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
import { readJsonRecord } from "../utils/json-input";
import { compileFlagRegex } from "../utils/flag-regex";
import { buildHintReconciliation, HintInputError } from "../utils/challenge-hints";

type Variables = JwtVariables;

// Evaluated by D1 in the write statement, including schedule changes made in flight.
const eventOpenCondition = `EXISTS (SELECT 1 FROM event_settings WHERE id = 1
  AND paused = 0
  AND (starts_at IS NULL OR starts_at <= CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
  AND (ends_at IS NULL OR ends_at >= CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
)`;


const isChallengeUrl = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) return false;
  if (!value) return true;
  const relative = value.startsWith("/") && !value.startsWith("//");
  if (!relative && !/^https:\/\//i.test(value)) return false;
  try {
    const parsed = new URL(value, "https://challenge.invalid");
    return parsed.protocol === "https:" && Boolean(parsed.hostname) && !parsed.username && !parsed.password
      && (!relative || parsed.origin === "https://challenge.invalid");
  } catch { return false; }
};

const isNumericInput = (value: unknown): value is number | string =>
  typeof value === "number" || (typeof value === "string" && value.trim().length > 0);

const isSafeFlagRegex = (pattern: string) => {
  return compileFlagRegex(pattern) !== null;
};

const challengesRouter = new Hono<{
  Bindings: Bindings;
  Variables: Variables;
}>();

async function verifyOptionalViewer(c: { env: Bindings }, token: string): Promise<boolean | null> {
  let payload: Awaited<ReturnType<typeof verify>>;
  try { payload = await verify(token, c.env.AUTH_SECRET, "HS256"); }
  catch { return null; }
  if (typeof payload.userId !== "string" || typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) return null;
  const account = await c.env.DATABASE.prepare("SELECT is_banned, isAdmin, emailVerified, auth_version FROM user WHERE id = ?")
    .bind(payload.userId).first<{ is_banned: number; isAdmin: number; emailVerified: number; auth_version: number }>();
  if (!account || account.is_banned || Boolean(account.isAdmin) !== (payload.isAdmin === true)) return null;
  if (!Number.isSafeInteger(payload.authVersion) || payload.authVersion !== account.auth_version) return null;
  return Boolean(account.isAdmin && account.emailVerified && payload.emailVerified === true);
}

challengesRouter.post("/create", authMiddleware, adminMiddleware, async (c) => {
  try {
    const db = getDB(c);
    const input = await readJsonRecord(c.req);
    if (!input) return c.json({ error: "Send a valid JSON object" }, 400);
    const { name, description, url, points, author, category, flag, date, flags, hints, tags, maxAttempts, isVisible } = input;
    if (isVisible !== undefined && typeof isVisible !== "boolean") return c.json({ error: "Visibility must be true or false" }, 400);
    const visible = isVisible === undefined ? true : isVisible;
    const flagRows = Array.isArray(flags) && flags.length ? flags : [{ value: flag, type: "static" }];
    if (typeof name !== "string" || !name.trim() || name.trim().length > 120 || typeof description !== "string" || !description.trim() || description.length > 50000 || typeof author !== "string" || !author.trim() || author.trim().length > 100 || typeof category !== "string" || !category.trim() || category.trim().length > 80 || (typeof points !== "number" && typeof points !== "string") || !Number.isInteger(Number(points)) || Number(points) < 1 || Number(points) > 100000 || flagRows.length < 1 || flagRows.length > 20) return c.json({ error: "Enter a name, description, author, category, valid points, and 1–20 flags" }, 400);
    if (!isChallengeUrl(url)) return c.json({ error: "Challenge URL must be a valid relative path or HTTPS URL without embedded credentials" }, 400);
    const normalizedFlags: { value: string; type: string }[] = [];
    for (const item of flagRows) {
      const rawValue = typeof item === "string" ? item : item?.value;
      const value = typeof rawValue === "string" ? rawValue.trim() : "";
      const type = typeof item === "string" ? "static" : item?.type || "static";
      if (!value || value.length > 512 || !["static", "regex"].includes(type)) return c.json({ error: "Each flag must be a value of at most 512 characters and use static or regex matching" }, 400);
      if (type === "regex" && !isSafeFlagRegex(value)) return c.json({ error: "Regex flags must use supported linear-time RE2 syntax, at most 128 characters, and limited repetition; backreferences and lookarounds are unsupported" }, 400);
      normalizedFlags.push({ value, type });
    }
    if (maxAttempts !== null && maxAttempts !== undefined && (!isNumericInput(maxAttempts) || !Number.isInteger(Number(maxAttempts)) || Number(maxAttempts) < 1 || Number(maxAttempts) > 1000000)) return c.json({ error: "Maximum attempts must be an integer between 1 and 1,000,000" }, 400);
    if (hints !== undefined && (!Array.isArray(hints) || hints.length > 30 || hints.some((hint: any) => typeof hint?.body !== "string" || hint.body.trim().length > 10000 || !isNumericInput(hint.cost) || !Number.isInteger(Number(hint.cost)) || Number(hint.cost) < 0 || Number(hint.cost) > Number(points)))) return c.json({ error: "Hints need text and an integer cost between zero and the challenge points" }, 400);
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
    }, 500);
  }
});

challengesRouter.get("/read", authMiddleware, teamMiddleware, async (c) => {
  try {
    const db = getDB(c);
    const userId = c.get("jwtPayload").userId;
    const isAdmin = c.get("jwtPayload").isAdmin;
    const event = await db.query.eventSettings.findFirst();
    if (!event && !isAdmin) return c.json({ error: "Event is not configured" }, 503);
    if (!isAdmin && event?.startsAt && Date.now() < event.startsAt.getTime()) return c.json({ error: "The event has not started" }, 403);
    if (!isAdmin && event?.endsAt && Date.now() > event.endsAt.getTime() && !event.viewChallengesAfterEnd) return c.json({ error: "The event has ended" }, 403);

    const allChallenges = await db.select().from(schema.challenges);
    const team = await db.select({ teamId: schema.teamMembers.teamId }).from(schema.teamMembers).where(eq(schema.teamMembers.userId, userId)).get();
    const visibleChallenges = allChallenges.filter((challenge) => challenge.isVisible || isAdmin);
    const allTags = await db.select().from(schema.challengeTags);
    const allFlags = isAdmin ? await db.select().from(schema.challengeFlags) : [];
    const allHints = await db.select().from(schema.challengeHints).orderBy(schema.challengeHints.sortOrder, schema.challengeHints.id);
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
      Object.create(null) as Record<string, any>,
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
      const input = await readJsonRecord(c.req);
      if (!input) return c.json({ error: "Send a valid JSON object" }, 400);
      const { name, description, url, points, author, category, date, flags, hints, tags, maxAttempts, isVisible } = input;
      const challengeId = c.req.param("id");
      const existingChallenge = await db.query.challenges.findFirst({ where: eq(schema.challenges.id, challengeId) });
      if (!existingChallenge) return c.json({ error: "Challenge not found" }, 404);
      const normalizedFlags: { value: string; type: string }[] = [];
      if (flags !== undefined && !Array.isArray(flags) || hints !== undefined && !Array.isArray(hints) || tags !== undefined && !Array.isArray(tags)) return c.json({ error: "Flags, hints, and tags must be lists" }, 400);
      if (Array.isArray(flags)) {
        if (flags.length < 1 || flags.length > 20) return c.json({ error: "A challenge needs 1–20 flags" }, 400);
        for (const item of flags) {
          const rawValue = typeof item === "string" ? item : item?.value;
          const value = typeof rawValue === "string" ? rawValue.trim() : "";
          const type = typeof item === "string" ? "static" : item?.type || "static";
          if (!value || value.length > 512 || !["static", "regex"].includes(type)) return c.json({ error: "Invalid flag value or match type" }, 400);
          if (type === "regex" && !isSafeFlagRegex(value)) return c.json({ error: "Regex flags must use supported linear-time RE2 syntax, at most 128 characters, and limited repetition; backreferences and lookarounds are unsupported" }, 400);
          normalizedFlags.push({ value, type });
        }
      }
      if (maxAttempts !== undefined && maxAttempts !== null && (!isNumericInput(maxAttempts) || !Number.isInteger(Number(maxAttempts)) || Number(maxAttempts) < 1 || Number(maxAttempts) > 1000000)) return c.json({ error: "Maximum attempts must be an integer between 1 and 1,000,000" }, 400);
      if (name !== undefined && (typeof name !== "string" || !name.trim() || name.trim().length > 120) || description !== undefined && (typeof description !== "string" || !description.trim() || description.length > 50000) || author !== undefined && (typeof author !== "string" || !author.trim() || author.trim().length > 100) || category !== undefined && (typeof category !== "string" || !category.trim() || category.trim().length > 80) || points !== undefined && ((typeof points !== "number" && typeof points !== "string") || !Number.isInteger(Number(points)) || Number(points) < 1 || Number(points) > 100000)) return c.json({ error: "One or more challenge fields are invalid" }, 400);
      if (url !== undefined && !isChallengeUrl(url)) return c.json({ error: "Challenge URL must be a valid relative path or HTTPS URL without embedded credentials" }, 400);
      if (isVisible !== undefined && typeof isVisible !== "boolean") return c.json({ error: "Visibility must be true or false" }, 400);
      if (date !== undefined && date !== null && (typeof date !== "string" || date.length > 100)) return c.json({ error: "Release note must be text of at most 100 characters" }, 400);
      if (hints !== undefined && (!Array.isArray(hints) || hints.length > 30 || hints.some((hint: any) => typeof hint?.body !== "string" || !hint.body.trim() || hint.body.trim().length > 10000 || !isNumericInput(hint.cost) || !Number.isInteger(Number(hint.cost)) || Number(hint.cost) < 0 || Number(hint.cost) > Number(points ?? existingChallenge.points)))) return c.json({ error: "Hints need text and valid costs" }, 400);
      if (tags !== undefined && (!Array.isArray(tags) || tags.length > 30 || tags.some((tag: unknown) => typeof tag !== "string" || !tag.trim() || tag.trim().length > 40))) return c.json({ error: "Provide at most 30 valid tags" }, 400);
      if ([name, description, url, points, author, category, date, flags, hints, tags, maxAttempts, isVisible].every((value) => value === undefined)) return c.json({ error: "Provide at least one challenge field" }, 400);
      const challengeUpdate = { flagVersion: Array.isArray(flags) ? sql`${schema.challenges.flagVersion} + 1` : undefined, name, description, url, points: points === undefined ? undefined : Number(points), author, category, date, flag: Array.isArray(flags) ? normalizedFlags[0]?.value ?? "" : undefined, maxAttempts: maxAttempts === undefined ? undefined : (maxAttempts ? Number(maxAttempts) : null), isVisible: isVisible === undefined ? undefined : Boolean(isVisible) };
      const statements: any[] = [];
      if (Object.values(challengeUpdate).some((value) => value !== undefined)) statements.push(db.update(schema.challenges).set(challengeUpdate).where(eq(schema.challenges.id, challengeId)));
      if (Array.isArray(flags)) {
        statements.push(db.delete(schema.challengeFlags).where(eq(schema.challengeFlags.challengeId, challengeId)));
        for (const item of normalizedFlags) statements.push(db.insert(schema.challengeFlags).values({ challengeId, value: item.value, type: item.type }));
      }
      if (Array.isArray(hints)) {
        statements.push(...await buildHintReconciliation(db, challengeId, hints.map((hint) => ({
          id: hint.id,
          body: hint.body.trim(),
          cost: Number(hint.cost),
          sortOrder: hint.sortOrder === undefined ? undefined : Number.isInteger(Number(hint.sortOrder)) ? Number(hint.sortOrder) : undefined,
        }))));
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
    } catch (error) {
      if (error instanceof HintInputError) return c.json({ error: error.message }, 400);
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
      const existing = await db.select({ id: schema.challenges.id, name: schema.challenges.name, category: schema.challenges.category, points: schema.challenges.points }).from(schema.challenges).where(eq(schema.challenges.id, challengeId)).get();

      if (!existing) {
        return c.json({ error: "Challenge not found" }, 404);
      }
      const deletedChallenge = { id: existing.id, name: existing.name, category: existing.category, points: existing.points };
      await c.env.DATABASE.batch([
        c.env.DATABASE.prepare(`INSERT INTO r2_cleanup_jobs (object_key)
          SELECT object_key FROM attachments WHERE challenge_id = ?
          UNION
          SELECT object_key FROM attachment_uploads WHERE challenge_id = ?
          ON CONFLICT(object_key) DO NOTHING`).bind(challengeId, challengeId),
        c.env.DATABASE.prepare("DELETE FROM challenges WHERE id = ?").bind(challengeId),
      ]);

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
    const input = await readJsonRecord(c.req);
    const flag = input?.flag;
    if (typeof flag !== "string" || flag.length > 512) return c.json({ error: "Flag must be a string of at most 512 characters" }, 400);
    const userId = c.get("jwtPayload").userId;
    const authVersion = Number(c.get("jwtPayload").authVersion);
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
      return compileFlagRegex(accepted.value)?.test(flag) ?? false;
    });

    const submissionId = crypto.randomUUID();
    const results = await c.env.DATABASE.batch([
      c.env.DATABASE.prepare(`
        INSERT INTO submissions (id, userId, teamId, challengeId, input, timestamp, isCorrect)
        SELECT ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM challenges current_challenge WHERE current_challenge.id = ? AND current_challenge.flag_version = ? AND current_challenge.flag = ?
          AND (current_challenge.max_attempts IS NULL OR (SELECT COUNT(*) FROM submissions WHERE teamId = ? AND challengeId = ?) < current_challenge.max_attempts))
          AND EXISTS (SELECT 1 FROM team_members tm JOIN teams t ON t.id = tm.team_id JOIN user account ON account.id = tm.user_id
            WHERE tm.user_id = ? AND tm.team_id = ? AND t.is_banned = 0 AND account.is_banned = 0 AND account.emailVerified = 1 AND account.isAdmin = 0 AND account.auth_version = ?)
          AND EXISTS (SELECT 1 FROM challenges WHERE id = ? AND is_visible = 1)
          AND ${eventOpenCondition}
          AND (SELECT COUNT(*) FROM submissions WHERE teamId = ? AND timestamp >= ?) < 10
          AND NOT EXISTS (SELECT 1 FROM team_solves WHERE team_id = ? AND challenge_id = ?)
      `).bind(submissionId, userId, team.teamId, challengeId, flag, now, isCorrect ? 1 : 0,
        challengeId, challenge.flagVersion, challenge.flag, team.teamId, challengeId,
        userId, team.teamId, authVersion, challengeId,
        team.teamId, now - 60_000, team.teamId, challengeId),
      c.env.DATABASE.prepare(`
        INSERT OR IGNORE INTO team_solves (id, team_id, challenge_id, submission_id, solved_at)
        SELECT ?, ?, ?, ?, ? FROM submissions WHERE id = ? AND isCorrect = 1
      `).bind(crypto.randomUUID(), team.teamId, challengeId, submissionId, now, submissionId),
    ]);

    if (!results[0]?.meta.changes) {
      const activeMembership = await c.env.DATABASE.prepare(`
        SELECT 1 AS active FROM team_members tm JOIN teams t ON t.id = tm.team_id JOIN user account ON account.id = tm.user_id
        WHERE tm.user_id = ? AND tm.team_id = ? AND t.is_banned = 0 AND account.is_banned = 0 AND account.emailVerified = 1 AND account.isAdmin = 0 AND account.auth_version = ?
          AND EXISTS (SELECT 1 FROM challenges WHERE id = ? AND is_visible = 1)
          AND ${eventOpenCondition}
      `).bind(userId, team.teamId, authVersion, challengeId).first();
      if (!activeMembership) return c.json({ error: "Competition access changed. Refresh before trying again." }, 409);
      const currentChallenge = await db.select({ flagVersion: schema.challenges.flagVersion, flag: schema.challenges.flag }).from(schema.challenges).where(eq(schema.challenges.id, challengeId)).get();
      if (!currentChallenge || currentChallenge.flagVersion !== challenge.flagVersion || currentChallenge.flag !== challenge.flag) return c.json({ error: "Challenge flags changed. Reload the challenge before submitting again." }, 409);
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
      .where(isAdmin ? undefined : eq(schema.submissions.userId, userId))
      .orderBy(schema.submissions.timestamp);

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
  if (!event && !isAdmin) return c.json({ error: "Event is not configured" }, 503);
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
  const authVersion = Number(c.get("jwtPayload").authVersion);
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
    ) AND EXISTS (SELECT 1 FROM team_members tm JOIN teams t ON t.id = tm.team_id JOIN user account ON account.id = tm.user_id
      WHERE tm.user_id = ? AND tm.team_id = ? AND t.is_banned = 0 AND account.is_banned = 0 AND account.emailVerified = 1 AND account.isAdmin = 0 AND account.auth_version = ?)
    AND EXISTS (SELECT 1 FROM challenges WHERE id = ? AND is_visible = 1)
    AND ${eventOpenCondition}
    AND EXISTS (SELECT 1 FROM challenge_hints current_hint WHERE current_hint.id = ? AND current_hint.cost = ? AND current_hint.body = ?)
    AND ? <= COALESCE((
      SELECT SUM(ch.points) - COALESCE((SELECT SUM(h.cost) FROM hint_unlocks hu JOIN challenge_hints h ON h.id = hu.hint_id WHERE hu.team_id = ?), 0)
      FROM team_solves ts JOIN challenges ch ON ch.id = ts.challenge_id WHERE ts.team_id = ?
    ), 0)
  `).bind(crypto.randomUUID(), hint.id, team.teamId, hint.id, team.teamId, userId, team.teamId, authVersion, hint.challengeId, hint.id, hint.cost, hint.body, hint.cost, team.teamId, team.teamId).run();
  if (!result.meta.changes) {
    const currentHint = await db.select().from(schema.challengeHints).where(eq(schema.challengeHints.id, hint.id)).get();
    if (!currentHint || currentHint.cost !== hint.cost || currentHint.body !== hint.body) return c.json({ error: "This hint changed. Reload it before purchasing." }, 409);
    const activeMembership = await c.env.DATABASE.prepare(`
      SELECT 1 AS active FROM team_members tm JOIN teams t ON t.id = tm.team_id JOIN user account ON account.id = tm.user_id
      WHERE tm.user_id = ? AND tm.team_id = ? AND t.is_banned = 0 AND account.is_banned = 0 AND account.emailVerified = 1 AND account.isAdmin = 0 AND account.auth_version = ?
        AND EXISTS (SELECT 1 FROM challenges WHERE id = ? AND is_visible = 1)
        AND ${eventOpenCondition}
    `).bind(userId, team.teamId, authVersion, hint.challengeId).first();
    if (!activeMembership) return c.json({ error: "Competition access changed. Refresh before trying again." }, 409);
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
    if (!event && !isAdmin) return c.json({ error: "Event is not configured" }, 503);
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
      .where(and(eq(schema.teams.hidden, false), eq(schema.teams.isBanned, false), sql`EXISTS (SELECT 1 FROM team_members tm JOIN user member ON member.id = tm.user_id WHERE tm.team_id = ${schema.teams.id} AND member.isAdmin = 0)`, event?.scoreboardFrozenAt ? lte(schema.teamSolves.solvedAt, event.scoreboardFrozenAt) : undefined))
      .groupBy(schema.teamSolves.teamId)
      .orderBy(sql`totalPoints DESC`, sql`lastSubmission ASC`, schema.teamSolves.teamId)
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
  if (!event && !isAdmin) return c.json({ error: "Event is not configured" }, 503);
  if (event && !event.scoreboardPublic && !isAdmin) return c.json({ error: "The scoreboard is private" }, 403);
  const cutoff = event?.scoreboardFrozenAt?.getTime();
  const solves = await db.select({ teamId: schema.teamSolves.teamId, teamName: schema.teams.name, points: schema.challenges.points, solvedAt: schema.teamSolves.solvedAt })
    .from(schema.teamSolves).innerJoin(schema.challenges, eq(schema.teamSolves.challengeId, schema.challenges.id)).innerJoin(schema.teams, eq(schema.teamSolves.teamId, schema.teams.id))
    .where(and(eq(schema.teams.hidden, false), eq(schema.teams.isBanned, false), sql`EXISTS (SELECT 1 FROM team_members tm JOIN user member ON member.id = tm.user_id WHERE tm.team_id = ${schema.teams.id} AND member.isAdmin = 0)`, cutoff === undefined ? undefined : lte(schema.teamSolves.solvedAt, new Date(cutoff))))
    .orderBy(schema.teamSolves.solvedAt);
  const unlocks = await db.select({ teamId: schema.hintUnlocks.teamId, cost: schema.challengeHints.cost, unlockedAt: schema.hintUnlocks.unlockedAt })
    .from(schema.hintUnlocks).innerJoin(schema.challengeHints, eq(schema.hintUnlocks.hintId, schema.challengeHints.id))
    .innerJoin(schema.teams, eq(schema.hintUnlocks.teamId, schema.teams.id))
    .where(and(eq(schema.teams.hidden, false), eq(schema.teams.isBanned, false), sql`EXISTS (SELECT 1 FROM team_members tm JOIN user member ON member.id = tm.user_id WHERE tm.team_id = ${schema.teams.id} AND member.isAdmin = 0)`, cutoff === undefined ? undefined : lte(schema.hintUnlocks.unlockedAt, new Date(cutoff)))).orderBy(schema.hintUnlocks.unlockedAt);
  const names = new Map(solves.map((row) => [row.teamId, row.teamName]));
  const timeline = [...solves.map((row) => ({ teamId: row.teamId, teamName: row.teamName, at: row.solvedAt.getTime(), delta: row.points })), ...unlocks.filter((row) => row.cost > 0 && names.has(row.teamId)).map((row) => ({ teamId: row.teamId, teamName: names.get(row.teamId)!, at: row.unlockedAt.getTime(), delta: -row.cost }))].sort((a, b) => a.at - b.at);
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
    if (!event && !isAdmin) return c.json({ error: "Event is not configured" }, 503);
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
      .where(and(eq(schema.teams.hidden, false), eq(schema.teams.isBanned, false), sql`EXISTS (SELECT 1 FROM team_members tm JOIN user member ON member.id = tm.user_id WHERE tm.team_id = ${schema.teams.id} AND member.isAdmin = 0)`, event?.scoreboardFrozenAt ? lte(schema.teamSolves.solvedAt, event.scoreboardFrozenAt) : undefined))
      .groupBy(schema.teamSolves.teamId)
      .orderBy(sql`totalPoints DESC`, sql`lastSubmission ASC`, schema.teamSolves.teamId)
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
