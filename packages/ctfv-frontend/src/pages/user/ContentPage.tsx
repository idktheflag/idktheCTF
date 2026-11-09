import { apiFetch } from "@/lib/api";
import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getBackendURL } from "@/lib/utils";
export const ContentPage: React.FC = () => {
  const { slug } = useParams(); const [page, setPage] = useState<{ title: string; body: string } | null>(null); const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setPage(null); setError("");
    apiFetch(`${getBackendURL()}/api/content/pages/${slug}`, { signal: controller.signal })
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not load page"); if (!controller.signal.aborted) setPage(data.page); })
      .catch((error) => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not load page"); });
    return () => controller.abort();
  }, [slug]);
  return <main className="prose mx-auto max-w-4xl p-6 dark:prose-invert">{error ? <p>{error}</p> : page ? <><h1>{page.title}</h1><Markdown remarkPlugins={[remarkGfm]}>{page.body}</Markdown></> : <p>Loading page…</p>}</main>;
};

