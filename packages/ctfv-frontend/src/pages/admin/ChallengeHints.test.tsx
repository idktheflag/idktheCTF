// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ChallengeFormDialog } from "./ChallengeFormDialog";

const { updateChallenge } = vi.hoisted(() => ({ updateChallenge: vi.fn(async () => {}) }));
vi.mock("@/auth-context", () => ({ useAuth: () => ({
  user: { username: "organizer" }, updateChallenge,
  getChallenges: async () => [{ challenges: [{ id: "challenge", name: "Challenge", category: "Web", description: "Description", url: "", points: 100, author: "Admin", flag: "flag", hints: [{ id: "idA", body: "A", cost: 10 }, { id: "idB", body: "B", cost: 20 }] }] }],
}) }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

async function openEditor() {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ attachments: [] })));
  const view = render(<ChallengeFormDialog mode="edit" challengeId="challenge" open onOpenChange={() => {}} onSaved={() => {}} />);
  await waitFor(() => expect(view.getByLabelText("Challenge name")).toHaveProperty("value", "Challenge"));
  return view;
}

test("removing and editing hints preserves the surviving identity and marks additions as new", async () => {
  const view = await openEditor();
  fireEvent.click(view.getByRole("button", { name: "Remove hint 1" }));
  fireEvent.change(view.getByLabelText("Hint 1 text"), { target: { value: " Updated B " } });
  fireEvent.change(view.getByLabelText("Hint 1 point cost"), { target: { value: "25" } });
  fireEvent.click(view.getByRole("button", { name: "Add hint" }));
  fireEvent.change(view.getByLabelText("Hint 2 text"), { target: { value: " C " } });
  fireEvent.submit(view.container.querySelector("form")!);
  await waitFor(() => expect(updateChallenge).toHaveBeenCalledWith("challenge", expect.objectContaining({ hints: [{ id: "idB", body: "Updated B", cost: 25 }, { id: null, body: "C", cost: 0 }] })));
});

test("saving a description change retains both existing hint identities", async () => {
  const view = await openEditor();
  fireEvent.change(view.getByLabelText("Description (Markdown supported)"), { target: { value: "Updated description" } });
  fireEvent.submit(view.container.querySelector("form")!);
  await waitFor(() => expect(updateChallenge).toHaveBeenCalledWith("challenge", expect.objectContaining({ description: "Updated description", hints: [{ id: "idA", body: "A", cost: 10 }, { id: "idB", body: "B", cost: 20 }] })));
});

test.each(["-1", "1.5", "101"])("rejects an out-of-range or fractional hint cost: %s", async (cost) => {
  const view = await openEditor();
  fireEvent.change(view.getByLabelText("Hint 1 point cost"), { target: { value: cost } });
  fireEvent.submit(view.container.querySelector("form")!);
  expect(await view.findByRole("alert")).toHaveProperty("textContent", "Hints need an integer cost between zero and the challenge points.");
  expect(updateChallenge).not.toHaveBeenCalled();
});

test("blanking a purchased hint cannot silently remove it during save", async () => {
  const view = await openEditor();
  fireEvent.change(view.getByLabelText("Hint 1 text"), { target: { value: "   " } });
  fireEvent.submit(view.container.querySelector("form")!);
  expect(await view.findByRole("alert")).toHaveProperty("textContent", "Enter hint text or remove the unused hint row.");
  expect(updateChallenge).not.toHaveBeenCalled();
});

test("a blank price cannot silently turn a paid hint into a free hint", async () => {
  const view = await openEditor();
  fireEvent.change(view.getByLabelText("Hint 1 point cost"), { target: { value: "" } });
  fireEvent.submit(view.container.querySelector("form")!);
  expect(await view.findByRole("alert")).toHaveProperty("textContent", "Enter an integer point cost for each hint.");
  expect(updateChallenge).not.toHaveBeenCalled();
});

test("limits the editor to thirty hints", async () => {
  const view = await openEditor();
  const add = view.getByRole("button", { name: "Add hint" });
  for (let index = 2; index < 30; index++) fireEvent.click(add);
  expect(add).toHaveProperty("disabled", true);
  expect(view.getAllByRole("button", { name: /^Remove hint / })).toHaveLength(30);
});

test("disables hint editing while a save is pending", async () => {
  let finish!: () => void;
  updateChallenge.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  const view = await openEditor();
  fireEvent.submit(view.container.querySelector("form")!);
  expect(view.getByLabelText("Hint 1 text").closest("fieldset")).toHaveProperty("disabled", true);
  expect(view.getByRole("button", { name: "Add hint" })).toHaveProperty("disabled", true);
  finish();
  await waitFor(() => expect(view.getByLabelText("Hint 1 text").closest("fieldset")).toHaveProperty("disabled", false));
});
