import { and, eq, lte } from "drizzle-orm";
import { Hono } from "hono";
import { JwtVariables } from "hono/jwt";
import { getDB } from "..";
import { Bindings } from "../../env";
import * as schema from "../db/schema";
import { adminMiddleware } from "../middlewares/admin";
import { authMiddleware } from "../middlewares/auth";
import { writeAudit } from "../utils/audit";
import { createSecureToken, sha256Hex } from "../utils/secure-token";
import { sendRegistrationInvitation } from "../utils/send-mail";

const router = new Hono<{ Bindings: Bindings; Variables: JwtVariables }>();

router.get("/invitations", authMiddleware, adminMiddleware, async (c) => {
  const rows = await c.env.DATABASE.prepare("SELECT id, email, expires_at AS expiresAt, redeemed_at AS redeemedAt, revoked_at AS revokedAt, created_at AS createdAt FROM registration_invitations ORDER BY created_at DESC LIMIT 500").all();
  return c.json(rows.results || []);
});

router.post("/invitations", authMiddleware, adminMiddleware, async (c) => {
  const input = await c.req.json<{ email?: unknown }>().catch((): { email?: unknown } => ({}));
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase().slice(0, 254) : "";
  if (!/^\S+@\S+\.\S+$/.test(email)) return c.json({ error: "Enter a valid email address" }, 400);
  const event = await getDB(c).query.eventSettings.findFirst();
  if (!event) return c.json({ error: "Event is not configured" }, 404);
  const domains = JSON.parse(event.allowedEmailDomains) as string[];
  if (domains.length && !domains.some((domain) => email.endsWith(`@${domain}`))) return c.json({ error: "Email is outside the allowed event domains" }, 400);
  const rawToken = createSecureToken();
  const id = crypto.randomUUID();
  await c.env.DATABASE.prepare("INSERT INTO registration_invitations (id, email, token_hash, created_by, expires_at) VALUES (?, ?, ?, ?, ?)").bind(id, email, await sha256Hex(rawToken), c.get("jwtPayload").userId, Date.now() + 7 * 24 * 60 * 60 * 1000).run();
  try { await sendRegistrationInvitation(c, email, rawToken); }
  catch { await c.env.DATABASE.prepare("UPDATE registration_invitations SET revoked_at = ? WHERE id = ?").bind(Date.now(), id).run(); return c.json({ error: "Invitation email could not be delivered; try again" }, 503); }
  await writeAudit(c, { action: "registration.invitation.created", targetType: "invitation", targetId: id, metadata: {} });
  return c.json({ id, email, message: "Invitation sent. The link expires in 7 days." }, 201);
});

router.delete("/invitations/:id", authMiddleware, adminMiddleware, async (c) => {
  const result = await c.env.DATABASE.prepare("UPDATE registration_invitations SET revoked_at = ? WHERE id = ? AND redeemed_at IS NULL AND revoked_at IS NULL").bind(Date.now(), c.req.param("id")).run();
  if (!result.meta.changes) return c.json({ error: "Invitation is not active" }, 404);
  await writeAudit(c, { action: "registration.invitation.revoked", targetType: "invitation", targetId: c.req.param("id"), metadata: {} });
  return c.json({ ok: true });
});

router.get("/", async (c) => {
  const event = await getDB(c).query.eventSettings.findFirst();
  if (!event) return c.json({ initialized: false }, 404);
  const now = Date.now();
  const phase = event.paused ? "paused" : event.startsAt && now < event.startsAt.getTime() ? "upcoming" : event.endsAt && now > event.endsAt.getTime() ? "ended" : "live";
  return c.json({ initialized: true, name: event.name, description: event.description, startsAt: event.startsAt, endsAt: event.endsAt, timezone: event.timezone, phase, registrationMode: event.registrationMode, scoreboardPublic: event.scoreboardPublic });
});

router.get("/settings", authMiddleware, adminMiddleware, async (c) => {
  const event = await getDB(c).query.eventSettings.findFirst();
  return event ? c.json({ ...event, allowedEmailDomains: JSON.parse(event.allowedEmailDomains) }) : c.json({ error: "Event not configured" }, 404);
});

router.put("/settings", authMiddleware, adminMiddleware, async (c) => {
  const db = getDB(c);
  const input = await c.req.json<Record<string, unknown>>();
  const current = await db.query.eventSettings.findFirst();
  if (!current) return c.json({ error: "Event not configured" }, 404);
  const startsAt = input.startsAt === undefined ? current.startsAt : input.startsAt ? new Date(String(input.startsAt)) : null;
  const endsAt = input.endsAt === undefined ? current.endsAt : input.endsAt ? new Date(String(input.endsAt)) : null;
  if ((startsAt && !Number.isFinite(startsAt.getTime())) || (endsAt && !Number.isFinite(endsAt.getTime())) || (startsAt && endsAt && startsAt >= endsAt)) return c.json({ error: "Event end must be later than its start" }, 400);
  const frozenAt = input.scoreboardFrozenAt === undefined ? current.scoreboardFrozenAt : input.scoreboardFrozenAt ? new Date(String(input.scoreboardFrozenAt)) : null;
  if (frozenAt && !Number.isFinite(frozenAt.getTime())) return c.json({ error: "Enter a valid scoreboard freeze time" }, 400);
  if (typeof input.name === "string" && !input.name.trim()) return c.json({ error: "Event name is required" }, 400);
  const maxTeamSize = input.maxTeamSize === undefined ? current.maxTeamSize : Number(input.maxTeamSize);
  if (!Number.isInteger(maxTeamSize) || maxTeamSize < 1 || maxTeamSize > 100) return c.json({ error: "Maximum team size must be between 1 and 100" }, 400);
  if (input.registrationMode !== undefined && !["public", "invite"].includes(String(input.registrationMode))) return c.json({ error: "Invalid registration mode" }, 400);
  const timezone = typeof input.timezone === "string" ? input.timezone.trim() : current.timezone;
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }); } catch { return c.json({ error: "Enter a valid IANA timezone" }, 400); }
  const name = input.name === undefined ? current.name : input.name;
  const description = input.description === undefined ? current.description : input.description;
  if (typeof name !== "string" || !name.trim() || name.trim().length > 100) return c.json({ error: "Event name must be 1–100 characters" }, 400);
  if (typeof description !== "string" || description.length > 10000) return c.json({ error: "Event description must be 10,000 characters or fewer" }, 400);
  if (!timezone || timezone.length > 64) return c.json({ error: "Timezone must be a valid IANA zone under 65 characters" }, 400);
  for (const key of ["paused", "scoreboardPublic", "viewChallengesAfterEnd"] as const) if (input[key] !== undefined && typeof input[key] !== "boolean") return c.json({ error: `${key} must be true or false` }, 400);
  const normalizedDomains = input.allowedEmailDomains === undefined ? JSON.parse(current.allowedEmailDomains) as string[] : Array.isArray(input.allowedEmailDomains) && input.allowedEmailDomains.every((v) => typeof v === "string") ? input.allowedEmailDomains.map((v: string) => v.trim().replace(/^@/, "").toLowerCase()).filter(Boolean) : null;
  if (!normalizedDomains || normalizedDomains.some((domain) => domain.length > 253 || !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(domain))) return c.json({ error: "Enter valid email domains, separated by commas" }, 400);
  const domains = JSON.stringify([...new Set(normalizedDomains)]);
  const result = await db.update(schema.eventSettings).set({
    name: name.trim(),
    description,
    startsAt, endsAt,
    timezone,
    registrationMode: input.registrationMode === undefined ? current.registrationMode : String(input.registrationMode),
    allowedEmailDomains: domains,
    paused: input.paused === undefined ? current.paused : Boolean(input.paused),
    scoreboardFrozenAt: frozenAt,
    scoreboardPublic: input.scoreboardPublic === undefined ? current.scoreboardPublic : Boolean(input.scoreboardPublic),
    viewChallengesAfterEnd: input.viewChallengesAfterEnd === undefined ? current.viewChallengesAfterEnd : Boolean(input.viewChallengesAfterEnd),
    maxTeamSize,
  }).where(eq(schema.eventSettings.id, 1)).returning().get();
  const allowedAuditFields = new Set(["name", "description", "startsAt", "endsAt", "timezone", "registrationMode", "paused", "scoreboardFrozenAt", "scoreboardPublic", "viewChallengesAfterEnd", "maxTeamSize"]);
  const changedFields = Object.keys(input).filter((key) => allowedAuditFields.has(key)).sort().join(",");
  await writeAudit(c, { action: "event.settings.updated", targetType: "event", targetId: "1", metadata: { changedFields } });
  return c.json({ ...result, allowedEmailDomains: JSON.parse(result.allowedEmailDomains) });
});

export async function enforceChallengeWindow(c: { json: (body: object, status?: number) => Response; env: Bindings; req: { path: string } }) {
  const event = await c.env.DATABASE.prepare("SELECT starts_at, ends_at, paused, view_challenges_after_end FROM event_settings WHERE id = 1").first<{ starts_at: number | null; ends_at: number | null; paused: number; view_challenges_after_end: number }>();
  if (!event) return null;
  const now = Date.now();
  if (event.starts_at && now < event.starts_at) return c.json({ error: "The event has not started" }, 403);
  if (event.ends_at && now > event.ends_at && !event.view_challenges_after_end) return c.json({ error: "The event has ended" }, 403);
  return null;
}

export function frozenScoreFilter(event: typeof schema.eventSettings.$inferSelect | undefined) {
  return event?.scoreboardFrozenAt ? lte(schema.teamSolves.solvedAt, event.scoreboardFrozenAt) : undefined;
}

export function eventScoreWhere(event: typeof schema.eventSettings.$inferSelect | undefined) {
  const cutoff = frozenScoreFilter(event);
  return cutoff ? and(cutoff) : undefined;
}

export default router;
