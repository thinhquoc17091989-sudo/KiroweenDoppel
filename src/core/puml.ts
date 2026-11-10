/**
 * Parser and printer for Doppel's PlantUML subset.
 *
 * Supported lines (anything else is dropped on parse, see design.md):
 *   @startuml <title> / @enduml
 *   ' id: <id>        ' req: R1, R2        ' status: proposed|approved   (apply to the next element)
 *   component "Name" as Alias     interface "Name" as Alias     (quotes and alias optional)
 *   A --> B : label               A ..> B : label               (..> = proposed link)
 *   note right of A : one line
 *   note right of A ... end note
 *
 * print(parse(text)) is canonical; parse(print(model)) returns the same model.
 * That round trip is property-tested in test/puml.test.ts.
 */
import type { Element, ElementKind, Model, NoteSide, Status } from './model';

const RE_ELEMENT = /^(component|interface)\s+(?:"([^"]*)"|(\S+))(?:\s+as\s+(\w+))?\s*$/;
const RE_LINK = /^(\w+)\s+(-->|\.\.>)\s+(\w+)\s*(?::\s*(.*?))?\s*$/;
const RE_NOTE_HEAD = /^note\s+(right|left|top|bottom)\s+of\s+(\w+)\s*(?::\s*(.*?))?\s*$/;
const RE_META = /^'\s*(id|req|status)\s*:\s*(.*?)\s*$/;

export function aliasOf(name: string): string {
  const a = name.replace(/[^A-Za-z0-9_]+/g, '');
  return a.length ? a : 'E';
}

export function idOf(alias: string): string {
  return alias
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .toLowerCase()
    .replace(/^-+|-+$/g, '');
}

interface Pending { id?: string; req?: string[]; status?: Status }
interface RawNote { target: string; side: NoteSide; lines: string[] }

export function parse(text: string): Model {
  const model: Model = { title: '', elements: [], links: [], notes: [] };
  const byAlias = new Map<string, Element>();
  const rawLinks: Array<{ from: string; to: string; label: string; proposed: boolean }> = [];
  const rawNotes: RawNote[] = [];
  let pending: Pending = {};
  let openNote: RawNote | null = null;
  let skinDepth = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (openNote) {
      if (/^end\s*note$/i.test(line)) { rawNotes.push(openNote); openNote = null; }
      else openNote.lines.push(line);
      continue;
    }
    if (skinDepth > 0) {
      for (const ch of line) { if (ch === '{') skinDepth++; else if (ch === '}') skinDepth--; }
      continue;
    }
    if (line.startsWith('@startuml')) { const t = line.slice(9).trim(); if (t && !model.title) model.title = t; continue; }
    if (line.startsWith('@enduml')) continue;
    if (line.startsWith('skinparam')) { if (line.endsWith('{')) skinDepth = 1; continue; }
    if (line.startsWith('title ')) { if (!model.title) model.title = line.slice(6).trim(); continue; }
    if (/^(hide|scale|!|left to right direction|top to bottom direction)/.test(line)) continue;

    if (line.startsWith("'")) {
      const m = RE_META.exec(line);
      if (!m) continue;
      const key = m[1];
      const value = m[2] ?? '';
      if (key === 'id') pending.id = value;
      else if (key === 'req') pending.req = value.split(',').map((s) => s.trim()).filter(Boolean);
      else if (key === 'status' && (value === 'proposed' || value === 'approved')) pending.status = value;
      continue;
    }

    let m: RegExpExecArray | null;
    if ((m = RE_ELEMENT.exec(line))) {
      const kind = m[1] as ElementKind;
      const name = m[2] ?? m[3] ?? '';
      const alias = m[4] ?? aliasOf(name);
      const el: Element = {
        id: pending.id ?? idOf(alias),
        kind, name, alias,
        req: pending.req ?? [],
        status: pending.status ?? 'approved',
      };
      model.elements.push(el);
      byAlias.set(alias, el);
      pending = {};
      continue;
    }
    if ((m = RE_LINK.exec(line))) {
      rawLinks.push({ from: m[1]!, to: m[3]!, label: m[4] ?? '', proposed: m[2] === '..>' });
      continue;
    }
    if ((m = RE_NOTE_HEAD.exec(line))) {
      const note: RawNote = { target: m[2]!, side: m[1] as NoteSide, lines: [] };
      if (m[3] !== undefined) { note.lines.push(m[3]); rawNotes.push(note); }
      else openNote = note;
      continue;
    }
    // Unknown line: dropped by design.
  }
  if (openNote) rawNotes.push(openNote);

  const resolve = (alias: string) => byAlias.get(alias)?.id;
  for (const l of rawLinks) {
    const from = resolve(l.from), to = resolve(l.to);
    if (from && to) model.links.push({ from, to, label: l.label, proposed: l.proposed });
  }
  for (const n of rawNotes) {
    const target = resolve(n.target);
    if (target) model.notes.push({ target, side: n.side, lines: n.lines });
  }
  return model;
}

const q = (s: string) => `"${s.replace(/"/g, "'")}"`;

export function print(model: Model): string {
  const out: string[] = [model.title ? `@startuml ${model.title}` : '@startuml'];
  const aliasById = new Map(model.elements.map((e) => [e.id, e.alias] as const));

  for (const e of model.elements) {
    out.push('');
    out.push(`' id: ${e.id}`);
    if (e.req.length) out.push(`' req: ${e.req.join(', ')}`);
    if (e.status === 'proposed') out.push(`' status: proposed`);
    out.push(`${e.kind} ${q(e.name)} as ${e.alias}`);
  }

  if (model.links.length) out.push('');
  for (const l of model.links) {
    const from = aliasById.get(l.from), to = aliasById.get(l.to);
    if (!from || !to) continue;
    out.push(`${from} ${l.proposed ? '..>' : '-->'} ${to}${l.label ? ` : ${l.label}` : ''}`);
  }

  for (const n of model.notes) {
    const target = aliasById.get(n.target);
    if (!target) continue;
    out.push('');
    if (n.lines.length === 1) out.push(`note ${n.side} of ${target} : ${n.lines[0]}`);
    else {
      out.push(`note ${n.side} of ${target}`);
      for (const line of n.lines) out.push(`  ${line}`);
      out.push('end note');
    }
  }
  out.push('@enduml');
  return out.join('\n') + '\n';
}
