#!/usr/bin/env node
/**
 * Drift checker: compares architecture/*.puml (static dialect only, see scope note below)
 * against trace.json and reports what has no code yet, what has gone stale since its code
 * was generated, and which trace rows are orphaned (their element was removed). This is a
 * plain Node script today, task 10's first half; the second half wraps this same logic as
 * a real MCP tool (check_drift / list_trace) Kiro can call directly, not yet built. Node 24
 * strips TypeScript types natively, so this imports src/core/*.ts straight from source —
 * no build step, no duplicated parsing logic.
 *
 * Scope: static (.puml) only. The dynamic dialects (state/activity/sequence) are not yet
 * written into architecture/ by anything real (see design.md's "Not done this pass"), so
 * there is nothing to scan there yet. "Orphan" here means a trace.json row whose element
 * no longer exists — not a filesystem scan for an unreferenced source file, which would
 * need a convention nothing enforces yet (follow-up, not this script).
 *
 * Usage: node mcp/check-drift.mjs [--brief]
 * Always exits 0 (by falling off the end, not by calling process.exit — on this Node
 * version, process.exit() right after the TypeScript type-stripping loader's async hooks
 * raises a libuv assertion on Windows; letting the event loop drain naturally avoids it).
 * Drift found is information for the agent, not a script failure. A missing or corrupt
 * trace.json is treated as "no trace yet", not an error.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parsePuml } from '../src/core/puml.ts';
import { computeStatus, emptyTrace, orphanRows, parseTrace } from '../src/core/trace.ts';

const root = process.cwd();
const archDir = join(root, 'architecture');
const tracePath = join(root, 'trace.json');
const brief = process.argv.includes('--brief');

function loadArchitectureElements() {
  if (!existsSync(archDir)) return [];
  const files = readdirSync(archDir).filter((f) => f.endsWith('.puml'));
  const elements = [];
  for (const f of files) {
    const text = readFileSync(join(archDir, f), 'utf8');
    elements.push(...parsePuml(text).elements);
  }
  return elements;
}

function loadTrace() {
  if (!existsSync(tracePath)) return emptyTrace();
  try {
    return parseTrace(readFileSync(tracePath, 'utf8'));
  } catch {
    return emptyTrace(); // corrupt trace.json reads as "nothing generated yet", not a crash
  }
}

const elements = loadArchitectureElements();
const trace = loadTrace();
const entries = computeStatus(elements, trace);
const orphans = orphanRows(elements, trace);
const noCode = entries.filter((e) => e.state === 'no-code');
const stale = entries.filter((e) => e.state === 'stale');

if (!elements.length) {
  console.log(brief ? 'drift: no architecture files yet.' : 'No architecture/*.puml files found yet — nothing to check.');
} else if (!noCode.length && !stale.length && !orphans.length) {
  console.log(brief ? 'drift: none.' : 'No drift: every element is in sync, no orphan trace rows.');
} else if (brief) {
  const parts = [];
  if (noCode.length) parts.push(`${noCode.length} with no code`);
  if (stale.length) parts.push(`${stale.length} stale`);
  if (orphans.length) parts.push(`${orphans.length} orphan trace row(s)`);
  console.log(`drift: ${parts.join(', ')}.`);
} else {
  console.log('Drift report');
  console.log('============');
  if (noCode.length) {
    console.log(`\n${noCode.length} element(s) with no generated code:`);
    for (const e of noCode) console.log(`  - ${e.id} (${e.name})`);
  }
  if (stale.length) {
    console.log(`\n${stale.length} stale element(s) — changed since their code was generated:`);
    for (const e of stale) console.log(`  - ${e.id} (${e.name}) -> ${e.codePath}`);
  }
  if (orphans.length) {
    console.log(`\n${orphans.length} orphan trace row(s) — element no longer in the architecture:`);
    for (const r of orphans) console.log(`  - ${r.id} -> ${r.codePath}`);
  }
}
