#!/usr/bin/env node
/**
 * Records that code and a test now exist for one element.
 *
 * CLI: `node mcp/update-trace.mjs <id>` — what the hook calls after generating code.
 * Importable: `recordGeneration(elementId, { root })` — what dev/dev-server.mjs calls,
 * so the two never drift apart into two copies of the same logic.
 *
 * This exists because the hash in trace.json has to come from hashElement() itself, never
 * from an agent reproducing FNV-1a by hand — a hand-written hash that happens to differ
 * from the real one would make check-drift.mjs report every element as stale forever,
 * which is worse than no trace row at all.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse as parsePuml } from '../dist-node/core/puml.js';
import { readArchitectureFiles } from './arch-files.mjs';
import { emptyTrace, hashElement, parseTrace, pathsFor, printTrace, upsertRow } from '../dist-node/core/trace.js';

/**
 * @param {string} elementId
 * @param {{ root?: string }} [opts]
 * @returns {{ ok: true, row: object } | { ok: false, error: string }}
 */
export function recordGeneration(elementId, opts = {}) {
  const root = opts.root ?? process.cwd();
  const archDir = join(root, 'architecture');
  const tracePath = join(root, 'trace.json');

  let found;
  for (const f of readArchitectureFiles(archDir)) {
    const e = parsePuml(f.text).elements.find((x) => x.id === elementId);
    if (e) { found = e; break; }
  }
  if (!found) return { ok: false, error: `No element with id "${elementId}" found in architecture/*.puml` };

  const trace = existsSync(tracePath)
    ? (() => { try { return parseTrace(readFileSync(tracePath, 'utf8')); } catch { return emptyTrace(); } })()
    : emptyTrace();
  const row = { id: found.id, req: found.req, ...pathsFor(found.id), hash: hashElement(found) };
  writeFileSync(tracePath, printTrace(upsertRow(trace, row)));
  return { ok: true, row };
}

// CLI entry point only when run directly, e.g. `node mcp/update-trace.mjs <id>` — importing
// this file (dev-server.mjs does) must never also run this block.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const rootArg = args.indexOf('--root');
  const root = rootArg >= 0 && args[rootArg + 1] ? resolve(args[rootArg + 1]) : process.cwd();
  const elementId = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--root');
  if (!elementId) {
    console.error('Usage: node mcp/update-trace.mjs <element-id> [--root <project-dir>]');
    process.exitCode = 1;
  } else {
    const result = recordGeneration(elementId, { root });
    if (!result.ok) {
      console.error(result.error);
      process.exitCode = 1;
    } else {
      console.log(`trace.json updated: ${result.row.id} -> ${result.row.codePath}, ${result.row.testPath} (hash ${result.row.hash})`);
    }
  }
}
