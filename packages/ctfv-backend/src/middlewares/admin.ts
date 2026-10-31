import { Context, MiddlewareHandler } from "hono";
import { JwtVariables } from "hono/jwt";

import { Bindings } from "../../env";

type Variables = JwtVariables;

export const adminMiddleware: MiddlewareHandler<{
  Bindings: Bindings;
  Variables: Variables;
}> = async (c: Context, next) => {
  const jwtPayload = c.get("jwtPayload");

  if (!jwtPayload || !jwtPayload.isAdmin) {
    return c.json({ error: "Access denied: Admin Only" }, 403);
  }
  await next();
};
