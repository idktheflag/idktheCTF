import { apiFetch } from "@/lib/api";
import { useAuth } from "@/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getBackendURL } from "@/lib/utils";
import { EventCountdown } from "./EventCountdown";
import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

type EventInfo = { name: string; description: string; startsAt: string | null; endsAt: string | null; timezone: string; phase: string };
type Announcement = { id: string; title: string; body: string; createdAt: string };
type EventPage = { slug: string; title: string };
export const Home: React.FC = () => {
  const navigate = useNavigate(); const { user } = useAuth();
  const [event, setEvent] = useState<EventInfo | null>(null); const [announcements, setAnnouncements] = useState<Announcement[]>([]); const [team, setTeam] = useState<boolean | null>(null);
  const [pages, setPages] = useState<EventPage[]>([]);
  useEffect(() => {
    void apiFetch(`${getBackendURL()}/api/event`).then((r) => r.ok ? r.json() : null).then(setEvent);
    void apiFetch(`${getBackendURL()}/api/content/announcements`).then((r) => r.json()).then((d) => setAnnouncements(d.announcements || []));
    void apiFetch(`${getBackendURL()}/api/content/pages`).then((r) => r.json()).then((d) => setPages(d.pages || []));
    if (user) void apiFetch(`${getBackendURL()}/api/teams/me`, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } }).then((r) => r.json()).then((d) => setTeam(Boolean(d.team)));
  }, [user]);
  const date = (value: string | null) => value ? new Date(value).toLocaleString(undefined, { timeZone: event?.timezone || "UTC" }) : "Not set";
  return <main className="mx-auto max-w-5xl px-4 py-8 text-foreground">
    <section className="mb-8 rounded-xl border border-border border-l-2 border-l-primary bg-card p-6 sm:p-8"><p className="mb-3 font-mono text-xs uppercase tracking-[0.16em] text-primary">{event?.phase || "Capture the flag"}</p><h1 className="mb-3 text-3xl font-semibold tracking-tight sm:text-4xl">{event?.name || "idktheCTF"}</h1><p className="max-w-3xl text-muted-foreground">{event?.description || "Find flags, solve challenges, and climb the team scoreboard."}</p><p className="mt-4 font-mono text-xs text-muted-foreground">Starts: {date(event?.startsAt || null)} <span className="px-1.5 text-border">/</span> Ends: {date(event?.endsAt || null)}</p><EventCountdown startsAt={event?.startsAt || null} endsAt={event?.endsAt || null} />
      <div className="mt-6 flex flex-wrap gap-3">{user ? <>{!user.isAdmin && team === false && <Button variant="outline" onClick={() => navigate("/teams")}>Create or join a team</Button>}<Button onClick={() => navigate(user.isAdmin ? "/admin/dashboard" : team ? "/challenges" : "/teams")}>{user.isAdmin ? "Organizer dashboard" : team ? "View challenges" : "Join the competition"}</Button></> : <><Button onClick={() => navigate("/register")}>Register</Button><Button onClick={() => navigate("/login")} variant="outline">Log in</Button></>}</div>
    </section>
    {announcements.length > 0 && <section className="mb-8"><h2 className="mb-3 text-2xl font-semibold">Announcements</h2><div className="grid gap-3">{announcements.map((item) => <Card key={item.id}><CardHeader><CardTitle>{item.title}</CardTitle></CardHeader><CardContent><p className="whitespace-pre-wrap">{item.body}</p><p className="mt-3 text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</p></CardContent></Card>)}</div></section>}
    {pages.length > 0 && <section className="mb-8 flex flex-wrap gap-3">{pages.map((page) => <Link key={page.slug} className="rounded-lg border border-border bg-card px-4 py-2 text-sm hover:border-primary" to={`/pages/${page.slug}`}>{page.title}</Link>)}</section>}
    <section className="grid gap-4 md:grid-cols-2"><Card><CardHeader><CardTitle>Team competition</CardTitle></CardHeader><CardContent><p className="text-muted-foreground">Every competitor plays as part of a team. Create a team of one to play solo, or share your join code with teammates.</p><Button className="mt-4" variant="outline" onClick={() => navigate("/teams")}>Explore teams</Button></CardContent></Card><Card><CardHeader><CardTitle>Rules</CardTitle></CardHeader><CardContent><ul className="list-inside list-disc space-y-1 text-muted-foreground"><li>Do not attack the competition infrastructure.</li><li>Do not brute-force flags or share solutions.</li><li>Follow the challenge scope and organizer instructions.</li></ul><Link className="mt-4 inline-block text-primary underline" to="/leaderboard">View team scoreboard</Link></CardContent></Card></section>
  </main>;
};
