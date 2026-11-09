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
  const ipKey = await sha256Hex(`${scope}\0ip\0${ip}`);
  const identityKey = await sha256Hex(`${scope}\0identity\0${normalizedEmail}`);
  try {
    const ipOutcome = await (c.env.AUTH_IP_LIMITER ?? limiter).limit({ key: ipKey });
    if (!ipOutcome.success) return true;
    const identityOutcome = await limiter.limit({ key: identityKey });
    return !identityOutcome.success;
  } catch {
    console.error(`Auth rate limiter unavailable for ${scope}`);
    return true;
  }
}
