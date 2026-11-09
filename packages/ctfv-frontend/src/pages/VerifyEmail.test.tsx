// @vitest-environment jsdom
import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import VerifyEmail from "./VerifyEmail";

const { verifyEmail } = vi.hoisted(() => ({ verifyEmail: vi.fn(async () => {}) }));
vi.mock("@/auth-context", () => ({ useAuth: () => ({ verifyEmail }) }));
afterEach(()=>{cleanup();verifyEmail.mockClear();});

test("StrictMode verifies a one-use link once and displays success", async () => {
  render(<StrictMode><MemoryRouter initialEntries={["/verify-email?token=test-token"]}><VerifyEmail /></MemoryRouter></StrictMode>);
  await waitFor(() => expect(screen.getByText("Your email has been successfully verified!")).toBeTruthy());
  expect(verifyEmail).toHaveBeenCalledTimes(1);
});
test('a temporary verification failure can be retried without replacing the link',async()=>{
  verifyEmail.mockRejectedValueOnce(new Error('Verification service unavailable')).mockResolvedValueOnce(undefined);
  render(<MemoryRouter initialEntries={['/verify-email?token=valid-token']}><VerifyEmail/></MemoryRouter>);
  expect(await screen.findByText('Verification service unavailable')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:/retry/i}));
  expect(await screen.findByText('Your email has been successfully verified!')).toBeTruthy();
  expect(verifyEmail).toHaveBeenCalledTimes(2);
});
