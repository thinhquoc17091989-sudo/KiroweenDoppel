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
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, watch, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { recordGeneration } from '../mcp/update-trace.mjs';
import { readArchitectureFiles } from '../mcp/arch-files.mjs';
import { layoutPathFor, normaliseTarget } from '../dist-node/core/paths.js';
import { parse as parsePuml } from '../dist-node/core/puml.js';
import { computeStatus, emptyTrace, orphanRows, parseTrace } from '../dist-node/core/trace.js';

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

export function doppelDevApi(root, { autoOpen = true } = {}) {
  const archDir = join(root, 'architecture');
  const tracePath = join(root, 'trace.json');
  // Hand-placed positions live here, committed with the repo so the whole team opens a
  // diagram arranged the same way. Never under architecture/, which steering feeds to Kiro.
  const layoutDir = join(root, '.doppel', 'layout');

  function loadArchitecture() {
    const files = readArchitectureFiles(archDir);
    return { files, elements: files.flatMap((f) => parsePuml(f.text).elements) };
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

  /** Every stored layout, keyed by the diagram path it belongs to. */
  function loadLayouts(dir = layoutDir, prefix = '') {
    if (!existsSync(dir)) return {};
    const out = {};
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) Object.assign(out, loadLayouts(join(dir, entry.name), rel));
      else if (entry.name.endsWith('.json')) {
        try { out[rel.replace(/\.json$/, '.puml')] = JSON.parse(readFileSync(join(dir, entry.name), 'utf8')); }
        catch { /* a corrupt layout reads as "never arranged", not a crash */ }
      }
    }
    return out;
  }

  function currentState() {
    const { files, elements } = loadArchitecture();
    const trace = loadTrace();
    const entries = computeStatus(elements, trace);
    const orphans = orphanRows(elements, trace);
    return { architectureFiles: files, proposalsFile: loadProposals(), entries, orphans, elementCount: elements.length, layouts: loadLayouts() };
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
      /**
       * Watch the proposals file so a reviewer never has to ask "has Kiro finished yet".
       * Kiro writes a proposal, this notices, and the open page shows it immediately. If no
       * page is open, a window is opened — that is the "it pops up" behaviour, done from
       * the server because a browser tab cannot open itself.
       *
       * Deliberately watched by its CONTENT, not just the fs event: editors and agents
       * commonly write a file two or three times in a row (truncate, write, rename), which
       * fires several events for one logical change and would otherwise open three windows.
       */
      const clients = new Set();
      let lastSeen = loadProposals()?.text ?? null;
      let settle = null;

      const notify = () => {
        const current = loadProposals();
        if (!current || current.text === lastSeen) return; // nothing actually changed
        lastSeen = current.text;

        const payload = `data: ${JSON.stringify({ type: 'proposals-changed', file: current.name })}\n\n`;
        for (const res of clients) { try { res.write(payload); } catch { clients.delete(res); } }

        if (clients.size === 0 && !autoOpen) {
          // Started with --no-open: respect that later too, rather than springing a window
          // on someone who explicitly asked for none.
          console.log(`  Doppel: Kiro proposed a change in ${current.name} (no page open; not opening one)`);
        } else if (clients.size === 0) {
          // Nobody is watching: open the review page so the proposal is seen at all.
          const url = `http://localhost:${server.config.server.port ?? 5173}/`;
          const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
          const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
          try { spawn(cmd, args, { stdio: 'ignore', detached: true }).unref(); } catch { /* headless: fine */ }
          console.log(`\n  Doppel: Kiro proposed a change in ${current.name} — opening ${url}\n`);
        } else {
          console.log(`  Doppel: Kiro proposed a change in ${current.name} — pushed to ${clients.size} open page(s)`);
        }
      };

      // Watch the whole project root shallowly; fs.watch on a single file misses rewrites
      // that replace the inode, which is exactly how many editors and agents save.
      let watcher = null;
      try {
        watcher = watch(root, { recursive: false }, (_event, filename) => {
          if (!filename || !String(filename).endsWith('.puml')) return;
          clearTimeout(settle);
          settle = setTimeout(notify, 250); // coalesce a burst of writes into one notification
        });
        watcher.unref?.(); // never hold the process open on our account
      } catch (err) {
        console.warn('  Doppel: could not watch for proposals —', err.message);
      }

      // Release the watcher, the debounce timer and any held-open SSE responses when the
      // server stops. Without this the handles keep the process alive -- which showed up as
      // vitest reporting "something prevents 2 Vite servers from exiting".
      const cleanup = () => {
        clearTimeout(settle);
        try { watcher?.close(); } catch { /* already closed */ }
        for (const res of clients) { try { res.end(); } catch { /* already gone */ } }
        clients.clear();
      };
      server.httpServer?.once('close', cleanup);
      process.once('exit', cleanup);

      server.middlewares.use('/api/events', (req, res) => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        res.write('retry: 2000\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
      });

      server.middlewares.use(async (req, res, next) => {
        try {
          if (req.url === '/api/state' && req.method === 'GET') {
            sendJson(res, 200, { ok: true, models: MODELS, ...currentState() });
            return;
          }
          if (req.url === '/api/approve' && req.method === 'POST') {
            const body = JSON.parse((await readBody(req)) || '{}');
            // Validated with the same rule the browser uses, not trusted from it: this
            // writes to disk, so a target that climbs out of architecture/ is refused here
            // whatever the page asked for.
            const target = normaliseTarget(String(body.target ?? ''));
            const text = String(body.text ?? '');
            if (!target) { sendJson(res, 400, { ok: false, error: 'target must be a .puml path inside architecture/' }); return; }
            if (!text.trim()) { sendJson(res, 400, { ok: false, error: 'nothing to write' }); return; }
            const abs = join(archDir, ...target.split('/'));
            mkdirSync(dirname(abs), { recursive: true });
            writeFileSync(abs, text, 'utf8');
            sendJson(res, 200, { ok: true, path: `architecture/${target}` });
            return;
          }
          if (req.url === '/api/layout' && req.method === 'POST') {
            const body = JSON.parse((await readBody(req)) || '{}');
            const rel = layoutPathFor(String(body.path ?? ''));
            if (!rel) { sendJson(res, 400, { ok: false, error: 'path must be a .puml diagram inside the project' }); return; }
            const abs = join(layoutDir, ...rel.split('/'));
            mkdirSync(dirname(abs), { recursive: true });
            // Sorted keys keep the diff small when two people arrange different boxes.
            const layout = body.layout && typeof body.layout === 'object' ? body.layout : {};
            const sorted = Object.fromEntries(Object.keys(layout).sort().map((k) => [k, layout[k]]));
            writeFileSync(abs, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
            sendJson(res, 200, { ok: true, path: `.doppel/layout/${rel}` });
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
