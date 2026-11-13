/**
 * Longest-path ranking over a DAG: a node with no incoming edge ranks 0, and every other
 * node ranks one more than the deepest thing that points into it. Shared by the static
 * dialect's left-to-right columns (src/core/layout.ts) and the state/activity dialects'
 * top-to-bottom rows — same algorithm, the renderer just picks which axis the rank maps to
 * (idea borrowed from a prior in-house editor's block and activity auto-layout passes, as an idea only,
 * per steering/product.md's origin rule — this implementation shares no code with it).
 *
 * A cycle has no fixed point under this rule (ranking it would raise every node in the
 * cycle forever), so an edge back into a node still being visited is ignored for ranking
 * purposes — it still exists and still renders, it just does not pull its target down.
 * An id with no edges at all still ranks 0.
 */
export function rankByLongestPath(ids: string[], edges: ReadonlyArray<{ from: string; to: string }>): Map<string, number> {
  const rank = new Map<string, number>();
  const incoming = new Map<string, string[]>();
  for (const id of ids) incoming.set(id, []);
  for (const e of edges) if (e.from !== e.to) incoming.get(e.to)?.push(e.from);

  const visiting = new Set<string>();
  const dfs = (id: string): number => {
    const known = rank.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0; // cycle guard, not a claim that the cycle itself has depth 0
    visiting.add(id);
    let d = 0;
    for (const p of incoming.get(id) ?? []) d = Math.max(d, dfs(p) + 1);
    visiting.delete(id);
    rank.set(id, d);
    return d;
  };
  for (const id of ids) dfs(id);
  return rank;
}
