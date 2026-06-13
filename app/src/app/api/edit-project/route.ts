// The edit agent: takes an existing project's stored source plus a short chat
// transcript of change requests, and rewrites the prototype. Like the build
// agent, every model call is metered against the user's token balance.

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { adminDb } from "@/lib/db-admin";
import { verifyUser } from "@/lib/auth";
import { openai, MODEL } from "@/lib/openai";
import { wrapPrototype } from "@/runtime/packaging";
import { ensureAccount, debitTokens, usageToTokens } from "@/lib/billing";
import { AUTHORING_GUIDE } from "@/lib/authoring";

/** A plain chat turn between the user and the edit agent. */
type IncomingMessage = { role: "user" | "assistant"; content: string };

const TOOLS: OpenAI.Responses.Tool[] = [
  {
    type: "function",
    name: "update_app",
    description:
      "Apply the user's requested change by rewriting the prototype. Pass the COMPLETE new source (not a diff) — it replaces the old source entirely. Call this once you understand the change; if the request is ambiguous, ask a clarifying question in plain text instead.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description:
            "The full, updated prototype component as browser-ESM source (NOT JSX). Same authoring rules as the original: use React.createElement, read window.radix, assign the component to window.App.",
        },
        summary: {
          type: "string",
          description:
            "One short sentence describing what you changed, shown back to the user.",
        },
        name: {
          type: "string",
          description:
            "Optional updated title for the app. Only set if the change warrants a rename.",
        },
        description: {
          type: "string",
          description: "Optional updated one-sentence description.",
        },
      },
      required: ["source", "summary"],
    },
  },
];

export async function POST(req: NextRequest) {
  try {
    const user = await verifyUser(req);
    if (!user)
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    // Every model call is metered — require a positive balance before spending
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

    // Load the project, confirm ownership, and recover its current source.
    const existing = await adminDb.query({
      projects: { $: { where: { id: projectId } }, owner: {} },
    });
    const project = existing?.projects?.[0] as
      | { name?: string; description?: string; source?: string; owner?: { id: string } }
      | undefined;

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    if (project.owner && project.owner.id !== user.id) {
      return NextResponse.json({ error: "Not your project" }, { status: 403 });
    }
    if (!project.source) {
      return NextResponse.json(
        {
          error:
            "This project predates editing and has no stored source. Rebuild it as a new project to enable edits.",
        },
        { status: 409 }
      );
    }

    const systemPrompt = `You are the Radix edit agent. You modify an existing working prototype in response to the user's requests.

Make the smallest change that satisfies the request, preserving everything else about the app (its structure, data, and behaviour) unless the user asks otherwise. When the change is clear, call update_app with the COMPLETE new source. If the request is genuinely ambiguous, ask one short clarifying question in plain text instead of guessing.

The app is currently titled "${project.name ?? "Untitled"}"${project.description ? ` (${project.description})` : ""}.

Here is the current prototype source:

\`\`\`js
${project.source}
\`\`\`

${AUTHORING_GUIDE}`;

    const input: OpenAI.Responses.ResponseInput = incomingMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const response = await openai.responses.create({
      model: MODEL,
      instructions: systemPrompt,
      input,
      tools: TOOLS,
    });

    // Debit this call's actual usage before branching, so every edit turn —
    // whether it rewrites the app or just replies — is paid for.
    await debitTokens(user.id, usageToTokens(response.usage), {
      model: MODEL,
      input_tokens: response.usage?.input_tokens,
      output_tokens: response.usage?.output_tokens,
      projectId,
      kind: "edit",
    });

    const updateCall = response.output.find(
      (item): item is OpenAI.Responses.ResponseFunctionToolCall =>
        item.type === "function_call" && item.name === "update_app"
    );

    if (updateCall) {
      const args = JSON.parse(updateCall.arguments) as {
        source: string;
        summary: string;
        name?: string;
        description?: string;
      };

      // Re-package the updated component and overwrite the project's bundle.
      const html = wrapPrototype({
        title: args.name ?? project.name ?? "Untitled",
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
            source: args.source,
            ...(args.name ? { name: args.name } : {}),
            ...(args.description ? { description: args.description } : {}),
          })
          .link({ bundle: file.id }),
      ]);

      return NextResponse.json({
        updated: true,
        reply: args.summary,
      });
    }

    // Otherwise the model asked a clarifying question or replied conversationally.
    return NextResponse.json({
      updated: false,
      reply: response.output_text || "Could you say a bit more about the change?",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[edit-project]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
