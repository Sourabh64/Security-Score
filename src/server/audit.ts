import type { Tx } from "./db";
import type { Actor } from "./permissions";

/**
 * Records an audit event. Summaries must never contain evidence content or free-text
 * supplied by users beyond short identifiers/titles.
 */
export async function audit(tx: Tx, actor: Actor | null, action: string, entityType: string, entityId: string, summary = "") {
  await tx.auditEvent.create({
    data: { actorId: actor?.id ?? null, actorName: actor?.name ?? "system", action, entityType, entityId, summary: summary.slice(0, 300) },
  });
}
