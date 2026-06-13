// Shared types for the structured `ask_question` tool used during onboarding.
// Imported by both the API route (server) and the chat UI (client), so keep
// this module free of server- or client-only imports.

export type QuestionType =
  | "text"
  | "long_text"
  | "single_choice"
  | "multi_choice"
  | "slider"
  | "boolean";

export interface Question {
  /** Unique within a prompt; answers are keyed by this. */
  id: string;
  type: QuestionType;
  /** The question shown to the user. */
  prompt: string;
  /** Choices for single_choice / multi_choice. */
  options?: string[];
  /** Slider bounds / granularity. */
  min?: number;
  max?: number;
  step?: number;
  /** Optional unit label shown next to a slider value (e.g. "words"). */
  unit?: string;
  /** Placeholder for text / long_text. */
  placeholder?: string;
  /** Whether the user must answer before submitting. Defaults to true. */
  required?: boolean;
}

export type AnswerValue = string | string[] | number | boolean;
export type Answers = Record<string, AnswerValue>;

/** A pending question set the model has asked the user to answer. */
export interface QuestionPrompt {
  /** The model's tool-call id; round-tripped so answers fold back to the call. */
  callId: string;
  /** Optional short framing sentence shown above the questions. */
  intro?: string;
  questions: Question[];
}

/** Returns true when an answer is present and non-empty for the given question. */
export function isAnswered(q: Question, value: AnswerValue | undefined): boolean {
  if (value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true; // numbers (slider) and booleans are always considered answered
}

/** A sensible default answer for a question, used to seed UI state. */
export function defaultAnswer(q: Question): AnswerValue {
  switch (q.type) {
    case "multi_choice":
      return [];
    case "slider": {
      const min = q.min ?? 0;
      const max = q.max ?? 100;
      return Math.round((min + max) / 2);
    }
    case "boolean":
      return false;
    case "single_choice":
      return "";
    default:
      return "";
  }
}
