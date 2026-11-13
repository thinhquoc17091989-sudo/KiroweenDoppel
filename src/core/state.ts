/**
 * Parser and printer for Doppel's state-machine dialect (`*.state.puml`).
 *
 * A deliberate simplification of real PlantUML state diagrams, matching the static
 * dialect's own "block dialect only" cut (see design.md): one flat machine, no composite
 * states, no concurrent regions, no choice/fork/history pseudostates — only `[*]` as the
 * machine's single start and end. States carry the same `' id:` / `' req:` / `' status:`
 * triplet as static elements; transitions are secondary, like static Links, carrying only
 * `proposed` (dashed `..>`) vs not (solid `-->`) — never their own id or modified status.
 *
 *   state "Name" as Alias
 *   [*] --> Alias : label        (also Alias --> [*], Alias --> Alias2 : label)
 *
 * Composite states, concurrency and the full pseudostate set are tracked as follow-up
 * work (see tasks.md); a line using them is simply dropped, the same policy the static
 * dialect uses for anything outside its own subset.
 */
import { aliasOf, idOf, printMeta, quote, readMeta, stripEnvelope, type Pending, type Status } from './dsl';

export interface StateNode {
  id: string;
  name: string;
  alias: string;
  req: string[];
  status: Status;
}

export interface StateTransition {
  /** A state id, or START — never END. `[*]` on the left of an arrow always means the
   *  machine's initial pseudostate in this grammar (no reversed arrows are supported). */
  from: string;
  /** A state id, or END — never START, for the same reason. */
  to: string;
  label: string;
  proposed: boolean;
}

export interface StateDiagram {
  title: string;
  states: StateNode[];
  transitions: StateTransition[];
}

/** The machine's single entry and exit, both spelled `[*]` in PlantUML; which one a given
 *  `[*]` means is read off the arrow's direction (a prior in-house editor's rule, reused as an idea only). */
export const START = 'start';
export const END = 'end';

const RE_STATE = /^state\s+(?:"([^"]*)"|(\S+))(?:\s+as\s+(\w+))?\s*$/;
const RE_TRANS = /^(\[\*\]|\w+)\s+(-->|\.\.>)\s+(\[\*\]|\w+)\s*(?::\s*(.*?))?\s*$/;

export function parse(text: string): StateDiagram {
  const { title, lines } = stripEnvelope(text);
  const states: StateNode[] = [];
  const byAlias = new Map<string, StateNode>();
  const rawTrans: Array<{ from: string; to: string; label: string; proposed: boolean }> = [];
  let pending: Pending = {};

  for (const line of lines) {
    if (readMeta(line, pending)) continue;
    let m: RegExpExecArray | null;
    if ((m = RE_STATE.exec(line))) {
      const name = m[1] ?? m[2] ?? '';
      const alias = m[3] ?? aliasOf(name, 'S');
      const s: StateNode = {
        id: pending.id ?? idOf(alias),
        name, alias,
        req: pending.req ?? [],
        status: pending.status ?? 'approved',
      };
      states.push(s);
      byAlias.set(alias, s);
      pending = {};
      continue;
    }
    if ((m = RE_TRANS.exec(line))) {
      rawTrans.push({ from: m[1]!, to: m[3]!, label: m[4] ?? '', proposed: m[2] === '..>' });
      continue;
    }
    // unrecognized line (composite-state braces, concurrency bars, …): dropped by design.
  }

  const transitions: StateTransition[] = [];
  for (const t of rawTrans) {
    if (t.from === '[*]' && t.to === '[*]') continue; // meaningless; a prior in-house editor skips it too
    const from = t.from === '[*]' ? START : byAlias.get(t.from)?.id;
    const to = t.to === '[*]' ? END : byAlias.get(t.to)?.id;
    if (from && to) transitions.push({ from, to, label: t.label, proposed: t.proposed });
  }
  return { title, states, transitions };
}

export function print(d: StateDiagram): string {
  const out: string[] = [d.title ? `@startuml ${d.title}` : '@startuml'];
  const aliasById = new Map(d.states.map((s) => [s.id, s.alias] as const));

  for (const s of d.states) {
    out.push('');
    printMeta(s.id, s.req, s.status, out);
    out.push(`state ${quote(s.name)} as ${s.alias}`);
  }

  if (d.transitions.length) out.push('');
  for (const t of d.transitions) {
    const from = t.from === START ? '[*]' : aliasById.get(t.from);
    const to = t.to === END ? '[*]' : aliasById.get(t.to);
    if (!from || !to) continue;
    out.push(`${from} ${t.proposed ? '..>' : '-->'} ${to}${t.label ? ` : ${t.label}` : ''}`);
  }
  out.push('@enduml');
  return out.join('\n') + '\n';
}
