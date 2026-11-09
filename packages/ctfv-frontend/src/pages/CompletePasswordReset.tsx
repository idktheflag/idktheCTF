import React, { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "@/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function CompletePasswordReset() {
  const [params] = useSearchParams(); const { completePasswordReset } = useAuth();
  const [password, setPassword] = useState(""); const [message, setMessage] = useState(""); const [error, setError] = useState(""); const [loading, setLoading] = useState(false);
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setLoading(true); setError(""); try { setMessage(await completePasswordReset(params.get("token") || "", password)); } catch (e) { setError(e instanceof Error ? e.message : "The link may have expired."); } finally { setLoading(false); } };
  return <Card className="mx-auto mt-8 w-full max-w-md"><CardHeader><CardTitle>Choose a new password</CardTitle><CardDescription>Use at least 12 characters. Reset links expire after 30 minutes.</CardDescription></CardHeader><CardContent>{message ? <div role="status" className="space-y-4"><p>{message}</p><Link className="text-primary hover:underline" to="/login">Sign in</Link></div> : <form onSubmit={submit} className="space-y-4"><label className="grid gap-2 text-sm">New password<Input type="password" autoComplete="new-password" minLength={12} required value={password} onChange={e => setPassword(e.target.value)} disabled={loading}/></label>{error && <p role="alert" className="text-sm text-red-600">{error}</p>}<Button className="w-full" disabled={loading || !params.get("token")}>{loading ? "Updating…" : "Update password"}</Button>{!params.get("token") && <p role="alert" className="text-sm text-red-600">This reset link is missing its token. Request another link.</p>}<Link className="block text-center text-sm text-primary hover:underline" to="/reset-password">Request another link</Link></form>}</CardContent></Card>;
}
