#!/usr/bin/env node
/**
 * Records that code and a test now exist for one element: `node mcp/update-trace.mjs <id>`.
 *
 * This exists because the hash in trace.json has to come from hashElement() itself, never
 * from an agent reproducing FNV-1a by hand — a hand-written hash that happens to differ
 * from the real one would make check-drift.mjs report every element as stale forever,
 * which is worse than no trace row at all. The hook (and anyone else recording a
 * generation) calls this script after writing src/<id>.ts and test/<id>.test.ts, rather
 * than editing trace.json directly.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parsePuml } from '../src/core/puml.ts';
import { emptyTrace, hashElement, parseTrace, pathsFor, printTrace, upsertRow } from '../src/core/trace.ts';

const [, , elementId] = process.argv;
const root = process.cwd();
const archDir = join(root, 'architecture');
const tracePath = join(root, 'trace.json');

if (!elementId) {
  console.error('Usage: node mcp/update-trace.mjs <element-id>');
  process.exitCode = 1;
} else {
  const files = existsSync(archDir) ? readdirSync(archDir).filter((f) => f.endsWith('.puml')) : [];
  let found;
  for (const f of files) {
    const e = parsePuml(readFileSync(join(archDir, f), 'utf8')).elements.find((x) => x.id === elementId);
    if (e) { found = e; break; }
  }

  if (!found) {
    console.error(`No element with id "${elementId}" found in architecture/*.puml`);
    process.exitCode = 1;
  } else {
    const trace = existsSync(tracePath)
      ? (() => { try { return parseTrace(readFileSync(tracePath, 'utf8')); } catch { return emptyTrace(); } })()
      : emptyTrace();
    const row = { id: found.id, req: found.req, ...pathsFor(found.id), hash: hashElement(found) };
    writeFileSync(tracePath, printTrace(upsertRow(trace, row)));
    console.log(`trace.json updated: ${row.id} -> ${row.codePath}, ${row.testPath} (hash ${row.hash})`);
  }
}
