import bcrypt from "bcryptjs";
import { and, eq, isNull, lte, or } from "drizzle-orm";
import { Hono } from "hono";
import { JwtVariables, sign, verify } from "hono/jwt";

import { getDB } from "..";
import { Bindings } from "../../env";
import * as schema from "../db/schema";
import { authMiddleware, unverifiedAuthMiddleware } from "../middlewares/auth";
import { isRateLimited } from "../utils/rate-limit";
import { createSecureToken, sha256Hex } from "../utils/secure-token";
import { sendPasswordResetEmail, sendVerificationEmail } from "../utils/send-mail";
import { readJsonRecord } from "../utils/json-input";
import { isUniqueConstraintError } from "../utils/sqlite-error";

type Variables = JwtVariables;

const userRouter = new Hono<{ Bindings: Bindings; Variables: Variables }>();
const registrationAcceptedMessage =
  "If registration was completed, sign in and follow the email verification steps.";

userRouter.post("/auth/register", async (c) => {
  try {
    const db = getDB(c);
    const input = await readJsonRecord(c.req);
    if (!input) return c.json({ error: "Send a valid JSON object" }, 400);
    const { email, password, username, invitationToken } = input;
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (await isRateLimited(c, c.env.AUTH_REGISTRATION_LIMITER, "registration", normalizedEmail)) return c.json({ error: "Too many registration attempts. Wait a minute and try again." }, 429);
    const ownerEmail = c.env.OWNER_EMAIL?.trim().toLowerCase();
    const isOwnerAccount = Boolean(ownerEmail && normalizedEmail === ownerEmail);
    const requestedUsername = typeof username === "string" ? username.trim() : "";
    if (normalizedEmail.length > 254 || !/^\S+@\S+\.\S+$/.test(normalizedEmail) || (!isOwnerAccount && (requestedUsername.length < 2 || requestedUsername.length > 40)) || typeof password !== "string" || password.length < 12 || new TextEncoder().encode(password).length > 72) {
      return c.json({ error: "Enter a valid email, a username of 2–40 characters, and a password of at least 12 characters and at most 72 UTF-8 bytes" }, 400);
    }
    const normalizedUsername = isOwnerAccount ? `organizer_${crypto.randomUUID()}` : requestedUsername;

    const event = await db.query.eventSettings.findFirst();
    if (!event) return c.json({ error: "This CTF has not been set up yet" }, 403);
    if (!isOwnerAccount && event.registrationMode !== "public" && typeof invitationToken !== "string") {
      return c.json({ error: "Registration requires an invitation." }, 403);
    }
    if (typeof invitationToken === "string" && !/^[a-f0-9]{64}$/i.test(invitationToken)) return c.json({ error: "Invitation is invalid or expired." }, 400);
    const domains = JSON.parse(event.allowedEmailDomains) as string[];
    if (!isOwnerAccount && domains.length && !domains.some((domain) => normalizedEmail.endsWith(`@${domain}`))) {
      return c.json({ error: `Use an email address from: ${domains.join(", ")}` }, 400);
    }

    let invitation: { id: string; email: string } | null = null;
    let invitationTokenHash = "";
    if (typeof invitationToken === "string" && !isOwnerAccount) {
      invitationTokenHash = await sha256Hex(invitationToken);
      invitation = await c.env.DATABASE.prepare("SELECT id, email FROM registration_invitations WHERE token_hash = ? AND redeemed_at IS NULL AND revoked_at IS NULL AND expires_at > ?").bind(invitationTokenHash, Date.now()).first<{ id: string; email: string }>();
      if (!invitation || invitation.email !== normalizedEmail) return c.json({ error: "Invitation is invalid, expired, or belongs to a different email." }, 400);
    }

    if (!c.env.AUTH_SECRET) return c.json({ error: "Authentication is not configured" }, 503);

    const existingUsername = await db.query.users.findFirst({
      where: eq(schema.users.username, normalizedUsername),
    });
    if (existingUsername) {
      return c.json({ error: "That username is already in use. Choose another." }, 409);
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const existingUser = await db.query.users.findFirst({
      where: eq(schema.users.email, normalizedEmail),
    });
    if (existingUser) return c.json({ message: registrationAcceptedMessage });

    let newUser: typeof schema.users.$inferSelect | undefined;
    if (invitation) {
      const now = Date.now();
      const results = await c.env.DATABASE.batch([
        c.env.DATABASE.prepare("UPDATE registration_invitations SET redeemed_at = ? WHERE id = ? AND token_hash = ? AND email = ? AND redeemed_at IS NULL AND revoked_at IS NULL AND expires_at > ?").bind(now, invitation.id, invitationTokenHash, normalizedEmail, now),
        c.env.DATABASE.prepare("INSERT INTO user (id, name, email, password, isAdmin, emailVerified, is_banned) SELECT ?, ?, ?, ?, 0, 0, 0 WHERE EXISTS (SELECT 1 FROM registration_invitations WHERE id = ? AND redeemed_at = ? AND email = ?)").bind(crypto.randomUUID(), normalizedUsername, normalizedEmail, hashedPassword, invitation.id, now, normalizedEmail),
      ]);
      if (!results[0]?.meta.changes || !results[1]?.meta.changes) return c.json({ error: "Invitation was already used or is no longer valid." }, 400);
      newUser = await db.query.users.findFirst({ where: eq(schema.users.email, normalizedEmail) });
    } else {
      newUser = await db.insert(schema.users).values({ email: normalizedEmail, password: hashedPassword, username: normalizedUsername, isAdmin: false }).returning().get();
    }
    if (!newUser) return c.json({ error: "Could not create account" }, 500);
    return c.json({ message: registrationAcceptedMessage });
  } catch (error) {
    if (isUniqueConstraintError(error, "user.name")) return c.json({ message: registrationAcceptedMessage });
    if (isUniqueConstraintError(error, "user.email")) {
      return c.json({ message: registrationAcceptedMessage });
    }
    console.error("Participant registration failed");
    return c.json({ error: "Internal server error" }, 500);
  }
});

userRouter.post("/auth/login", async (c) => {
  const db = getDB(c);
  const input = await readJsonRecord(c.req);
  if (!input) return c.json({ error: "Send a valid JSON object" }, 400);
  const normalizedEmail = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (await isRateLimited(c, c.env.AUTH_LOGIN_LIMITER, "login", normalizedEmail)) {
    return c.json({ error: "Too many sign-in attempts. Wait a minute and try again." }, 429);
  }
  const password = input.password;

  const user = await db.query.users.findFirst({
    where: eq(schema.users.email, normalizedEmail),
  });

  if (!user || typeof password !== "string" || new TextEncoder().encode(password).length > 72 || !(await bcrypt.compare(password, user.password))) {
    return c.json({ error: "Invalid credentials" }, 401);
  }
  if (user.isBanned) return c.json({ error: "Account is unavailable" }, 403);

  const ownerEmail = c.env.OWNER_EMAIL?.trim().toLowerCase();
  let isAdmin = user.isAdmin;
  if (user.emailVerified && ownerEmail && user.email.trim().toLowerCase() === ownerEmail) {
    const promoted = await db.update(schema.users)
      .set({ isAdmin: true })
      .where(eq(schema.users.id, user.id))
      .returning({ isAdmin: schema.users.isAdmin })
      .get();
    isAdmin = Boolean(promoted?.isAdmin);
  }

  const token = await sign(
    {
      userId: user.id,
      authVersion: user.authVersion,
      email: user.email,
      ...(isAdmin || (ownerEmail && user.email.trim().toLowerCase() === ownerEmail) ? {} : { username: user.username }),
      isAdmin,
      emailVerified: user.emailVerified,
      exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    },
    c.env.AUTH_SECRET,
  );

  return c.json({ token });
});

const passwordResetMessage = "If an account exists for that email, a password reset link has been sent.";

userRouter.post("/auth/password-reset/request", async (c) => {
  let email = "";
  try {
    const input = await c.req.json<{ email?: unknown }>();
    if (typeof input.email === "string") email = input.email.trim().toLowerCase();
  } catch {
    return c.json({ message: passwordResetMessage });
  }
  if (await isRateLimited(c, c.env.AUTH_RECOVERY_LIMITER, "password-reset-request", email || "invalid")) {
    return c.json({ error: "Too many requests. Wait a minute and try again." }, 429);
  }
  if (email.length > 254 || !/^\S+@\S+\.\S+$/.test(email)) return c.json({ message: passwordResetMessage });

  const account = await getDB(c).select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users).where(eq(schema.users.email, email)).get();
  if (!account) return c.json({ message: passwordResetMessage });

  const rawToken = createSecureToken();
  const tokenHash = await sha256Hex(rawToken);
  const now = Date.now();
  await c.env.DATABASE.batch([
    c.env.DATABASE.prepare("DELETE FROM password_reset_tokens WHERE expires_at <= ? OR used_at IS NOT NULL").bind(now),
    c.env.DATABASE.prepare("INSERT INTO password_reset_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(tokenHash, account.id, now + 30 * 60 * 1000),
  ]);
  try {
    await sendPasswordResetEmail(c, account.email, rawToken);
  } catch {
    console.error("Password reset email delivery failed");
  }
  return c.json({ message: passwordResetMessage });
});

userRouter.post("/auth/password-reset/complete", async (c) => {
  let token = "";
  let password: unknown;
  try {
    const input = await c.req.json<{ token?: unknown; password?: unknown }>();
    token = typeof input.token === "string" ? input.token : "";
    password = input.password;
  } catch {
    return c.json({ error: "This reset link is invalid or expired. Request a new one." }, 400);
  }
  const tokenIdentity = await sha256Hex(token.slice(0, 256));
  if (await isRateLimited(c, c.env.AUTH_RECOVERY_LIMITER, "password-reset-complete", tokenIdentity)) {
    return c.json({ error: "Too many attempts. Wait a minute and try again." }, 429);
  }
  if (!/^[a-f0-9]{64}$/i.test(token) || typeof password !== "string" || password.length < 12 || new TextEncoder().encode(password).length > 72) {
    return c.json({ error: "This reset link is invalid or expired, or the password must be at least 12 characters and at most 72 UTF-8 bytes." }, 400);
  }

  const tokenHash = await sha256Hex(token);
  const activeToken = await c.env.DATABASE.prepare("SELECT 1 AS active FROM password_reset_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?")
    .bind(tokenHash, Date.now()).first();
  if (!activeToken) return c.json({ error: "This reset link is invalid or expired. Request a new one." }, 400);
  const passwordHash = await bcrypt.hash(password, 10);
  const now = Date.now();
  const results = await c.env.DATABASE.batch([
    c.env.DATABASE.prepare("UPDATE user SET password = ?, auth_version = auth_version + 1, lastVerificationEmailSent = NULL WHERE id = (SELECT user_id FROM password_reset_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?)").bind(passwordHash, tokenHash, now),
    c.env.DATABASE.prepare("UPDATE password_reset_tokens SET used_at = ? WHERE user_id = (SELECT user_id FROM password_reset_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?) AND used_at IS NULL").bind(now, tokenHash, now),
  ]);
  if (!results[0]?.meta.changes) return c.json({ error: "This reset link is invalid or expired. Request a new one." }, 400);
  return c.json({ message: "Password changed. Sign in with your new password." });
});

userRouter.post("/auth/send-verify-email", unverifiedAuthMiddleware, async (c) => {
  const db = getDB(c);
  const payload = c.get("jwtPayload");

  const user = await db.query.users.findFirst({
    where: eq(schema.users.id, payload.userId as string),
  });

  if (!user || user.isBanned) return c.json({ error: "Account is unavailable" }, 403);
  if (user.emailVerified) return c.json({ error: "Email already verified" }, 400);
  if (await isRateLimited(c, c.env.AUTH_RECOVERY_LIMITER, "verification-email", user.email)) return c.json({ error: "Too many requests. Wait a minute and try again." }, 429);

  if (
    user.lastVerificationEmailSent &&
    user.lastVerificationEmailSent.getTime() > Date.now() - 60 * 1000
  ) {
    return c.json({ error: "A verification email was recently requested. Wait a minute before trying again." }, 429);
  }

  const reservedAt = new Date();
  const reserved = await db.update(schema.users).set({ lastVerificationEmailSent: reservedAt })
    .where(and(eq(schema.users.id, user.id), eq(schema.users.emailVerified, false), eq(schema.users.isBanned, false), eq(schema.users.authVersion, user.authVersion),
      or(isNull(schema.users.lastVerificationEmailSent), lte(schema.users.lastVerificationEmailSent, new Date(reservedAt.getTime() - 60_000)))))
    .returning({ id: schema.users.id }).get();
  if (!reserved) {
    return c.json({ error: "A verification request is already pending or the account changed. Wait a minute before trying again." }, 429);
  }
  const releaseReservation = () => db.update(schema.users).set({ lastVerificationEmailSent: null })
    .where(and(eq(schema.users.id, user.id), eq(schema.users.authVersion, user.authVersion), eq(schema.users.lastVerificationEmailSent, reservedAt))).run();
  let emailSent: Awaited<ReturnType<typeof sendVerificationEmail>>;
  try {
    emailSent = await sendVerificationEmail(c, user.email, user.id, user.authVersion);
  } catch {
    await releaseReservation();
    return c.json({ error: "Verification email could not be sent. Please try again in a minute." }, 503);
  }
  if (emailSent) return c.json({ message: "Verification email sent" });
  await releaseReservation();
  return c.json({ error: "Account changed. Request a new verification email." }, 409);

});

userRouter.get("/auth/verify-email", async (c) => {
  const db = getDB(c);
  const emailToken = c.req.query("token") as string;
  let decoded: Awaited<ReturnType<typeof verify>>;
  try { decoded = await verify(emailToken, c.env.AUTH_SECRET, "HS256"); }
  catch { return c.json({ error: "Invalid or expired token." }, 400); }
  if (decoded.purpose !== "email-verification" || typeof decoded.id !== "string" || !Number.isSafeInteger(decoded.authVersion) || typeof decoded.exp !== "number") return c.json({ error: "Invalid or expired token. Request a new verification email." }, 400);

  const ownerEmail = c.env.OWNER_EMAIL?.trim().toLowerCase();
  const account = await db.select({ email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, decoded.id))
    .get();
  if (!account) return c.json({ error: "Account not found" }, 404);
  const isOwner = Boolean(ownerEmail && account.email.trim().toLowerCase() === ownerEmail);
  const updatedUser = await db
    .update(schema.users)
    .set({
      emailVerified: true,
      ...(isOwner ? { isAdmin: true } : {}),
    })
    .where(and(eq(schema.users.id, decoded.id), eq(schema.users.emailVerified, false), eq(schema.users.isBanned, false), eq(schema.users.authVersion, decoded.authVersion as number)))
    .returning({
      id: schema.users.id,
      username: schema.users.username,
      email: schema.users.email,
      isAdmin: schema.users.isAdmin,
      emailVerified: schema.users.emailVerified,
      authVersion: schema.users.authVersion,
    });

  if (!updatedUser[0]) return c.json({ error: "Invalid or already used verification link. Request a new verification email." }, 400);
  const token = await sign(
    {
      userId: updatedUser[0].id,
      authVersion: updatedUser[0].authVersion,
      ...(updatedUser[0].isAdmin ? {} : { username: updatedUser[0].username }),
      email: updatedUser[0].email,
      isAdmin: updatedUser[0].isAdmin,
      emailVerified: updatedUser[0].emailVerified,
      exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    },
    c.env.AUTH_SECRET,
  );

  return c.json({ message: "Email verified successfully!", token });
});

userRouter.get("/", async (c) => {
  const db = getDB(c);
  const users = await db.query.users.findMany({
    where: and(
      eq(schema.users.isAdmin, false),
      eq(schema.users.emailVerified, true),
      eq(schema.users.isBanned, false),
    ),
    columns: {
      id: true,
      username: true,
      website: true,
      affiliation: true,
      country: true,
      isAdmin: true,
    },
  });
  return c.json(users);
});

// Get user profile
userRouter.get("/:id", authMiddleware, async (c) => {
  const db = getDB(c);
  const userId = c.req.param("id");
  const user = await db.query.users.findFirst({
    where: eq(schema.users.id, userId),
    columns: {
      id: true,
      username: true,
      rollNo: true,
      instituteName: true,
      website: true,
      affiliation: true,
      country: true,
      isAdmin: true,
    },
  });

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }
  const payload = c.get("jwtPayload");
  if (user.isAdmin && !payload.isAdmin) return c.json({ error: "User not found" }, 404);
  if (user.isAdmin) {
    const account = await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, userId)).get();
    return c.json({ id: user.id, email: account?.email, isAdmin: user.isAdmin });
  }
  if (payload.isAdmin || payload.userId === userId) {
    const account = await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, userId)).get();
    return c.json({ ...user, email: account?.email });
  }
  const { rollNo: _rollNo, instituteName: _instituteName, ...publicProfile } = user;
  return c.json(publicProfile);
});

// Update user profile
userRouter.put("/:id", authMiddleware, async (c) => {
  const db = getDB(c);
  const userId = c.req.param("id");
  if (userId !== c.get("jwtPayload").userId) {
    return c.json({ error: "Unauthorized" }, 403);
  }
  if (c.get("jwtPayload").isAdmin) return c.json({ error: "Organizer accounts use email and password sign-in only" }, 403);
  const input = await readJsonRecord(c.req);
  if (!input) return c.json({ error: "Send a valid JSON object" }, 400);
  const limits = { rollNo: 64, instituteName: 160, website: 2048, affiliation: 160, country: 100 };
  const updates: Partial<Pick<typeof schema.users.$inferInsert, keyof typeof limits>> = {};
  for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
    const value = input[key];
    if (value === undefined) continue;
    if (value !== null && (typeof value !== "string" || value.length > limits[key])) return c.json({ error: `${key} must be text of at most ${limits[key]} characters` }, 400);
    updates[key] = typeof value === "string" ? value.trim() : null;
  }
  if (!Object.keys(updates).length) return c.json({ error: "Provide at least one profile field" }, 400);
  if (updates.website) {
    try {
      const website = updates.website;
      const bareDomain = !/[\s:]/.test(website) && !website.startsWith("/") && /^[^/]+\.[^/]+(?:\/.*)?$/.test(website);
      const url = new URL(bareDomain ? `https://${website}` : website);
      if (!["http:", "https:"].includes(url.protocol)) return c.json({ error: "Website must use HTTP or HTTPS" }, 400);
      if (url.username || url.password) return c.json({ error: "Website URLs must not contain login credentials" }, 400);
      updates.website = url.href;
    } catch { return c.json({ error: "Website must be a valid HTTP or HTTPS URL" }, 400); }
  }

  const updatedUser = await db
    .update(schema.users)
    .set(updates)
    .where(eq(schema.users.id, userId))
    .returning({
      id: schema.users.id,
      username: schema.users.username,
      email: schema.users.email,
      rollNo: schema.users.rollNo,
      instituteName: schema.users.instituteName,
      website: schema.users.website,
      affiliation: schema.users.affiliation,
      country: schema.users.country,
    });

  return c.json(updatedUser[0]);
});

export default userRouter;
