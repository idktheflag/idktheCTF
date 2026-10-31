import { and, eq, lte, sql } from "drizzle-orm";
import { Hono } from "hono";
import { JwtVariables } from "hono/jwt";

import { getDB } from "..";
import { Bindings } from "../../env";
import * as schema from "../db/schema";
import { authMiddleware } from "../middlewares/auth";

const router = new Hono<{ Bindings: Bindings; Variables: JwtVariables }>();
router.use("/*", authMiddleware);

router.get("/", async (c) => {
  const rows = await getDB(c).select({
    id: schema.teams.id,
    name: schema.teams.name,
    captainId: schema.teams.captainId,
    memberCount: schema.teamMembers.id,
  }).from(schema.teams).leftJoin(schema.teamMembers, eq(schema.teams.id, schema.teamMembers.teamId)).leftJoin(schema.users, eq(schema.teamMembers.userId, schema.users.id)).where(and(eq(schema.teams.hidden, false), eq(schema.teams.isBanned, false), eq(schema.users.isAdmin, false)));
  const teams = new Map<string, { id: string; name: string; captainId: string; memberCount: number }>();
  for (const row of rows) {
    const team = teams.get(row.id) ?? { id: row.id, name: row.name, captainId: row.captainId, memberCount: 0 };
    if (row.memberCount) team.memberCount++;
    teams.set(row.id, team);
  }
  return c.json({ teams: [...teams.values()] });
});

router.get("/me", async (c) => {
  const userId = c.get("jwtPayload").userId;
  const membership = await getDB(c).select({
    id: schema.teams.id, name: schema.teams.name, captainId: schema.teams.captainId,
    joinCode: schema.teams.joinCode,
  }).from(schema.teamMembers).innerJoin(schema.teams, eq(schema.teamMembers.teamId, schema.teams.id)).where(eq(schema.teamMembers.userId, userId)).get();
  return c.json({ team: membership ?? null });
});

router.post("/", async (c) => {
  if (c.get("jwtPayload").isAdmin) return c.json({ error: "Organizer accounts cannot join the competition" }, 403);
  const userId = c.get("jwtPayload").userId;
  const { name } = await c.req.json<{ name?: string }>();
  const teamName = name?.trim();
  if (!teamName || teamName.length > 48) return c.json({ error: "Team name must be between 1 and 48 characters" }, 400);
  const db = getDB(c);
  const existing = await db.select().from(schema.teamMembers).where(eq(schema.teamMembers.userId, userId)).get();
  if (existing) return c.json({ error: "You already belong to a team" }, 409);
  const event = await db.query.eventSettings.findFirst();
  if (!event) return c.json({ error: "Event setup is incomplete" }, 409);
  const id = crypto.randomUUID();
  const joinCode = crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  try {
    await c.env.DATABASE.batch([
      c.env.DATABASE.prepare("INSERT INTO teams (id, name, join_code, captain_id) VALUES (?, ?, ?, ?)").bind(id, teamName, joinCode, userId),
      c.env.DATABASE.prepare("INSERT INTO team_members (id, team_id, user_id) VALUES (?, ?, ?)").bind(crypto.randomUUID(), id, userId),
    ]);
    return c.json({ team: { id, name: teamName, captainId: userId, joinCode } }, 201);
  } catch {
    return c.json({ error: "Team name is already taken or membership could not be created" }, 409);
  }
});

router.post("/join", async (c) => {
  if (c.get("jwtPayload").isAdmin) return c.json({ error: "Organizer accounts cannot join the competition" }, 403);
  const userId = c.get("jwtPayload").userId;
  const { joinCode } = await c.req.json<{ joinCode?: string }>();
  if (!joinCode?.trim()) return c.json({ error: "Join code is required" }, 400);
  const existing = await getDB(c).select().from(schema.teamMembers).where(eq(schema.teamMembers.userId, userId)).get();
  if (existing) return c.json({ error: "You already belong to a team" }, 409);
  const event = await getDB(c).query.eventSettings.findFirst();
  if (!event) return c.json({ error: "Event setup is incomplete" }, 409);
  const result = await c.env.DATABASE.prepare(`
    INSERT INTO team_members (id, team_id, user_id)
    SELECT ?, teams.id, ? FROM teams
    WHERE upper(teams.join_code) = upper(?) AND teams.hidden = 0 AND teams.is_banned = 0
      AND (SELECT COUNT(*) FROM team_members WHERE team_id = teams.id) < ?
      AND NOT EXISTS (SELECT 1 FROM team_members WHERE user_id = ?)
  `).bind(crypto.randomUUID(), userId, joinCode.trim(), event.maxTeamSize, userId).run();
  if (!result.meta.changes) return c.json({ error: "Invalid code, team full, or already in a team" }, 409);
  const team = await getDB(c).select({ id: schema.teams.id, name: schema.teams.name, captainId: schema.teams.captainId }).from(schema.teamMembers).innerJoin(schema.teams, eq(schema.teamMembers.teamId, schema.teams.id)).where(eq(schema.teamMembers.userId, userId)).get();
  return c.json({ team }, 201);
});

router.post("/leave", async (c) => {
  const userId = c.get("jwtPayload").userId;
  const db = getDB(c);
  const membership = await db.select({ teamId: schema.teamMembers.teamId, captainId: schema.teams.captainId }).from(schema.teamMembers).innerJoin(schema.teams, eq(schema.teamMembers.teamId, schema.teams.id)).where(eq(schema.teamMembers.userId, userId)).get();
  if (!membership) return c.json({ error: "You are not in a team" }, 404);
  if (membership.captainId === userId) return c.json({ error: "Team captains must transfer captaincy before leaving" }, 409);
  await db.delete(schema.teamMembers).where(and(eq(schema.teamMembers.userId, userId), eq(schema.teamMembers.teamId, membership.teamId)));
  return c.json({ left: true });
});

router.post("/transfer", async (c) => {
  const userId = c.get("jwtPayload").userId;
  const { nextCaptainId } = await c.req.json<{ nextCaptainId?: string }>();
  if (!nextCaptainId) return c.json({ error: "Choose a team member to become captain" }, 400);
  const team = await getDB(c).select().from(schema.teams).where(eq(schema.teams.captainId, userId)).get();
  if (!team) return c.json({ error: "Only the current captain can transfer captaincy" }, 403);
  const result = await c.env.DATABASE.prepare(`
    UPDATE teams SET captain_id = ? WHERE id = ? AND captain_id = ?
      AND EXISTS (SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?)
  `).bind(nextCaptainId, team.id, userId, team.id, nextCaptainId).run();
  return result.meta.changes ? c.json({ transferred: true }) : c.json({ error: "The selected user is not on your team" }, 409);
});

router.put("/:id", async (c) => {
  const userId = c.get("jwtPayload").userId;
  const teamId = c.req.param("id");
  const { name } = await c.req.json<{ name?: string }>();
  const team = await getDB(c).select().from(schema.teams).where(eq(schema.teams.id, teamId)).get();
  if (!team) return c.json({ error: "Team not found" }, 404);
  if (!c.get("jwtPayload").isAdmin && team.captainId !== userId) return c.json({ error: "Only a captain or admin can update the team" }, 403);
  const normalizedName = name?.trim();
  if (!normalizedName || normalizedName.length > 48) return c.json({ error: "Team name must be between 1 and 48 characters" }, 400);
  try {
    const updated = await getDB(c).update(schema.teams).set({ name: normalizedName }).where(eq(schema.teams.id, teamId)).returning({ id: schema.teams.id, name: schema.teams.name, captainId: schema.teams.captainId }).get();
    return c.json({ team: updated });
  } catch { return c.json({ error: "Team name is already taken" }, 409); }
});

router.get("/:id", async (c) => {
  const team = await getDB(c).select({ id: schema.teams.id, name: schema.teams.name, captainId: schema.teams.captainId, hidden: schema.teams.hidden, isBanned: schema.teams.isBanned }).from(schema.teams).where(eq(schema.teams.id, c.req.param("id"))).get();
  if (!team || team.hidden || team.isBanned) return c.json({ error: "Team not found" }, 404);
  const db = getDB(c);
  const event = await db.query.eventSettings.findFirst();
  const cutoff = event?.scoreboardFrozenAt?.getTime();
  if (event && !event.scoreboardPublic && !c.get("jwtPayload").isAdmin) return c.json({ error: "The scoreboard is private" }, 403);
  const members = await db.select({ id: schema.users.id, username: schema.users.username }).from(schema.teamMembers).innerJoin(schema.users, eq(schema.teamMembers.userId, schema.users.id)).where(and(eq(schema.teamMembers.teamId, team.id), eq(schema.users.isAdmin, false)));
  const solves = await db.select({ challengeId: schema.challenges.id, challengeName: schema.challenges.name, points: schema.challenges.points, solvedAt: schema.teamSolves.solvedAt }).from(schema.teamSolves).innerJoin(schema.challenges, eq(schema.teamSolves.challengeId, schema.challenges.id)).where(eq(schema.teamSolves.teamId, team.id)).orderBy(schema.teamSolves.solvedAt);
  const visibleSolves = solves.filter((solve) => cutoff === undefined || solve.solvedAt.getTime() <= cutoff);
  const attempts = await db.select({ isCorrect: schema.submissions.isCorrect }).from(schema.submissions).where(eq(schema.submissions.teamId, team.id));
  const visibleAttempts = attempts; // Attempts are retained for team stats, including after a scoreboard freeze.
  const unlocks = await db.select({ cost: schema.challengeHints.cost, unlockedAt: schema.hintUnlocks.unlockedAt }).from(schema.hintUnlocks).innerJoin(schema.challengeHints, eq(schema.hintUnlocks.hintId, schema.challengeHints.id)).where(eq(schema.hintUnlocks.teamId, team.id));
  const hintSpend = unlocks.filter((item) => cutoff === undefined || item.unlockedAt.getTime() <= cutoff).reduce((sum, item) => sum + item.cost, 0);
  const totalPoints = visibleSolves.reduce((sum, solve) => sum + solve.points, 0) - hintSpend;
  const scores = await db.select({ teamId: schema.teamSolves.teamId, points: schema.challenges.points }).from(schema.teamSolves).innerJoin(schema.challenges, eq(schema.teamSolves.challengeId, schema.challenges.id)).innerJoin(schema.teams, eq(schema.teamSolves.teamId, schema.teams.id)).where(and(eq(schema.teams.isBanned, false), sql`EXISTS (SELECT 1 FROM team_members tm JOIN user member ON member.id = tm.user_id WHERE tm.team_id = ${schema.teams.id} AND member.isAdmin = 0)`, cutoff === undefined ? undefined : lte(schema.teamSolves.solvedAt, new Date(cutoff))));
  const totals = new Map<string, number>();
  for (const row of scores) totals.set(row.teamId, (totals.get(row.teamId) || 0) + row.points);
  const allHintCosts = await db.select({ teamId: schema.hintUnlocks.teamId, cost: schema.challengeHints.cost, unlockedAt: schema.hintUnlocks.unlockedAt }).from(schema.hintUnlocks).innerJoin(schema.challengeHints, eq(schema.hintUnlocks.hintId, schema.challengeHints.id)).where(cutoff === undefined ? undefined : lte(schema.hintUnlocks.unlockedAt, new Date(cutoff)));
  for (const item of allHintCosts) totals.set(item.teamId, (totals.get(item.teamId) || 0) - item.cost);
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const rank = ranked.findIndex(([teamId]) => teamId === team.id) + 1 || null;
  return c.json({ team: { id: team.id, name: team.name, captainId: team.captainId, members }, stats: { rank, totalPoints, solves: visibleSolves.length, attempts: visibleAttempts.length, correctAttempts: visibleAttempts.filter((attempt) => attempt.isCorrect).length, accuracy: visibleAttempts.length ? Math.round(visibleAttempts.filter((attempt) => attempt.isCorrect).length / visibleAttempts.length * 100) : 0, hintSpend, lastSolveAt: visibleSolves.at(-1)?.solvedAt ?? null }, solvedChallenges: visibleSolves });
});

export default router;
