"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import type { User } from "@instantdb/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Loader2, X, Coins, Sparkles } from "lucide-react";

/**
 * Right-hand chat panel for editing the selected project. Each user message is
 * sent to the edit agent with the running transcript; when the agent rewrites
 * the app, `onEdited` is called so the shell can refresh the preview. Like the
 * build flow, calls are metered — a 402 renders a "buy tokens" card.
 */
type ChatEntry =
  | { kind: "text"; role: "user" | "assistant"; content: string }
  | { kind: "paywall" };

interface EditProjectChatProps {
  projectId: string;
  projectName: string;
  user: User;
  onEdited: () => void;
  onClose: () => void;
}

function apiHeaders(user: User): HeadersInit {
  return {
    "Content-Type": "application/json",
    token: user.refresh_token,
  };
}

const INITIAL_MESSAGE: ChatEntry = {
  kind: "text",
  role: "assistant",
  content:
    "What would you like to change? Describe it in plain language — e.g. \"add a dark header\", \"let me delete tasks\", or \"seed it with more sample data\".",
};

export function EditProjectChat({
  projectId,
  projectName,
  user,
  onEdited,
  onClose,
}: EditProjectChatProps) {
  const [entries, setEntries] = useState<ChatEntry[]>([INITIAL_MESSAGE]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // Restart the transcript when the user switches to a different project.
  useEffect(() => {
    setEntries([INITIAL_MESSAGE]);
    setInput("");
  }, [projectId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries, sending]);

  /** Maps the local transcript into the wire format the route expects. */
  function toWire(items: ChatEntry[]) {
    return items
      .filter((e): e is Extract<ChatEntry, { kind: "text" }> => e.kind === "text")
      .map((e) => ({ role: e.role, content: e.content }));
  }

  async function send() {
    const content = input.trim();
    if (!content || sending) return;
    setInput("");

    const next: ChatEntry[] = [
      ...entries,
      { kind: "text", role: "user", content },
    ];
    setEntries(next);
    setSending(true);

    try {
      const res = await fetch("/api/edit-project", {
        method: "POST",
        headers: apiHeaders(user),
        body: JSON.stringify({ projectId, messages: toWire(next) }),
      });

      const data = await res.json();

      if (res.status === 402 || data?.error === "insufficient_tokens") {
        setEntries((prev) => [...prev, { kind: "paywall" }]);
        return;
      }

      if (!res.ok) {
        setEntries((prev) => [
          ...prev,
          {
            kind: "text",
            role: "assistant",
            content: `That didn't go through. Try again. (${data.error ?? res.statusText})`,
          },
        ]);
        return;
      }

      if (data.reply) {
        setEntries((prev) => [
          ...prev,
          { kind: "text", role: "assistant", content: data.reply },
        ]);
      }

      // The agent rewrote the app — refresh the live preview.
      if (data.updated) onEdited();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown error";
      setEntries((prev) => [
        ...prev,
        {
          kind: "text",
          role: "assistant",
          content: `That didn't go through. Try again. (${msg})`,
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex w-96 shrink-0 flex-col border-l bg-background">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <div className="leading-tight">
            <span className="block text-sm font-medium">Edit</span>
            <span className="block text-xs text-muted-foreground">
              {projectName}
            </span>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-3 px-3 py-4">
          {entries.map((entry, i) => {
            if (entry.kind === "paywall") {
              return (
                <div
                  key={i}
                  className="flex flex-col items-start gap-3 rounded-lg border bg-card p-4 text-sm shadow-sm"
                >
                  <div className="flex items-center gap-2 font-medium">
                    <Coins className="size-4 text-amber-500" />
                    You&apos;re out of tokens
                  </div>
                  <p className="text-muted-foreground">
                    Editing uses tokens for each change. Top up to keep going.
                  </p>
                  <Button asChild>
                    <Link href="/billing">Buy tokens</Link>
                  </Button>
                </div>
              );
            }
            return (
              <div
                key={i}
                className={`flex ${entry.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed ${
                    entry.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "border bg-card text-foreground shadow-sm"
                  }`}
                >
                  {entry.content}
                </div>
              </div>
            );
          })}
          {sending && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground shadow-sm">
                <Loader2 className="size-4 animate-spin" />
                Working…
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      <div className="border-t p-3">
        <div className="flex gap-2">
          <Input
            placeholder="Describe a change…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            disabled={sending}
            className="flex-1"
          />
          <Button onClick={send} disabled={!input.trim() || sending} size="icon">
            <Send className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
