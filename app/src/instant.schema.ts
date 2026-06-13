// Docs: https://www.instantdb.com/docs/modeling-data

import { i } from "@instantdb/react";

const _schema = i.schema({
  entities: {
    // Auto-created by Instant Storage on upload; required to use Storage.
    $files: i.entity({
      path: i.string().unique().indexed(),
      url: i.string(),
    }),
    $users: i.entity({
      email: i.string().unique().indexed().optional(),
    }),
    // A Radix project: a self-contained React app whose HTML bundle lives in
    // Instant Storage (linked via `bundle`), owned by a user.
    projects: i.entity({
      name: i.string().indexed(),
      description: i.string().optional(),
      // The prototype's component source (browser ESM). Stored so the edit agent
      // can load and rewrite it; the rendered HTML bundle lives in Storage.
      source: i.string().optional(),
      // Name of a curated Lucide icon (see lib/icons). Falls back to a default.
      icon: i.string().optional(),
      createdAt: i.number().indexed(),
    }),
    // A named collection of projects, owned by a user. A project belongs to at
    // most one workspace; projects with none are shown as "Unassigned".
    workspaces: i.entity({
      name: i.string().indexed(),
      // Name of a curated Lucide icon (see lib/icons). Falls back to a default.
      icon: i.string().optional(),
      createdAt: i.number().indexed(),
    }),
    // A user's token wallet. One-to-one with $users. All writes happen
    // server-side via the admin client (see lib/billing.ts); clients only read.
    accounts: i.entity({
      // Current spendable token balance. Debited per model call, credited by
      // Stripe purchases/subscriptions and the one-time free grant.
      tokenBalance: i.number().indexed(),
      stripeCustomerId: i.string().optional().indexed(),
      stripeSubscriptionId: i.string().optional(),
      // undefined / "active" / "canceled" — mirrors the Stripe subscription.
      subscriptionStatus: i.string().optional(),
      // True once the signup free grant has been applied (idempotency guard).
      freeGrantApplied: i.boolean(),
      createdAt: i.number().indexed(),
    }),
    // Append-only audit trail of every balance change. For Stripe credits the
    // originating event id is recorded in `stripeEventId`; the webhook skips an
    // event whose id already appears here, making processing idempotent.
    ledgerEntries: i.entity({
      delta: i.number(),
      // "grant" | "purchase" | "subscription" | "build"
      reason: i.string().indexed(),
      createdAt: i.number().indexed(),
      // Stripe event id for purchase/subscription credits; absent otherwise.
      stripeEventId: i.string().optional().indexed(),
      // Free-form context: openai usage for builds, stripe ids for purchases.
      meta: i.json().optional(),
    }),
  },
  links: {
    projectOwner: {
      forward: { on: "projects", has: "one", label: "owner", onDelete: "cascade" },
      reverse: { on: "$users", has: "many", label: "projects" },
    },
    projectBundle: {
      forward: { on: "projects", has: "one", label: "bundle" },
      reverse: { on: "$files", has: "one", label: "project", onDelete: "cascade" },
    },
    workspaceOwner: {
      forward: { on: "workspaces", has: "one", label: "owner", onDelete: "cascade" },
      reverse: { on: "$users", has: "many", label: "workspaces" },
    },
    // A project belongs to at most one workspace. No cascade: deleting a
    // workspace just unlinks its projects (they become "Unassigned").
    projectWorkspace: {
      forward: { on: "projects", has: "one", label: "workspace" },
      reverse: { on: "workspaces", has: "many", label: "projects" },
    },
    accountOwner: {
      forward: { on: "accounts", has: "one", label: "owner", onDelete: "cascade" },
      reverse: { on: "$users", has: "one", label: "account" },
    },
    accountLedger: {
      forward: { on: "ledgerEntries", has: "one", label: "account", onDelete: "cascade" },
      reverse: { on: "accounts", has: "many", label: "ledger" },
    },
  },
  rooms: {},
});

// This helps TypeScript display nicer intellisense
type _AppSchema = typeof _schema;
interface AppSchema extends _AppSchema {}
const schema: AppSchema = _schema;

export type { AppSchema };
export default schema;
