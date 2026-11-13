/**
 * Vite plugin: the dev console's server-side half, mounted onto Vite's own dev server via
 * configureServer, so one `vite` process serves the real app (index.html), the dev console
 * (dev/console.html) AND these API routes, all on one port. No separate server to run or
 * keep in sync with a second port.
 *
 * GET  /api/state        -> architecture files, the plant-watering proposals file, trace,
 *                            drift — everything the console's diagrams and tables need.
 * POST /api/run {task, model} -> runs Kiro CLI on the task (fs_read/fs_write trust only,
 *                            no shell — the same scoping every manual Kiro call in this
 *                            project uses; a broader grant was denied by this environment's
 *                            own sandbox once already), then auto-syncs trace.json for
 *                            whichever src/<id>.ts files actually changed, detected by
 *                            comparing file CONTENT before and after (an earlier mtime-based
 *                            version of this check missed a real edit during testing — see
 *                            design.md's "Dev console" section for what went wrong and why
 *                            content comparison replaced it).
 */
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { recordGeneration } from '../mcp/update-trace.mjs';
import { parse as parsePuml } from '../src/core/puml.ts';
import { computeStatus, emptyTrace, isApprovedArchitectureFile, orphanRows, parseTrace } from '../src/core/trace.ts';

const MODELS = ['claude-haiku-5.5', 'claude-sonnet-5.5', 'claude-opus-5.5', 'auto'];
const KIRO_EXE = join(process.env.LOCALAPPDATA ?? '', 'kiro-cli', 'kiro-cli.exe');
/**
 * Where a proposals file might live, in priority order. Hardcoding only the samples/ path
 * (as an earlier version did) meant a real project had to mimic Doppel's demo folder layout
 * before anything showed up — found by actually running the CLI against another project.
 *
 * Deliberately NOT `architecture/proposals.puml`, even though that reads as the natural
 * spot: `architecture/` means APPROVED, and `.kiro/steering/architecture.md` feeds
 * `architecture/*.puml` to Kiro as the approved truth. A proposals file living there would
 * hand Kiro unapproved proposals as settled design and double-count every element that
 * appears in both — which is exactly what happened when it was tried.
 */
const PROPOSALS_CANDIDATES = [
  'proposals.puml',
  'doppel/proposals.puml',
  'samples/plant-watering/proposals.puml',
];

/** Never counted as approved architecture, wherever someone puts it. */
const PROPOSALS_BASENAME = 'proposals.puml';

export function doppelDevApi(root) {
  const archDir = join(root, 'architecture');
  const tracePath = join(root, 'trace.json');

  function loadArchitecture() {
    if (!existsSync(archDir)) return { files: [], elements: [] };
    const names = readdirSync(archDir).filter(isApprovedArchitectureFile);
    const files = names.map((name) => ({ name, text: readFileSync(join(archDir, name), 'utf8') }));
    const elements = files.flatMap((f) => parsePuml(f.text).elements);
    return { files, elements };
  }

  function loadProposals() {
    for (const rel of PROPOSALS_CANDIDATES) {
      const abs = join(root, rel);
      if (existsSync(abs)) return { name: rel, text: readFileSync(abs, 'utf8') };
    }
    return null;
  }

  function loadTrace() {
    if (!existsSync(tracePath)) return emptyTrace();
    try { return parseTrace(readFileSync(tracePath, 'utf8')); } catch { return emptyTrace(); }
  }

  function currentState() {
    const { files, elements } = loadArchitecture();
    const trace = loadTrace();
    const entries = computeStatus(elements, trace);
    const orphans = orphanRows(elements, trace);
    return { architectureFiles: files, proposalsFile: loadProposals(), entries, orphans, elementCount: elements.length };
  }

  function codeFileContents(elements) {
    const content = new Map();
    for (const e of elements) {
      const p = join(root, 'src', `${e.id}.ts`);
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
      const args = ['chat', '--no-interactive', '--trust-workspace', '--trust-tools=fs_read,fs_write', '--model', model, task];
      execFile(KIRO_EXE, args, { cwd: root, timeout: 10 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
        resolve({ ok: !err, output: (stdout || '') + (stderr ? `\n${stderr}` : ''), error: err ? String(err.message) : undefined });
      });
    });
  }

  async function runTask(task, model) {
    const before = loadArchitecture();
    const beforeContent = codeFileContents(before.elements);

    const kiro = await runKiro(task, MODELS.includes(model) ? model : 'claude-sonnet-5.5');

    const after = loadArchitecture();
    const afterContent = codeFileContents(after.elements);
    const synced = [];
    for (const e of after.elements) {
      if (!afterContent.has(e.id)) continue;
      if (afterContent.get(e.id) !== beforeContent.get(e.id)) {
        const result = recordGeneration(e.id, { root });
        if (result.ok) synced.push(e.id);
      }
    }
    return { kiro, synced, state: currentState() };
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (c) => { data += c; if (data.length > 1_000_000) req.destroy(); });
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });
  }

  function sendJson(res, status, body) {
    const text = JSON.stringify(body);
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(text);
  }

  return {
    name: 'doppel-dev-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          if (req.url === '/api/state' && req.method === 'GET') {
            sendJson(res, 200, { ok: true, models: MODELS, ...currentState() });
            return;
          }
          if (req.url === '/api/run' && req.method === 'POST') {
            const body = JSON.parse((await readBody(req)) || '{}');
            const task = String(body.task ?? '').trim();
            if (!task) { sendJson(res, 400, { ok: false, error: 'task is required' }); return; }
            const result = await runTask(task, String(body.model ?? ''));
            sendJson(res, 200, { ok: true, ...result });
            return;
          }
        } catch (err) {
          sendJson(res, 500, { ok: false, error: String(err?.message ?? err) });
          return;
        }
        next();
      });
    },
  };
}
