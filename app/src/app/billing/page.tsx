"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Coins, Loader2 } from "lucide-react";
import { db } from "@/lib/db";
import { Login } from "@/components/Login";
import { Button } from "@/components/ui/button";
import { PRODUCTS, type ProductKey } from "@/lib/products";

const REASON_LABEL: Record<string, string> = {
  grant: "Welcome grant",
  purchase: "Token pack",
  subscription: "Subscription",
  build: "Build",
};

export default function BillingPage() {
  const { isLoading, user } = db.useAuth();

  if (isLoading) return null;
  if (!user) return <Login />;

  return <Billing refreshToken={user.refresh_token} />;
}

function Billing({ refreshToken }: { refreshToken: string }) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: accountData } = db.useQuery({ accounts: {} });
  const { data: ledgerData } = db.useQuery({
    ledgerEntries: { $: { order: { createdAt: "desc" }, limit: 50 } },
  });

  const account = accountData?.accounts?.[0];
  const balance = account?.tokenBalance;
  const subscribed = account?.subscriptionStatus === "active";
  const ledger = ledgerData?.ledgerEntries ?? [];

  async function post(path: string, body?: object): Promise<string | null> {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", token: refreshToken },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? res.statusText);
    return data.url ?? null;
  }

  async function buy(key: ProductKey) {
    setError(null);
    setBusyKey(key);
    try {
      const url = await post("/api/checkout", { productKey: key });
      if (url) window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start checkout.");
      setBusyKey(null);
    }
  }

  async function manage() {
    setError(null);
    setBusyKey("portal");
    try {
      const url = await post("/api/portal");
      if (url) window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't open the billing portal.");
      setBusyKey(null);
    }
  }

  const packs = PRODUCTS.filter((p) => p.kind === "pack");
  const subscription = PRODUCTS.find((p) => p.kind === "subscription");

  return (
    <div className="min-h-screen flex-1 bg-muted/20">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to workspace
        </Link>

        <div className="mt-6 flex items-center justify-between rounded-xl border bg-card p-6 shadow-sm">
          <div>
            <p className="text-sm text-muted-foreground">Your balance</p>
            <div className="mt-1 flex items-center gap-2">
              <Coins className="size-6 text-amber-500" />
              <span className="text-3xl font-semibold tracking-tight">
                {balance ?? "—"}
              </span>
              <span className="text-sm text-muted-foreground">tokens</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Tokens are spent as you build. Each model call costs what it really
              costs to run.
            </p>
          </div>
          {subscribed && (
            <Button
              variant="outline"
              onClick={manage}
              disabled={busyKey === "portal"}
            >
              {busyKey === "portal" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                "Manage subscription"
              )}
            </Button>
          )}
        </div>

        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

        <h2 className="mt-10 text-sm font-semibold">Token packs</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          {packs.map((p) => (
            <div
              key={p.key}
              className="flex flex-col rounded-xl border bg-card p-5 shadow-sm"
            >
              <p className="font-medium">{p.name}</p>
              <p className="mt-1 text-2xl font-semibold">{p.price}</p>
              <p className="text-sm text-muted-foreground">
                {p.tokens.toLocaleString()} tokens
              </p>
              <p className="mt-2 flex-1 text-xs text-muted-foreground">{p.blurb}</p>
              <Button
                className="mt-4"
                onClick={() => buy(p.key)}
                disabled={!!busyKey}
              >
                {busyKey === p.key ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  "Buy"
                )}
              </Button>
            </div>
          ))}
        </div>

        {subscription && (
          <>
            <h2 className="mt-10 text-sm font-semibold">Subscription</h2>
            <div className="mt-3 flex items-center justify-between rounded-xl border bg-card p-5 shadow-sm">
              <div>
                <p className="font-medium">
                  {subscription.name} · {subscription.price}
                </p>
                <p className="text-sm text-muted-foreground">
                  {subscription.tokens.toLocaleString()} tokens topped up every
                  month.
                </p>
              </div>
              {subscribed ? (
                <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-700">
                  Active
                </span>
              ) : (
                <Button
                  onClick={() => buy(subscription.key)}
                  disabled={!!busyKey}
                >
                  {busyKey === subscription.key ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    "Subscribe"
                  )}
                </Button>
              )}
            </div>
          </>
        )}

        <h2 className="mt-10 text-sm font-semibold">History</h2>
        <div className="mt-3 overflow-hidden rounded-xl border bg-card shadow-sm">
          {ledger.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted-foreground">
              No activity yet.
            </p>
          ) : (
            ledger.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between border-b px-5 py-3 text-sm last:border-b-0"
              >
                <div>
                  <p className="font-medium">
                    {REASON_LABEL[entry.reason] ?? entry.reason}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(entry.createdAt).toLocaleString()}
                  </p>
                </div>
                <span
                  className={`font-mono ${
                    entry.delta >= 0 ? "text-green-700" : "text-muted-foreground"
                  }`}
                >
                  {entry.delta >= 0 ? "+" : ""}
                  {entry.delta}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
