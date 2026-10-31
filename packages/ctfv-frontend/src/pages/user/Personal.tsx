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
import { useParams } from "react-router-dom";

type SolvedChallenge = {
  challengeId: string;
  challengeName: string;
  points: number;
  solvedTime: string;
};

type UserData = {
  rank: number;
  username: string;
  email: string;
  totalPoints: number;
  solvedChallenges: SolvedChallenge[];
};

const Personal: React.FC = () => {
  const { userId } = useParams<{ userId: string }>();
  const [userData, setUserData] = useState<UserData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchUserData = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch(
          getBackendURL() + `/api/challenges/personal/${userId}`,
          {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${localStorage.getItem("token")}`,
            },
          },
        );
        if (!response.ok) {
          throw new Error("Failed to fetch user data");
        }

        const data = await response.json();
        setUserData(data);
      } catch (err) {
        console.error("Error fetching user data:", err);
        setError(
          "An error occurred while fetching user data. Please try again later.",
        );
      } finally {
        setIsLoading(false);
      }
    };

    fetchUserData();
  }, [userId]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">Loading user data...</span>
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
      {userData ? (
        <>
          <div className="mb-8 flex flex-col items-center text-muted-foreground">
            <h1 className="mb-2 text-4xl font-bold">{userData.username}</h1>
            <h2 className="mb-2 text-xl">Rank: {userData.rank}</h2>
            {userData.email && (
              <h2 className="mb-4 text-xl">Email: {userData.email}</h2>
            )}
            <h2 className="mb-4 text-xl">
              Total Points: {userData.totalPoints}
            </h2>
          </div>

          <h2 className="mb-4 text-xl font-semibold text-muted-foreground">
            Solves
          </h2>
          {userData.solvedChallenges.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Challenge Name</TableHead>
                  <TableHead>Points</TableHead>
                  <TableHead>Solved At</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {userData.solvedChallenges.map((challenge) => (
                  <TableRow
                    key={challenge.challengeId}
                    className="text-muted-foreground"
                  >
                    <TableCell>{challenge.challengeName}</TableCell>
                    <TableCell>{challenge.points}</TableCell>
                    <TableCell>
                      {new Date(challenge.solvedTime).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-center text-muted-foreground dark:text-muted-foreground">
              No solved challenges yet.
            </p>
          )}
        </>
      ) : (
        <p className="text-center text-muted-foreground dark:text-muted-foreground">
          User not found.
        </p>
      )}
    </div>
  );
};

export default Personal;

