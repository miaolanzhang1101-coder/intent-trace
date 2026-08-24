/**
 * Pure, dependency-free graph algorithms over the intent DAG.
 *
 * Edge convention: an edge { intentId, dependsOnId } means
 *   intentId  --depends-on-->  dependsOnId
 * i.e. dependsOnId must be applied before intentId, and reverting dependsOnId
 * impacts intentId (intentId is "required_by" reachable from dependsOnId).
 *
 * These functions are the correctness core of cascade rollback and dry-run
 * impact analysis, so they're kept side-effect-free and unit-testable.
 */

export interface Edge {
  readonly intentId: string;
  readonly dependsOnId: string;
}

function buildAdjacency(edges: ReadonlyArray<Edge>) {
  // dependents.get(x) = intents that depend ON x (x is required by them)
  const dependents = new Map<string, Set<string>>();
  // dependencies.get(x) = intents x depends on
  const dependencies = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!dependents.has(e.dependsOnId)) dependents.set(e.dependsOnId, new Set());
    dependents.get(e.dependsOnId)!.add(e.intentId);
    if (!dependencies.has(e.intentId)) dependencies.set(e.intentId, new Set());
    dependencies.get(e.intentId)!.add(e.dependsOnId);
  }
  return { dependents, dependencies };
}

/** Direct intents that this intent depends on. */
export function directDependencies(id: string, edges: ReadonlyArray<Edge>): string[] {
  return edges.filter((e) => e.intentId === id).map((e) => e.dependsOnId);
}

/** Direct intents that depend on this intent (its `required_by`). */
export function directDependents(id: string, edges: ReadonlyArray<Edge>): string[] {
  return edges.filter((e) => e.dependsOnId === id).map((e) => e.intentId);
}

/**
 * All intents that transitively depend on `id` (everything that would be
 * impacted by reverting `id`). BFS over the `dependents` relation.
 */
export function transitiveDependents(id: string, edges: ReadonlyArray<Edge>): string[] {
  const { dependents } = buildAdjacency(edges);
  const seen = new Set<string>();
  const queue = [...(dependents.get(id) ?? [])];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const next of dependents.get(cur) ?? []) if (!seen.has(next)) queue.push(next);
  }
  return [...seen];
}

/** All intents `id` transitively depends on. */
export function transitiveDependencies(id: string, edges: ReadonlyArray<Edge>): string[] {
  const { dependencies } = buildAdjacency(edges);
  const seen = new Set<string>();
  const queue = [...(dependencies.get(id) ?? [])];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const next of dependencies.get(cur) ?? []) if (!seen.has(next)) queue.push(next);
  }
  return [...seen];
}

/**
 * Detect whether adding edge (from depends-on to) introduces a cycle.
 * A cycle exists if `to` can already reach `from` via the depends-on relation,
 * i.e. `from` is a transitive dependency of `to`. Returns the offending path.
 */
export function findCyclePath(
  from: string,
  to: string,
  edges: ReadonlyArray<Edge>,
): string[] | null {
  if (from === to) return [from, to];
  const { dependencies } = buildAdjacency(edges);
  const stack: Array<{ node: string; path: string[] }> = [
    { node: to, path: [from, to] },
  ];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const { node, path } = stack.pop()!;
    if (node === from) return path;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const dep of dependencies.get(node) ?? []) {
      stack.push({ node: dep, path: [...path, dep] });
    }
  }
  return null;
}

/**
 * Kahn topological order over a subset of nodes. Returns nodes such that every
 * dependency appears before the intents that depend on it. Ignores edges to
 * nodes outside `subset`.
 */
export function topoOrder(subset: ReadonlyArray<string>, edges: ReadonlyArray<Edge>): string[] {
  const set = new Set(subset);
  const indegree = new Map<string, number>();
  const out = new Map<string, string[]>(); // dependsOn -> [dependents]
  for (const n of subset) indegree.set(n, 0);
  for (const e of edges) {
    if (!set.has(e.intentId) || !set.has(e.dependsOnId)) continue;
    indegree.set(e.intentId, (indegree.get(e.intentId) ?? 0) + 1);
    if (!out.has(e.dependsOnId)) out.set(e.dependsOnId, []);
    out.get(e.dependsOnId)!.push(e.intentId);
  }
  const ready = subset.filter((n) => (indegree.get(n) ?? 0) === 0).sort();
  const order: string[] = [];
  while (ready.length > 0) {
    const n = ready.shift()!;
    order.push(n);
    for (const m of out.get(n) ?? []) {
      indegree.set(m, (indegree.get(m) ?? 0) - 1);
      if ((indegree.get(m) ?? 0) === 0) ready.push(m);
    }
    ready.sort();
  }
  return order;
}
