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
      createdAt: i.number().indexed(),
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
  },
  rooms: {},
});

// This helps TypeScript display nicer intellisense
type _AppSchema = typeof _schema;
interface AppSchema extends _AppSchema {}
const schema: AppSchema = _schema;

export type { AppSchema };
export default schema;
