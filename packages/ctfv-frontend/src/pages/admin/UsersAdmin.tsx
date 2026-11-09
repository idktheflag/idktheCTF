import { apiFetch } from "@/lib/api";
import { getBackendURL } from "@/lib/utils";
import React, { useCallback, useEffect, useRef, useState } from "react";

type AdminUser = {
  id: string;
  username: string | null;
  email: string;
  teamName: string | null;
  isAdmin: boolean;
  isBanned: boolean;
  emailVerified: boolean;
  isOwner: boolean;
};

export const UsersAdmin: React.FC = () => {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [sort, setSort] = useState("username");
  const [dir, setDir] = useState("asc");
  const [canManageRoles, setCanManageRoles] = useState(false);
  const [moderating, setModerating] = useState(false);
  const moderationRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "25", q: query, sort, dir });
      if (status) {
        const [key, value] = status.split("=");
        params.set(key, value);
      }
      const response = await apiFetch(`${getBackendURL()}/api/admin/users?${params}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setUsers(data.users);
      setTotal(data.total);
      setCanManageRoles(data.canManageRoles === true);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load participants");
    }
  }, [page, query, sort, dir, status]);

  useEffect(() => { void load(); }, [load]);

  const toggleBan = async (user: AdminUser) => {
    if (moderationRef.current) return;
    moderationRef.current = true;
    setModerating(true);
    setError("");
    try {
      const response = await apiFetch(`${getBackendURL()}/api/admin/users/${user.id}/ban`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: JSON.stringify({ isBanned: !user.isBanned }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update account access");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update account access. Please try again.");
    } finally {
      moderationRef.current = false;
      setModerating(false);
    }
  };

  const toggleRole = async (user: AdminUser) => {
    if (!canManageRoles || user.isOwner || moderationRef.current) return;
    const isAdmin = !user.isAdmin;
    const action = isAdmin ? "make an organizer" : "remove organizer access from";
    if (!window.confirm(`Are you sure you want to ${action} ${user.email}? They will need to sign in again for the change to take effect.`)) return;
    moderationRef.current = true;
    setModerating(true);
    setError("");
    try {
      const response = await apiFetch(`${getBackendURL()}/api/admin/users/${user.id}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: JSON.stringify({ isAdmin }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update organizer access");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update organizer access. Please try again.");
    } finally {
      moderationRef.current = false;
      setModerating(false);
    }
  };

  const order = (key: string) => {
    setDir(sort === key && dir === "asc" ? "desc" : "asc");
    setSort(key);
    setPage(1);
  };
  const sortHeader = (label: string, key: string) => (
    <th className="px-4 py-3">
      <button onClick={() => order(key)} className="font-medium hover:text-foreground">
        {label}{sort === key ? (dir === "asc" ? " ↑" : " ↓") : " ↕"}
      </button>
    </th>
  );

  return (
    <div className="space-y-5">
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-primary">Organizer</p>
        <h1 className="mt-2 text-2xl font-semibold">Participants</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage participant accounts and access. Team rosters are available in Teams.</p>
      </div>
      {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); setPage(1); setQuery(q.trim()); }}>
        <input aria-label="Search participants" value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search username, email, team" className="h-10 min-w-56 flex-1 rounded-md border border-border bg-card px-3 text-sm" />
        <select aria-label="Filter participants" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="h-10 rounded-md border border-border bg-card px-3 text-sm">
          <option value="">All participants</option><option value="verified=true">Verified</option><option value="verified=false">Unverified</option><option value="banned=true">Banned</option><option value="banned=false">Not banned</option><option value="admin=true">Admins</option><option value="admin=false">Non-admins</option>
        </select>
        <button className="h-10 rounded-md border border-border px-4 text-sm hover:bg-accent">Search</button>
        <button type="button" onClick={() => { setQ(""); setQuery(""); setStatus(""); setPage(1); }} className="h-10 rounded-md px-3 text-sm text-muted-foreground hover:bg-accent">Reset</button>
      </form>
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-secondary text-muted-foreground"><tr>{sortHeader("Username", "username")}{sortHeader("Email", "email")}{sortHeader("Team", "teamName")}<th className="px-4 py-3">Status</th><th className="px-4 py-3">Actions</th></tr></thead>
          <tbody>{users.map((user) => (
            <tr key={user.id} className="border-t border-border">
              <td className="px-4 py-3 font-medium">{user.isAdmin ? "Organizer" : user.username}</td>
              <td className="px-4 py-3 text-muted-foreground">{user.email}</td>
              <td className="px-4 py-3 text-muted-foreground">{user.teamName || "No team"}</td>
              <td className="px-4 py-3 text-xs text-muted-foreground">{user.isBanned ? "Banned" : user.emailVerified ? "Verified" : "Unverified"}</td>
              <td className="flex gap-2 px-4 py-3">
                {!user.isAdmin && <button disabled={moderating} onClick={() => void toggleBan(user)} className={`rounded border border-border px-3 py-1.5 text-xs hover:bg-accent ${user.isBanned ? "" : "text-destructive"}`}>{user.isBanned ? "Restore" : "Ban"}</button>}
                {canManageRoles && !user.isOwner && <button disabled={moderating || (!user.isAdmin && (!user.emailVerified || user.isBanned))} title={!user.isAdmin && !user.emailVerified ? "The user must verify their email first" : undefined} onClick={() => void toggleRole(user)} className="rounded border border-border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50">{user.isAdmin ? "Remove organizer" : "Make organizer"}</button>}
              </td>
            </tr>
          ))}</tbody>
        </table>
        {!users.length && <p className="p-10 text-center text-sm text-muted-foreground">No participants match these filters.</p>}
      </div>
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{total ? `${(page - 1) * 25 + 1}–${Math.min(page * 25, total)} of ${total}` : "0 participants"}</span>
        <div className="flex gap-2"><button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded border border-border px-3 py-1.5 disabled:opacity-40">Previous</button><button disabled={page * 25 >= total} onClick={() => setPage(page + 1)} className="rounded border border-border px-3 py-1.5 disabled:opacity-40">Next</button></div>
      </div>
    </div>
  );
};
