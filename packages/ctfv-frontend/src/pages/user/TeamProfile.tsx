import { apiFetch } from "@/lib/api";
import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getBackendURL } from "@/lib/utils";

type ProfileData = {
  team: { id: string; name: string; members: { id: string; username: string }[] };
  stats: { rank: number | null; totalPoints: number; solves: number; attempts: number; correctAttempts: number; accuracy: number; hintSpend: number; lastSolveAt: string | null };
  solvedChallenges: { challengeId: string; challengeName: string; points: number; solvedAt: string }[];
};

export const TeamProfile: React.FC = () => {
  const { teamId } = useParams<{ teamId: string }>();
  const [data, setData] = useState<ProfileData | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError("");
    apiFetch(`${getBackendURL()}/api/teams/${teamId}`, { signal: controller.signal, headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "Could not load team"); if (!controller.signal.aborted) setData(body); })
      .catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not load team"); });
    return () => controller.abort();
  }, [teamId]);

  if (error) return <main className="p-8"><p className="text-red-600">{error}</p><Link className="text-primary underline" to="/leaderboard">Back to scoreboard</Link></main>;
  if (!data) return <main className="p-8">Loading team…</main>;
  const { team, stats } = data;
  const cards = [["Rank", stats.rank ? `#${stats.rank}` : "Unranked"], ["Points", stats.totalPoints], ["Challenges solved", stats.solves], ["Flag attempts", stats.attempts], ["Accuracy", `${stats.accuracy}%`], ["Hint points spent", stats.hintSpend]];
  return <main className="mx-auto max-w-5xl p-4 sm:p-8">
    <Link to="/leaderboard" className="text-sm text-primary hover:underline">â† Scoreboard</Link>
    <header className="my-6"><p className="text-sm font-semibold uppercase tracking-wider text-primary">Team profile</p><h1 className="mt-1 text-4xl font-bold">{team.name}</h1><p className="mt-2 text-muted-foreground">{team.members.length} member{team.members.length === 1 ? "" : "s"}{stats.lastSolveAt ? ` · Last solve ${new Date(stats.lastSolveAt).toLocaleString()}` : " · No solves yet"}</p></header>
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">{cards.map(([label, value]) => <div key={label} className="rounded-xl bg-card p-4 shadow bg-card"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-bold">{value}</p></div>)}</section>
    <div className="mt-6 grid gap-6 md:grid-cols-[1fr_2fr]">
      <section className="rounded-xl bg-card p-5 shadow bg-card"><h2 className="mb-3 text-xl font-semibold">Members</h2><ul className="space-y-2">{team.members.map((member) => <li key={member.id} className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary font-semibold text-primary">{member.username.slice(0, 1).toUpperCase()}</span>{member.username}</li>)}</ul></section>
      <section className="rounded-xl bg-card p-5 shadow bg-card"><h2 className="mb-3 text-xl font-semibold">Solve history</h2>{data.solvedChallenges.length ? <ol className="space-y-3">{data.solvedChallenges.map((solve) => <li key={solve.challengeId} className="flex items-center justify-between gap-4 border-b border-border pb-3 last:border-0 border-border"><div><p className="font-medium">{solve.challengeName}</p><p className="text-sm text-muted-foreground">{new Date(solve.solvedAt).toLocaleString()}</p></div><span className="whitespace-nowrap font-semibold text-primary">+{solve.points}</span></li>)}</ol> : <p className="text-muted-foreground">This team has not solved a challenge yet.</p>}</section>
    </div>
  </main>;
};

export default TeamProfile;

