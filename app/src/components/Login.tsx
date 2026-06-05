"use client";

import { useState } from "react";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function Login() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await db.auth.sendMagicCode({ email });
      setSentTo(email);
    } catch (err) {
      setError(errMessage(err) ?? "Couldn't send a code to that email.");
    } finally {
      setPending(false);
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    if (!sentTo) return;
    setError(null);
    setPending(true);
    try {
      await db.auth.signInWithMagicCode({ email: sentTo, code });
      // On success, db.useAuth() updates and the app swaps in automatically.
    } catch (err) {
      setError(errMessage(err) ?? "That code wasn't right. Try again.");
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-1 items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm rounded-xl border bg-card p-8 shadow-sm">
        <div className="mb-6 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Radix</h1>
          <p className="text-sm text-muted-foreground">
            {sentTo
              ? `Enter the code we emailed to ${sentTo}.`
              : "Sign in with a magic code sent to your email."}
          </p>
        </div>

        {!sentTo ? (
          <form onSubmit={sendCode} className="space-y-4">
            <Input
              type="email"
              required
              autoFocus
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Button type="submit" className="w-full" disabled={pending || !email}>
              {pending ? "Sending…" : "Send code"}
            </Button>
          </form>
        ) : (
          <form onSubmit={verifyCode} className="space-y-4">
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              autoFocus
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <Button type="submit" className="w-full" disabled={pending || !code}>
              {pending ? "Verifying…" : "Verify & sign in"}
            </Button>
            <button
              type="button"
              className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
              onClick={() => {
                setSentTo(null);
                setCode("");
                setError(null);
              }}
            >
              Use a different email
            </button>
          </form>
        )}

        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
      </div>
    </div>
  );
}

function errMessage(err: unknown): string | undefined {
  if (
    err &&
    typeof err === "object" &&
    "body" in err &&
    err.body &&
    typeof err.body === "object" &&
    "message" in err.body &&
    typeof err.body.message === "string"
  ) {
    return err.body.message;
  }
  return undefined;
}
