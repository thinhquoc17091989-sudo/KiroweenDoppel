#!/usr/bin/env node
/**
 * Dev console server. A developer tool for fast iteration on Doppel itself, NOT part of
 * the Doppel product — the shipped review page (index.html) never calls this. It exists
 * because a browser page cannot spawn a process on its own: this is the thin piece of
 * Node glue behind dev/console.html that lets a plain web page type a task description,
 * trigger a real Kiro CLI run, and see the architecture/trace/drift state change, without
 * anyone typing a command.
 *
 * Binds to 127.0.0.1 only — never reachable from the network, this machine only.
 *
 * Endpoints:
 *   GET  /                 -> dev/console.html
 *   GET  /api/state        -> current architecture files, trace.json, drift report (no Kiro call, free)
 *   POST /api/run {task, model} -> runs Kiro CLI on the task (fs_read/fs_write only, no
 *                                  shell trust — same scoping every manual Kiro call in
 *                                  this project has used), then re-syncs trace.json for
 *                                  whatever source files Kiro actually touched (detected
 *                                  by mtime, not by trusting Kiro's own report of what it
 *                                  did), then returns Kiro's output plus the fresh state.
 */
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { recordGeneration } from '../mcp/update-trace.mjs';
import { parse as parsePuml } from '../src/core/puml.ts';
import { computeStatus, emptyTrace, orphanRows, parseTrace } from '../src/core/trace.ts';

const ROOT = join(import.meta.dirname, '..');
const PORT = 5175;
const KIRO_EXE = join(process.env.LOCALAPPDATA ?? '', 'kiro-cli', 'kiro-cli.exe');
const MODELS = ['claude-haiku-5.5', 'claude-sonnet-5.5', 'claude-opus-5.5', 'auto'];

function archDir() { return join(ROOT, 'architecture'); }
function tracePath() { return join(ROOT, 'trace.json'); }

function loadArchitecture() {
  const dir = archDir();
  if (!existsSync(dir)) return { files: [], elements: [] };
  const names = readdirSync(dir).filter((f) => f.endsWith('.puml'));
  const files = names.map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }));
  const elements = files.flatMap((f) => parsePuml(f.text).elements);
  return { files, elements };
}

function loadTrace() {
  if (!existsSync(tracePath())) return emptyTrace();
  try { return parseTrace(readFileSync(tracePath(), 'utf8')); } catch { return emptyTrace(); }
}

function currentState() {
  const { files, elements } = loadArchitecture();
  const trace = loadTrace();
  const entries = computeStatus(elements, trace);
  const orphans = orphanRows(elements, trace);
  return { architectureFiles: files, entries, orphans, elementCount: elements.length };
}

/** Which source files exist and their exact content, for the "what did this Kiro run
 *  actually touch" check in runTask below. Content, not mtime: an mtime-based version of
 *  this check was tried first and missed a real edit during testing (Kiro wrote a line
 *  into moisture-sensor.ts, said in its own text response that it had not, and the
 *  written file's mtime did not come back later than the run's start time either — on
 *  this Windows/Node combination, something in the write-then-exit path does not give a
 *  timestamp this check can trust). Content comparison has no timing precision to get
 *  wrong: a byte-for-byte unchanged file is provably untouched, full stop. */
function codeFileContents(elements) {
  const content = new Map();
  for (const e of elements) {
    const p = join(ROOT, 'src', `${e.id}.ts`);
    if (existsSync(p)) content.set(e.id, readFileSync(p, 'utf8'));
  }
  return content;
}

function runKiro(task, model) {
  return new Promise((resolve) => {
    if (!existsSync(KIRO_EXE)) {
      resolve({ ok: false, output: `Kiro CLI not found at ${KIRO_EXE}` });
      return;
    }
    const args = [
      'chat', '--no-interactive', '--trust-workspace',
      '--trust-tools=fs_read,fs_write',
      '--model', model,
      task,
    ];
    execFile(KIRO_EXE, args, { cwd: ROOT, timeout: 10 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, output: (stdout || '') + (stderr ? `\n${stderr}` : ''), error: err ? String(err.message) : undefined });
    });
  });
}

async function runTask(task, model) {
  const before = loadArchitecture();
  const beforeContent = codeFileContents(before.elements);

  const kiro = await runKiro(task, MODELS.includes(model) ? model : 'claude-sonnet-5.5');

  // Auto-sync: for every element whose src/<id>.ts content differs from (or did not exist
  // before) this run, record a fresh trace row. This is the console doing the hook's "call
  // update-trace.mjs" step on the agent's behalf, since this flow deliberately does not
  // grant Kiro shell trust (see steering's origin rule discussion and the earlier sandbox
  // denial on granting that trust). An element Kiro did NOT touch this run keeps its
  // existing row untouched, so a genuinely stale element is never silently marked fixed
  // just because some OTHER element changed.
  const after = loadArchitecture();
  const afterContent = codeFileContents(after.elements);
  const synced = [];
  for (const e of after.elements) {
    if (!afterContent.has(e.id)) continue;
    const touchedThisRun = afterContent.get(e.id) !== beforeContent.get(e.id); // undefined !== string is true for a brand-new file
    if (touchedThisRun) {
      const result = recordGeneration(e.id, { root: ROOT });
      if (result.ok) synced.push(e.id);
    }
  }

  return { kiro, synced, state: currentState() };
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text) });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1_000_000) req.destroy(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/') {
      const html = readFileSync(join(import.meta.dirname, 'console.html'));
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      res.end(html);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/state') {
      sendJson(res, 200, { ok: true, models: MODELS, ...currentState() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/run') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const task = String(body.task ?? '').trim();
      if (!task) { sendJson(res, 400, { ok: false, error: 'task is required' }); return; }
      const result = await runTask(task, String(body.model ?? ''));
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  } catch (err) {
    sendJson(res, 500, { ok: false, error: String(err?.message ?? err) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Doppel dev console: http://127.0.0.1:${PORT}`);
});
