// Docs: https://www.instantdb.com/docs/permissions

import type { InstantRules } from "@instantdb/react";

const rules = {
  $users: {
    allow: {
      view: "auth.id == data.id",
      create: "true",
      update: "auth.id == data.id",
    },
  },
  projects: {
    allow: {
      view: "auth.id in data.ref('owner.id')",
      create: "auth.id != null",
      update: "auth.id in data.ref('owner.id')",
      delete: "auth.id in data.ref('owner.id')",
    },
  },
  // Token wallets and the ledger are read-only to their owner. Every write goes
  // through the admin client in server routes, so the balance can't be forged.
  accounts: {
    allow: {
      view: "auth.id in data.ref('owner.id')",
      create: "false",
      update: "false",
      delete: "false",
    },
  },
  ledgerEntries: {
    allow: {
      view: "auth.id in data.ref('account.owner.id')",
      create: "false",
      update: "false",
      delete: "false",
    },
  },
  // $files perms cannot use data.ref; gate by path instead.
  // Bundles are uploaded under `projects/<ownerId>/<projectId>/index.html`.
  $files: {
    allow: {
      view: "data.path.startsWith('projects/' + auth.id + '/')",
      create: "data.path.startsWith('projects/' + auth.id + '/')",
      delete: "data.path.startsWith('projects/' + auth.id + '/')",
    },
  },
} satisfies InstantRules;

export default rules;
