import type { HonoRequest } from "hono/request";

export async function readJsonRecord(request: Pick<HonoRequest, "json">): Promise<Record<string, unknown> | null> {
  const value = await request.json<unknown>().catch(() => null);
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
