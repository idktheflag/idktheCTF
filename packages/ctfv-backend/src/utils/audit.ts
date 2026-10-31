import { Context } from "hono";
import { JwtVariables } from "hono/jwt";
import { getDB } from "..";
import { Bindings } from "../../env";
import * as schema from "../db/schema";

type AuditContext = Context<{ Bindings: Bindings; Variables: JwtVariables }>;
type AuditValue = string | number | boolean | null;

const forbiddenMetadataKey = /password|token|secret|flag|submission|input|body|content|bytes/i;

export function buildAuditInsert(
  c: AuditContext,
  entry: {
    action: string;
    targetType: string;
    targetId?: string | null;
    metadata?: Record<string, AuditValue>;
  },
) {
  const actor = c.get("jwtPayload");
  const metadata = Object.fromEntries(
    Object.entries(entry.metadata ?? {})
      .filter(([key, value]) => !forbiddenMetadataKey.test(key) && (typeof value !== "string" || value.length <= 160))
      .slice(0, 8),
  );

  return getDB(c).insert(schema.auditLogs).values({
      actorId: String(actor.userId ?? "unknown"),
      actorUsername: typeof actor.username === "string" ? actor.username.slice(0, 80) : "Administrator",
      action: entry.action.slice(0, 80),
      targetType: entry.targetType.slice(0, 80),
      targetId: entry.targetId?.slice(0, 120) ?? null,
      metadata: JSON.stringify(metadata).slice(0, 2048),
    });
}

export async function writeAudit(
  c: AuditContext,
  entry: Parameters<typeof buildAuditInsert>[1],
) {
  try {
    await buildAuditInsert(c, entry).run();
  } catch {
    console.error("Could not persist organizer audit event");
  }
}
