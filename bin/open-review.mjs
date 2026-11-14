#!/usr/bin/env node
/**
 * "Make sure the reviewer can see this." Run by a Kiro hook the moment a proposal is
 * written, so nobody has to remember to start Doppel first.
 *
 * It is deliberately almost always a no-op:
 *   - Doppel already running  -> do nothing. The running server is already watching the
 *                                proposals file; it pushes to any open page, and opens one
 *                                itself if none is open. Starting a second server here
 *                                would just fight the first for the port.
 *   - Doppel not running      -> start it detached and return immediately. It opens the
 *                                review page on startup, which shows the new proposal.
 *
 * Returning immediately matters: this runs from a hook, and a hook that blocks on a
 * long-running server would hang the agent's turn.
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.DOPPEL_PORT || 5173);
const URL_ROOT = `http://localhost:${PORT}/`;

/** Is a Doppel server already answering on this port? Checks /api/state specifically, so an
 *  unrelated app squatting the port is not mistaken for ours. */
async function doppelIsRunning() {
  try {
    const res = await fetch(`${URL_ROOT}api/state`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return false;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) return false;
    const data = await res.json();
    return data?.ok === true;
  } catch {
    return false; // nothing listening, or not ours
  }
}

if (await doppelIsRunning()) {
  console.log(`Doppel already running at ${URL_ROOT} — it will surface the proposal itself.`);
} else {
  const child = spawn(process.execPath, [resolve(PACKAGE_DIR, 'bin/doppel.mjs'), '--port', String(PORT)], {
    cwd: process.cwd(),       // the project the hook fired in, not Doppel's own folder
    detached: true,           // outlives this script, which must exit now
    stdio: 'ignore',
  });
  child.unref();
  console.log(`Started Doppel at ${URL_ROOT} to review the proposal.`);
}
