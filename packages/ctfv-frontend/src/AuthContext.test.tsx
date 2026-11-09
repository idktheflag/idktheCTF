// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { AuthProvider } from "./AuthContext";
import { useAuth } from "./auth-context";
const Viewer = () => <p>{useAuth().user?.email || "guest"}</p>;
const token = (expires: number) => `e30.${btoa(JSON.stringify({ userId: "player", email: "player@example.test", isAdmin: false, emailVerified: true, authVersion: 0, exp: expires }))}.unused`;
afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers(); });

test("expired saved sessions do not appear logged in", () => {
  localStorage.setItem("token", token(1));
  render(<AuthProvider><Viewer /></AuthProvider>);
  expect(screen.getByText("guest")).toBeTruthy();
  expect(localStorage.getItem("token")).toBeNull();
});

test("session UI logs out when the token expires", async () => {
  vi.useFakeTimers();
  localStorage.setItem("token", token(Math.floor(Date.now() / 1000) + 2));
  render(<AuthProvider><Viewer /></AuthProvider>);
  expect(screen.getByText("player@example.test")).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(2001); });
  expect(screen.getByText("guest")).toBeTruthy();
  expect(localStorage.getItem("token")).toBeNull();
});

test("saved sessions are available on the first protected-route render", () => {
  localStorage.setItem("token", token(Math.floor(Date.now() / 1000) + 60));
  const seen: (string | null)[] = [];
  const Protected = () => { seen.push(useAuth().user?.email || null); return null; };
  render(<AuthProvider><Protected /></AuthProvider>);
  expect(seen[0]).toBe("player@example.test");
});
