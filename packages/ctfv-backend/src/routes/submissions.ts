import { and, eq, lte, sql } from "drizzle-orm";
import { Context, Hono } from "hono";
import { JwtVariables } from "hono/jwt";

import { getDB } from "..";
import { Bindings } from "../../env";
import * as schema from "../db/schema";
import { authMiddleware } from "../middlewares/auth";

type Variables = JwtVariables;

// Participant history is a scoreboard view, not an organizer attempt log.
async function visibleSubmissions(c: Context<{ Bindings: Bindings; Variables: Variables }>) {
  if (c.get("jwtPayload").isAdmin) return eq(schema.users.isAdmin, false);
  const event = await getDB(c).query.eventSettings.findFirst();
  const now = Date.now();
  if (!event || !event.scoreboardPublic || (event.startsAt && now < event.startsAt.getTime()) || (event.endsAt && now > event.endsAt.getTime() && !event.viewChallengesAfterEnd)) return sql`0 = 1`;
  return and(
    eq(schema.users.isAdmin, false), eq(schema.users.isBanned, false),
    eq(schema.submissions.isCorrect, true), eq(schema.challenges.isVisible, true),
    sql`EXISTS (SELECT 1 FROM teams t WHERE t.id = ${schema.submissions.teamId} AND t.hidden = 0 AND t.is_banned = 0)`,
    event.scoreboardFrozenAt ? lte(schema.submissions.timestamp, event.scoreboardFrozenAt) : undefined,
  );
}

const submissionRouter = new Hono<{
  Bindings: Bindings;
  Variables: Variables;
}>();

submissionRouter.get("/read", authMiddleware, async (c) => {
  try {
    const db = getDB(c);
    const result = await db
      .select({
        username: schema.users.username,
        timestamp: schema.submissions.timestamp,
        challengeName: schema.challenges.name,
        challengeDescription: schema.challenges.description,
        isCorrect: schema.submissions.isCorrect,
      })
      .from(schema.submissions)
      .innerJoin(schema.users, eq(schema.submissions.userId, schema.users.id))
      .innerJoin(
        schema.challenges,
        eq(schema.submissions.challengeId, schema.challenges.id),
      )
      .where(await visibleSubmissions(c));
    return c.json(result);
  } catch {
    return c.json({
      success: false,
      error: "Could not process submission",
    }, 500);
  }
});

submissionRouter.get("/readbyuserid/:id", authMiddleware, async (c) => {
  try {
    const userId = c.req.param("id");
    const db = getDB(c);
    const result = await db
      .select({
        username: schema.users.username,
        timestamp: schema.submissions.timestamp,
        challengeName: schema.challenges.name,
        challengeDescription: schema.challenges.description,
        isCorrect: schema.submissions.isCorrect,
      })
      .from(schema.submissions)
      .innerJoin(schema.users, eq(schema.submissions.userId, schema.users.id))
      .innerJoin(
        schema.challenges,
        eq(schema.submissions.challengeId, schema.challenges.id),
      )
      .where(and(eq(schema.users.id, userId), await visibleSubmissions(c)));

    return c.json(result);
  } catch {
    return c.json({ error: "Could not load submissions" }, 500);
  }
});

submissionRouter.get("/readbychallengeid/:id", authMiddleware, async (c) => {
  try {
    const challengeId = c.req.param("id");
    const db = getDB(c);
    const result = await db
      .select({
        userId: schema.submissions.userId,
        username: schema.users.username,
        timestamp: schema.submissions.timestamp,
        challengeName: schema.challenges.name,
        challengeDescription: schema.challenges.description,
        isCorrect: schema.submissions.isCorrect,
      })
      .from(schema.submissions)
      .innerJoin(schema.users, eq(schema.submissions.userId, schema.users.id))
      .innerJoin(
        schema.challenges,
        eq(schema.submissions.challengeId, schema.challenges.id),
      )
      .where(and(eq(schema.challenges.id, challengeId), await visibleSubmissions(c)))
      .orderBy(sql`timestamp ASC`);

    return c.json(result);
  } catch {
    return c.json({ error: "Could not load challenge submissions" }, 500);
  }
});

export default submissionRouter;
