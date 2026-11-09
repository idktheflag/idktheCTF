// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { StrictMode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { AdminDashboard } from "./AdminDashboard";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test("distinguishes unavailable dashboard data and recovers through retry", async () => {
  let resolve!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((done) => { resolve = done; })));
  render(<MemoryRouter><AdminDashboard /></MemoryRouter>);
  expect(screen.queryByText("Event setup in progress")).toBeNull();
  expect(screen.queryByText("No submissions yet")).toBeNull();
  await act(async () => resolve(Response.json({ error: "Database unavailable" }, { status: 503 })));
  expect(screen.getByRole("alert").textContent).toContain("Database unavailable");
  expect(screen.queryByText("Loading")).toBeNull();
  expect(screen.queryByText("Event setup in progress")).toBeNull();
  expect(screen.queryByText("No submissions yet")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /retry/i }));
  expect(screen.queryByRole("alert")).toBeNull();
  await act(async () => resolve(Response.json({ counts: { participants: 0, teams: 0, challenges: 0, solves: 0 }, event: null, recent: [] })));
  expect(screen.getByText("Not configured")).toBeTruthy();
  expect(screen.getByText("No submissions yet")).toBeTruthy();
});

test("cancels dashboard loading on unmount", () => {
  let signal: AbortSignal | null | undefined;
  vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    signal = init?.signal;
    return new Promise<Response>(() => {});
  }));
  const { unmount } = render(<MemoryRouter><AdminDashboard /></MemoryRouter>);
  unmount();
  expect(signal?.aborted).toBe(true);
});

test("ignores a late response from an effect that was cleaned up", async () => {
  const pending: ((response: Response) => void)[] = [];
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => pending.push(resolve))));
  render(<StrictMode><MemoryRouter><AdminDashboard /></MemoryRouter></StrictMode>);
  await act(async () => pending[1](Response.json({ counts: {}, event: { name: "Current event", startsAt: null, endsAt: null, paused: false }, recent: [] })));
  expect(screen.getByText("Current event", { selector: "h2" })).toBeTruthy();
  await act(async () => pending[0](Response.json({ counts: {}, event: { name: "Stale event", startsAt: null, endsAt: null, paused: false }, recent: [] })));
  expect(screen.queryByText("Stale event")).toBeNull();
  expect(screen.getByText("Current event", { selector: "h2" })).toBeTruthy();
});
