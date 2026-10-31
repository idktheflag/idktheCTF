import type { Bindings } from "../../env";
import { sha256Hex } from "./secure-token";

export async function isRateLimited(
  c: { env: Bindings; req: { header: (name: string) => string | undefined } },
  limiter: RateLimit | undefined,
  scope: string,
  email: string,
) {
  // Wrangler local may not emulate the native binding. Production has it in wrangler.toml.
  if (!limiter) return false;
  const ip = c.req.header("CF-Connecting-IP") || "unavailable";
  const normalizedEmail = email.trim().toLowerCase().slice(0, 254);
  const key = await sha256Hex(`${scope}\0${normalizedEmail}\0${ip}`);
  try {
    const outcome = await limiter.limit({ key });
    return !outcome.success;
  } catch {
    console.error(`Auth rate limiter unavailable for ${scope}`);
    return false;
  }
}
