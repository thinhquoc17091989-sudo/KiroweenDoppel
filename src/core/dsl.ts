/**
 * What every Doppel PlantUML-subset dialect shares: the `@startuml`/`@enduml` envelope,
 * and the `' id:` / `' req:` / `' status:` comment triplet that attaches trace metadata
 * to whichever declaration line comes next. src/core/puml.ts (the static dialect) predates
 * this file and keeps its own copy inline; state.ts, activity.ts and sequence.ts use this
 * one so the pattern is written once.
 */

export type Status = 'proposed' | 'approved' | 'modified';

export interface Pending {
  id?: string;
  req?: string[];
  status?: Status;
}

const RE_META = /^'\s*(id|req|status)\s*:\s*(.*?)\s*$/;

/**
 * Reads one meta comment line into `pending` (mutated in place). Returns true when the
 * line was a comment at all — including one this dialect does not recognize — so the
 * caller's loop always treats a `'`-line as consumed and never falls through to try
 * parsing it as a shape.
 */
export function readMeta(line: string, pending: Pending): boolean {
  if (!line.startsWith("'")) return false;
  const m = RE_META.exec(line);
  if (!m) return true;
  const key = m[1];
  const value = m[2] ?? '';
  if (key === 'id') pending.id = value;
  else if (key === 'req') pending.req = value.split(',').map((s) => s.trim()).filter(Boolean);
  else if (key === 'status' && (value === 'proposed' || value === 'approved' || value === 'modified')) {
    pending.status = value;
  }
  return true;
}

/** Writes the id/req/status lines ahead of a declaration. Omits status when it is the default, 'approved'. */
export function printMeta(id: string, req: string[], status: Status, out: string[]): void {
  out.push(`' id: ${id}`);
  if (req.length) out.push(`' req: ${req.join(', ')}`);
  if (status !== 'approved') out.push(`' status: ${status}`);
}

export interface Envelope {
  title: string;
  lines: string[];
}

/**
 * Strips `@startuml <title>` / `@enduml`, blank lines and surrounding whitespace. Every
 * other line is handed to the dialect's own grammar as-is; an unrecognized one is that
 * dialect's problem to drop, not this function's.
 */
export function stripEnvelope(text: string): Envelope {
  let title = '';
  const lines: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('@startuml')) {
      const t = line.slice('@startuml'.length).trim();
      if (t && !title) title = t;
      continue;
    }
    if (line.startsWith('@enduml')) continue;
    lines.push(line);
  }
  return { title, lines };
}

export function aliasOf(name: string, fallback: string): string {
  const a = name.replace(/[^A-Za-z0-9_]+/g, '');
  return a.length ? a : fallback;
}

export function idOf(alias: string): string {
  return alias
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .toLowerCase()
    .replace(/^-+|-+$/g, '');
}

export const quote = (s: string): string => `"${s.replace(/"/g, "'")}"`;
