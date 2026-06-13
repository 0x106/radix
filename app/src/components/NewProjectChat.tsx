"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import type { User } from "@instantdb/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QuestionCard } from "@/components/QuestionCard";
import { Send, Loader2, X, Coins } from "lucide-react";
import type { Answers, Question, QuestionPrompt } from "@/lib/questions";

/**
 * A transcript entry is either a plain text turn or a structured question the
 * model asked. A question entry is `pending` until the user submits answers,
 * after which it renders as a read-only recap and is replayed to the model.
 */
type ChatEntry =
  | { kind: "text"; role: "user" | "assistant"; content: string }
  | { kind: "paywall" }
  | {
      kind: "question";
      callId: string;
      intro?: string;
      questions: Question[];
      answers?: Answers;
    };

interface NewProjectChatProps {
  /** Client-generated id the new project will be created under. */
  projectId: string;
  user: User;
  onComplete: (projectId: string) => void;
  onCancel: () => void;
}

const INITIAL_MESSAGE: ChatEntry = {
  kind: "text",
  role: "assistant",
  content:
    "What would you like to build? Describe the app — what it does and who it's for. Rough is fine; I'll ask a few questions, then draft a working prototype.",
};

/** Headers carrying the InstantDB token so the route can verify the user. */
function apiHeaders(user: User): HeadersInit {
  return {
    "Content-Type": "application/json",
    token: user.refresh_token,
  };
}

/** Maps the local transcript into the wire format the API route expects. */
function toWire(entries: ChatEntry[]) {
  return entries
    .filter(
      (e): e is Extract<ChatEntry, { kind: "text" | "question" }> =>
        e.kind === "text" || (e.kind === "question" && !!e.answers)
    )
    .map((e) =>
      e.kind === "text"
        ? { kind: "text", role: e.role, content: e.content }
        : {
            kind: "question",
            callId: e.callId,
            questions: e.questions,
            answers: e.answers,
          }
    );
}

export function NewProjectChat({
  projectId,
  user,
  onComplete,
  onCancel,
}: NewProjectChatProps) {
  const [entries, setEntries] = useState<ChatEntry[]>([INITIAL_MESSAGE]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [building, setBuilding] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // A pending (unanswered) question blocks the free-text composer.
  const last = entries[entries.length - 1];
  const pendingQuestion = last?.kind === "question" && !last.answers;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries, sending]);

  /** Sends the given transcript to the model and appends its response. */
  async function exchange(next: ChatEntry[]) {
    setEntries(next);
    setSending(true);

    try {
      const res = await fetch("/api/init-project", {
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
            content: `That didn't go through — your answers here are unaffected. Try again. (${data.error ?? res.statusText})`,
          },
        ]);
        return;
      }

      if (data.done) {
        // The agent built and uploaded the app; hand control back so the shell
        // can select and render it.
        setBuilding(true);
        onComplete(projectId);
        return;
      }

      if (data.question) {
        const q = data.question as QuestionPrompt;
        setEntries((prev) => [
          ...prev,
          { kind: "question", callId: q.callId, intro: q.intro, questions: q.questions },
        ]);
        return;
      }

      if (data.reply) {
        setEntries((prev) => [
          ...prev,
          { kind: "text", role: "assistant", content: data.reply },
        ]);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown error";
      setEntries((prev) => [
        ...prev,
        {
          kind: "text",
          role: "assistant",
          content: `That didn't go through — your answers here are unaffected. Try again. (${msg})`,
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  function sendText() {
    const content = input.trim();
    if (!content || sending || pendingQuestion) return;
    setInput("");
    exchange([...entries, { kind: "text", role: "user", content }]);
  }

  function submitAnswers(callId: string, answers: Answers) {
    if (sending) return;
    exchange(
      entries.map((e) =>
        e.kind === "question" && e.callId === callId ? { ...e, answers } : e
      )
    );
  }

  const busy = sending || building;

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden bg-muted/20">
      <div className="flex items-center justify-between border-b bg-background px-6 py-3">
        <div>
          <h2 className="text-sm font-semibold">New project</h2>
          <p className="text-xs text-muted-foreground">
            A few questions first. Then I&apos;ll build it.
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onCancel} disabled={building}>
          <X className="size-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[640px] flex-col gap-3 px-6 py-6">
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
                    Building uses tokens for each step. Top up to keep going — your
                    answers here are saved.
                  </p>
                  <Button asChild>
                    <Link href="/billing">Buy tokens</Link>
                  </Button>
                </div>
              );
            }
            if (entry.kind === "question") {
              return (
                <QuestionCard
                  key={i}
                  intro={entry.intro}
                  questions={entry.questions}
                  answers={entry.answers}
                  readOnly={!!entry.answers}
                  disabled={busy}
                  onSubmit={(answers) => submitAnswers(entry.callId, answers)}
                />
              );
            }
            return (
              <div
                key={i}
                className={`flex ${entry.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-4 py-3 text-sm leading-relaxed ${
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
              <div className="flex items-center gap-2 rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm">
                <Loader2 className="size-4 animate-spin" />
                {building ? "Building your app…" : "Thinking…"}
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      <div className="border-t bg-background p-4">
        <div className="mx-auto flex max-w-[640px] gap-2">
          <Input
            placeholder={
              pendingQuestion
                ? "Answer the question above to continue…"
                : "Type your answer…"
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendText()}
            disabled={busy || pendingQuestion}
            className="flex-1"
            autoFocus
          />
          <Button
            onClick={sendText}
            disabled={!input.trim() || busy || pendingQuestion}
            size="icon"
          >
            <Send className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
