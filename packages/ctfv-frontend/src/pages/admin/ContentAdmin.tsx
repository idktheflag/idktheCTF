import React, { useEffect, useState } from "react";
import { getBackendURL } from "@/lib/utils";
type Content = { id: string; title: string; body: string; published: boolean; slug?: string };
export const ContentAdmin: React.FC = () => {
  const [title, setTitle] = useState(""); const [body, setBody] = useState(""); const [slug, setSlug] = useState("");
  const [announcements, setAnnouncements] = useState<Content[]>([]); const [pages, setPages] = useState<Content[]>([]);
  const [kind, setKind] = useState<"announcements" | "pages">("announcements"); const [editing, setEditing] = useState<string | null>(null); const [error, setError] = useState("");
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` };
  const load = async () => {
    const [a, p] = await Promise.all([fetch(`${getBackendURL()}/api/content/admin/announcements`, { headers }), fetch(`${getBackendURL()}/api/content/admin/pages`, { headers })]);
    const ad = await a.json(); const pd = await p.json(); if (!a.ok || !p.ok) throw new Error(ad.error || pd.error);
    setAnnouncements(ad.announcements); setPages(pd.pages);
  };
  useEffect(() => { void load().catch((e) => setError(e.message)); }, []);
  const startEdit = (type: "announcements" | "pages", item: Content) => { setKind(type); setEditing(item.id); setTitle(item.title); setBody(item.body); setSlug(item.slug || ""); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const clearForm = () => { setEditing(null); setTitle(""); setBody(""); setSlug(""); };
  const save = async () => {
    setError(""); const base = `${getBackendURL()}/api/content/admin/${kind}${editing ? `/${editing}` : ""}`;
    const response = await fetch(base, { method: editing ? "PUT" : "POST", headers, body: JSON.stringify({ title, body, slug: kind === "pages" ? slug : undefined, published: true }) });
    const data = await response.json(); if (!response.ok) { setError(data.error || "Could not save content"); return; }
    clearForm(); await load();
  };
  const remove = async (type: "announcements" | "pages", item: Content) => {
    if (!window.confirm(`Delete “${item.title}”? This cannot be undone.`)) return;
    const response = await fetch(`${getBackendURL()}/api/content/admin/${type}/${item.id}`, { method: "DELETE", headers }); const data = await response.json();
    if (!response.ok) { setError(data.error || "Could not delete content"); return; } await load();
  };
  const itemList = (type: "announcements" | "pages", items: Content[]) => <ul className="grid gap-3">{items.map((item) => <li key={item.id} className="rounded-lg border border-border bg-card p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><strong>{item.title}</strong><span className="ml-2 text-sm text-muted-foreground">{item.published ? "Published" : "Draft"}{item.slug ? ` Â· /pages/${item.slug}` : ""}</span></div><div className="flex gap-2"><button onClick={() => startEdit(type, item)} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent">Edit</button><button onClick={() => void remove(type, item)} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-destructive hover:bg-accent">Delete</button></div></div><p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{item.body}</p></li>)}</ul>;
  return <main className="mx-auto max-w-5xl space-y-5"><div><h1 className="text-2xl font-bold tracking-tight">Announcements and pages</h1><p className="mt-1 text-sm text-muted-foreground">Publish notices and reference pages for competitors.</p></div>{error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</p>}
    <section className="grid gap-3 rounded-lg border border-border bg-card p-5"><h2 className="text-base font-semibold">{editing ? "Edit content" : "Publish content"}</h2><div className="flex gap-2"><button onClick={() => { setKind("announcements"); clearForm(); }} className={`rounded-md px-3 py-1.5 text-sm font-medium ${kind === "announcements" ? "bg-primary text-primary-foreground" : "border border-border hover:bg-accent"}`}>Announcement</button><button onClick={() => { setKind("pages"); clearForm(); }} className={`rounded-md px-3 py-1.5 text-sm font-medium ${kind === "pages" ? "bg-primary text-primary-foreground" : "border border-border hover:bg-accent"}`}>Page</button></div>
      {kind === "pages" && <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="Page slug (lowercase-hyphenated)" className="rounded border p-2 bg-background" />}
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="rounded border p-2 bg-background" /><textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Markdown content" className="rounded border p-2 bg-background" />
      <div className="flex gap-3"><button onClick={() => void save()} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">{editing ? "Save changes" : `Publish ${kind === "pages" ? "page" : "announcement"}`}</button>{editing && <button onClick={clearForm} className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-accent">Cancel</button>}</div>
    </section><section className="space-y-3"><h2 className="text-base font-semibold">Announcements</h2>{announcements.length ? itemList("announcements", announcements) : <p className="rounded-md border border-dashed border-border px-5 py-6 text-sm text-muted-foreground">No announcements published yet.</p>}</section><section className="space-y-3"><h2 className="text-base font-semibold">Pages</h2>{pages.length ? itemList("pages", pages) : <p className="rounded-md border border-dashed border-border px-5 py-6 text-sm text-muted-foreground">No pages published yet.</p>}</section></main>;
};

