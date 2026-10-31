import { Context } from "hono";
import { sign } from "hono/jwt";

const applicationUrl = (c: Context) => {
  const request = new URL(c.req.url);
  if (request.hostname === "localhost" || request.hostname === "127.0.0.1") return request.origin;
  return c.env.APP_URL || request.origin;
};

export const sendVerificationEmail = async (
  c: Context,
  email: string,
  userId: string,
) => {
  const token = await sign(
    { id: userId, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 },
    c.env.AUTH_SECRET,
  );
  const verificationURL = new URL("/verify-email", applicationUrl(c));
  verificationURL.searchParams.set("token", token);

  await c.env.EMAIL.send({
    from: c.env.EMAIL_FROM,
    to: email,
    subject: "Verify your email for CTFv",
    text: `Click on the following link to verify your email: ${verificationURL}`,
  });

  return true;
};

export const sendPasswordResetEmail = async (
  c: Context,
  email: string,
  token: string,
) => {
  const resetURL = new URL("/reset-password/complete", applicationUrl(c));
  resetURL.searchParams.set("token", token);
  await c.env.EMAIL.send({
    from: c.env.EMAIL_FROM,
    to: email,
    subject: "Reset your idktheCTF password",
    text: `A password reset was requested for this account. Use this link within 30 minutes to choose a new password: ${resetURL}\n\nIf you did not request this, you can ignore this email.`,
  });
};

export const sendRegistrationInvitation = async (c: Context, email: string, token: string) => {
  const inviteURL = new URL("/register", applicationUrl(c));
  inviteURL.searchParams.set("invite", token);
  await c.env.EMAIL.send({
    from: c.env.EMAIL_FROM,
    to: email,
    subject: "Invitation to idktheCTF",
    text: `You have been invited to register for idktheCTF. This link expires in 7 days: ${inviteURL}\n\nIf you were not expecting this invitation, you can ignore this email.`,
  });
};
