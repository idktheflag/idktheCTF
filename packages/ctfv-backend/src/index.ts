import { drizzle } from "drizzle-orm/d1";
import { Context, Hono } from "hono";
import { cors } from "hono/cors";
import { JwtVariables } from "hono/jwt";

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

app.onError((error, c) => {
  const requestId = crypto.randomUUID();
  console.error(JSON.stringify({ event: "worker.request.error", requestId, path: c.req.path, name: error instanceof Error ? error.name : "UnknownError" }));
  if (c.req.path.startsWith("/api/")) return c.json({ error: "The request could not be completed", requestId }, 500);
  return c.text("Internal server error", 500);
});

app.use(
  "*",
  cors({
    origin: (origin) => origin,
    credentials: true,
  }),
);
app.use("*", async (c, next) => {
  const startedAt = Date.now();
  await next();
  console.log(JSON.stringify({ event: "worker.request", method: c.req.method, path: c.req.path, status: c.res.status, durationMs: Date.now() - startedAt }));
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

export default app;
