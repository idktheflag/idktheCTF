import React, { useCallback, useEffect, useState } from "react";
import { getBackendURL } from "@/lib/utils";
import { useAuth } from "@/AuthContext";
import { Link } from "react-router-dom";

type Team = { id: string; name: string; captainId: string; joinCode?: string; memberCount?: number };

export const Teams: React.FC = () => {
  const [team, setTeam] = useState<Team | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const token = localStorage.getItem("token");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [mine, directory] = await Promise.all([
        fetch(`${getBackendURL()}/api/teams/me`, { headers }),
        fetch(`${getBackendURL()}/api/teams`, { headers }),
      ]);
      if (!mine.ok || !directory.ok) throw new Error("Sign in to view teams");
      setTeam((await mine.json()).team);
      setTeams((await directory.json()).teams);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const mutate = async (path: string, body: object) => {
    setError("");
    const response = await fetch(`${getBackendURL()}/api/teams${path}`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not update team");
    await load();
  };

  if (!user) return <p className="p-8">Please <Link className="text-primary underline" to="/login">log in</Link> to join a team.</p>;
  if (!user.emailVerified) return <p className="p-8">Verify your email before joining a team. <Link className="text-primary underline" to="/send-email">Send verification email</Link>.</p>;
  if (loading) return <p className="p-8">Loading teamsâ€¦</p>;
  return (
    <main className="mx-auto max-w-4xl p-4 text-foreground text-foreground">
      <h1 className="mb-2 text-3xl font-bold">Teams</h1>
      <p className="mb-6 text-muted-foreground text-muted-foreground">Every competitor must be on a team. A team with one person is a valid way to play solo.</p>
      {error && <p role="alert" className="mb-4 rounded bg-red-100 p-3 text-red-800">{error}</p>}
      {team ? (
        <section className="mb-8 rounded-xl bg-card p-6 shadow bg-card">
          <h2 className="text-xl font-semibold">Your team: <Link to={`/team/${team.id}`} className="text-primary hover:underline">{team.name}</Link></h2>
          <p className="mt-2">Share this join code with teammates: <code className="rounded bg-secondary px-2 py-1 bg-background">{team.joinCode}</code></p>
          <p className="mt-2 text-sm text-muted-foreground">{team.captainId === user?.userId ? "You are the captain." : "Your team captain manages membership."}</p>
        </section>
      ) : (
        <section className="mb-8 grid gap-6 rounded-xl bg-card p-6 shadow bg-card md:grid-cols-2">
          <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void mutate("/", { name }).catch((err) => setError(err.message)); }}>
            <h2 className="text-xl font-semibold">Create a team</h2>
            <p className="text-sm text-muted-foreground">Create a one-person team if you are playing solo.</p>
            <input required maxLength={48} value={name} onChange={(e) => setName(e.target.value)} placeholder="Team name" className="rounded border p-2 text-foreground bg-background dark:text-white" />
            <button className="rounded bg-primary px-4 py-2 font-semibold text-white">Create team</button>
          </form>
          <form className="grid content-start gap-3" onSubmit={(e) => { e.preventDefault(); void mutate("/join", { joinCode }).catch((err) => setError(err.message)); }}>
            <h2 className="text-xl font-semibold">Join a team</h2>
            <p className="text-sm text-muted-foreground">Ask a team member for their join code.</p>
            <input required value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="Join code" className="rounded border p-2 text-foreground bg-background dark:text-white" />
            <button className="rounded border px-4 py-2 font-semibold">Join team</button>
          </form>
        </section>
      )}
      <section>
        <h2 className="mb-3 text-xl font-semibold">Teams</h2>
        {teams.length ? <ul className="grid gap-3 sm:grid-cols-2">{teams.map((entry) => <li key={entry.id} className="rounded-lg bg-card p-4 shadow bg-card"><Link to={`/team/${entry.id}`} className="font-semibold text-primary hover:underline">{entry.name}</Link><span className="ml-2 text-sm text-muted-foreground">{entry.memberCount} member{entry.memberCount === 1 ? "" : "s"}</span></li>)}</ul> : <p>No teams created yet.</p>}
      </section>
    </main>
  );
};

