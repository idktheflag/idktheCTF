import React, { useEffect, useState } from "react";
import { getBackendURL, localInputToUtc, utcToLocalInput, TIMEZONE_OPTIONS } from "@/lib/utils";

type Settings = { name: string; description: string; timezone: string; startsAt: string | null; endsAt: string | null; paused: boolean; scoreboardFrozenAt: string | null; scoreboardPublic: boolean; viewChallengesAfterEnd: boolean; registrationMode: string; maxTeamSize: number; allowedEmailDomains: string[] };
const localDate = (value: string | null, zone: string) => utcToLocalInput(value, zone);

export const EventSettings: React.FC = () => {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteMessage, setInviteMessage] = useState("");
  const [invitations, setInvitations] = useState<{id:string;email:string;expiresAt:number;redeemedAt:number|null;revokedAt:number|null}[]>([]);
  const [inviteBusy, setInviteBusy] = useState(false);
  const loadInvitations = async () => {
    const r = await fetch(`${getBackendURL()}/api/event/invitations`, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } });
    if (r.ok) setInvitations(await r.json());
  };
  useEffect(() => {
    fetch(`${getBackendURL()}/api/event/settings`, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } })
      .then(async (r) => { const data = await r.json(); if (!r.ok) throw new Error(data.error); setSettings({ ...data, startsAt: localDate(data.startsAt, data.timezone), endsAt: localDate(data.endsAt, data.timezone), scoreboardFrozenAt: localDate(data.scoreboardFrozenAt, data.timezone), allowedEmailDomains: data.allowedEmailDomains || [] }); })
      .catch((e) => setError(e.message));
    void loadInvitations();
  }, []);
  const invite = async (e: React.FormEvent) => {
    e.preventDefault(); setInviteBusy(true); setInviteMessage("");
    try { const r = await fetch(`${getBackendURL()}/api/event/invitations`, { method:"POST", headers:{"Content-Type":"application/json",Authorization:`Bearer ${localStorage.getItem("token")}`}, body:JSON.stringify({email:inviteEmail}) }); const data=await r.json(); if(!r.ok) throw new Error(data.error); setInviteMessage(data.message); setInviteEmail(""); await loadInvitations(); }
    catch (e) { setInviteMessage(e instanceof Error ? e.message : "Could not send invitation"); }
    finally { setInviteBusy(false); }
  };
  const revokeInvite = async (id:string) => { if(!window.confirm("Revoke this invitation? Its registration link will stop working.")) return; const r=await fetch(`${getBackendURL()}/api/event/invitations/${id}`,{method:"DELETE",headers:{Authorization:`Bearer ${localStorage.getItem("token")}`}}); const data=await r.json(); if(!r.ok) setInviteMessage(data.error || "Could not revoke invitation"); else { setInviteMessage("Invitation revoked."); await loadInvitations(); } };
  const field = (key: keyof Settings, value: unknown) => setSettings((old) => old ? { ...old, [key]: value } : old);
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setError(""); setMessage("");
    if (!settings) return;
    const response = await fetch(`${getBackendURL()}/api/event/settings`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` }, body: JSON.stringify({ ...settings, startsAt: localInputToUtc(settings.startsAt || "", settings.timezone), endsAt: localInputToUtc(settings.endsAt || "", settings.timezone), scoreboardFrozenAt: localInputToUtc(settings.scoreboardFrozenAt || "", settings.timezone), allowedEmailDomains: settings?.allowedEmailDomains || [] }) });
    const data = await response.json();
    if (!response.ok) setError(data.error || "Could not save settings"); else setMessage("Event settings saved.");
  };
  if (!settings) return <main className="mx-auto max-w-4xl rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">{error || "Loading event settingsâ€¦"}</main>;
  return <main className="mx-auto max-w-4xl space-y-5"><div><h1 className="text-2xl font-bold tracking-tight">Event settings</h1><p className="mt-1 text-sm text-muted-foreground">Control event timing, registration, team limits, and scoreboard visibility.</p></div><form onSubmit={save} className="grid gap-4 rounded-lg border border-border bg-card p-5 sm:grid-cols-2 sm:p-6">
    <label className="grid gap-1 sm:col-span-2">CTF name<input required value={settings.name} onChange={(e) => field("name", e.target.value)} className="rounded border p-2 bg-background" /></label>
    <label className="grid gap-1 sm:col-span-2">Description<textarea rows={4} value={settings.description} onChange={(e) => field("description", e.target.value)} className="rounded border p-2 bg-background" /></label>
    <label className="grid gap-1">Starts at<input type="datetime-local" value={settings.startsAt || ""} onChange={(e) => field("startsAt", e.target.value || null)} className="rounded border p-2 bg-background" /></label>
    <label className="grid gap-1">Ends at<input type="datetime-local" value={settings.endsAt || ""} onChange={(e) => field("endsAt", e.target.value || null)} className="rounded border p-2 bg-background" /></label>
    <label className="grid gap-1">Timezone<select required value={settings.timezone} onChange={(e) => field("timezone", e.target.value)} className="rounded border p-2 bg-background">{[...new Set([settings.timezone, ...TIMEZONE_OPTIONS])].map((zone) => <option key={zone} value={zone}>{zone.replace(/_/g, " ")}</option>)}</select></label>
    <label className="grid gap-1">Maximum team size<input type="number" min="1" max="100" value={settings.maxTeamSize} onChange={(e) => field("maxTeamSize", Number(e.target.value))} className="rounded border p-2 bg-background" /></label>
    <label className="grid gap-1">Registration<select value={settings.registrationMode} onChange={(e) => field("registrationMode", e.target.value)} className="rounded border p-2 bg-background"><option value="public">Open registration</option><option value="invite">Invitation required</option></select></label>
    <label className="grid gap-1">Allowed email domains<input value={settings.allowedEmailDomains.join(", ")} onChange={(e) => field("allowedEmailDomains", e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} placeholder="example.org, school.edu" className="rounded border p-2 bg-background" /></label>
    <label className="flex items-center gap-2"><input type="checkbox" checked={settings.paused} onChange={(e) => field("paused", e.target.checked)} /> Pause submissions</label>
    <label className="flex items-center gap-2"><input type="checkbox" checked={settings.scoreboardPublic} onChange={(e) => field("scoreboardPublic", e.target.checked)} /> Public scoreboard</label>
    <label className="flex items-center gap-2"><input type="checkbox" checked={settings.viewChallengesAfterEnd} onChange={(e) => field("viewChallengesAfterEnd", e.target.checked)} /> Keep challenges visible after event</label>
    <label className="grid gap-1 sm:col-span-2">Freeze scoreboard at<input type="datetime-local" value={settings.scoreboardFrozenAt || ""} onChange={(e) => field("scoreboardFrozenAt", e.target.value || null)} className="rounded border p-2 bg-background" /></label>
    {error && <p role="alert" className="text-red-600 sm:col-span-2">{error}</p>}{message && <p className="text-green-700 sm:col-span-2">{message}</p>}
    <button className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground hover:bg-primary/90 sm:col-span-2">Save settings</button>
  </form>
  <section className="rounded-lg border border-border bg-card p-5 sm:p-6"><div><h2 className="text-lg font-semibold">Registration invitations</h2><p className="mt-1 text-sm text-muted-foreground">Send a single-use, email-bound registration link. Links expire after seven days.</p></div>
    <form onSubmit={invite} className="mt-4 flex flex-col gap-2 sm:flex-row"><input type="email" required value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} placeholder="participant@example.com" className="min-w-0 flex-1 rounded border border-border bg-background p-2"/><button disabled={inviteBusy} className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-50">{inviteBusy ? "Sending…" : "Send invitation"}</button></form>
    {inviteMessage && <p className="mt-3 text-sm" role="status">{inviteMessage}</p>}
    <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-border text-muted-foreground"><th className="py-2 pr-3">Email</th><th className="py-2 pr-3">Expires</th><th className="py-2 pr-3">Status</th><th className="py-2">Action</th></tr></thead><tbody>{invitations.map(i=><tr key={i.id} className="border-b border-border/60"><td className="py-2 pr-3">{i.email}</td><td className="py-2 pr-3">{new Date(i.expiresAt).toLocaleString()}</td><td className="py-2 pr-3">{i.redeemedAt ? "Used" : i.revokedAt ? "Revoked" : i.expiresAt < Date.now() ? "Expired" : "Active"}</td><td className="py-2">{!i.redeemedAt&&!i.revokedAt&&i.expiresAt>Date.now()&&<button className="text-destructive underline" onClick={()=>void revokeInvite(i.id)}>Revoke</button>}</td></tr>)}</tbody></table>{invitations.length===0&&<p className="py-5 text-sm text-muted-foreground">No invitations yet.</p>}</div>
  </section></main>;
};

