/**
 * trace.json: the project-wide record linking an architecture element to its generated
 * code, its generated test, the requirements it satisfies, and a hash of the element's
 * own text at the moment that code was (re)generated. Comparing that stored hash against
 * the element's CURRENT hash is the entire mechanism behind "in sync" vs "stale" (R5) and
 * behind drift (R6, see mcp/check-drift.mjs) — no file timestamps, no git diff, just text.
 *
 * This module owns the hash and the sync/stale/missing computation. It does NOT generate
 * code or write new rows itself — that is the hook's job (task 8, agent work) when it
 * (re)generates a file; this module only tells the hook, the UI and the drift checker
 * what the CURRENT state is, given whatever trace.json already holds.
 */
import type { Element } from './model.ts';

export interface TraceRow {
  /** Element id. One row per element that has ever had code generated for it. */
  id: string;
  /** Requirement ids this element satisfies, copied from the element at generation time. */
  req: string[];
  codePath: string;
  testPath: string;
  /** Hash of the element's block AT THE MOMENT its code/test were last generated. */
  hash: string;
}

export type TraceFile = Record<string, TraceRow>; // keyed by element id, same key as the row's own id

export type ElementState = 'in-sync' | 'stale' | 'no-code';

export interface TraceEntry {
  id: string;
  name: string;
  req: string[];
  state: ElementState;
  codePath?: string;
  testPath?: string;
}

/**
 * A short, stable hash of the text that actually matters for regeneration: kind, name,
 * requirements and status — not id (identity, not content) and not position (layout.json's
 * concern, not trace's). Pure and deterministic: same element, same hash, forever, so two
 * reviewers (or a reviewer and CI) agree on whether something changed without diffing files.
 * FNV-1a: small, dependency-free, good enough to detect accidental collision at this scale
 * (a handful of elements per project), not cryptographic — trace.json is not a security
 * boundary.
 */
export function hashElement(e: Element): string {
  const material = JSON.stringify([e.kind, e.name, [...e.req].sort()]);
  let h = 0x811c9dc5;
  for (let i = 0; i < material.length; i++) {
    h ^= material.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** The paths code generation is expected to use for an element — the one convention every
 *  dialect, the hook and the UI all agree on, so nothing has to ask trace.json where a new
 *  element's files WOULD go before they exist. */
export function pathsFor(id: string): { codePath: string; testPath: string } {
  return { codePath: `src/${id}.ts`, testPath: `test/${id}.test.ts` };
}

/**
 * Whether a file inside architecture/ counts as APPROVED architecture.
 *
 * Defined once here because five separate readers glob that folder (the dev API, the MCP
 * server, both mcp/ scripts and the review page) and they must agree exactly: anything they
 * accept is handed to Kiro as settled design via `.kiro/steering/architecture.md`, which
 * includes `architecture/*.puml` wholesale. A proposals file that slipped into that folder
 * would be read as approved and double-count every element it shares with the real
 * architecture — observed for real before this guard existed.
 */
export function isApprovedArchitectureFile(name: string): boolean {
  return name.endsWith('.puml') && name.toLowerCase() !== 'proposals.puml';
}

export function emptyTrace(): TraceFile {
  return {};
}

export function parseTrace(text: string): TraceFile {
  const data: unknown = JSON.parse(text);
  if (!data || typeof data !== 'object') return {};
  return data as TraceFile;
}

export function printTrace(trace: TraceFile): string {
  // Keys sorted so trace.json diffs cleanly in git regardless of generation order.
  const sorted: TraceFile = {};
  for (const id of Object.keys(trace).sort()) sorted[id] = trace[id]!;
  return JSON.stringify(sorted, null, 2) + '\n';
}

/** One row, inserted or replacing whichever row shares its id. Pure: returns a new TraceFile. */
export function upsertRow(trace: TraceFile, row: TraceRow): TraceFile {
  return { ...trace, [row.id]: row };
}

export function removeRow(trace: TraceFile, id: string): TraceFile {
  const { [id]: _removed, ...rest } = trace;
  return rest;
}

/**
 * The live view every UI and the drift checker actually want: for each element that is
 * currently part of the architecture (R5.1), its name, requirements and state against
 * trace.json — 'no-code' when nothing was ever generated for it (a brand-new approval, or
 * trace.json has simply never been written), 'stale' when generated code exists but the
 * element's content has changed since, 'in-sync' otherwise. Interface elements, which
 * never get a test file by convention (see samples/plant-watering/proposals.puml), still
 * get a row and a state the same way; a missing testPath is not itself staleness.
 */
export function computeStatus(elements: readonly Element[], trace: TraceFile): TraceEntry[] {
  return elements.map((e) => {
    const row = trace[e.id];
    if (!row) return { id: e.id, name: e.name, req: e.req, state: 'no-code' };
    const state: ElementState = row.hash === hashElement(e) ? 'in-sync' : 'stale';
    return { id: e.id, name: e.name, req: e.req, state, codePath: row.codePath, testPath: row.testPath };
  });
}

/** Trace rows whose element no longer exists in the current architecture at all — an
 *  orphan, the other half of drift (R6): code was generated, the element was since removed
 *  or renamed (a rename keeps the id, so this only fires on a real removal), and the file
 *  is still sitting there with nothing in the architecture to justify it. */
export function orphanRows(elements: readonly Element[], trace: TraceFile): TraceRow[] {
  const liveIds = new Set(elements.map((e) => e.id));
  return Object.values(trace).filter((row) => !liveIds.has(row.id));
}
