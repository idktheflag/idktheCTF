import { MiddlewareHandler } from "hono";
import { JwtVariables, verify } from "hono/jwt";

import { Bindings } from "../../env";

type Variables = JwtVariables;

const createAuthMiddleware = (allowUnverified: boolean): MiddlewareHandler<{
  Bindings: Bindings;
  Variables: Variables;
}> => async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const token = authHeader.split(" ")[1];
  let payload: Awaited<ReturnType<typeof verify>>;
  try {
    payload = await verify(token, c.env.AUTH_SECRET, "HS256");
  } catch {
    return c.json({ error: "Invalid token" }, 401);
  }
  if (typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000) || typeof payload.userId !== "string") {
    return c.json({ error: "Session expired. Sign in again." }, 401);
  }
  const account = await c.env.DATABASE.prepare("SELECT is_banned, isAdmin, emailVerified, auth_version FROM user WHERE id = ?").bind(payload.userId).first() as { is_banned: number; isAdmin: number; emailVerified: number; auth_version: number } | null;
  if (!account || account.is_banned) return c.json({ error: "Account is unavailable" }, 403);
  if (!Number.isSafeInteger(payload.authVersion) || payload.authVersion !== account.auth_version) return c.json({ error: "Session expired. Sign in again." }, 401);
  if (Boolean(account.isAdmin) !== (payload.isAdmin === true)) {
    return c.json({ error: "Account permissions changed. Sign in again." }, 401);
  }
  const tokenEmailVerified = payload.emailVerified === true;
  if (
    (!allowUnverified && (!account.emailVerified || !tokenEmailVerified)) ||
    (allowUnverified && Boolean(account.emailVerified) !== tokenEmailVerified)
  ) {
    return c.json({ error: "Verify your email before continuing", code: "EMAIL_NOT_VERIFIED" }, 403);
  }

  c.set("jwtPayload", payload);
  await next();
};

export const authMiddleware = createAuthMiddleware(false);
export const unverifiedAuthMiddleware = createAuthMiddleware(true);
