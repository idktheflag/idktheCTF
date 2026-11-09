import { Context } from "hono";
import { sign } from "hono/jwt";
import type { Bindings } from "../../env";

const MAIL_FROM = "no-reply@idktheflag.sh";
async function deliver(c: { env: Bindings }, kind: "verification" | "recovery" | "invitation", message: { to: string; subject: string; text: string }) {
  try {
    const result = await c.env.EMAIL.send({ ...message, from: MAIL_FROM });
    console.log(JSON.stringify({ event: "email.accepted", kind }));
    return result;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "unknown";
    console.error(JSON.stringify({ event: "email.delivery.failed", kind, code: /^[A-Za-z0-9_.:-]{1,80}$/.test(code) ? code : "unknown" }));
    throw error;
  }
}

const applicationUrl = (c: Context) => {
  const request = new URL(c.req.url);
  return c.env.APP_URL || request.origin;
};

export const sendVerificationEmail = async (
  c: Context<{ Bindings: Bindings; Variables: import("hono/jwt").JwtVariables }>,
  email: string,
  userId: string,
  authVersion: number,
) => {
  const account = await c.env.DATABASE.prepare("SELECT auth_version FROM user WHERE id = ? AND auth_version = ? AND emailVerified = 0 AND is_banned = 0").bind(userId, authVersion).first<{ auth_version: number }>();
  if (!account) return false;
  const token = await sign(
    { id: userId, purpose: "email-verification", authVersion: account.auth_version, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 },
    c.env.AUTH_SECRET,
  );
  const verificationURL = new URL("/verify-email", applicationUrl(c));
  verificationURL.searchParams.set("token", token);

  await deliver(c, "verification", {
    to: email,
    subject: "Verify your email for CTFv",
    text: `Click on the following link to verify your email: ${verificationURL}`,
  });

  return { authVersion: account.auth_version };
};

export const sendPasswordResetEmail = async (
  c: Context,
  email: string,
  token: string,
) => {
  const resetURL = new URL("/reset-password/complete", applicationUrl(c));
  resetURL.searchParams.set("token", token);
  await deliver(c, "recovery", {
    to: email,
    subject: "Reset your idktheCTF password",
    text: `A password reset was requested for this account. Use this link within 30 minutes to choose a new password: ${resetURL}\n\nIf you did not request this, you can ignore this email.`,
  });
};

export const sendRegistrationInvitation = async (c: Context, email: string, token: string) => {
  const inviteURL = new URL("/register", applicationUrl(c));
  inviteURL.searchParams.set("invite", token);
  await deliver(c, "invitation", {
    to: email,
    subject: "Invitation to idktheCTF",
    text: `You have been invited to register for idktheCTF. This link expires in 7 days: ${inviteURL}\n\nIf you were not expecting this invitation, you can ignore this email.`,
  });
};
