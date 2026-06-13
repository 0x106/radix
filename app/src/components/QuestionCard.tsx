"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type Answers,
  type AnswerValue,
  type Question,
  defaultAnswer,
  isAnswered,
} from "@/lib/questions";

interface QuestionCardProps {
  intro?: string;
  questions: Question[];
  /** Provided in read-only recap mode (after the user has answered). */
  answers?: Answers;
  /** When true, render a static summary instead of inputs. */
  readOnly?: boolean;
  /** Disable inputs / submit while a request is in flight. */
  disabled?: boolean;
  onSubmit?: (answers: Answers) => void;
}

function seed(questions: Question[], answers?: Answers): Answers {
  const out: Answers = {};
  for (const q of questions) {
    out[q.id] = answers?.[q.id] ?? defaultAnswer(q);
  }
  return out;
}

export function QuestionCard({
  intro,
  questions,
  answers,
  readOnly = false,
  disabled = false,
  onSubmit,
}: QuestionCardProps) {
  const [values, setValues] = useState<Answers>(() => seed(questions, answers));
  const [showErrors, setShowErrors] = useState(false);

  function set(id: string, value: AnswerValue) {
    setValues((prev) => ({ ...prev, [id]: value }));
  }

  function toggleMulti(id: string, option: string) {
    setValues((prev) => {
      const cur = Array.isArray(prev[id]) ? (prev[id] as string[]) : [];
      const next = cur.includes(option)
        ? cur.filter((o) => o !== option)
        : [...cur, option];
      return { ...prev, [id]: next };
    });
  }

  const missing = questions.filter(
    (q) => q.required !== false && !isAnswered(q, values[q.id])
  );

  function handleSubmit() {
    if (disabled) return;
    if (missing.length > 0) {
      setShowErrors(true);
      return;
    }
    onSubmit?.(values);
  }

  // ---- Read-only recap ------------------------------------------------------
  if (readOnly) {
    const recap = answers ?? values;
    return (
      <div className="w-full rounded-lg border bg-card px-4 py-3 shadow-sm">
        {intro && <p className="mb-2 text-sm text-foreground">{intro}</p>}
        <dl className="flex flex-col gap-2">
          {questions.map((q) => (
            <div key={q.id}>
              <dt className="text-xs font-medium text-muted-foreground">{q.prompt}</dt>
              <dd className="text-sm text-foreground">{formatAnswer(q, recap[q.id])}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }

  // ---- Interactive ----------------------------------------------------------
  return (
    <div className="w-full rounded-lg border bg-card px-4 py-4 shadow-sm">
      {intro && <p className="mb-3 text-sm text-foreground">{intro}</p>}

      <div className="flex flex-col gap-4">
        {questions.map((q) => {
          const invalid =
            showErrors && q.required !== false && !isAnswered(q, values[q.id]);
          return (
            <div key={q.id} className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">
                {q.prompt}
                {q.required === false && (
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    (optional)
                  </span>
                )}
              </label>
              {renderField(q, values[q.id], { set, toggleMulti, disabled })}
              {invalid && (
                <span className="text-xs text-destructive">This is required.</span>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-end gap-3">
        {showErrors && missing.length > 0 && (
          <span className="text-xs text-destructive">
            Please answer {missing.length} more.
          </span>
        )}
        <Button size="sm" onClick={handleSubmit} disabled={disabled}>
          Submit answers
        </Button>
      </div>
    </div>
  );
}

interface FieldHelpers {
  set: (id: string, value: AnswerValue) => void;
  toggleMulti: (id: string, option: string) => void;
  disabled: boolean;
}

function renderField(q: Question, value: AnswerValue, h: FieldHelpers) {
  switch (q.type) {
    case "long_text":
      return (
        <textarea
          rows={3}
          placeholder={q.placeholder}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => h.set(q.id, e.target.value)}
          disabled={h.disabled}
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
        />
      );

    case "single_choice":
      return (
        <div className="flex flex-wrap gap-2">
          {(q.options ?? []).map((opt) => {
            const active = value === opt;
            return (
              <button
                key={opt}
                type="button"
                disabled={h.disabled}
                onClick={() => h.set(q.id, opt)}
                className={`rounded-full border px-3 py-1.5 text-sm transition disabled:opacity-50 ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-background text-foreground hover:border-ring"
                }`}
              >
                {opt}
              </button>
            );
          })}
        </div>
      );

    case "multi_choice": {
      const selected = Array.isArray(value) ? value : [];
      return (
        <div className="flex flex-col gap-2">
          {(q.options ?? []).map((opt) => (
            <label
              key={opt}
              className="flex cursor-pointer items-center gap-2 text-sm text-foreground"
            >
              <input
                type="checkbox"
                checked={selected.includes(opt)}
                onChange={() => h.toggleMulti(q.id, opt)}
                disabled={h.disabled}
                className="size-4 accent-primary"
              />
              {opt}
            </label>
          ))}
        </div>
      );
    }

    case "slider": {
      const min = q.min ?? 0;
      const max = q.max ?? 100;
      const step = q.step ?? 1;
      const num = typeof value === "number" ? value : min;
      return (
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={num}
            disabled={h.disabled}
            onChange={(e) => h.set(q.id, Number(e.target.value))}
            className="flex-1 accent-primary disabled:opacity-50"
          />
          <span className="min-w-[3.5rem] text-right text-sm tabular-nums text-foreground">
            {num}
            {q.unit ? ` ${q.unit}` : ""}
          </span>
        </div>
      );
    }

    case "boolean": {
      const yes = value === true;
      return (
        <div className="flex gap-2">
          {[
            { label: "Yes", val: true },
            { label: "No", val: false },
          ].map((o) => {
            const active = yes === o.val;
            return (
              <button
                key={o.label}
                type="button"
                disabled={h.disabled}
                onClick={() => h.set(q.id, o.val)}
                className={`rounded-full border px-4 py-1.5 text-sm transition disabled:opacity-50 ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-background text-foreground hover:border-ring"
                }`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      );
    }

    case "text":
    default:
      return (
        <Input
          placeholder={q.placeholder}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => h.set(q.id, e.target.value)}
          disabled={h.disabled}
        />
      );
  }
}

function formatAnswer(q: Question, value: AnswerValue | undefined): string {
  if (value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return `${value}${q.unit ? ` ${q.unit}` : ""}`;
  return value;
}
