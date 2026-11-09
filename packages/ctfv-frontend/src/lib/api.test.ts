// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { apiFetch } from "./api";
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

test("a rejected current session signals sign-in without consuming the error response", async () => {
  localStorage.setItem("token", "current");
  const listener = vi.fn();
  window.addEventListener("ctf:session-expired", listener);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Session expired. Sign in again." }, { status: 401 })));
  const response = await apiFetch("/api/admin/dashboard", { headers: { Authorization: "Bearer current" } });
  expect(listener).toHaveBeenCalledTimes(1);
  expect((await response.json()).error).toContain("Session expired");
  window.removeEventListener("ctf:session-expired", listener);
});

test("an older request cannot sign out a newer session", async () => {
  localStorage.setItem("token", "new");
  const listener = vi.fn();
  window.addEventListener("ctf:session-expired", listener);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({}, { status: 401 })));
  await apiFetch("/api/admin/dashboard", { headers: { Authorization: "Bearer old" } });
  expect(listener).not.toHaveBeenCalled();
  expect(localStorage.getItem("token")).toBe("new");
  window.removeEventListener("ctf:session-expired", listener);
});
