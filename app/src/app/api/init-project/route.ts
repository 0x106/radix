import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { adminDb } from "@/lib/db-admin";
import { verifyUser } from "@/lib/auth";
import { openai, MODEL } from "@/lib/openai";
import { wrapPrototype } from "@/runtime/packaging";
import { ensureAccount, debitTokens, usageToTokens } from "@/lib/billing";
import { AUTHORING_GUIDE } from "@/lib/authoring";
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

    const { projectId, workspaceId, messages: incomingMessages } =
      (await req.json()) as {
        projectId: string;
        workspaceId?: string;
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

    // If a target workspace was given, confirm the user owns it before we link
    // the new project to it; ignore a workspace that isn't theirs.
    let linkWorkspaceId: string | undefined;
    if (workspaceId) {
      const ws = await adminDb.query({
        workspaces: { $: { where: { id: workspaceId } }, owner: {} },
      });
      const workspace = ws?.workspaces?.[0] as
        | { owner?: { id: string } }
        | undefined;
      if (workspace?.owner?.id === user.id) linkWorkspaceId = workspaceId;
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
            // Persist the raw source so the edit agent can rewrite it later.
            source: args.source,
            createdAt: Date.now(),
          })
          .link({
            owner: user.id,
            bundle: file.id,
            ...(linkWorkspaceId ? { workspace: linkWorkspaceId } : {}),
          }),
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
