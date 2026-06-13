// Shared OpenAI client. Uses the Responses API with gpt-5.5 (configurable via
// OPENAI_MODEL). Server-only — the key is secret.

import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  throw new Error("Missing OPENAI_API_KEY in environment");
}

export const openai = new OpenAI({ apiKey });

export const MODEL = process.env.OPENAI_MODEL ?? "gpt-5.5";
