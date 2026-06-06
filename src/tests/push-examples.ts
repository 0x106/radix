// Push the example prototypes to a user's Radix account via the admin SDK.
//
// Usage (from repo root):
//   npx tsx src/tests/push-examples.ts [owner-email]
//
// Defaults to jordan.evan.campbell@gmail.com. The owner must have signed into
// the Radix app at least once so their $users row exists.
//
// Two kinds of examples:
//   - Smoke tests (counter, todo): plain React, wrapped with wrapReactApp.
//   - Phase 0 spikes (habits, chat, cron): exercise the window.radix runtime
//     contract, wrapped with wrapPrototype (which installs the runtime shim).

import { wrapReactApp, wrapPrototype } from "../lib/htmlTemplate";
import { pushProject } from "../lib/pushProject";
import { counter } from "./examples/counter";
import { todo } from "./examples/todo";
import { habits } from "./examples/habits";
import { chat } from "./examples/chat";
import { cron } from "./examples/cron";

const ownerEmail = process.argv[2] ?? "jordan.evan.campbell@gmail.com";

// `wrap` selects packaging: smoke tests get no runtime, spikes get window.radix.
const examples = [
  { ...counter, wrap: wrapReactApp },
  { ...todo, wrap: wrapReactApp },
  { ...habits, wrap: wrapPrototype },
  { ...chat, wrap: wrapPrototype },
  { ...cron, wrap: wrapPrototype },
];

async function main() {
  for (const ex of examples) {
    const html = ex.wrap({ title: ex.name, componentSource: ex.source });
    const { projectId } = await pushProject({
      ownerEmail,
      name: ex.name,
      description: ex.description,
      html,
    });
    console.log(`✓ Pushed "${ex.name}" → project ${projectId}`);
  }
  console.log(`\nDone. ${examples.length} example(s) pushed to ${ownerEmail}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
