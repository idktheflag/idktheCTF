import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { JwtVariables } from "hono/jwt";

import { getDB } from "..";
import { Bindings } from "../../env";
import * as schema from "../db/schema";
import { authMiddleware } from "../middlewares/auth";

type Variables = JwtVariables;

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
      .where(eq(schema.users.isAdmin, false));
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
      .where(and(eq(schema.users.id, userId), eq(schema.users.isAdmin, false)));

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
      .where(and(eq(schema.challenges.id, challengeId), eq(schema.users.isAdmin, false)))
      .orderBy(sql`timestamp ASC`);

    return c.json(result);
  } catch {
    return c.json({ error: "Could not load challenge submissions" }, 500);
  }
});

export default submissionRouter;
