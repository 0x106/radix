// Docs: https://www.instantdb.com/docs/permissions

import type { InstantRules } from "@instantdb/react";

const rules = {
  files: {
    allow: {
      view: "auth.id in data.ref('folder.owner.id') || auth.id != null",
      create: "auth.id != null",
      delete: "auth.id in data.ref('folder.owner.id') || auth.id != null",
      update: "auth.id in data.ref('folder.owner.id') || auth.id != null",
    },
  },
  specs: {
    allow: {
      view: "auth.id in data.ref('owner.id') || auth.id != null",
      create: "auth.id != null",
      delete: "auth.id in data.ref('owner.id') || auth.id != null",
      update: "auth.id in data.ref('owner.id') || auth.id != null",
    },
  },
  $users: {
    allow: {
      view: "auth.id == data.id",
      create: "true",
      update: "auth.id == data.id",
    },
  },
  folders: {
    allow: {
      view: "auth.id in data.ref('owner.id') || auth.id != null",
      create: "auth.id != null",
      delete: "auth.id in data.ref('owner.id') || auth.id != null",
      update: "auth.id in data.ref('owner.id') || auth.id != null",
    },
  },
  streams: {
    allow: {
      view: "auth.id in data.ref('owner.id') || auth.id != null",
      create: "auth.id != null",
      delete: "auth.id in data.ref('owner.id') || auth.id != null",
      update: "auth.id in data.ref('owner.id') || auth.id != null",
    },
  },
  messages: {
    allow: {
      view: "auth.id in data.ref('stream.owner.id') || auth.id != null",
      create: "auth.id != null",
      delete: "auth.id in data.ref('stream.owner.id') || auth.id != null",
      update: "false",
    },
  },
  actionLog: {
    allow: {
      view: "auth.id in data.ref('file.folder.owner.id') || auth.id != null",
      create: "auth.id != null",
      delete: "auth.id in data.ref('file.folder.owner.id') || auth.id != null",
      update: "false",
    },
  },
} satisfies InstantRules;

export default rules;
