import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { JwtVariables, sign, verify } from "hono/jwt";

import { getDB } from "..";
import { Bindings } from "../../env";
import * as schema from "../db/schema";
import { authMiddleware } from "../middlewares/auth";
import { isRateLimited } from "../utils/rate-limit";
import { createSecureToken, sha256Hex } from "../utils/secure-token";
import { sendPasswordResetEmail, sendVerificationEmail } from "../utils/send-mail";

type Variables = JwtVariables;

const userRouter = new Hono<{ Bindings: Bindings; Variables: Variables }>();

userRouter.post("/auth/register", async (c) => {
  try {
    const db = getDB(c);
    const { email, password, username, invitationToken } = await c.req.json();
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    const ownerEmail = c.env.OWNER_EMAIL?.trim().toLowerCase();
    const isOwnerAccount = Boolean(ownerEmail && normalizedEmail === ownerEmail);
    const requestedUsername = typeof username === "string" ? username.trim() : "";
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail) || (!isOwnerAccount && (requestedUsername.length < 2 || requestedUsername.length > 40)) || typeof password !== "string" || password.length < 12) {
      return c.json({ error: "Enter a valid email, a username of 2–40 characters, and a password of at least 12 characters" }, 400);
    }
    const normalizedUsername = isOwnerAccount ? `organizer_${crypto.randomUUID()}` : requestedUsername;

    const existingUser = await db.query.users.findFirst({
      where: eq(schema.users.email, normalizedEmail),
    });

    if (existingUser) {
      return c.json({ error: "User already exists" }, 400);
    }

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

    if (!c.env.AUTH_SECRET) return c.json({ error: "Authentication is not configured" }, 503);

    const hashedPassword = await bcrypt.hash(password, 10);

    let newUser: typeof schema.users.$inferSelect | undefined;
    if (typeof invitationToken === "string" && !isOwnerAccount) {
      const tokenHash = await sha256Hex(invitationToken);
      const invitation = await c.env.DATABASE.prepare("SELECT id, email FROM registration_invitations WHERE token_hash = ? AND redeemed_at IS NULL AND revoked_at IS NULL AND expires_at > ?").bind(tokenHash, Date.now()).first<{ id: string; email: string }>();
      if (!invitation || invitation.email !== normalizedEmail) return c.json({ error: "Invitation is invalid, expired, or belongs to a different email." }, 400);
      const now = Date.now();
      const results = await c.env.DATABASE.batch([
        c.env.DATABASE.prepare("UPDATE registration_invitations SET redeemed_at = ? WHERE id = ? AND token_hash = ? AND email = ? AND redeemed_at IS NULL AND revoked_at IS NULL AND expires_at > ?").bind(now, invitation.id, tokenHash, normalizedEmail, now),
        c.env.DATABASE.prepare("INSERT INTO user (id, name, email, password, isAdmin, emailVerified, is_banned) SELECT ?, ?, ?, ?, 0, 0, 0 WHERE EXISTS (SELECT 1 FROM registration_invitations WHERE id = ? AND redeemed_at = ? AND email = ?)").bind(crypto.randomUUID(), normalizedUsername, normalizedEmail, hashedPassword, invitation.id, now, normalizedEmail),
      ]);
      if (!results[0]?.meta.changes || !results[1]?.meta.changes) return c.json({ error: "Invitation was already used or is no longer valid." }, 400);
      newUser = await db.query.users.findFirst({ where: eq(schema.users.email, normalizedEmail) });
    } else {
      newUser = await db.insert(schema.users).values({ email: normalizedEmail, password: hashedPassword, username: normalizedUsername, isAdmin: false }).returning().get();
    }
    if (!newUser) return c.json({ error: "Could not create account" }, 500);

    const token = await sign(
      {
        userId: newUser.id,
        email: newUser.email,
        ...(isOwnerAccount ? {} : { username: newUser.username }),
        emailVerified: newUser.emailVerified,
        isAdmin: false,
        exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
      },
      c.env.AUTH_SECRET,
    );

    return c.json({ token });
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed: user\.name/.test(error.message)) {
      return c.json({ error: "That username is already in use. Choose another." }, 409);
    }
    if (error instanceof Error && /UNIQUE constraint failed: user\.email/.test(error.message)) {
      return c.json({ error: "An account already exists for that email." }, 409);
    }
    console.error("Participant registration failed");
    return c.json({ error: "Internal server error" }, 500);
  }
});

userRouter.post("/auth/login", async (c) => {
  const db = getDB(c);
  const input = await c.req.json<{ email?: unknown; password?: unknown }>();
  const normalizedEmail = typeof input.email === "string" ? input.email.trim().toLowerCase().slice(0, 254) : "";
  if (await isRateLimited(c, c.env.AUTH_LOGIN_LIMITER, "login", normalizedEmail)) {
    return c.json({ error: "Too many sign-in attempts. Wait a minute and try again." }, 429);
  }
  const password = input.password;

  const user = await db.query.users.findFirst({
    where: eq(schema.users.email, normalizedEmail),
  });

  if (!user || typeof password !== "string" || !(await bcrypt.compare(password, user.password))) {
    return c.json({ error: "Invalid credentials" }, 401);
  }

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
    if (typeof input.email === "string") email = input.email.trim().toLowerCase().slice(0, 254);
  } catch {
    return c.json({ message: passwordResetMessage });
  }
  if (await isRateLimited(c, c.env.AUTH_RECOVERY_LIMITER, "password-reset-request", email || "invalid")) {
    return c.json({ error: "Too many requests. Wait a minute and try again." }, 429);
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) return c.json({ message: passwordResetMessage });

  const account = await getDB(c).select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users).where(eq(schema.users.email, email)).get();
  if (!account) return c.json({ message: passwordResetMessage });

  const rawToken = createSecureToken();
  const tokenHash = await sha256Hex(rawToken);
  const now = Date.now();
  await c.env.DATABASE.batch([
    c.env.DATABASE.prepare("DELETE FROM password_reset_tokens WHERE expires_at <= ? OR used_at IS NOT NULL").bind(now),
    c.env.DATABASE.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").bind(account.id),
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
  if (!/^[a-f0-9]{64}$/i.test(token) || typeof password !== "string" || password.length < 12) {
    return c.json({ error: "This reset link is invalid or expired, or the new password is too short." }, 400);
  }

  const tokenHash = await sha256Hex(token);
  const passwordHash = await bcrypt.hash(password, 10);
  const now = Date.now();
  const results = await c.env.DATABASE.batch([
    c.env.DATABASE.prepare("UPDATE user SET password = ? WHERE id = (SELECT user_id FROM password_reset_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?)").bind(passwordHash, tokenHash, now),
    c.env.DATABASE.prepare("UPDATE password_reset_tokens SET used_at = ? WHERE user_id = (SELECT user_id FROM password_reset_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?) AND used_at IS NULL").bind(now, tokenHash, now),
  ]);
  if (!results[0]?.meta.changes) return c.json({ error: "This reset link is invalid or expired. Request a new one." }, 400);
  return c.json({ message: "Password changed. Sign in with your new password." });
});

userRouter.post("/auth/send-verify-email", async (c) => {
  const db = getDB(c);
  const { email } = await c.req.json();

  const user = await db.query.users.findFirst({
    where: eq(schema.users.email, email),
  });

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  if (user.emailVerified) {
    return c.json({ error: "Email already verified" }, 400);
  }

  if (
    user.lastVerificationEmailSent &&
    user.lastVerificationEmailSent.getTime() > Date.now() - 24 * 60 * 60 * 1000
  ) {
    return c.json({ error: "Email already sent, wait 24 hours!" }, 400);
  }

  const emailSent = await sendVerificationEmail(c, user.email, user.id);

  if (emailSent) {
    await db
      .update(schema.users)
      .set({ lastVerificationEmailSent: new Date() })
      .where(eq(schema.users.id, user.id))
      .run();
    return c.json({ message: "Verification email sent" });
  }

  return c.json({ error: "Failed to send verification email" }, 500);
});

userRouter.get("/auth/verify-email", async (c) => {
  const db = getDB(c);
  const emailToken = c.req.query("token") as string;
  try {
    const decoded = (await verify(emailToken, c.env.AUTH_SECRET)) as {
      id: string;
    };

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
      .where(eq(schema.users.id, decoded.id))
      .returning({
        id: schema.users.id,
        username: schema.users.username,
        email: schema.users.email,
        isAdmin: schema.users.isAdmin,
        emailVerified: schema.users.emailVerified,
      });

    if (!updatedUser[0]) return c.json({ error: "Account not found" }, 404);
    const token = await sign(
      {
        userId: updatedUser[0].id,
        ...(updatedUser[0].isAdmin ? {} : { username: updatedUser[0].username }),
        email: updatedUser[0].email,
        isAdmin: updatedUser[0].isAdmin,
        emailVerified: updatedUser[0].emailVerified,
        exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
      },
      c.env.AUTH_SECRET,
    );

    return c.json({ message: "Email verified successfully!", token });
  } catch (err) {
    return c.json({ error: "Invalid or expired token." }, 400);
  }
});

userRouter.get("/", async (c) => {
  const db = getDB(c);
  const users = await db.query.users.findMany({
    where: eq(schema.users.isAdmin, false),
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
  if (user.isAdmin || payload.username == null) {
    const account = await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, userId)).get();
    return c.json({ id: user.id, email: account?.email, isAdmin: user.isAdmin });
  }
  if (payload.isAdmin || payload.userId === userId) {
    const account = await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, userId)).get();
    return c.json({ ...user, email: account?.email });
  }
  return c.json(user);
});

// Update user profile
userRouter.put("/:id", authMiddleware, async (c) => {
  const db = getDB(c);
  const userId = c.req.param("id");
  const { rollNo, instituteName, website, affiliation, country } =
    await c.req.json();

  if (userId !== c.get("jwtPayload").userId) {
    return c.json({ error: "Unauthorized" }, 403);
  }
  if (c.get("jwtPayload").isAdmin) return c.json({ error: "Organizer accounts use email and password sign-in only" }, 403);

  const updatedUser = await db
    .update(schema.users)
    .set({ rollNo, instituteName, website, affiliation, country })
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
