/**
 * Parser and printer for Doppel's sequence dialect (`*.seq.puml`).
 *
 * Unlike state and activity, sequence diagrams ARE naturally addressable in real
 * PlantUML: a message is already one line, in order, between two named participants. So
 * this dialect stays close to the real syntax — the departure is only that the MESSAGE,
 * not the participant, is the tracked content unit (it carries the `' id:` / `' req:` /
 * `' status:` triplet), because a message is what a change set actually adds or edits;
 * participants are structural, like a static diagram's declared names.
 *
 *   participant "Name" as Alias
 *   Alias -> Other : label           (approved; also --> accepted on read)
 *   Alias ..> Other : label          (proposed)
 *
 * No fragments (alt/opt/loop) and no activation bars in this slice — plain ordered
 * messages only; a line outside this grammar is dropped, same policy as elsewhere.
 */
import { aliasOf, idOf, printMeta, quote, readMeta, stripEnvelope, type Pending, type Status } from './dsl';

export interface SeqParticipant {
  id: string;
  name: string;
  alias: string;
}

export interface SeqMessage {
  id: string;
  from: string; // participant id
  to: string;
  label: string;
  req: string[];
  status: Status;
}

export interface SequenceDiagram {
  title: string;
  participants: SeqParticipant[];
  messages: SeqMessage[];
}

const RE_PARTICIPANT = /^participant\s+(?:"([^"]*)"|(\S+))(?:\s+as\s+(\w+))?\s*$/;
const RE_MESSAGE = /^(\w+)\s+(->|-->|\.\.>)\s+(\w+)\s*(?::\s*(.*?))?\s*$/;

interface RawMsg { from: string; to: string; label: string; arrow: string; pending: Pending }

export function parse(text: string): SequenceDiagram {
  const { title, lines } = stripEnvelope(text);
  const participants: SeqParticipant[] = [];
  const byAlias = new Map<string, SeqParticipant>();
  const rawMsgs: RawMsg[] = [];
  let pending: Pending = {};

  for (const line of lines) {
    if (readMeta(line, pending)) continue;
    let m: RegExpExecArray | null;
    if ((m = RE_PARTICIPANT.exec(line))) {
      const name = m[1] ?? m[2] ?? '';
      const alias = m[3] ?? aliasOf(name, 'P');
      const p: SeqParticipant = { id: idOf(alias), name, alias };
      participants.push(p);
      byAlias.set(alias, p);
      continue;
    }
    if ((m = RE_MESSAGE.exec(line))) {
      rawMsgs.push({ from: m[1]!, to: m[3]!, label: m[4] ?? '', arrow: m[2]!, pending });
      pending = {};
      continue;
    }
    // unrecognized line (fragments, activation, notes, …): dropped by design.
  }

  const resolve = (alias: string) => byAlias.get(alias)?.id;
  const messages: SeqMessage[] = [];
  for (const rm of rawMsgs) {
    const from = resolve(rm.from), to = resolve(rm.to);
    if (!from || !to) continue;
    const status = rm.pending.status ?? 'approved';
    messages.push({
      id: rm.pending.id ?? `msg-${messages.length + 1}`,
      from, to, label: rm.label,
      req: rm.pending.req ?? [],
      status,
    });
  }
  return { title, participants, messages };
}

export function print(d: SequenceDiagram): string {
  const out: string[] = [d.title ? `@startuml ${d.title}` : '@startuml'];
  for (const p of d.participants) out.push(`participant ${quote(p.name)} as ${p.alias}`);

  const aliasById = new Map(d.participants.map((p) => [p.id, p.alias] as const));
  for (const msg of d.messages) {
    const from = aliasById.get(msg.from), to = aliasById.get(msg.to);
    if (!from || !to) continue;
    out.push('');
    printMeta(msg.id, msg.req, msg.status, out);
    const arrow = msg.status === 'proposed' ? '..>' : '->';
    out.push(`${from} ${arrow} ${to}${msg.label ? ` : ${msg.label}` : ''}`);
  }
  out.push('@enduml');
  return out.join('\n') + '\n';
}
