import { eq } from "drizzle-orm";
import { Context, MiddlewareHandler } from "hono";
import { JwtVariables } from "hono/jwt";

import { getDB } from "..";
import { Bindings } from "../../env";
import * as schema from "../db/schema";

export const teamMiddleware: MiddlewareHandler<{
  Bindings: Bindings;
  Variables: JwtVariables;
}> = async (c: Context, next) => {
  if (c.get("jwtPayload").isAdmin) return next();
  const userId = c.get("jwtPayload").userId;
  const membership = await getDB(c).select({ id: schema.teamMembers.id, banned: schema.teams.isBanned })
    .from(schema.teamMembers).innerJoin(schema.teams, eq(schema.teamMembers.teamId, schema.teams.id))
    .where(eq(schema.teamMembers.userId, userId)).get();
  if (!membership) return c.json({ error: "Create or join a team before participating", code: "TEAM_REQUIRED" }, 403);
  if (membership.banned) return c.json({ error: "Your team is unavailable" }, 403);
  await next();
};
