import { apiFetch } from "@/lib/api";
import { useAuth } from "@/auth-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getBackendURL } from "@/lib/utils";
import React, { useCallback, useEffect, useRef, useState } from "react";

type Mode = "create" | "edit";
type Attachment = { id: string; filename: string; size: number };
type ServerPart = { partNumber: number; etag: string; size: number };
type UploadSession = { uploadId: string; attachmentId: string; filename: string; size: number; partSize: number; totalParts: number; expiresAt: string; parts: ServerPart[] };
type UploadItem = { key: string; file: File | null; name: string; size: number; fingerprint: string; session: UploadSession | null; status: "queued" | "uploading" | "complete" | "error" | "needs-file"; error?: string };
type HintRow = { key: string; id: string | null; body: string; cost: string };
type FormValues = { name: string; category: string; description: string; url: string; points: string; author: string; date: string; flags: string; hints: HintRow[]; tags: string; maxAttempts: string; isVisible: boolean };

const emptyForm: FormValues = { name: "", category: "", description: "", url: "", points: "100", author: "", date: "", flags: "", hints: [], tags: "", maxAttempts: "", isVisible: true };
const tokenHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem("token")}` });
const formatSize = (size: number) => size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;
const fileFingerprint = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;
const storageKey = (challengeId: string) => `idkthectf:uploads:${challengeId}`;

export const ChallengeFormDialog: React.FC<{
  mode: Mode;
  open: boolean;
  challengeId?: string;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}> = ({ mode, open, challengeId, onOpenChange, onSaved }) => {
  const { user, createChallenge, getChallenges, updateChallenge } = useAuth();
  const getChallengesRef = useRef(getChallenges);
  getChallengesRef.current = getChallenges;
  const [values, setValues] = useState<FormValues>({ ...emptyForm });
  const [currentChallengeId, setCurrentChallengeId] = useState<string | null>(challengeId || null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploads, setUploadState] = useState<UploadItem[]>([]);
  const uploadsRef = useRef<UploadItem[]>([]);
  const activeUploads = useRef(new Set<string>());
  const setUploads = useCallback((change: React.SetStateAction<UploadItem[]>) => {
    const next = typeof change === "function" ? change(uploadsRef.current) : change;
    uploadsRef.current = next;
    setUploadState(next);
  }, []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const updateValues = (key: keyof FormValues, value: string | boolean) => setValues((old) => ({ ...old, [key]: value }));
  const updateHint = (key: string, change: Partial<Pick<HintRow, "body" | "cost">>) => setValues((old) => ({ ...old, hints: old.hints.map((hint) => hint.key === key ? { ...hint, ...change } : hint) }));
  const updateUpload = (key: string, change: Partial<UploadItem>) => setUploads((old) => old.map((item) => item.key === key ? { ...item, ...change } : item));

  useEffect(() => {
    if (!open) return;
    let live = true;
    setError("");
    setSaving(false);
    setCurrentChallengeId(challengeId || null);
    setUploads([]);
    if (mode === "create") {
      setValues({ ...emptyForm, author: user?.username || "idktheCTF" });
      setAttachments([]);
      return () => { live = false; };
    }
    const load = async () => {
      try {
        const id = challengeId;
        if (!id) throw new Error("Challenge not found");
        const grouped = await getChallengesRef.current();
        const challenge = grouped.flatMap((group) => group.challenges).find((item) => item.id === id);
        if (!challenge) throw new Error("Challenge not found");
        if (live) setValues({
          name: challenge.name, category: challenge.category, description: challenge.description, url: challenge.url,
          points: String(challenge.points), author: challenge.author, date: challenge.date || "",
          flags: challenge.flags?.map((flag) => flag.type === "regex" ? `regex:${flag.value}` : flag.value).join("\n") || challenge.flag || "",
          hints: challenge.hints?.map((hint) => ({ key: crypto.randomUUID(), id: hint.id ?? null, cost: String(hint.cost), body: hint.body || "" })) || [],
          tags: challenge.tags?.join(", ") || "", maxAttempts: challenge.maxAttempts ? String(challenge.maxAttempts) : "", isVisible: challenge.isVisible !== false,
        });
        const response = await apiFetch(`${getBackendURL()}/api/attachments/challenge/${id}`, { headers: tokenHeaders() });
        const data = await response.json();
        if (live && response.ok) setAttachments(data.attachments || []);
        const saved = JSON.parse(localStorage.getItem(storageKey(id)) || "[]") as { uploadId: string; name: string; size: number; fingerprint: string }[];
        const pending: UploadItem[] = [];
        for (const item of saved) {
          const sessionResponse = await apiFetch(`${getBackendURL()}/api/attachments/multipart/${item.uploadId}`, { headers: tokenHeaders() });
          const sessionData = await sessionResponse.json();
          if (!sessionResponse.ok) continue;
          pending.push({ key: item.uploadId, file: null, name: item.name, size: item.size, fingerprint: item.fingerprint, session: sessionData, status: "needs-file" });
        }
        if (live) setUploads(pending);
      } catch (caught) {
        if (live) setError((caught as Error).message);
      }
    };
    void load();
    return () => { live = false; };
  }, [open, mode, challengeId, user?.username, setUploads]);

  const persistSessions = (targetId: string, items: UploadItem[]) => {
    const saved = items.filter((item) => item.session && item.status !== "complete").map((item) => ({ uploadId: item.session!.uploadId, name: item.name, size: item.size, fingerprint: item.fingerprint }));
    localStorage.setItem(storageKey(targetId), JSON.stringify(saved));
  };

  const uploadFile = async (item: UploadItem, targetId: string) => {
    if (activeUploads.current.has(item.key)) throw new Error("This file is already uploading.");
    if (!item.file) { updateUpload(item.key, { status: "needs-file", error: "Select this same file again to resume its upload." }); throw new Error("Select the original file before saving."); }
    if (item.fingerprint !== fileFingerprint(item.file)) { updateUpload(item.key, { status: "error", error: "Choose the original file to resume this upload." }); throw new Error("Choose the original file to resume this upload."); }
    activeUploads.current.add(item.key);
    updateUpload(item.key, { status: "uploading", error: undefined });
    try {
      let session: UploadSession;
      if (item.session) {
        session = item.session;
      } else {
        const response = await apiFetch(`${getBackendURL()}/api/attachments/multipart`, {
          method: "POST", headers: { ...tokenHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ challengeId: targetId, filename: item.name, contentType: item.file.type || "application/octet-stream", size: item.size }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not start this upload");
        session = { ...data, parts: [] } as UploadSession;
        updateUpload(item.key, { session });
        persistSessions(targetId, uploadsRef.current);
      }
      const completed = new Set(session.parts.map((part) => part.partNumber));
      for (let partNumber = 1; partNumber <= session.totalParts; partNumber += 1) {
        if (completed.has(partNumber)) continue;
        const start = (partNumber - 1) * session.partSize;
        const partBody = await item.file.slice(start, Math.min(item.size, start + session.partSize)).arrayBuffer();
        const response = await apiFetch(`${getBackendURL()}/api/attachments/multipart/${session.uploadId}/parts/${partNumber}`, { method: "PUT", headers: tokenHeaders(), body: partBody });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `Part ${partNumber} failed`);
        session.parts = [...session.parts.filter((part) => part.partNumber !== partNumber), data].sort((a, b) => a.partNumber - b.partNumber);
        updateUpload(item.key, { session });
        persistSessions(targetId, uploadsRef.current);
      }
      const response = await apiFetch(`${getBackendURL()}/api/attachments/multipart/${session.uploadId}/complete`, { method: "POST", headers: tokenHeaders() });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not complete this upload");
      setAttachments((old) => [...old, data.attachment]);
      updateUpload(item.key, { status: "complete", session: null, error: undefined });
      persistSessions(targetId, uploadsRef.current);
    } catch (caught) {
      updateUpload(item.key, { status: "error", error: (caught as Error).message });
      throw caught;
    } finally {
      activeUploads.current.delete(item.key);
    }
  };

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList) return;
    const picked = Array.from(fileList);
    setUploads((old) => {
      const next = [...old];
      for (const file of picked) {
        const fingerprint = fileFingerprint(file);
        const existing = next.findIndex((item) => item.name === file.name && item.size === file.size && (item.status === "needs-file" || item.status === "error"));
        if (existing >= 0) { next[existing] = { ...next[existing], file, status: "queued", error: undefined }; }
        else next.push({ key: crypto.randomUUID(), file, name: file.name, size: file.size, fingerprint, session: null, status: "queued" });
      }
      return next;
    });
  };

  const removeUpload = async (item: UploadItem, targetId?: string) => {
    if (activeUploads.current.has(item.key)) throw new Error("Wait for this upload to finish before cancelling.");
    if (item.session) {
      const response = await apiFetch(`${getBackendURL()}/api/attachments/multipart/${item.session.uploadId}`, { method: "DELETE", headers: tokenHeaders() });
      if (!response.ok) throw new Error("Could not cancel the upload. Try again.");
    }
    setUploads((old) => old.filter((upload) => upload.key !== item.key));
    if (targetId) persistSessions(targetId, uploadsRef.current);
  };

  const removeAttachment = async (attachment: Attachment) => {
    const response = await apiFetch(`${getBackendURL()}/api/attachments/${attachment.id}`, { method: "DELETE", headers: tokenHeaders() });
    if (!response.ok) { const data = await response.json(); throw new Error(data.error || "Could not remove the file"); }
    setAttachments((old) => old.filter((item) => item.id !== attachment.id));
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      const flags = values.flags.split("\n").map((value) => value.trim()).filter(Boolean).map((line) => line.startsWith("regex:") ? { value: line.slice(6), type: "regex" as const } : { value: line, type: "static" as const });
      if (values.hints.some((hint) => !hint.body.trim())) throw new Error("Enter hint text or remove the unused hint row.");
      if (values.hints.some((hint) => !hint.cost.trim())) throw new Error("Enter an integer point cost for each hint.");
      const hints = values.hints.map((hint) => ({ id: hint.id, cost: Number(hint.cost), body: hint.body.trim() }));
      if (hints.length > 30 || hints.some((hint) => !Number.isInteger(hint.cost) || hint.cost < 0 || hint.cost > Number(values.points))) throw new Error("Hints need an integer cost between zero and the challenge points.");
      const tags = values.tags.split(",").map((tag) => tag.trim()).filter(Boolean);
      const payload = { name: values.name.trim(), category: values.category.trim(), description: values.description, url: values.url, points: Number(values.points), author: values.author.trim(), date: values.date || "", flag: flags[0]?.value || "", flags, hints, tags, maxAttempts: values.maxAttempts ? Number(values.maxAttempts) : null, isVisible: values.isVisible };
      let targetId = currentChallengeId;
      if (targetId) await updateChallenge(targetId, payload);
      else {
        const created = await createChallenge(payload);
        targetId = created.id;
        setCurrentChallengeId(targetId);
      }
      onSaved();
      const incomplete = uploadsRef.current.filter((item) => item.status !== "complete");
      for (const item of incomplete) await uploadFile(item, targetId);
      const hasUnattached = uploadsRef.current.some((item) => item.status !== "complete");
      if (hasUnattached) { setSaving(false); return; }
      setSaving(false);
      onOpenChange(false);
    } catch (caught) {
      setError((caught as Error).message);
      setSaving(false);
    }
  };

  const field = (key: keyof FormValues) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => updateValues(key, event.target.value);

  return <Dialog open={open} onOpenChange={(next) => { if (!saving && activeUploads.current.size === 0) onOpenChange(next); }}>
    <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto border-border bg-card text-foreground sm:p-7">
      <DialogHeader>
        <DialogTitle>{currentChallengeId ? "Edit challenge" : "Create challenge"}</DialogTitle>
        <DialogDescription>Configure challenge details, accepted flags, hints, and files.</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm">Challenge name<Input required maxLength={120} value={values.name} onChange={field("name")} /></label>
        <label className="grid gap-1.5 text-sm">Category<Input required maxLength={60} value={values.category} onChange={field("category")} placeholder="Web, crypto, forensics…" /></label>
        <label className="grid gap-1.5 text-sm sm:col-span-2">Description (Markdown supported)<Textarea required rows={6} value={values.description} onChange={field("description")} /></label>
        <label className="grid gap-1.5 text-sm">Connection details or URL<Input value={values.url} onChange={field("url")} /></label>
        <label className="grid gap-1.5 text-sm">Points<Input required type="number" min="1" max="100000" value={values.points} onChange={field("points")} /></label>
        <label className="grid gap-1.5 text-sm">Author<Input required maxLength={80} value={values.author} onChange={field("author")} /></label>
        <label className="grid gap-1.5 text-sm">Release note / date<Input value={values.date} onChange={field("date")} /></label>
        <label className="grid gap-1.5 text-sm sm:col-span-2">Maximum attempts (blank is unlimited)<Input type="number" min="1" value={values.maxAttempts} onChange={field("maxAttempts")} /></label>
        <label className="grid gap-1.5 text-sm sm:col-span-2">Accepted flags (one per line; prefix regex flags with <code>regex:</code>)<Textarea required rows={4} value={values.flags} onChange={field("flags")} placeholder="flag{example}\nregex:^flag\\{[a-z0-9]+\\}$" /></label>
        <fieldset disabled={saving} className="grid gap-3 rounded-lg border border-border bg-background p-4 sm:col-span-2">
          <legend className="px-1 text-sm font-semibold">Hints</legend>
          {values.hints.map((hint, index) => <div key={hint.key} className="grid gap-2 rounded-md border border-border p-3">
            <label className="grid gap-1.5 text-sm">Hint {index + 1} text<Textarea required rows={2} maxLength={10000} value={hint.body} onChange={(event) => updateHint(hint.key, { body: event.target.value })} /></label>
            <div className="flex items-end gap-3">
              <label className="grid flex-1 gap-1.5 text-sm">Hint {index + 1} point cost<Input required type="number" min="0" max={values.points} step="1" value={hint.cost} onChange={(event) => updateHint(hint.key, { cost: event.target.value })} /></label>
              <Button type="button" variant="ghost" aria-label={`Remove hint ${index + 1}`} onClick={() => setValues((old) => ({ ...old, hints: old.hints.filter((row) => row.key !== hint.key) }))}>Remove</Button>
            </div>
          </div>)}
          <Button type="button" variant="outline" disabled={saving || values.hints.length >= 30} onClick={() => setValues((old) => old.hints.length >= 30 ? old : ({ ...old, hints: [...old.hints, { key: crypto.randomUUID(), id: null, body: "", cost: "0" }] }))}>Add hint</Button>
        </fieldset>
        <label className="grid gap-1.5 text-sm sm:col-span-2">Tags<Input value={values.tags} onChange={field("tags")} placeholder="web, linux, beginner" /></label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={values.isVisible} onChange={(event) => updateValues("isVisible", event.target.checked)} />Visible to teams</label>
        <div className="grid gap-3 rounded-lg border border-border bg-background p-4 sm:col-span-2">
          <div><h3 className="text-sm font-semibold">Challenge files</h3><p className="mt-1 text-xs text-muted-foreground">Uploads resume in chunks. Cloudflare account request limits apply.</p></div>
          {attachments.map((attachment) => <div key={attachment.id} className="flex items-center justify-between gap-3 border-b border-border pb-2 text-sm"><span className="min-w-0 truncate">{attachment.filename} <span className="text-muted-foreground">· {formatSize(attachment.size)}</span></span><button type="button" className="text-xs text-muted-foreground hover:text-destructive" onClick={() => void removeAttachment(attachment).catch((caught) => setError((caught as Error).message))}>Remove</button></div>)}
          <input multiple disabled={saving} type="file" onChange={(event) => handleFiles(event.target.files)} className="text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-secondary file:px-3 file:py-2 file:text-foreground" />
          {uploads.map((item) => <div key={item.key} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"><span className="min-w-0"><span className="block truncate">{item.name} <span className="text-muted-foreground">· {formatSize(item.size)}</span></span><span className="text-xs text-muted-foreground">{item.status === "uploading" ? `Uploaded ${item.session?.parts.length || 0} / ${item.session?.totalParts || "…"} parts` : item.status === "complete" ? "Uploaded" : item.status === "needs-file" ? "Resumable · select the same file to continue" : item.status === "error" ? item.error : "Ready to upload when saved"}</span></span><div className="flex gap-2">{item.file && item.status !== "complete" && item.status !== "uploading" && !saving && <Button type="button" size="sm" variant="outline" onClick={() => { if (currentChallengeId) { setSaving(true); void uploadFile(item, currentChallengeId).catch((caught) => setError((caught as Error).message)).finally(() => setSaving(false)); } }}>Retry</Button>}<Button type="button" size="sm" variant="ghost" disabled={saving || item.status === "uploading"} onClick={() => void removeUpload(item, currentChallengeId || undefined).catch((caught) => setError((caught as Error).message))}>Cancel</Button></div></div>)}
        </div>
        {error && <p role="alert" className="rounded-md border border-destructive/30 px-3 py-2 text-sm text-destructive sm:col-span-2">{error}</p>}
        <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? "Saving and uploading…" : currentChallengeId ? "Save challenge" : "Create challenge"}</Button></div>
      </form>
    </DialogContent>
  </Dialog>;
};
