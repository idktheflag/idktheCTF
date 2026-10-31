import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getBackendURL } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";

type User = {
  email: string;
  rank: number;
  name: string;
  points: number;
  userId: string;
};
type HistoryTeam = { teamId: string; teamName: string; points: { at: number; score: number }[] };

export const LeaderBoard: React.FC = () => {
  const [leaderboardData, setLeaderboardData] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryTeam[]>([]);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const token = localStorage.getItem("token");
        const headers: HeadersInit = { "Content-Type": "application/json" };
        if (token) headers.Authorization = `Bearer ${token}`;
        const response = await fetch(
          getBackendURL() + "/api/challenges/leaderboard",
          {
            method: "GET",
            headers,
          },
        );

        if (!response.ok) {
          if (response.status === 401) {
            throw new Error("Login to view the leaderboard");
          } else {
            throw new Error("Failed to fetch leaderboard");
          }
        }

        const data = await response.json();

        const leaderboard = data.leaderboard.map(
          (
            user: {
              teamId: string;
              username: string;
              totalPoints: number;
            },
            index: number,
          ) => ({
            rank: index + 1,
            name: user.username,
            points: user.totalPoints,
            userId: user.teamId,
            email: "",
          }),
        );

        setLeaderboardData(leaderboard);
        const historyResponse = await fetch(getBackendURL() + "/api/challenges/scoreboard-history", { headers });
        if (historyResponse.ok) setHistory((await historyResponse.json()).teams);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        console.error("Error fetching leaderboard:", err);
        setError(
          "Error fetching leaderboard: " + (err.message || "An error occurred"),
        );
      } finally {
        setIsLoading(false);
      }
    };

    fetchLeaderboard();
  }, []);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">Loading leaderboard...</span>
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive" className="m-4">
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="p-8">
      <h1 className="mb-6 text-3xl font-bold text-foreground text-foreground">
        Leaderboard
      </h1>
      {history.length > 0 && <section className="mb-8 rounded-xl bg-card p-5 shadow bg-card">
        <h2 className="mb-3 text-xl font-semibold">Score over time</h2>
        <div className="overflow-x-auto"><svg viewBox="0 0 900 280" role="img" aria-label="Team scores over time" className="min-w-[640px] w-full">
          {[0, 1, 2, 3, 4].map((line) => <g key={line}><line x1="52" x2="885" y1={20 + line * 55} y2={20 + line * 55} stroke="currentColor" opacity=".12" /><text x="4" y={24 + line * 55} fontSize="12" fill="currentColor" opacity=".65">{Math.round((Math.max(...history.flatMap((t) => t.points.map((p) => p.score))) || 0) * (4 - line) / 4)}</text></g>)}
          {history.slice(0, 8).map((team, index) => { const all = history.flatMap((t) => t.points.map((p) => p.at)); const min = Math.min(...all); const max = Math.max(...all); const maxScore = Math.max(1, ...history.flatMap((t) => t.points.map((p) => p.score))); const coords = team.points.map((p) => `${52 + (max === min ? 0 : (p.at - min) / (max - min) * 833)},${240 - p.score / maxScore * 220}`).join(" "); const colors = ["#4f46e5", "#0891b2", "#16a34a", "#ea580c", "#db2777", "#7c3aed", "#ca8a04", "#0f766e"]; return <polyline key={team.teamId} points={coords} fill="none" stroke={colors[index]} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />; })}
        </svg></div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm">{history.slice(0, 8).map((team, index) => <Link key={team.teamId} to={`/team/${team.teamId}`} className="hover:underline" style={{ color: ["#4f46e5", "#0891b2", "#16a34a", "#ea580c", "#db2777", "#7c3aed", "#ca8a04", "#0f766e"][index] }}>{team.teamName}</Link>)}</div>
      </section>}
      {leaderboardData.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rank</TableHead>
              <TableHead>Name</TableHead>
              {leaderboardData[0].email && <TableHead>Email</TableHead>}
              <TableHead>Points</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leaderboardData.map((user) => (
              <TableRow key={user.rank}>
                <TableCell className="text-muted-foreground">
                  {user.rank}
                </TableCell>
                <TableCell>
                  <Link
                    to={`/team/${user.userId}`}
                    className="text-primary hover:underline"
                  >
                    {user.name}
                  </Link>
                </TableCell>
                {user.email && (
                  <TableCell className="text-muted-foreground">
                    {user.email}
                  </TableCell>
                )}
                <TableCell className="text-muted-foreground">
                  {user.points}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-center text-muted-foreground dark:text-muted-foreground">
          No submissions yet, be the first one to submit!
        </p>
      )}
    </div>
  );
};

