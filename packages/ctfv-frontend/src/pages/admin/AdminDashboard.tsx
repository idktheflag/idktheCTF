import { apiFetch } from "@/lib/api";
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, ArrowDownToLine, ArrowRight, ArrowUpRight, Flag, Plus, Trophy, Users, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getBackendURL } from "@/lib/utils";

type DashboardData = {
  counts: Record<string, number>;
  event: { name: string; startsAt: string | null; endsAt: string | null; paused: boolean } | null;
  recent: { id: string; username: string; teamName: string | null; challengeName: string; isCorrect: boolean; timestamp: number }[];
};
const metrics = [
  { key: "participants", label: "Participants", icon: UserRound },
  { key: "teams", label: "Teams", icon: Users },
  { key: "challenges", label: "Challenges", icon: Flag },
  { key: "solves", label: "Correct solves", icon: Trophy },
];

const exportEvent = async () => {
  const response = await apiFetch(`${getBackendURL()}/api/admin/export`, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } });
  if (!response.ok) throw new Error("Could not export event data");
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = "ctf-export.json"; anchor.click();
  URL.revokeObjectURL(url);
};

export const AdminDashboard: React.FC = () => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [exportError, setExportError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    apiFetch(`${getBackendURL()}/api/admin/dashboard`, { signal: controller.signal, headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Request failed");
        if (!controller.signal.aborted) setData(body);
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setError(e instanceof Error && e.message ? e.message : "Request failed");
      });
    return () => controller.abort();
  }, [attempt]);
  const status = error ? "Unavailable" : !data ? "Loading" : !data.event ? "Not configured" : data.event.paused ? "Paused" : data.event.startsAt && Date.now() < new Date(data.event.startsAt).getTime() ? "Scheduled" : data.event.endsAt && Date.now() > new Date(data.event.endsAt).getTime() ? "Ended" : "Live";

  return <div className="space-y-6">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><h1 className="text-3xl font-bold tracking-tight">Overview</h1><p className="mt-1 text-sm text-muted-foreground">Event activity and management.</p></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" asChild><Link to="/admin/challenges"><Flag size={16} className="mr-2" />Challenges</Link></Button><Button asChild><Link to="/admin/challenges"><Plus size={16} className="mr-2" />Create challenge</Link></Button></div>
    </div>

    {error && <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">Could not load dashboard: {error}<Button className="ml-3" variant="outline" size="sm" onClick={() => { setError(""); setData(null); setAttempt((value) => value + 1); }}>Retry</Button></div>}

    <section className="rounded-lg border border-border bg-card">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-md bg-secondary text-secondary-foreground"><Activity size={18} /></span><div><p className="text-sm text-muted-foreground">Current event</p><h2 className="mt-0.5 text-lg font-semibold">{error ? "Event details unavailable" : !data ? "Loading event details" : data.event?.name || "Event setup in progress"}</h2><p className="mt-1 text-sm text-muted-foreground">{data?.event?.startsAt ? `Starts ${new Date(data.event.startsAt).toLocaleString()}` : data ? "Start time not set" : ""}{data?.event?.endsAt ? ` · Ends ${new Date(data.event.endsAt).toLocaleString()}` : ""}</p></div></div>
        <div className="flex items-center gap-3"><span className="rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground">{status}</span><Button variant="ghost" size="sm" asChild><Link to="/admin/event">Settings<ArrowUpRight size={14} className="ml-1" /></Link></Button></div>
      </div>
    </section>

    <section><h2 className="mb-3 text-sm font-semibold">Event totals</h2><div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{metrics.map(({ key, label, icon: Icon }) => <article key={key} className="rounded-lg border border-border bg-card p-4 sm:p-5"><div className="flex items-center justify-between"><p className="text-sm text-muted-foreground">{label}</p><span className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary text-secondary-foreground"><Icon size={16} /></span></div><p className="mt-3 text-3xl font-semibold tracking-tight">{data?.counts[key] ?? "—"}</p></article>)}</div></section>

    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h2 className="font-semibold">Recent submissions</h2><p className="mt-0.5 text-sm text-muted-foreground">Latest flag attempts across the event.</p></div><Button variant="ghost" size="sm" asChild><Link to="/admin/challenges">Challenges<ArrowRight size={14} className="ml-1" /></Link></Button></div>
      {!data ? <div className="px-6 py-12 text-center text-sm text-muted-foreground">{error ? "Submissions unavailable" : "Loading submissions"}</div> : data.recent.length ? <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead className="bg-secondary/60 text-muted-foreground"><tr><th className="px-5 py-3 font-medium">Participant</th><th className="px-4 py-3 font-medium">Team</th><th className="px-4 py-3 font-medium">Challenge</th><th className="px-4 py-3 font-medium">Result</th><th className="px-5 py-3 font-medium">Submitted</th></tr></thead><tbody>{data.recent.map((row) => <tr key={row.id} className="border-t border-border"><td className="px-5 py-3.5 font-medium">{row.username}</td><td className="px-4 py-3.5 text-muted-foreground">{row.teamName || "—"}</td><td className="px-4 py-3.5">{row.challengeName}</td><td className="px-4 py-3.5"><span className="rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">{row.isCorrect ? "Correct" : "Incorrect"}</span></td><td className="px-5 py-3.5 text-muted-foreground">{new Date(row.timestamp).toLocaleString()}</td></tr>)}</tbody></table></div> : <div className="px-6 py-12 text-center"><Flag className="mx-auto text-muted-foreground" size={20} /><p className="mt-3 font-medium">No submissions yet</p><p className="mt-1 text-sm text-muted-foreground">Flag attempts will appear here when teams start playing.</p></div>}
    </section>

    <section className="flex flex-col justify-between gap-3 rounded-lg border border-border bg-card px-5 py-4 sm:flex-row sm:items-center"><div><h2 className="text-sm font-semibold">Event data</h2><p className="mt-1 text-sm text-muted-foreground">Download a JSON backup of event data, teams, challenges, solves, and submissions.</p></div><div>{exportError && <p role="alert" className="mb-2 text-sm text-destructive">{exportError}</p>}<Button variant="outline" size="sm" onClick={() => { setExportError(""); void exportEvent().catch((e) => setExportError(e.message)); }}><ArrowDownToLine size={15} className="mr-2" />Export JSON</Button></div></section>
  </div>;
};

