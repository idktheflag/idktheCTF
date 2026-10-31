import { Context, MiddlewareHandler } from "hono";
import { JwtVariables, verify } from "hono/jwt";

import { Bindings } from "../../env";

type Variables = JwtVariables;

export const authMiddleware: MiddlewareHandler<{
  Bindings: Bindings;
  Variables: Variables;
}> = async (c: Context, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const token = authHeader.split(" ")[1];
  try {
    const payload = await verify(token, c.env.AUTH_SECRET);
    if (typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000) || typeof payload.userId !== "string") {
      return c.json({ error: "Session expired. Sign in again." }, 401);
    }
    const account = await c.env.DATABASE.prepare("SELECT is_banned, isAdmin, emailVerified FROM user WHERE id = ?").bind(payload.userId).first() as { is_banned: number; isAdmin: number; emailVerified: number } | null;
    if (!account || account.is_banned) return c.json({ error: "Account is unavailable" }, 403);
    if (Boolean(account.isAdmin) !== (payload.isAdmin === true)) {
      return c.json({ error: "Account permissions changed. Sign in again." }, 401);
    }
    if (!account.emailVerified || payload.emailVerified !== true) {
      return c.json({ error: "Email not verified" }, 401);
    }

    c.set("jwtPayload", payload);
    await next();
  } catch (error) {
    return c.json({ error: "Invalid token" }, 401);
  }
};
