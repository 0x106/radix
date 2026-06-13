import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { adminDb } from "@/lib/db-admin";
import { verifyUser } from "@/lib/auth";
import { openai, MODEL } from "@/lib/openai";
import { wrapPrototype } from "@/runtime/packaging";
import { ensureAccount, debitTokens, usageToTokens } from "@/lib/billing";
import type { Answers, Question } from "@/lib/questions";

/**
 * Transcript entries the client sends back on each turn. A plain text turn is a
 * role/content message; a `question` turn captures a previous `ask_question`
 * tool call together with the user's answers, so we can replay it to the model
 * as a real function_call / function_call_output pair.
 */
type IncomingMessage =
  | { kind?: "text"; role: "user" | "assistant"; content: string }
  | {
      kind: "question";
      callId: string;
      questions: Question[];
      answers: Answers;
    };

const TOOLS: OpenAI.Responses.Tool[] = [
  {
    type: "function",
    name: "create_app",
    description:
      "Create the prototype app from an initial implementation. Call this once you understand what the user wants — after asking at least 2-3 questions. Do not call this prematurely.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "A short, human title for the app (shown in the sidebar).",
        },
        description: {
          type: "string",
          description: "One sentence describing what the app does.",
        },
        source: {
          type: "string",
          description:
            "The full prototype component as browser-ESM source (NOT JSX). See the authoring rules in the instructions: use React.createElement, read window.radix, and assign the component to window.App.",
        },
      },
      required: ["name", "description", "source"],
    },
  },
  {
    type: "function",
    name: "ask_question",
    description:
      "Ask the user one or more structured questions, rendered as interactive UI (text fields, choice lists, sliders, toggles) instead of free-form prose. Use this whenever you want concrete, structured answers — what the app does, who it's for, key features, data it manages, whether it needs a simulated world (time/events). The user's answers are returned to you as the tool result. You may ask several questions at once; keep it to a focused batch.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        intro: {
          type: "string",
          description: "Optional short sentence shown above the questions.",
        },
        questions: {
          type: "array",
          description: "One or more questions to ask at once.",
          items: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description:
                  "Unique identifier for this question; answers are keyed by it.",
              },
              type: {
                type: "string",
                enum: [
                  "text",
                  "long_text",
                  "single_choice",
                  "multi_choice",
                  "slider",
                  "boolean",
                ],
                description:
                  "Input type: text (one line), long_text (paragraph), single_choice (pick one), multi_choice (pick many), slider (number in a range), boolean (yes/no).",
              },
              prompt: { type: "string", description: "The question text." },
              options: {
                type: "array",
                items: { type: "string" },
                description: "Choices for single_choice / multi_choice.",
              },
              min: { type: "number", description: "Slider minimum." },
              max: { type: "number", description: "Slider maximum." },
              step: { type: "number", description: "Slider step size." },
              unit: {
                type: "string",
                description:
                  "Optional unit shown next to a slider value (e.g. 'items').",
              },
              placeholder: {
                type: "string",
                description: "Placeholder for text / long_text inputs.",
              },
              required: {
                type: "boolean",
                description: "Whether the user must answer. Defaults to true.",
              },
            },
            required: ["id", "type", "prompt"],
          },
        },
      },
      required: ["questions"],
    },
  },
];

// Teaches the model the Radix prototype authoring contract. The prototype runs
// as a browser ES module inside a sandboxed iframe: React is global, the Radix
// runtime is on `window.radix`, and there is NO JSX transform.
const AUTHORING_GUIDE = `## How to write a Radix prototype

The "source" you pass to create_app is the body of a browser ES module that runs
inside a sandboxed iframe. Follow these rules exactly or the app will not run:

1. NO JSX. Build elements with React.createElement. Start with:
     const { useState, useEffect, useMemo } = React;
     const h = React.createElement;
2. Define one top-level component function and assign it to window.App:
     window.App = MyApp;
   Do NOT use import/export — React is already a global, and so is window.radix.
3. Style with inline style objects (no external CSS, no Tailwind).
4. Keep everything in this one source string. It must be self-contained.
5. The prototype runs in a sandboxed iframe. If you use a <form>, ALWAYS call
   e.preventDefault() in its onSubmit handler before doing anything else — a real
   form submission would try to navigate the frame and is blocked / reloads state:
     h("form", { onSubmit: (e) => { e.preventDefault(); addTodo(); } }, ...)
   The same applies to links: don't rely on <a href> navigation; handle onClick.

### The runtime: window.radix

Reach all "backend" capabilities through window.radix (alias it: const radix = window.radix):

- radix.db — a synchronous, seeded entity store. Declare collections ONCE at the
  top of your component module (before the component, or in a useState initializer
  guard), then read/write synchronously:
    radix.db.define({
      todos: {
        fields: { text: "string", done: { type: "boolean", default: false } },
        seed: [{ id: "1", text: "First task", done: false }],
      },
    });
    radix.db.create("todos", { text: "Buy milk", done: false });
    radix.db.update("todos", someId, { done: true });
    radix.db.delete("todos", someId);
    const rows = radix.db.query("todos", { where: { done: false }, order: { field: "text", dir: "asc" } });
  Subscribe for live updates inside useEffect:
    useEffect(() => radix.db.subscribe("todos", setRows), []);
  Field types: "string" | "number" | "boolean" | "json" | "ref" | { type: "enum", values: [...] }.
  Every row gets a string id automatically. db.reset() restores the seed.

- radix.clock — simulated time: now(), setTimeout(fn, ms), onFrame(fn) for render loops.
- radix.random — seeded RNG: random(), int(min, max), pick(array). Use this, never Math.random.
- radix.events — pub/sub bus: on(topic, fn), emit(topic, payload).
- radix.actor(config) — a stateful world process with start/tick/on handlers, for
  apps that need something to react to over time (bots, simulations, multiplayer).
- radix.log — simulation log: info(msg, data), warn(...), error(...).

Only use the data store (radix.db) for simple CRUD apps. Reach for clock/events/
actor when the app genuinely needs the passage of time or autonomous activity.

### Example (a minimal counter)

const { useState } = React;
const h = React.createElement;
function Counter() {
  const [n, setN] = useState(0);
  return h("div", { style: { padding: 40, textAlign: "center", fontFamily: "system-ui" } },
    h("p", { style: { fontSize: 48, margin: 0 } }, String(n)),
    h("button", { onClick: () => setN((v) => v + 1) }, "+1"),
  );
}
window.App = Counter;

Make the prototype genuinely functional and reasonably complete for what the user
described — real interactions, seeded sample data, and a clean inline-styled UI.`;

export async function POST(req: NextRequest) {
  try {
    const user = await verifyUser(req);
    if (!user)
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    // Every model call is metered. Require a positive balance before spending
    // any OpenAI tokens; the client turns a 402 into a "buy tokens" prompt.
    const account = await ensureAccount(user.id);
    if (account.tokenBalance <= 0) {
      return NextResponse.json(
        { error: "insufficient_tokens", balance: account.tokenBalance },
        { status: 402 }
      );
    }

    const { projectId, messages: incomingMessages } = (await req.json()) as {
      projectId: string;
      messages: IncomingMessage[];
    };

    if (!projectId || !incomingMessages) {
      return NextResponse.json(
        { error: "Missing projectId or messages" },
        { status: 400 }
      );
    }

    // The projectId is client-generated; make sure it doesn't collide with (or
    // hijack) someone else's existing project.
    const existing = await adminDb.query({
      projects: { $: { where: { id: projectId } }, owner: {} },
    });
    const existingProject = existing?.projects?.[0] as
      | { owner?: { id: string } }
      | undefined;
    if (existingProject?.owner && existingProject.owner.id !== user.id) {
      return NextResponse.json({ error: "Not your project" }, { status: 403 });
    }

    const systemPrompt = `You are the Radix build agent. You interview the user briefly about the app they want, then write an initial working prototype.

You are concise and practical: ask a focused round or two of questions to pin down what the app does, who it's for, the core features, and what data or simulated behaviour it needs. Prefer the ask_question tool for concrete answers — it renders interactive UI (text, choices, sliders, toggles) and the answers come back to you. Batch a few related questions per call. Ask at least 2-3 questions before building. Do not over-interview; once you have a clear enough picture, build.

When ready, call create_app with a name, a one-sentence description, and the full prototype source.

${AUTHORING_GUIDE}`;

    // Rebuild the Responses API input from the transcript. Plain turns map to
    // role/content messages; an answered `ask_question` turn is replayed as the
    // original function_call plus its function_call_output so the model sees the
    // answers as a genuine tool result.
    const input: OpenAI.Responses.ResponseInput = [];
    for (const m of incomingMessages) {
      if ("kind" in m && m.kind === "question") {
        input.push({
          type: "function_call",
          call_id: m.callId,
          name: "ask_question",
          arguments: JSON.stringify({ questions: m.questions }),
        });
        input.push({
          type: "function_call_output",
          call_id: m.callId,
          output: JSON.stringify({ answers: m.answers }),
        });
      } else {
        input.push({ role: m.role, content: m.content });
      }
    }

    const response = await openai.responses.create({
      model: MODEL,
      instructions: systemPrompt,
      input,
      tools: TOOLS,
    });

    // Debit this call's actual usage. Done before we branch on the response so
    // every turn — interview or build — is paid for.
    await debitTokens(user.id, usageToTokens(response.usage), {
      model: MODEL,
      input_tokens: response.usage?.input_tokens,
      output_tokens: response.usage?.output_tokens,
      projectId,
    });

    const toolCalls = response.output.filter(
      (item): item is OpenAI.Responses.ResponseFunctionToolCall =>
        item.type === "function_call"
    );

    // Building the app takes precedence and ends the conversation.
    const buildCall = toolCalls.find((c) => c.name === "create_app");

    // Otherwise, the model may want to ask the user structured questions.
    const questionCall = toolCalls.find((c) => c.name === "ask_question");
    if (!buildCall && questionCall) {
      const qArgs = JSON.parse(questionCall.arguments) as {
        intro?: string;
        questions: Question[];
      };
      return NextResponse.json({
        done: false,
        question: {
          callId: questionCall.call_id,
          intro: qArgs.intro || response.output_text || undefined,
          questions: qArgs.questions ?? [],
        },
      });
    }

    if (buildCall) {
      const args = JSON.parse(buildCall.arguments) as {
        name: string;
        description: string;
        source: string;
      };

      // Package the component into one self-contained HTML document using the
      // canonical runtime, pinned to this shell's origin for the postMessage
      // bridge, then upload it to Instant Storage and create the project record.
      const html = wrapPrototype({
        title: args.name,
        componentSource: args.source,
        shellOrigin: new URL(req.url).origin,
      });

      const path = `projects/${user.id}/${projectId}/index.html`;
      const { data: file } = await adminDb.storage.uploadFile(
        path,
        Buffer.from(html, "utf8"),
        { contentType: "text/html" }
      );

      await adminDb.transact([
        adminDb.tx.projects[projectId]
          .update({
            name: args.name,
            description: args.description,
            createdAt: Date.now(),
          })
          .link({ owner: user.id, bundle: file.id }),
      ]);

      return NextResponse.json({ done: true, projectId });
    }

    // Otherwise return the assistant's conversational reply.
    return NextResponse.json({ done: false, reply: response.output_text });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[init-project]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
