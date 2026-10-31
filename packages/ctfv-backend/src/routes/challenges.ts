import { and, eq, lte, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { JwtVariables, sign, verify } from "hono/jwt";

import { getDB } from "..";
import { Bindings } from "../../env";
import * as schema from "../db/schema";
import { adminMiddleware } from "../middlewares/admin";
import { authMiddleware } from "../middlewares/auth";
import { teamMiddleware } from "../middlewares/team";
import { buildAuditInsert, writeAudit } from "../utils/audit";

type Variables = JwtVariables;

const isSafeFlagRegex = (pattern: string) => {
  if (pattern.length > 128 || /\)[*+{]/.test(pattern)) return false;
  const unboundedQuantifiers = pattern.match(/[+*]|\{\d+,\}/g) ?? [];
  if (unboundedQuantifiers.length > 2) return false;
  try { new RegExp(pattern, "i"); return true; } catch { return false; }
};

const challengesRouter = new Hono<{
  Bindings: Bindings;
  Variables: Variables;
}>();

async function verifyOptionalViewer(c: { env: Bindings }, token: string): Promise<boolean | null> {
  try {
    const payload = await verify(token, c.env.AUTH_SECRET);
    if (typeof payload.userId !== "string" || typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    const account = await c.env.DATABASE.prepare("SELECT is_banned, isAdmin, emailVerified FROM user WHERE id = ?")
      .bind(payload.userId).first<{ is_banned: number; isAdmin: number; emailVerified: number }>();
    if (!account || account.is_banned || !account.emailVerified || Boolean(account.isAdmin) !== (payload.isAdmin === true) || payload.emailVerified !== true) return null;
    return Boolean(account.isAdmin);
  } catch {
    return null;
  }
}

challengesRouter.post("/create", authMiddleware, adminMiddleware, async (c) => {
  try {
    const db = getDB(c);
    const { name, description, url, points, author, category, flag, date, flags, hints, tags, maxAttempts, isVisible } =
      await c.req.json();
    if (isVisible !== undefined && typeof isVisible !== "boolean") return c.json({ error: "Visibility must be true or false" }, 400);
    const visible = isVisible === undefined ? true : isVisible;
    const flagRows = Array.isArray(flags) && flags.length ? flags : [{ value: flag, type: "static" }];
    if (typeof name !== "string" || !name.trim() || name.trim().length > 120 || typeof description !== "string" || !description.trim() || description.length > 50000 || typeof author !== "string" || !author.trim() || author.trim().length > 100 || typeof category !== "string" || !category.trim() || category.trim().length > 80 || !Number.isInteger(Number(points)) || Number(points) < 1 || Number(points) > 100000 || flagRows.length < 1 || flagRows.length > 20) return c.json({ error: "Enter a name, description, author, category, valid points, and 1–20 flags" }, 400);
    if (typeof url !== "string" || url.length > 2048 || (url && ((url.startsWith("/") && url.startsWith("//")) || (!url.startsWith("/") && !/^https:\/\//i.test(url))))) return c.json({ error: "Challenge URL must be a relative path or HTTPS URL" }, 400);
    const normalizedFlags: { value: string; type: string }[] = [];
    for (const item of flagRows) {
      const value = (typeof item === "string" ? item : item?.value)?.trim();
      const type = typeof item === "string" ? "static" : item?.type || "static";
      if (!value || value.length > 512 || !["static", "regex"].includes(type)) return c.json({ error: "Each flag must be a value of at most 512 characters and use static or regex matching" }, 400);
      if (type === "regex" && !isSafeFlagRegex(value)) return c.json({ error: "Regex flags must be valid, at most 128 characters, and use limited repetition" }, 400);
      normalizedFlags.push({ value, type });
    }
    if (maxAttempts !== null && maxAttempts !== undefined && (!Number.isInteger(Number(maxAttempts)) || Number(maxAttempts) < 1 || Number(maxAttempts) > 1000000)) return c.json({ error: "Maximum attempts must be an integer between 1 and 1,000,000" }, 400);
    if (hints !== undefined && (!Array.isArray(hints) || hints.length > 30 || hints.some((hint: any) => typeof hint?.body !== "string" || hint.body.trim().length > 10000 || !Number.isInteger(Number(hint.cost)) || Number(hint.cost) < 0 || Number(hint.cost) > Number(points)))) return c.json({ error: "Hints need text and an integer cost between zero and the challenge points" }, 400);
    if (tags !== undefined && (!Array.isArray(tags) || tags.length > 30 || tags.some((tag: unknown) => typeof tag !== "string" || !tag.trim() || tag.trim().length > 40))) return c.json({ error: "Provide at most 30 tags, each 1–40 characters" }, 400);
    const challengeId = crypto.randomUUID();
    const newChallenge = { id: challengeId, name: name.trim(), description, url: url || "", points: Number(points), author: author.trim(), category: category.trim(), flag: normalizedFlags[0]?.value ?? "", date: typeof date === "string" ? date.slice(0, 100) : null, maxAttempts: maxAttempts ? Number(maxAttempts) : null, isVisible: visible };
    const batch: any[] = [db.insert(schema.challenges).values(newChallenge)];
    for (const item of normalizedFlags) batch.push(db.insert(schema.challengeFlags).values({ challengeId, value: item.value, type: item.type }));
    for (const hint of (Array.isArray(hints) ? hints : [])) batch.push(db.insert(schema.challengeHints).values({ challengeId, body: hint.body.trim(), cost: Number(hint.cost), sortOrder: Number.isInteger(Number(hint.sortOrder)) ? Number(hint.sortOrder) : 0 }));
    for (const tag of (Array.isArray(tags) ? tags : [])) batch.push(db.insert(schema.challengeTags).values({ challengeId, tag: tag.trim() }));
    batch.push(buildAuditInsert(c, { action: "challenge.created", targetType: "challenge", targetId: challengeId, metadata: { name: newChallenge.name, category: newChallenge.category, points: newChallenge.points } }));
    await db.batch(batch as [typeof batch[number], ...typeof batch[number][]]);
    return c.json({ ...newChallenge, flag: undefined });
  } catch {
    return c.json({
      error: "Could not create challenge",
    });
  }
});

challengesRouter.get("/read", authMiddleware, teamMiddleware, async (c) => {
  try {
    const db = getDB(c);
    const userId = c.get("jwtPayload").userId;
    const event = await db.query.eventSettings.findFirst();
    if (event?.startsAt && Date.now() < event.startsAt.getTime()) return c.json({ error: "The event has not started" }, 403);
    if (event?.endsAt && Date.now() > event.endsAt.getTime() && !event.viewChallengesAfterEnd) return c.json({ error: "The event has ended" }, 403);

    const allChallenges = await db.select().from(schema.challenges);
    const isAdmin = c.get("jwtPayload").isAdmin;
    const team = await db.select({ teamId: schema.teamMembers.teamId }).from(schema.teamMembers).where(eq(schema.teamMembers.userId, userId)).get();
    const visibleChallenges = allChallenges.filter((challenge) => challenge.isVisible || isAdmin);
    const allTags = await db.select().from(schema.challengeTags);
    const allFlags = isAdmin ? await db.select().from(schema.challengeFlags) : [];
    const allHints = await db.select().from(schema.challengeHints);
    const solvedChallenges = team
      ? await db.select({ challengeId: schema.teamSolves.challengeId }).from(schema.teamSolves).where(eq(schema.teamSolves.teamId, team.teamId))
      : [];

    const solvedChallengeIds = new Set(
      solvedChallenges.map((c) => c.challengeId),
    );

    const groupedChallenges = visibleChallenges.reduce(
      (acc, challenge) => {
        if (!acc[challenge.category]) {
          acc[challenge.category] = [];
        }
        acc[challenge.category].push({
          id: challenge.id,
          name: challenge.name,
          description: challenge.description,
          url: challenge.url,
          points: challenge.points,
          author: challenge.author,
          flag: isAdmin ? challenge.flag : null,
          maxAttempts: challenge.maxAttempts,
          isVisible: challenge.isVisible,
          tags: allTags.filter((item) => item.challengeId === challenge.id).map((item) => item.tag),
          flags: isAdmin ? allFlags.filter((item) => item.challengeId === challenge.id).map(({ value, type }) => ({ value, type })) : undefined,
          hints: allHints.filter((item) => item.challengeId === challenge.id).map(({ id, body, cost }) => ({ id, body: isAdmin || cost === 0 ? body : undefined, cost })),
          solved: solvedChallengeIds.has(challenge.id),
          date: challenge.date,
        });
        return acc;
      },
      {} as Record<string, any>,
    );

    const response = {
      challenges: Object.entries(groupedChallenges).map(
        ([category, challenges]) => ({
          category,
          challenges,
        }),
      ),
    };

    return c.json(response);
  } catch {
    return c.json({ error: "Could not load challenges" }, 500);
  }
});

challengesRouter.put(
  "/update/:id",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    try {
      const db = getDB(c);
      const { name, description, url, points, author, category, date, flags, hints, tags, maxAttempts, isVisible } =
        await c.req.json();
      const challengeId = c.req.param("id");
      const existingChallenge = await db.query.challenges.findFirst({ where: eq(schema.challenges.id, challengeId) });
      if (!existingChallenge) return c.json({ error: "Challenge not found" }, 404);
      const normalizedFlags: { value: string; type: string }[] = [];
      if (flags !== undefined && !Array.isArray(flags) || hints !== undefined && !Array.isArray(hints) || tags !== undefined && !Array.isArray(tags)) return c.json({ error: "Flags, hints, and tags must be lists" }, 400);
      if (Array.isArray(flags)) {
        if (flags.length < 1 || flags.length > 20) return c.json({ error: "A challenge needs 1–20 flags" }, 400);
        for (const item of flags) {
          const value = (typeof item === "string" ? item : item?.value)?.trim();
          const type = typeof item === "string" ? "static" : item?.type || "static";
          if (!value || value.length > 512 || !["static", "regex"].includes(type)) return c.json({ error: "Invalid flag value or match type" }, 400);
          if (type === "regex" && !isSafeFlagRegex(value)) return c.json({ error: "Regex flags must be valid, at most 128 characters, and use limited repetition" }, 400);
          normalizedFlags.push({ value, type });
        }
      }
      if (maxAttempts !== undefined && maxAttempts !== null && (!Number.isInteger(Number(maxAttempts)) || Number(maxAttempts) < 1 || Number(maxAttempts) > 1000000)) return c.json({ error: "Maximum attempts must be an integer between 1 and 1,000,000" }, 400);
      if (name !== undefined && (typeof name !== "string" || !name.trim() || name.trim().length > 120) || description !== undefined && (typeof description !== "string" || !description.trim() || description.length > 50000) || author !== undefined && (typeof author !== "string" || !author.trim() || author.trim().length > 100) || category !== undefined && (typeof category !== "string" || !category.trim() || category.trim().length > 80) || points !== undefined && (!Number.isInteger(Number(points)) || Number(points) < 1 || Number(points) > 100000)) return c.json({ error: "One or more challenge fields are invalid" }, 400);
      if (url !== undefined && (typeof url !== "string" || url.length > 2048 || (url && ((url.startsWith("/") && url.startsWith("//")) || (!url.startsWith("/") && !/^https:\/\//i.test(url)))))) return c.json({ error: "Challenge URL must be a relative path or HTTPS URL" }, 400);
      if (isVisible !== undefined && typeof isVisible !== "boolean") return c.json({ error: "Visibility must be true or false" }, 400);
      if (hints !== undefined && (!Array.isArray(hints) || hints.length > 30 || hints.some((hint: any) => typeof hint?.body !== "string" || !hint.body.trim() || hint.body.trim().length > 10000 || !Number.isInteger(Number(hint.cost)) || Number(hint.cost) < 0 || Number(hint.cost) > Number(points ?? existingChallenge.points)))) return c.json({ error: "Hints need text and valid costs" }, 400);
      if (tags !== undefined && (!Array.isArray(tags) || tags.length > 30 || tags.some((tag: unknown) => typeof tag !== "string" || !tag.trim() || tag.trim().length > 40))) return c.json({ error: "Provide at most 30 valid tags" }, 400);
      const statements: any[] = [db.update(schema.challenges).set({ name, description, url, points, author, category, date, flag: Array.isArray(flags) ? normalizedFlags[0]?.value ?? "" : undefined, maxAttempts: maxAttempts === undefined ? undefined : (maxAttempts ? Number(maxAttempts) : null), isVisible: isVisible === undefined ? undefined : Boolean(isVisible) }).where(eq(schema.challenges.id, challengeId))];
      if (Array.isArray(flags)) {
        statements.push(db.delete(schema.challengeFlags).where(eq(schema.challengeFlags.challengeId, challengeId)));
        for (const item of normalizedFlags) statements.push(db.insert(schema.challengeFlags).values({ challengeId, value: item.value, type: item.type }));
      }
      if (Array.isArray(hints)) {
        statements.push(db.delete(schema.challengeHints).where(eq(schema.challengeHints.challengeId, challengeId)));
        for (const hint of hints) statements.push(db.insert(schema.challengeHints).values({ challengeId, body: hint.body.trim(), cost: Number(hint.cost), sortOrder: Number.isInteger(Number(hint.sortOrder)) ? Number(hint.sortOrder) : 0 }));
      }
      if (Array.isArray(tags)) {
        statements.push(db.delete(schema.challengeTags).where(eq(schema.challengeTags.challengeId, challengeId)));
        for (const tag of tags) statements.push(db.insert(schema.challengeTags).values({ challengeId, tag: tag.trim() }));
      }
      statements.push(buildAuditInsert(c, { action: "challenge.updated", targetType: "challenge", targetId: challengeId, metadata: { name: typeof name === "string" ? name.trim() : existingChallenge.name, category: typeof category === "string" ? category.trim() : existingChallenge.category, points: points === undefined ? existingChallenge.points : Number(points), isVisible: isVisible === undefined ? existingChallenge.isVisible : Boolean(isVisible) } }));
      await db.batch(statements as [typeof statements[number], ...typeof statements[number][]]);
      const updated = await db.query.challenges.findFirst({ where: eq(schema.challenges.id, challengeId) });
      if (!updated) return c.json({ error: "Challenge not found" }, 404);
      return c.json({ id: updated.id, name: updated.name, description: updated.description, url: updated.url, points: updated.points, author: updated.author, category: updated.category, date: updated.date, isVisible: updated.isVisible, maxAttempts: updated.maxAttempts });
    } catch {
      return c.json({ error: "Could not update challenge" }, 500);
    }
  },
);

challengesRouter.delete(
  "/delete/:id",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    try {
      const db = getDB(c);
      const challengeId = c.req.param("id");
      const deletedChallenge = await db
        .delete(schema.challenges)
        .where(eq(schema.challenges.id, challengeId))
        .returning()
        .get();

      if (!deletedChallenge) {
        return c.json({ error: "Challenge not found" });
      }

      await writeAudit(c, { action: "challenge.deleted", targetType: "challenge", targetId: challengeId, metadata: { name: deletedChallenge.name, category: deletedChallenge.category, points: deletedChallenge.points } });

      return c.json(deletedChallenge);
    } catch {
      return c.json({ error: "Could not delete challenge" }, 500);
    }
  },
);

challengesRouter.post("/submit/:id", authMiddleware, teamMiddleware, async (c) => {
  try {
    if (c.get("jwtPayload").isAdmin) return c.json({ error: "Organizer accounts cannot submit flags" }, 403);
    const db = getDB(c);
    const challengeId = c.req.param("id");
    const { flag } = await c.req.json();
    if (typeof flag !== "string" || flag.length > 256) return c.json({ error: "Flag must be a string under 256 characters" }, 400);
    const userId = c.get("jwtPayload").userId;
    const team = await db.select().from(schema.teamMembers).where(eq(schema.teamMembers.userId, userId)).get();
    if (!team) return c.json({ error: "Create or join a team before participating", code: "TEAM_REQUIRED" }, 403);

    const challenge = await db
      .select()
      .from(schema.challenges)
      .where(eq(schema.challenges.id, challengeId))
      .get();

    if (!challenge) {
      return c.json({ error: "Challenge not found" }, 404);
    }
    if (!challenge.isVisible && !c.get("jwtPayload").isAdmin) return c.json({ error: "Challenge not found" }, 404);
    const event = await db.query.eventSettings.findFirst();
    const now = Date.now();
    if (event?.paused) return c.json({ error: "The event is paused" }, 403);
    if (event?.startsAt && now < event.startsAt.getTime()) return c.json({ error: "The event has not started" }, 403);
    if (event?.endsAt && now > event.endsAt.getTime()) return c.json({ error: "The event has ended" }, 403);

    const hasSubmitted = await db.select().from(schema.teamSolves)
      .where(and(eq(schema.teamSolves.teamId, team.teamId), eq(schema.teamSolves.challengeId, challengeId))).get();

    if (hasSubmitted) {
      return c.json({ error: "Already submitted" }, 400);
    }

    const recent = await c.env.DATABASE.prepare("SELECT COUNT(*) AS total FROM submissions WHERE teamId = ? AND timestamp >= ?")
      .bind(team.teamId, now - 60_000).first<{ total: number }>();
    if ((recent?.total ?? 0) >= 10) return c.json({ error: "Submission rate limit reached. Try again in a minute." }, 429);
    if (challenge.maxAttempts !== null && challenge.maxAttempts !== undefined) {
      const attempts = await c.env.DATABASE.prepare("SELECT COUNT(*) AS total FROM submissions WHERE teamId = ? AND challengeId = ?")
        .bind(team.teamId, challengeId).first<{ total: number }>();
      if ((attempts?.total ?? 0) >= challenge.maxAttempts) return c.json({ error: "Maximum attempts reached" }, 429);
    }
    const acceptedFlags = await db.select().from(schema.challengeFlags).where(eq(schema.challengeFlags.challengeId, challengeId));
    const candidates = acceptedFlags.length ? acceptedFlags : [{ value: challenge.flag, type: "static" }];
    const isCorrect = candidates.some((accepted) => {
      if (accepted.type === "static") return accepted.value === flag;
      try { return isSafeFlagRegex(accepted.value) && new RegExp(accepted.value, "i").test(flag); } catch { return false; }
    });

    const submissionId = crypto.randomUUID();
    const maxAttemptsEnabled = challenge.maxAttempts !== null && challenge.maxAttempts !== undefined;
    const results = await c.env.DATABASE.batch([
      c.env.DATABASE.prepare(`
        INSERT INTO submissions (id, userId, teamId, challengeId, input, timestamp, isCorrect)
        SELECT ?, ?, ?, ?, ?, ?, ?
        WHERE (? = 0 OR (SELECT COUNT(*) FROM submissions WHERE teamId = ? AND challengeId = ?) < ?)
          AND (SELECT COUNT(*) FROM submissions WHERE teamId = ? AND timestamp >= ?) < 10
          AND (? = 0 OR NOT EXISTS (SELECT 1 FROM team_solves WHERE team_id = ? AND challenge_id = ?))
      `).bind(submissionId, userId, team.teamId, challengeId, flag, now, isCorrect ? 1 : 0,
        maxAttemptsEnabled ? 1 : 0, team.teamId, challengeId, challenge.maxAttempts ?? 0,
        team.teamId, now - 60_000, isCorrect ? 1 : 0, team.teamId, challengeId),
      c.env.DATABASE.prepare(`
        INSERT OR IGNORE INTO team_solves (id, team_id, challenge_id, submission_id, solved_at)
        SELECT ?, ?, ?, ?, ? FROM submissions WHERE id = ? AND isCorrect = 1
      `).bind(crypto.randomUUID(), team.teamId, challengeId, submissionId, now, submissionId),
    ]);

    if (!results[0]?.meta.changes) {
      const solved = await db.select().from(schema.teamSolves).where(and(eq(schema.teamSolves.teamId, team.teamId), eq(schema.teamSolves.challengeId, challengeId))).get();
      if (solved) return c.json({ error: "Already submitted" }, 400);
      const latestCount = await c.env.DATABASE.prepare("SELECT COUNT(*) AS total FROM submissions WHERE teamId = ? AND timestamp >= ?").bind(team.teamId, now - 60_000).first() as { total: number } | null;
      if ((latestCount?.total ?? 0) >= 10) return c.json({ error: "Submission rate limit reached. Try again in a minute." }, 429);
      return c.json({ error: "Maximum attempts reached" }, 429);
    }

    return c.json({
      submission: {
        id: submissionId,
        timestamp: new Date(now),
        isCorrect,
      },
    });
  } catch {
    return c.json(
      { error: "Could not process submission" },
      500,
    );
  }
});

challengesRouter.get("/submissions", authMiddleware, async (c) => {
  try {
    const db = getDB(c);
    const isAdmin = c.get("jwtPayload").isAdmin;
    const userId = c.get("jwtPayload").userId;

    const submissions = await db
      .select({
        id: schema.submissions.id,
        userId: schema.submissions.userId,
        challengeId: schema.submissions.challengeId,
        input: schema.submissions.input,
        timestamp: schema.submissions.timestamp,
        isCorrect: schema.submissions.isCorrect,
      })
      .from(schema.submissions)
      .orderBy(schema.submissions.timestamp);

    if (!isAdmin) {
      const userSubmissions = submissions.filter(
        (submission) => submission.userId === userId,
      );
      return c.json({ submissions: userSubmissions });
    }

    return c.json({ submissions });
  } catch {
    return c.json(
      { error: "Could not load submission history" },
      500,
    );
  }
});

challengesRouter.get("/:challengeId/hints", authMiddleware, teamMiddleware, async (c) => {
  const isAdmin = c.get("jwtPayload").isAdmin;
  const db = getDB(c);
  const challenge = await db.select().from(schema.challenges).where(eq(schema.challenges.id, c.req.param("challengeId"))).get();
  if (!challenge || (!challenge.isVisible && !isAdmin)) return c.json({ error: "Challenge not found" }, 404);
  const event = await db.query.eventSettings.findFirst();
  const now = Date.now();
  if (!isAdmin && event?.startsAt && now < event.startsAt.getTime()) return c.json({ error: "The event has not started" }, 403);
  if (!isAdmin && event?.endsAt && now > event.endsAt.getTime() && !event.viewChallengesAfterEnd) return c.json({ error: "The event has ended" }, 403);
  const team = await db.select({ teamId: schema.teamMembers.teamId }).from(schema.teamMembers).where(eq(schema.teamMembers.userId, c.get("jwtPayload").userId)).get();
  if (!team && !isAdmin) return c.json({ error: "Team membership required" }, 403);
  const hints = await db.select().from(schema.challengeHints).where(eq(schema.challengeHints.challengeId, c.req.param("challengeId"))).orderBy(schema.challengeHints.sortOrder);
  const unlocked = team ? await db.select({ hintId: schema.hintUnlocks.hintId }).from(schema.hintUnlocks).where(eq(schema.hintUnlocks.teamId, team.teamId)) : [];
  const unlockedIds = new Set(unlocked.map((item) => item.hintId));
  return c.json({ hints: hints.map(({ id, cost, sortOrder, body }) => ({ id, cost, sortOrder, unlocked: isAdmin || cost === 0 || unlockedIds.has(id), body: isAdmin || cost === 0 || unlockedIds.has(id) ? body : null })) });
});

challengesRouter.post("/hints/:hintId/unlock", authMiddleware, teamMiddleware, async (c) => {
  const db = getDB(c);
  const userId = c.get("jwtPayload").userId;
  const team = await db.select({ teamId: schema.teamMembers.teamId }).from(schema.teamMembers).where(eq(schema.teamMembers.userId, userId)).get();
  const hint = await db.select().from(schema.challengeHints).where(eq(schema.challengeHints.id, c.req.param("hintId"))).get();
  if (!team) return c.json({ error: "Team membership required" }, 403);
  if (!hint) return c.json({ error: "Hint not found" }, 404);
  const challenge = await db.select().from(schema.challenges).where(eq(schema.challenges.id, hint.challengeId)).get();
  if (!challenge || !challenge.isVisible) return c.json({ error: "Challenge not found" }, 404);
  const event = await db.query.eventSettings.findFirst();
  const now = Date.now();
  if (event?.paused) return c.json({ error: "The event is paused" }, 403);
  if (event?.startsAt && now < event.startsAt.getTime()) return c.json({ error: "The event has not started" }, 403);
  if (event?.endsAt && now > event.endsAt.getTime()) return c.json({ error: "The event has ended" }, 403);
  const result = await c.env.DATABASE.prepare(`
    INSERT INTO hint_unlocks(id, hint_id, team_id)
    SELECT ?, ?, ? WHERE NOT EXISTS (
      SELECT 1 FROM hint_unlocks WHERE hint_id = ? AND team_id = ?
    ) AND ? <= COALESCE((
      SELECT SUM(ch.points) - COALESCE((SELECT SUM(h.cost) FROM hint_unlocks hu JOIN challenge_hints h ON h.id = hu.hint_id WHERE hu.team_id = ?), 0)
      FROM team_solves ts JOIN challenges ch ON ch.id = ts.challenge_id WHERE ts.team_id = ?
    ), 0)
  `).bind(crypto.randomUUID(), hint.id, team.teamId, hint.id, team.teamId, hint.cost, team.teamId, team.teamId).run();
  if (!result.meta.changes) {
    const prior = await db.select().from(schema.hintUnlocks).where(and(eq(schema.hintUnlocks.hintId, hint.id), eq(schema.hintUnlocks.teamId, team.teamId))).get();
    if (!prior) return c.json({ error: "Not enough team points to unlock this hint" }, 409);
  }
  return c.json({ hint: { id: hint.id, body: hint.body, cost: hint.cost }, alreadyUnlocked: !result.meta.changes });
});

challengesRouter.get("/leaderboard", async (c) => {
  try {
    const db = getDB(c);
    let isAdmin = false;
    const authorization = c.req.header("Authorization");
    if (authorization) {
      if (!authorization.startsWith("Bearer ")) return c.json({ error: "Invalid authorization" }, 401);
      const role = await verifyOptionalViewer(c, authorization.slice(7));
      if (role === null) return c.json({ error: "Invalid authorization" }, 401);
      isAdmin = role;
    }
    const event = await db.query.eventSettings.findFirst();
    if (event && !event.scoreboardPublic && !isAdmin) return c.json({ error: "The scoreboard is private" }, 403);
    const hintCost = event?.scoreboardFrozenAt
      ? sql`COALESCE((SELECT SUM(h.cost) FROM hint_unlocks hu JOIN challenge_hints h ON h.id = hu.hint_id WHERE hu.team_id = ${schema.teamSolves.teamId} AND hu.unlocked_at <= ${event.scoreboardFrozenAt.getTime()}), 0)`
      : sql`COALESCE((SELECT SUM(h.cost) FROM hint_unlocks hu JOIN challenge_hints h ON h.id = hu.hint_id WHERE hu.team_id = ${schema.teamSolves.teamId}), 0)`;
    const leaderboard = await db
      .select({
        teamId: schema.teamSolves.teamId,
        teamName: schema.teams.name,
        username: schema.teams.name,
        totalPoints: sql`SUM(${schema.challenges.points}) - ${hintCost}`.as("totalPoints"),
        lastSubmission: sql`MAX(${schema.teamSolves.solvedAt})`.as(
          "lastSubmission",
        ),
      })
      .from(schema.teamSolves)
      .innerJoin(
        schema.challenges,
        eq(schema.teamSolves.challengeId, schema.challenges.id),
      )
      .innerJoin(schema.teams, eq(schema.teamSolves.teamId, schema.teams.id))
      .where(and(eq(schema.teams.isBanned, false), sql`EXISTS (SELECT 1 FROM team_members tm JOIN user member ON member.id = tm.user_id WHERE tm.team_id = ${schema.teams.id} AND member.isAdmin = 0)`, event?.scoreboardFrozenAt ? lte(schema.teamSolves.solvedAt, event.scoreboardFrozenAt) : undefined))
      .groupBy(schema.teamSolves.teamId)
      .orderBy(sql`totalPoints DESC`, sql`lastSubmission ASC`)
      .all();

    return c.json({ leaderboard });
  } catch {
    return c.json({ error: "Could not load scoreboard" }, 500);
  }
});

challengesRouter.get("/scoreboard-history", async (c) => {
  const authorization = c.req.header("Authorization");
  let isAdmin = false;
  if (authorization) {
    if (!authorization.startsWith("Bearer ")) return c.json({ error: "Invalid authorization" }, 401);
    const role = await verifyOptionalViewer(c, authorization.slice(7));
    if (role === null) return c.json({ error: "Invalid authorization" }, 401);
    isAdmin = role;
  }
  const db = getDB(c);
  const event = await db.query.eventSettings.findFirst();
  if (event && !event.scoreboardPublic && !isAdmin) return c.json({ error: "The scoreboard is private" }, 403);
  const cutoff = event?.scoreboardFrozenAt?.getTime();
  const solves = await db.select({ teamId: schema.teamSolves.teamId, teamName: schema.teams.name, points: schema.challenges.points, solvedAt: schema.teamSolves.solvedAt })
    .from(schema.teamSolves).innerJoin(schema.challenges, eq(schema.teamSolves.challengeId, schema.challenges.id)).innerJoin(schema.teams, eq(schema.teamSolves.teamId, schema.teams.id))
    .where(and(eq(schema.teams.isBanned, false), sql`EXISTS (SELECT 1 FROM team_members tm JOIN user member ON member.id = tm.user_id WHERE tm.team_id = ${schema.teams.id} AND member.isAdmin = 0)`, cutoff === undefined ? undefined : lte(schema.teamSolves.solvedAt, new Date(cutoff))))
    .orderBy(schema.teamSolves.solvedAt);
  const unlocks = await db.select({ teamId: schema.hintUnlocks.teamId, cost: schema.challengeHints.cost, unlockedAt: schema.hintUnlocks.unlockedAt })
    .from(schema.hintUnlocks).innerJoin(schema.challengeHints, eq(schema.hintUnlocks.hintId, schema.challengeHints.id))
    .where(cutoff === undefined ? undefined : lte(schema.hintUnlocks.unlockedAt, new Date(cutoff))).orderBy(schema.hintUnlocks.unlockedAt);
  const timeline = [...solves.map((row) => ({ teamId: row.teamId, teamName: row.teamName, at: row.solvedAt.getTime(), delta: row.points })), ...unlocks.map((row) => ({ teamId: row.teamId, teamName: "", at: row.unlockedAt.getTime(), delta: -row.cost }))].sort((a, b) => a.at - b.at);
  const names = new Map(solves.map((row) => [row.teamId, row.teamName]));
  const totals = new Map<string, number>();
  const points = new Map<string, { at: number; score: number }[]>();
  for (const row of timeline) {
    const next = (totals.get(row.teamId) || 0) + row.delta;
    totals.set(row.teamId, next);
    const history = points.get(row.teamId) || [];
    history.push({ at: row.at, score: next });
    points.set(row.teamId, history);
  }
  const teams = [...points.entries()].map(([teamId, history]) => ({ teamId, teamName: names.get(teamId) || "", points: history }))
    .sort((a, b) => (b.points.at(-1)?.score || 0) - (a.points.at(-1)?.score || 0)).slice(0, 12);
  return c.json({ teams });
});

challengesRouter.get("/personal/:id", authMiddleware, async (c) => {
  try {
    const db = getDB(c);
    const id = c.req.param("id");
    const isAdmin = c.get("jwtPayload").isAdmin;
    const targetUser = await db.select({ isAdmin: schema.users.isAdmin }).from(schema.users).where(eq(schema.users.id, id)).get();
    if (targetUser?.isAdmin && !isAdmin) return c.json({ error: "User not found" }, 404);
    const event = await db.query.eventSettings.findFirst();
    if (event && !event.scoreboardPublic && !isAdmin) return c.json({ error: "The scoreboard is private" }, 403);
    const hintCost = event?.scoreboardFrozenAt
      ? sql`COALESCE((SELECT SUM(h.cost) FROM hint_unlocks hu JOIN challenge_hints h ON h.id = hu.hint_id WHERE hu.team_id = ${schema.teamSolves.teamId} AND hu.unlocked_at <= ${event.scoreboardFrozenAt.getTime()}), 0)`
      : sql`COALESCE((SELECT SUM(h.cost) FROM hint_unlocks hu JOIN challenge_hints h ON h.id = hu.hint_id WHERE hu.team_id = ${schema.teamSolves.teamId}), 0)`;
    const targetTeam = await db.select({ teamId: schema.teamMembers.teamId })
      .from(schema.teamMembers).where(or(eq(schema.teamMembers.userId, id), eq(schema.teamMembers.teamId, id))).get();
    if (!targetTeam) return c.json({ error: "This competitor is not in a team" }, 404);

    const leaderboard = await db
      .select({
        teamId: schema.teamSolves.teamId,
        username: schema.teams.name,
        totalPoints: sql`SUM(${schema.challenges.points}) - ${hintCost}`.as("totalPoints"),
        lastSubmission: sql`MAX(${schema.teamSolves.solvedAt})`.as(
          "lastSubmission",
        ),
      })
      .from(schema.teamSolves)
      .innerJoin(
        schema.challenges,
        eq(schema.teamSolves.challengeId, schema.challenges.id),
      )
      .innerJoin(schema.teams, eq(schema.teamSolves.teamId, schema.teams.id))
      .where(and(eq(schema.teams.isBanned, false), sql`EXISTS (SELECT 1 FROM team_members tm JOIN user member ON member.id = tm.user_id WHERE tm.team_id = ${schema.teams.id} AND member.isAdmin = 0)`, event?.scoreboardFrozenAt ? lte(schema.teamSolves.solvedAt, event.scoreboardFrozenAt) : undefined))
      .groupBy(schema.teamSolves.teamId)
      .orderBy(sql`totalPoints DESC`, sql`lastSubmission ASC`)
      .all();

    const userRank = leaderboard.findIndex((entry) => entry.teamId === targetTeam.teamId) + 1;
    const userData = leaderboard.find((entry) => entry.teamId === targetTeam.teamId);

    if (!userData) {
      return c.json({ error: "User not found" }, 404);
    }

    const solvedChallenges = await db
      .select({
        challengeId: schema.challenges.id,
        challengeName: schema.challenges.name,
        points: schema.challenges.points,
        solvedTime: schema.teamSolves.solvedAt,
      })
      .from(schema.teamSolves)
      .innerJoin(
        schema.challenges,
        eq(schema.teamSolves.challengeId, schema.challenges.id),
      )
      .where(and(eq(schema.teamSolves.teamId, targetTeam.teamId), event?.scoreboardFrozenAt ? lte(schema.teamSolves.solvedAt, event.scoreboardFrozenAt) : undefined))
      .orderBy(schema.teamSolves.solvedAt);

    return c.json({
      rank: userRank,
      username: userData.username,
      totalPoints: userData.totalPoints,
      solvedChallenges,
    });
  } catch {
    return c.json(
      { error: "Could not load team statistics" },
      500,
    );
  }
});

export default challengesRouter;
