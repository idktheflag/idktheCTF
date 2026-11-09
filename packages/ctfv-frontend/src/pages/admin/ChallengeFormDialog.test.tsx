// @vitest-environment jsdom
import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ChallengeFormDialog } from "./ChallengeFormDialog";

vi.mock("@/auth-context", () => ({ useAuth: () => ({ user: { username: "organizer" }, createChallenge: async () => ({ id: "challenge" }), getChallenges: async () => [], updateChallenge: async () => {} }) }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

test("sequential files finish without restoring a completed multipart session", async () => {
  const snapshots: { uploadId: string }[][] = [];
  const close = vi.fn();
  let started = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/multipart")) {
      started++;
      if (started === 2) snapshots.push(JSON.parse(localStorage.getItem("idkthectf:uploads:challenge") || "[]"));
      return Response.json({ uploadId: `session-${started}`, totalParts: 1, partSize: 1, parts: [] });
    }
    if (init?.method === "PUT") return Response.json({ partNumber: 1, etag: "etag", size: 1 });
    if (url.endsWith("/complete")) {
      snapshots.push(JSON.parse(localStorage.getItem("idkthectf:uploads:challenge") || "[]"));
      return Response.json({ attachment: { id: `attachment-${started}`, filename: "file", size: 1 } });
    }
    throw new Error(`Unexpected request: ${url}`);
  }));
  const { container } = render(<ChallengeFormDialog mode="create" open onOpenChange={close} onSaved={() => {}} />);
  const files = ["one.txt", "two.txt"].map((name) => {
    const file = new File(["x"], name, { type: "text/plain", lastModified: 1 });
    Object.defineProperty(file, "slice", { value: () => ({ arrayBuffer: async () => new ArrayBuffer(1) }) });
    return file;
  });
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files } });
  fireEvent.submit(container.querySelector("form")!);
  await waitFor(() => expect(close).toHaveBeenCalledWith(false));
  expect(started).toBe(2);
  expect(snapshots[1]).toEqual([]);
  expect(snapshots[2]).toEqual([{ uploadId: "session-2", name: "two.txt", size: 1, fingerprint: "two.txt:1:1" }]);
  expect(JSON.parse(localStorage.getItem("idkthectf:uploads:challenge") || "[]")).toEqual([]);
});
