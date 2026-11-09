// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import SendEmail from "./SendEmail";
vi.mock("@/auth-context", () => ({ useAuth: () => ({ user: { email: "player@example.test", emailVerified: false } }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test("failed sending never claims that verification mail was sent", async () => {
  let resolve!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((done) => { resolve = done; })));
  render(<MemoryRouter><SendEmail /></MemoryRouter>);
  expect(screen.getByText(/Sending a verification email to/)).toBeTruthy();
  expect(screen.queryByText(/accepted for delivery/)).toBeNull();
  await act(async () => resolve(Response.json({ error: "Email service unavailable" }, { status: 503 })));
  await waitFor(() => expect(screen.getByText(/Email service unavailable/)).toBeTruthy());
  expect(screen.queryByText(/accepted for delivery/)).toBeNull();
});
