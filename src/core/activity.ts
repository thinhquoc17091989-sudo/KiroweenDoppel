/**
 * Parser and printer for Doppel's activity dialect (`*.activity.puml`).
 *
 * This is NOT real PlantUML activity syntax, which chains steps implicitly
 * (`:Step one;` then `:Step two;` connects them without naming either) and so has no
 * natural place to hang a stable id. Doppel instead declares each action or decision with
 * an alias, like every other dialect here, and connects them with explicit edges:
 *
 *   action "Check moisture" as CheckMoisture
 *   decision "Rain forecast?" as RainDecision
 *   start --> CheckMoisture
 *   CheckMoisture --> RainDecision
 *   RainDecision --> SkipWatering : yes
 *   RainDecision --> RunPump : no
 *   RunPump --> end
 *
 * `start` and `end` are reserved literal tokens, not declarations. This buys addressable
 * ids and req/status tags at the cost of looking less like the PlantUML a person might
 * paste in from elsewhere — a deliberate trade, named here rather than left implicit.
 * While/repeat loops, fork/join and partitions are out of this slice (no cycles means the
 * layout stays a plain DAG); a line using them is dropped, same policy as elsewhere.
 */
import { aliasOf, idOf, printMeta, quote, readMeta, stripEnvelope, type Pending, type Status } from './dsl';

export type ActivityKind = 'action' | 'decision';

export interface ActivityNode {
  id: string;
  kind: ActivityKind;
  name: string;
  alias: string;
  req: string[];
  status: Status;
}

export interface ActivityEdge {
  from: string; // a node id, or the literal pseudostate below
  to: string;
  label: string;
  proposed: boolean;
}

export interface ActivityDiagram {
  title: string;
  nodes: ActivityNode[];
  edges: ActivityEdge[];
}

export const START = 'start';
export const END = 'end';

const RE_NODE = /^(action|decision)\s+(?:"([^"]*)"|(\S+))(?:\s+as\s+(\w+))?\s*$/;
const RE_EDGE = /^(start|end|\w+)\s+(-->|\.\.>)\s+(start|end|\w+)\s*(?::\s*(.*?))?\s*$/;

export function parse(text: string): ActivityDiagram {
  const { title, lines } = stripEnvelope(text);
  const nodes: ActivityNode[] = [];
  const byAlias = new Map<string, ActivityNode>();
  const rawEdges: Array<{ from: string; to: string; label: string; proposed: boolean }> = [];
  let pending: Pending = {};

  for (const line of lines) {
    if (readMeta(line, pending)) continue;
    let m: RegExpExecArray | null;
    if ((m = RE_NODE.exec(line))) {
      const kind = m[1] as ActivityKind;
      const name = m[2] ?? m[3] ?? '';
      const alias = m[4] ?? aliasOf(name, 'N');
      const n: ActivityNode = {
        id: pending.id ?? idOf(alias),
        kind, name, alias,
        req: pending.req ?? [],
        status: pending.status ?? 'approved',
      };
      nodes.push(n);
      byAlias.set(alias, n);
      pending = {};
      continue;
    }
    if ((m = RE_EDGE.exec(line))) {
      rawEdges.push({ from: m[1]!, to: m[3]!, label: m[4] ?? '', proposed: m[2] === '..>' });
      continue;
    }
    // unrecognized line (while/repeat, fork/join, partition, …): dropped by design.
  }

  const resolve = (tok: string) => (tok === 'start' ? START : tok === 'end' ? END : byAlias.get(tok)?.id);
  const edges: ActivityEdge[] = [];
  for (const e of rawEdges) {
    const from = resolve(e.from), to = resolve(e.to);
    if (from && to) edges.push({ from, to, label: e.label, proposed: e.proposed });
  }
  return { title, nodes, edges };
}

/**
 * 'start' and 'end' are plain reserved words in this grammar, not a positional token like
 * state.ts's `[*]` — parse() resolves either one on either side of an edge, so print()
 * has to be equally symmetric or a diagram using `end` as a source (odd, but not a parse
 * error) would silently lose that edge on the way back out.
 */
function tokenFor(id: string, aliasById: Map<string, string>): string | undefined {
  if (id === START) return 'start';
  if (id === END) return 'end';
  return aliasById.get(id);
}

export function print(d: ActivityDiagram): string {
  const out: string[] = [d.title ? `@startuml ${d.title}` : '@startuml'];
  const aliasById = new Map(d.nodes.map((n) => [n.id, n.alias] as const));

  for (const n of d.nodes) {
    out.push('');
    printMeta(n.id, n.req, n.status, out);
    out.push(`${n.kind} ${quote(n.name)} as ${n.alias}`);
  }

  if (d.edges.length) out.push('');
  for (const e of d.edges) {
    const from = tokenFor(e.from, aliasById);
    const to = tokenFor(e.to, aliasById);
    if (!from || !to) continue;
    out.push(`${from} ${e.proposed ? '..>' : '-->'} ${to}${e.label ? ` : ${e.label}` : ''}`);
  }
  out.push('@enduml');
  return out.join('\n') + '\n';
}
