/** Pure hierarchy helpers (no DB) used by services and tests. */

export interface ParentLink {
  id: string;
  parentId: string | null;
}

/**
 * Returns true if setting `projectId`'s parent to `newParentId` would create a cycle
 * (the new parent is the project itself or one of its descendants).
 */
export function wouldCreateCycle(nodes: ParentLink[], projectId: string, newParentId: string | null): boolean {
  if (!newParentId) return false;
  if (newParentId === projectId) return true;
  const parentOf = new Map(nodes.map((n) => [n.id, n.parentId]));
  parentOf.set(projectId, newParentId);
  const seen = new Set<string>();
  let cur: string | null | undefined = newParentId;
  while (cur) {
    if (cur === projectId || seen.has(cur)) return true;
    seen.add(cur);
    cur = parentOf.get(cur) ?? null;
  }
  return false;
}

export function depthOf(nodes: ParentLink[], id: string): number {
  const parentOf = new Map(nodes.map((n) => [n.id, n.parentId]));
  let depth = 0;
  let cur = parentOf.get(id) ?? null;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    depth++;
    cur = parentOf.get(cur) ?? null;
  }
  return depth;
}

export function parseList(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function joinList(values: string[]): string {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))].join(",");
}

/** Effective capabilities: the project's own capabilities plus those inherited from its ancestors. */
export function effectiveCapabilities(
  nodes: { id: string; parentId: string | null; capabilities: string }[],
  id: string,
): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const caps: string[] = [];
  const seen = new Set<string>();
  let cur = byId.get(id);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    caps.push(...parseList(cur.capabilities).map((c) => c.toLowerCase()));
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return [...new Set(caps)];
}
