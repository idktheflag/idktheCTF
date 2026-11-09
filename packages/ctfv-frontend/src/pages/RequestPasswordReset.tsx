import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function RequestPasswordReset() {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setLoading(true); setError("");
    try { setMessage(await requestPasswordReset(email)); }
    catch (e) { setError(e instanceof Error ? e.message : "Please try again."); }
    finally { setLoading(false); }
  };
  return <Card className="mx-auto mt-8 w-full max-w-md"><CardHeader><CardTitle>Reset your password</CardTitle><CardDescription>We’ll send a reset link if an account exists for that email.</CardDescription></CardHeader><CardContent>
    {message ? <div role="status" className="space-y-4"><p>{message}</p><p className="text-sm text-muted-foreground">Check your inbox and spam folder. The link expires after 30 minutes.</p><Link className="text-primary hover:underline" to="/login">Back to sign in</Link></div> : <form onSubmit={submit} className="space-y-4"><label className="grid gap-2 text-sm">Email<Input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} disabled={loading}/></label>{error && <p role="alert" className="text-sm text-red-600">{error}</p>}<Button className="w-full" disabled={loading}>{loading ? "Sending…" : "Send reset link"}</Button><Link className="block text-center text-sm text-primary hover:underline" to="/login">Back to sign in</Link></form>}
  </CardContent></Card>;
}
