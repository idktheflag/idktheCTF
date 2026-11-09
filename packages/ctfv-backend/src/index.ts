import { drizzle } from "drizzle-orm/d1";
import { Context, Hono } from "hono";
import { JwtVariables } from "hono/jwt";
import { bodyLimit } from "hono/body-limit";

import { Bindings } from "../env";
import * as schema from "./db/schema";
import challengesRouter from "./routes/challenges";
import submissionRouter from "./routes/submissions";
import userRouter from "./routes/user";
import teamsRouter from "./routes/teams";
import eventRouter from "./routes/event";
import adminRouter from "./routes/admin";
import contentRouter from "./routes/content";
import attachmentsRouter from "./routes/attachments";

type Variables = JwtVariables;

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

async function processR2CleanupJobs(env: Bindings) {
  const now = Date.now();
  const expired = await env.DATABASE.prepare("SELECT id, object_key, upload_id FROM attachment_uploads WHERE expires_at <= ? ORDER BY expires_at LIMIT 25").bind(now).all<{ id: string; object_key: string; upload_id: string }>();
  for (const session of expired.results) {
    try {
      try { await env.FILES.resumeMultipartUpload(session.object_key, session.upload_id).abort(); } catch { /* Multipart may already be complete or expired. */ }
      await env.FILES.delete(session.object_key);
      await env.DATABASE.prepare("DELETE FROM attachment_uploads WHERE id = ? AND expires_at <= ?").bind(session.id, now).run();
    } catch {
      console.error(JSON.stringify({ event: "r2.expired_upload_cleanup.failed", key: session.object_key }));
    }
  }
  const due = await env.DATABASE.prepare("SELECT object_key FROM r2_cleanup_jobs WHERE next_attempt_at <= ? ORDER BY next_attempt_at LIMIT 50").bind(Date.now()).all<{ object_key: string }>();
  for (const { object_key } of due.results) {
    try {
      await env.FILES.delete(object_key);
      await env.DATABASE.prepare("DELETE FROM r2_cleanup_jobs WHERE object_key = ?").bind(object_key).run();
    } catch (error) {
      console.error(JSON.stringify({ event: "r2.cleanup.failed", key: object_key }));
      await env.DATABASE.prepare("UPDATE r2_cleanup_jobs SET attempts = attempts + 1, next_attempt_at = ? WHERE object_key = ?")
        .bind(Date.now() + 60_000, object_key).run();
    }
  }
}

app.notFound((c) => c.req.path.startsWith("/api/")
  ? c.json({ error: "API endpoint not found" }, 404)
  : c.text("Not found", 404));



app.onError((error, c) => {
  const requestId = crypto.randomUUID();
  console.error(JSON.stringify({ event: "worker.request.error", requestId, path: c.req.path, name: error instanceof Error ? error.name : "UnknownError" }));
  if (c.req.path.startsWith("/api/")) return c.json({ error: "The request could not be completed", requestId }, 500);
  return c.text("Internal server error", 500);
});

app.use("*", async (c, next) => {
  const startedAt = Date.now();
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Cache-Control", "no-store");
  console.log(JSON.stringify({ event: "worker.request", method: c.req.method, path: c.req.path, status: c.res.status, durationMs: Date.now() - startedAt }));
});

app.use("/api/*", async (c, next) => {
  const isUploadPart = c.req.method === "PUT" && /^\/api\/attachments\/multipart\/[^/]+\/parts\/\d+$/.test(c.req.path);
  // Multipart bodies are bounded by the attachment route after organizer authorization.
  if (isUploadPart) return next();
  return bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json({ error: "Request body is too large" }, 413) })(c, next);
});

app.get("api/health", async (c) => {
  try {
    await c.env.DATABASE.prepare("SELECT 1").first();
    return c.json({ ok: true, database: "ok" });
  } catch {
    return c.json({ ok: false, database: "unavailable" }, 503);
  }
});

app.route("api/users", userRouter);
app.route("api/teams", teamsRouter);
app.route("api/event", eventRouter);
app.route("api/admin", adminRouter);
app.route("api/content", contentRouter);
app.route("api/attachments", attachmentsRouter);
app.route("api/challenges", challengesRouter);
app.route("api/submissions", submissionRouter);

export const getDB = (c: Context) => drizzle(c.env.DATABASE, { schema });

Object.assign(app, {
  scheduled(_event: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(processR2CleanupJobs(env));
  },
});

export default app;
