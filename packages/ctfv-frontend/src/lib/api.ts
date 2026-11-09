/** Preserve responses for callers while notifying the session owner of revocation. */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit) {
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  const authorization = headers.get("Authorization");
  const response = await fetch(input, init);
  if (response.status === 401 && authorization?.startsWith("Bearer ")) {
    const token = authorization.slice(7);
    // A slow request from before a new login must not sign out that new login.
    if (token && localStorage.getItem("token") === token) {
      window.dispatchEvent(new CustomEvent("ctf:session-expired", { detail: { token } }));
    }
  }
  return response;
}
