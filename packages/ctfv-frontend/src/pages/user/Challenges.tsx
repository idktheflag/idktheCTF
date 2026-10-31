import { useAuth } from "@/AuthContext";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getBackendURL } from "@/lib/utils";
import { ChallengeFormDialog } from "@/pages/admin/ChallengeFormDialog";
import { Loader2, Trash2 } from "lucide-react";
import React, { useEffect, useState } from "react";
import Markdown from "react-markdown";
import { Link } from "react-router-dom";
import remarkGfm from "remark-gfm";

type Challenge = {
  id: string;
  name: string;
  description: string;
  url: string;
  points: number;
  author: string;
  date: string;
  flag: string | null;
  solved: boolean;
  tags?: string[];
  hints?: { id: string; body?: string; cost: number }[];
  maxAttempts?: number | null;
  isVisible?: boolean;
};

type CategoryChallenges = {
  category: string;
  challenges: Challenge[];
};

type Submission = {
  userId: string;
  username: string;
  timestamp: string;
  challengeName: string;
  challengeDescription: string;
  isCorrect: boolean;
};

const LoadingSpinner: React.FC<{ message: string }> = ({ message }) => (
  <div className="flex h-screen items-center justify-center">
    <Loader2 className="h-8 w-8 animate-spin" />
    <span className="ml-2">Loading {message}...</span>
  </div>
);

const ErrorAlert: React.FC<{ message: string }> = ({ message }) => (
  <Alert variant="destructive" className="m-4">
    <AlertTitle>Error</AlertTitle>
    <AlertDescription>{message}</AlertDescription>
  </Alert>
);

const ChallengeCard: React.FC<{
  challenge: Challenge;
  onClick: () => void;
}> = ({ challenge, onClick }) => (
  <Card
    className={`cursor-pointer border-none text-center shadow-custom transition-shadow duration-300 hover:shadow-hover-custom dark:hover:shadow-dark-hover ${
      challenge.solved ? "bg-green-400 dark:bg-green-600" : "bg-card"
    }`}
    onClick={onClick}
  >
    <CardHeader>
      <CardTitle>{challenge.name}</CardTitle>
      <p className="text-sm">{challenge.date}</p>
    </CardHeader>
    <CardContent>
      <p>{challenge.points} points</p>
    </CardContent>
  </Card>
);

const ChallengeDetails: React.FC<{
  challenge: Challenge;
  isAdmin: boolean;
  onDelete: () => Promise<void>;
  onEdit: () => void;
  isDeleting: boolean;
}> = ({ challenge, isAdmin, onDelete, onEdit, isDeleting }) => (
  <>
    <Markdown remarkPlugins={[remarkGfm]} className="mb-2 text-lg">
      {challenge.description}
    </Markdown>
    <p>
      <strong>Challenge Link:</strong>{" "}
      <a href={challenge.url} target="_blank" rel="noreferrer">
        {challenge.url}
      </a>
    </p>
    {isAdmin && (
      <>
        <p>
          <strong>Flag:</strong> {challenge.flag}
        </p>
        <div className="my-4 flex space-x-2">
          <Button onClick={onEdit}>Edit challenge</Button>
          <Button
            variant="destructive"
            onClick={onDelete}
            disabled={isDeleting}
          >
            {isDeleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            Delete
          </Button>
        </div>
      </>
    )}
  </>
);

const ChallengeExtras: React.FC<{ challengeId: string }> = ({ challengeId }) => {
  const [hints, setHints] = useState<{ id: string; cost: number; body: string | null; unlocked: boolean }[]>([]);
  const [files, setFiles] = useState<{ id: string; filename: string; size: number }[]>([]);
  const [error, setError] = useState("");
  const token = localStorage.getItem("token");
  useEffect(() => {
    const headers = { Authorization: `Bearer ${token}` };
    void fetch(getBackendURL() + `/api/challenges/${challengeId}/hints`, { headers }).then((r) => r.json()).then((d) => setHints(d.hints || []));
    void fetch(getBackendURL() + `/api/attachments/challenge/${challengeId}`, { headers }).then((r) => r.json()).then((d) => setFiles(d.attachments || []));
  }, [challengeId, token]);
  const unlock = async (id: string) => {
    const r = await fetch(getBackendURL() + `/api/challenges/hints/${id}/unlock`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    const d = await r.json();
    if (!r.ok) { setError(d.error || "Hint could not be unlocked"); return; }
    setHints((old) => old.map((hint) => hint.id === id ? { ...hint, body: d.hint.body, unlocked: true } : hint));
  };
  const download = async (id: string, filename: string) => {
    const r = await fetch(getBackendURL() + `/api/attachments/${id}/download`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) { setError("File download failed"); return; }
    const href = URL.createObjectURL(await r.blob()); const a = document.createElement("a"); a.href = href; a.download = filename; a.click(); URL.revokeObjectURL(href);
  };
  return <section className="mt-5 grid gap-4 border-t pt-4"><h3 className="font-semibold">Hints</h3>{hints.map((hint) => <div key={hint.id} className="rounded bg-secondary p-3 bg-card">{hint.body ? <p>{hint.body}</p> : <button className="text-primary underline" onClick={() => void unlock(hint.id)}>Unlock hint Â· {hint.cost} points</button>}</div>)}<h3 className="font-semibold">Files</h3>{files.map((file) => <button key={file.id} onClick={() => void download(file.id, file.filename)} className="text-left text-primary underline">{file.filename} Â· {(file.size / 1024).toFixed(0)} KB</button>)}{error && <p role="alert" className="text-sm text-red-600">{error}</p>}</section>;
};

const FlagSubmission: React.FC<{
  flagInput: string;
  setFlagInput: (value: string) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  submissionStatus: string | null;
}> = ({
  flagInput,
  setFlagInput,
  onSubmit,
  isSubmitting,
  submissionStatus,
}) => (
  <div className="my-4">
    <Input
      value={flagInput}
      onChange={(e) => setFlagInput(e.target.value)}
      placeholder="Enter flag"
    />
    <Button
      className="mt-2 w-full"
      onClick={onSubmit}
      disabled={isSubmitting || !flagInput}
    >
      {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit"}
    </Button>
    {submissionStatus === "correct" && (
      <p className="mt-2 text-green-500">Correct flag! ðŸŽ‰</p>
    )}
    {submissionStatus === "incorrect" && (
      <p className="mt-2 text-red-500">Incorrect flag. Try again.</p>
    )}
    {submissionStatus === "error" && (
      <p className="mt-2 text-red-500">
        Error submitting flag. Please try again.
      </p>
    )}
  </div>
);

const SubmissionsTable: React.FC<{ submissions: Submission[] }> = ({
  submissions,
}) => (
  <div className="max-h-96 overflow-auto">
    {submissions.length === 0 ? (
      <p>No submissions found.</p>
    ) : (
      <table className="min-w-full text-center">
        <thead className="sticky top-0 bg-card bg-card">
          <tr>
            <th className="border px-4 py-2">Username</th>
            <th className="border px-4 py-2">Timestamp</th>
          </tr>
        </thead>
        <tbody>
          {submissions.map((submission, index) => (
            <tr key={index}>
              <td className="border px-4 py-2 text-primary hover:underline dark:text-primary">
                <Link to={`/personal/${submission.userId}`}>
                  {submission.username}
                </Link>
              </td>
              <td className="border px-4 py-2">
                {new Date(submission.timestamp).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </div>
);

export const Challenges: React.FC = () => {
  const [categories, setCategories] = useState<CategoryChallenges[]>([]);
  const [selectedChallenge, setSelectedChallenge] = useState<Challenge | null>(
    null,
  );
  const [flagInput, setFlagInput] = useState("");
  const [submissionStatus, setSubmissionStatus] = useState<string | null>(null);
  const { user, deleteChallenge } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [editChallengeId, setEditChallengeId] = useState<string | null>(null);
  const [challengeQuery, setChallengeQuery] = useState("");
  const [challengeOrder, setChallengeOrder] = useState("default");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [visibilityFilter, setVisibilityFilter] = useState("");

  const visibleCategories = categories
    .filter((category) => !categoryFilter || category.category === categoryFilter)
    .map((category) => ({
      ...category,
      challenges: category.challenges
        .filter((challenge) => !user?.isAdmin || !visibilityFilter || String(challenge.isVisible !== false) === visibilityFilter)
        .filter((challenge) => `${challenge.name} ${category.category} ${challenge.tags?.join(" ") || ""}`.toLowerCase().includes(challengeQuery.toLowerCase()))
        .sort((a, b) => challengeOrder === "name" ? a.name.localeCompare(b.name) : challengeOrder === "points" ? a.points - b.points : 0),
    }))
    .filter((category) => category.challenges.length > 0);

  useEffect(() => {
    fetchChallenges();
  }, []);

  const fetchChallenges = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(getBackendURL() + "/api/challenges/read", {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });
      if (response.ok) {
        const data = await response.json();
        setCategories(data.challenges);
      } else if (response.status === 401) {
        setError("To view challenges, please register first.");
      } else {
        setError("Failed to fetch challenges. Please try again later.");
      }
    } catch (error) {
      console.error("Error fetching challenges:", error);
      setError(
        "An error occurred while fetching challenges. Please try again later.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const openDialog = async (challenge: Challenge) => {
    setSelectedChallenge(challenge);
    setFlagInput("");
    setSubmissionStatus(null);
    await fetchSubmissions(challenge.id);
  };

  const fetchSubmissions = async (challengeId: string) => {
    try {
      const response = await fetch(
        getBackendURL() + `/api/submissions/readbychallengeid/${challengeId}`,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
        },
      );
      if (response.ok) {
        const data = await response.json();
        setSubmissions(
          data.filter((submission: Submission) => submission.isCorrect),
        );
      } else {
        console.error("Failed to fetch submissions");
      }
    } catch (error) {
      console.error("Error fetching submissions:", error);
    }
  };

  const handleFlagSubmission = async () => {
    if (
      !selectedChallenge ||
      !flagInput.trim() ||
      submissionStatus === "correct"
    )
      return;

    setIsSubmitting(true);
    setSubmissionStatus(null);

    try {
      const response = await fetch(
        getBackendURL() + `/api/challenges/submit/${selectedChallenge.id}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
          body: JSON.stringify({ flag: flagInput }),
        },
      );

      if (response.ok) {
        const data = await response.json();
        if (data.submission.isCorrect) {
          setSubmissionStatus("correct");
          updateChallengeStatus(selectedChallenge.id, true);
        } else {
          setSubmissionStatus("incorrect");
        }
      } else {
        setSubmissionStatus("error");
      }
    } catch (error) {
      console.error("Error submitting flag:", error);
      setSubmissionStatus("error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateChallengeStatus = (challengeId: string, solved: boolean) => {
    setCategories((prevCategories) =>
      prevCategories.map((category) => ({
        ...category,
        challenges: category.challenges.map((challenge) =>
          challenge.id === challengeId ? { ...challenge, solved } : challenge,
        ),
      })),
    );
  };

  const handleDeleteChallenge = async () => {
    if (!selectedChallenge) return;
    if (!window.confirm(`Delete “${selectedChallenge.name}”? This also removes its challenge data.`)) return;
    setIsDeleting(true);

    try {
      await deleteChallenge(selectedChallenge.id);
      setCategories((prevCategories) =>
        prevCategories.map((category) => ({
          ...category,
          challenges: category.challenges.filter(
            (challenge) => challenge.id !== selectedChallenge.id,
          ),
        })),
      );
      setSelectedChallenge(null);
    } catch (error) {
      console.error("Error deleting challenge:", error);
      setError("Failed to delete the challenge. Please try again.");
    } finally {
      setIsDeleting(false);
    }
  };

  if (isLoading) return <LoadingSpinner message="challenges" />;
  if (error) return <ErrorAlert message={error} />;

  return (
    <div className="p-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3"><div><p className="font-mono text-xs uppercase tracking-widest text-primary">idktheCTF</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">Challenges</h1><p className="mt-1 text-sm text-muted-foreground">Browse the event challenge board.</p></div>{user?.isAdmin && <Button onClick={() => setCreateOpen(true)}>Create challenge</Button>}</div>

      <div className="mb-6 grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_200px_180px_180px]"><Input aria-label="Search challenges" value={challengeQuery} onChange={(e) => setChallengeQuery(e.target.value)} placeholder="Search challenges or tags"/><select aria-label="Filter challenge category" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="h-10 rounded-md border border-border bg-card px-3 text-sm"><option value="">All categories</option>{categories.map((category) => <option key={category.category} value={category.category}>{category.category}</option>)}</select><select aria-label="Sort challenges" value={challengeOrder} onChange={(e) => setChallengeOrder(e.target.value)} className="h-10 rounded-md border border-border bg-card px-3 text-sm"><option value="default">Event order</option><option value="name">Name A–Z</option><option value="points">Points: low to high</option></select>{user?.isAdmin && <select aria-label="Filter challenge visibility" value={visibilityFilter} onChange={(e) => setVisibilityFilter(e.target.value)} className="h-10 rounded-md border border-border bg-card px-3 text-sm"><option value="">All visibility</option><option value="true">Visible</option><option value="false">Hidden</option></select>}</div>

      {visibleCategories.map((category) => (
        <div key={category.category} className="mb-8">
          <h2 className="mb-4 text-xl font-semibold text-foreground">
            {category.category}
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {category.challenges.map((challenge) => (
              <Dialog key={challenge.id}>
                <DialogTrigger asChild>
                  <ChallengeCard
                    challenge={challenge}
                    onClick={() => openDialog(challenge)}
                  />
                </DialogTrigger>

                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>
                      <h2 className="text-2xl font-semibold">
                        {selectedChallenge?.name}
                      </h2>
                    </DialogTitle>
                    <div className="flex space-x-4">
                      <p>
                        <strong>Points:</strong> {selectedChallenge?.points}
                      </p>
                      <p>
                        <strong>Author:</strong> {selectedChallenge?.author}
                      </p>
                    </div>
                  </DialogHeader>

                  <Tabs defaultValue="details">
                    <TabsList>
                      <TabsTrigger value="details">Details</TabsTrigger>
                      <TabsTrigger value="submissions">
                        Submissions ({submissions.length})
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="details">
                      {selectedChallenge && (
                        <>
                          <ChallengeDetails
                            challenge={selectedChallenge}
                            isAdmin={user?.isAdmin || false}
                            onDelete={handleDeleteChallenge}
                            onEdit={() => setEditChallengeId(selectedChallenge.id)}
                            isDeleting={isDeleting}
                          />
                          <p className="my-2 text-sm text-muted-foreground">{selectedChallenge.tags?.join(" Â· ")}</p>
                          <ChallengeExtras challengeId={selectedChallenge.id} />
                          {!user?.isAdmin && (
                            <FlagSubmission
                              flagInput={flagInput}
                              setFlagInput={setFlagInput}
                              onSubmit={handleFlagSubmission}
                              isSubmitting={isSubmitting}
                              submissionStatus={submissionStatus}
                            />
                          )}
                        </>
                      )}
                    </TabsContent>

                    <TabsContent value="submissions">
                      <SubmissionsTable submissions={submissions} />
                    </TabsContent>
                  </Tabs>
                </DialogContent>
              </Dialog>
            ))}
          </div>
        </div>
      ))}
      {visibleCategories.length === 0 && <p className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">No challenges match this search.</p>}
      {user?.isAdmin && <>
        <ChallengeFormDialog mode="create" open={createOpen} onOpenChange={setCreateOpen} onSaved={() => void fetchChallenges()} />
        <ChallengeFormDialog mode="edit" open={Boolean(editChallengeId)} challengeId={editChallengeId || undefined} onOpenChange={(open) => { if (!open) setEditChallengeId(null); }} onSaved={() => void fetchChallenges()} />
      </>}
    </div>
  );
};

