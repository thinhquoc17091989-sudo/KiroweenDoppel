/**
 * Finding the approved architecture on disk, in one place.
 *
 * `architecture/` is a hierarchy: a folder per feature, and dialects named by a suffix
 * before `.puml`. Every reader that scans it — the dev API, the MCP server, the drift
 * check, the trace recorder — has to walk it the same way, because a reader that only
 * looks at the top level silently ignores most of a real project's diagrams and then
 * reports drift it cannot see. That bug is easy to reintroduce separately in four files
 * and impossible to reintroduce in one, so the walk lives here.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isApprovedArchitectureFile } from '../dist-node/core/trace.js';

/** Every approved .puml under `dir`, at any depth, as sorted paths relative to it. */
export function listArchitectureFiles(dir, prefix = '') {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listArchitectureFiles(join(dir, entry.name), rel));
    else if (isApprovedArchitectureFile(entry.name)) out.push(rel);
  }
  return prefix ? out : out.sort();
}

/** The same files, read. `name` stays relative to `dir`, so it survives as a display path. */
export function readArchitectureFiles(dir) {
  return listArchitectureFiles(dir).map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }));
}
