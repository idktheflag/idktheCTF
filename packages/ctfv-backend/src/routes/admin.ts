import { Hono } from "hono";
import { JwtVariables } from "hono/jwt";
import { eq } from "drizzle-orm";
import { getDB } from "..";
import { Bindings } from "../../env";
import * as schema from "../db/schema";
import { adminMiddleware } from "../middlewares/admin";
import { authMiddleware } from "../middlewares/auth";
import { writeAudit } from "../utils/audit";

const router = new Hono<{ Bindings: Bindings; Variables: JwtVariables }>();
router.use("/*", authMiddleware, adminMiddleware);

router.get("/dashboard", async (c) => {
  const [users, teams, challenges, solves, submissions, recent] = await Promise.all([
    c.env.DATABASE.prepare("SELECT COUNT(*) AS count FROM user WHERE isAdmin = 0 AND is_banned = 0").first(),
    c.env.DATABASE.prepare("SELECT COUNT(*) AS count FROM teams WHERE is_banned = 0").first(),
    c.env.DATABASE.prepare("SELECT COUNT(*) AS count FROM challenges").first(),
    c.env.DATABASE.prepare("SELECT COUNT(*) AS count FROM team_solves").first(),
    c.env.DATABASE.prepare("SELECT COUNT(*) AS count FROM submissions s JOIN user u ON u.id=s.userId WHERE u.isAdmin = 0").first(),
    c.env.DATABASE.prepare("SELECT s.id, s.timestamp, s.isCorrect, u.name AS username, t.name AS teamName, ch.name AS challengeName FROM submissions s JOIN user u ON u.id=s.userId LEFT JOIN teams t ON t.id=s.teamId JOIN challenges ch ON ch.id=s.challengeId WHERE u.isAdmin = 0 ORDER BY s.timestamp DESC LIMIT 10").all(),
  ]);
  const event = await getDB(c).query.eventSettings.findFirst();
  return c.json({ counts: { participants: users?.count ?? 0, teams: teams?.count ?? 0, challenges: challenges?.count ?? 0, solves: solves?.count ?? 0, submissions: submissions?.count ?? 0 }, event: event ? { name: event.name, startsAt: event.startsAt, endsAt: event.endsAt, paused: event.paused } : null, recent: recent.results });
});

router.get("/users", async (c) => {
  const page = Math.max(1, Math.floor(Number(c.req.query("page")) || 1));
  const pageSize = Math.max(1, Math.min(100, Math.floor(Number(c.req.query("pageSize")) || 25)));
  const query = (c.req.query("q") || "").trim().slice(0, 100);
  const where: string[] = ["1 = 1"];
  const bindings: (string | number)[] = [];
  if (query) {
    where.push("(lower(u.name) LIKE ? OR lower(u.email) LIKE ? OR lower(COALESCE(t.name, '')) LIKE ?)");
    const like = `%${query.toLowerCase()}%`;
    bindings.push(like, like, like);
  }
  for (const key of ["verified", "banned", "admin"] as const) {
    const value = c.req.query(key);
    if (value === "true" || value === "false") {
      const column = key === "verified" ? "emailVerified" : key === "banned" ? "is_banned" : "isAdmin";
      where.push(`u.${column} = ?`);
      bindings.push(value === "true" ? 1 : 0);
    }
  }
  const sortColumns: Record<string, string> = { username: "u.name", email: "u.email", teamName: "t.name", verified: "u.emailVerified", banned: "u.is_banned" };
  const sortColumn = sortColumns[c.req.query("sort") || "username"] || sortColumns.username;
  const direction = c.req.query("dir")?.toLowerCase() === "desc" ? "DESC" : "ASC";
  const whereSql = where.join(" AND ");
  const [count, result] = await Promise.all([
    c.env.DATABASE.prepare(`SELECT COUNT(*) AS total FROM user u LEFT JOIN team_members tm ON tm.user_id = u.id LEFT JOIN teams t ON t.id = tm.team_id WHERE ${whereSql}`).bind(...bindings).first<{ total: number }>(),
    c.env.DATABASE.prepare(`SELECT u.id, CASE WHEN u.isAdmin = 1 THEN NULL ELSE u.name END AS username, u.email, u.isAdmin, u.emailVerified, u.is_banned AS isBanned, CASE WHEN u.isAdmin = 1 THEN NULL ELSE t.name END AS teamName FROM user u LEFT JOIN team_members tm ON tm.user_id = u.id LEFT JOIN teams t ON t.id = tm.team_id WHERE ${whereSql} ORDER BY ${sortColumn} ${direction}, u.id ASC LIMIT ? OFFSET ?`).bind(...bindings, pageSize, (page - 1) * pageSize).all(),
  ]);
  return c.json({ users: result.results, page, pageSize, total: count?.total ?? 0 });
});

router.patch("/users/:id/ban", async (c) => {
  const isBanned = Boolean((await c.req.json<{ isBanned?: boolean }>()).isBanned);
  const actor = c.get("jwtPayload").userId;
  const result = await c.env.DATABASE.prepare("UPDATE user SET is_banned = ? WHERE id = ? AND isAdmin = 0 AND id <> ?")
    .bind(isBanned ? 1 : 0, c.req.param("id"), actor).run();
  if (!result.meta.changes) return c.json({ error: "Participant not found or cannot be moderated" }, 404);
  await writeAudit(c, { action: isBanned ? "participant.banned" : "participant.unbanned", targetType: "participant", targetId: c.req.param("id"), metadata: { isBanned } });
  return c.json({ updated: true, isBanned });
});

router.get("/teams", async (c) => {
  const page = Math.max(1, Math.floor(Number(c.req.query("page")) || 1));
  const pageSize = Math.max(1, Math.min(100, Math.floor(Number(c.req.query("pageSize")) || 25)));
  const query = (c.req.query("q") || "").trim().slice(0, 100);
  const where: string[] = ["1 = 1"];
  const bindings: (string | number)[] = [];
  if (query) {
    where.push("(lower(t.name) LIKE ? OR lower(u.name) LIKE ?)");
    const like = `%${query.toLowerCase()}%`;
    bindings.push(like, like);
  }
  const banned = c.req.query("banned");
  if (banned === "true" || banned === "false") { where.push("t.is_banned = ?"); bindings.push(banned === "true" ? 1 : 0); }
  const hidden = c.req.query("hidden");
  if (hidden === "true" || hidden === "false") { where.push("t.hidden = ?"); bindings.push(hidden === "true" ? 1 : 0); }
  const sortColumns: Record<string, string> = { name: "t.name", createdAt: "t.created_at", memberCount: "memberCount", banned: "t.is_banned" };
  const sortColumn = sortColumns[c.req.query("sort") || "name"] || sortColumns.name;
  const direction = c.req.query("dir")?.toLowerCase() === "desc" ? "DESC" : "ASC";
  const whereSql = where.join(" AND ");
  const [count, result] = await Promise.all([
    c.env.DATABASE.prepare(`SELECT COUNT(*) AS total FROM teams t LEFT JOIN user u ON u.id = t.captain_id WHERE ${whereSql}`).bind(...bindings).first<{ total: number }>(),
    c.env.DATABASE.prepare(`SELECT t.id, t.name, t.captain_id AS captainId, t.is_banned AS isBanned, t.hidden, t.created_at AS createdAt, COUNT(CASE WHEN member.isAdmin = 0 THEN tm.id END) AS memberCount FROM teams t LEFT JOIN user u ON u.id = t.captain_id LEFT JOIN team_members tm ON tm.team_id = t.id LEFT JOIN user member ON member.id = tm.user_id WHERE ${whereSql} GROUP BY t.id ORDER BY ${sortColumn} ${direction}, t.id ASC LIMIT ? OFFSET ?`).bind(...bindings, pageSize, (page - 1) * pageSize).all(),
  ]);
  return c.json({ teams: result.results, page, pageSize, total: count?.total ?? 0 });
});

router.patch("/teams/:id/ban", async (c) => {
  const isBanned = Boolean((await c.req.json<{ isBanned?: boolean }>()).isBanned);
  const result = await getDB(c).update(schema.teams).set({ isBanned }).where(eq(schema.teams.id, c.req.param("id"))).run();
  if (result.meta.changes) await writeAudit(c, { action: isBanned ? "team.banned" : "team.unbanned", targetType: "team", targetId: c.req.param("id"), metadata: { isBanned } });
  return c.json({ updated: result.meta.changes > 0, isBanned });
});

router.get("/logs", async (c) => {
  const page = Math.max(1, Math.floor(Number(c.req.query("page")) || 1));
  const pageSize = Math.max(1, Math.min(100, Math.floor(Number(c.req.query("pageSize")) || 50)));
  const query = (c.req.query("q") || "").trim().slice(0, 100).toLowerCase();
  const action = (c.req.query("action") || "").trim().slice(0, 80);
  const from = c.req.query("from") ? Date.parse(c.req.query("from")!) : NaN;
  const to = c.req.query("to") ? Date.parse(c.req.query("to")!) : NaN;
  const where: string[] = ["1 = 1"];
  const bindings: (string | number)[] = [];
  if (query) { where.push("(lower(actor_username) LIKE ? OR lower(action) LIKE ? OR lower(target_type) LIKE ? OR lower(COALESCE(target_id, '')) LIKE ?)"); const like = `%${query}%`; bindings.push(like, like, like, like); }
  if (action) { where.push("action = ?"); bindings.push(action); }
  if (Number.isFinite(from)) { where.push("created_at >= ?"); bindings.push(from); }
  if (Number.isFinite(to)) { where.push("created_at <= ?"); bindings.push(to); }
  const sortColumns: Record<string, string> = { createdAt: "created_at", action: "action", actor: "actor_username" };
  const sortColumn = sortColumns[c.req.query("sort") || "createdAt"] || sortColumns.createdAt;
  const direction = c.req.query("dir")?.toLowerCase() === "asc" ? "ASC" : "DESC";
  const whereSql = where.join(" AND ");
  const [count, result] = await Promise.all([
    c.env.DATABASE.prepare(`SELECT COUNT(*) AS total FROM audit_logs WHERE ${whereSql}`).bind(...bindings).first<{ total: number }>(),
    c.env.DATABASE.prepare(`SELECT id, actor_id AS actorId, actor_username AS actorUsername, action, target_type AS targetType, target_id AS targetId, metadata, created_at AS createdAt FROM audit_logs WHERE ${whereSql} ORDER BY ${sortColumn} ${direction}, id ASC LIMIT ? OFFSET ?`).bind(...bindings, pageSize, (page - 1) * pageSize).all(),
  ]);
  return c.json({ logs: result.results, page, pageSize, total: count?.total ?? 0 });
});

router.get("/export", async (c) => {
  const db = getDB(c);
  const [event, users, teams, challenges, flags, hints, tags, solves, submissions, announcements, pages] = await Promise.all([
    db.query.eventSettings.findFirst(),
    db.select({ id: schema.users.id, username: schema.users.username, email: schema.users.email, isAdmin: schema.users.isAdmin }).from(schema.users),
    db.select({ id: schema.teams.id, name: schema.teams.name, captainId: schema.teams.captainId, isBanned: schema.teams.isBanned }).from(schema.teams),
    db.select().from(schema.challenges), db.select().from(schema.challengeFlags), db.select().from(schema.challengeHints), db.select().from(schema.challengeTags),
    db.select().from(schema.teamSolves), db.select().from(schema.submissions), db.select().from(schema.announcements), db.select().from(schema.contentPages),
  ]);
  const { allowedEmailDomains, ...publicEvent } = event ?? {};
  await writeAudit(c, { action: "event.exported", targetType: "event", targetId: "1", metadata: { userCount: users.length, teamCount: teams.length, challengeCount: challenges.length } });
  return c.json({ version: 1, exportedAt: new Date().toISOString(), event: publicEvent, users, teams, challenges, flags, hints, tags, solves, submissions, announcements, pages });
});

export default router;
