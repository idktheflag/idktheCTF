import { and, eq, inArray } from "drizzle-orm";
import type { getDB } from "..";
import * as schema from "../db/schema";

export type HintEdit = { id?: string | null; body: string; cost: number; sortOrder?: number };
export class HintInputError extends Error {}

/**
 * Call after validating/normalizing body, cost and sortOrder. Append the returned
 * statements to the challenge update's D1 batch; no writes happen here. Map
 * HintInputError to HTTP 400. Omitted hints should skip this helper; [] removes all.
 * A string ID retains that hint; null explicitly creates a new hint. Undefined
 * supports unchanged legacy rows by exact body/cost only. Ambiguous legacy edits
 * fail rather than transferring purchases from omitted hints to unrelated rows.
 */
export async function buildHintReconciliation(db: ReturnType<typeof getDB>, challengeId: string, hints: HintEdit[]) {
  const existing = await db.select().from(schema.challengeHints)
    .where(eq(schema.challengeHints.challengeId, challengeId))
    .orderBy(schema.challengeHints.sortOrder, schema.challengeHints.id);
  const byId = new Map(existing.map((hint) => [hint.id, hint]));
  const used = new Set<string>();
  const matches: (typeof existing[number] | undefined)[] = hints.map(() => undefined);

  // Reserve every explicit ID before attempting matches for legacy input.
  hints.forEach((hint, index) => {
    if (hint.id === undefined || hint.id === null) return;
    if (typeof hint.id !== "string" || !byId.has(hint.id) || used.has(hint.id)) {
      throw new HintInputError("Hint IDs must be unique and belong to this challenge");
    }
    matches[index] = byId.get(hint.id);
    used.add(hint.id);
  });
  hints.forEach((hint, index) => {
    if (hint.id !== undefined) return;
    const match = existing.find((row) => !used.has(row.id) && row.body === hint.body && row.cost === hint.cost);
    if (match) { matches[index] = match; used.add(match.id); }
  });
  if (used.size < existing.length && hints.some((hint, index) => hint.id === undefined && !matches[index])) {
    throw new HintInputError("Ambiguous hint changes: reload the challenge and send stable hint IDs (null for new hints)");
  }

  const removedIds = existing.filter((hint) => !used.has(hint.id)).map((hint) => hint.id);
  return [
    ...(removedIds.length ? [db.delete(schema.challengeHints)
      .where(and(eq(schema.challengeHints.challengeId, challengeId), inArray(schema.challengeHints.id, removedIds)))] : []),
    ...hints.map((hint, index) => {
      const values = { body: hint.body, cost: hint.cost, sortOrder: hint.sortOrder ?? index };
      const match = matches[index];
      return match
        ? db.update(schema.challengeHints).set(values).where(and(eq(schema.challengeHints.challengeId, challengeId), eq(schema.challengeHints.id, match.id)))
        : db.insert(schema.challengeHints).values({ ...values, challengeId });
    }),
  ];
}
