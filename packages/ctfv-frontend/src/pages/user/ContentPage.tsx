import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getBackendURL } from "@/lib/utils";
export const ContentPage: React.FC = () => {
  const { slug } = useParams(); const [page, setPage] = useState<{ title: string; body: string } | null>(null); const [error, setError] = useState("");
  useEffect(() => { fetch(`${getBackendURL()}/api/content/pages/${slug}`).then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); setPage(d.page); }).catch((e) => setError(e.message)); }, [slug]);
  return <main className="prose mx-auto max-w-4xl p-6 dark:prose-invert">{error ? <p>{error}</p> : page ? <><h1>{page.title}</h1><Markdown remarkPlugins={[remarkGfm]}>{page.body}</Markdown></> : <p>Loading pageâ€¦</p>}</main>;
};

