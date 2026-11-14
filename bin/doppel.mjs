#!/usr/bin/env node
/**
 * `npx doppel` — the one-command entry point. Run it inside any project and it serves the
 * review page against THAT project's architecture/ and proposals files.
 *
 * The distinction that makes this work: Vite's root is the DOPPEL PACKAGE (where index.html
 * and src/ live), while the API plugin reads the HOST PROJECT (wherever the command was run).
 * Conflating the two is the obvious bug here — Vite would look for index.html in the user's
 * repo and fail, or the API would serve Doppel's own sample instead of their architecture.
 *
 * Commands:
 *   doppel          serve the review page for this project
 *   doppel init     scaffold this project so Kiro knows about Doppel here (steering, hook,
 *                   MCP registration). Run this once in a new project before serving.
 *
 * Flags:
 *   --port <n>   port to listen on (default 5173, falls forward if taken)
 *   --no-open    don't launch a browser
 *   --root <dir> treat this directory as the project (default: the current directory)
 */
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { doppelDevApi } from '../dev/api-plugin.mjs';
import { reportInit, runInit } from './init.mjs';

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const projectRoot = resolve(arg('--root', process.cwd()));
const port = Number(arg('--port', '5173'));
const open = !process.argv.includes('--no-open');

if (process.argv[2] === 'init') {
  reportInit(runInit(projectRoot, PACKAGE_DIR));
  process.exit(0);
}

if (projectRoot === PACKAGE_DIR) {
  console.log('Doppel: running against its own repository.');
} else {
  console.log(`Doppel: serving the review page for ${projectRoot}`);
}

// Say plainly what is and is not there, rather than opening a page that looks broken.
const hasArch = existsSync(resolve(projectRoot, 'architecture'));
const hasKiro = existsSync(resolve(projectRoot, '.kiro'));
if (!hasArch) console.log('  note: no architecture/ folder here yet — approve something and Doppel will create it.');
if (!hasKiro) console.log('  note: no .kiro/ folder here yet — Kiro will not have steering or hooks for this project.');

const server = await createServer({
  configFile: false,          // do not pick up the host project's vite config
  root: PACKAGE_DIR,          // index.html and src/ live in the package
  plugins: [doppelDevApi(projectRoot)], // but the data comes from the host project
  server: { port, open: false },
  logLevel: 'warn',
});

await server.listen();
const url = `http://localhost:${server.config.server.port ?? port}/`;
console.log(`\n  Doppel is running: ${url}`);
console.log(`  Dev console:       ${url}dev/console.html`);
console.log('  Press Ctrl+C to stop.\n');

if (open) {
  const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
}
