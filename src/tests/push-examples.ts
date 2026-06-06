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
//   - Phase 0 examples (habits, chat, cron): exercise the window.radix runtime
//     contract, wrapped with wrapPrototype (which installs the runtime shim).

import { wrapReactApp, wrapPrototype } from "../lib/htmlTemplate";
import { pushProject } from "../lib/pushProject";
import { counter } from "./examples/counter";
import { todo } from "./examples/todo";
import { habits } from "./examples/habits";
import { chat } from "./examples/chat";
import { cron } from "./examples/cron";
import { admin } from "./examples/admin";
import { finance } from "./examples/finance";
import { shop } from "./examples/shop";
import { smarthome } from "./examples/smarthome";

const ownerEmail = process.argv[2] ?? "jordan.evan.campbell@gmail.com";

// `wrap` selects packaging: smoke tests get no runtime, examples get window.radix.
const examples = [
  { ...counter, wrap: wrapReactApp },
  { ...todo, wrap: wrapReactApp },
  { ...habits, wrap: wrapPrototype },
  { ...chat, wrap: wrapPrototype },
  { ...cron, wrap: wrapPrototype },
  // db-focused examples: filtering/bulk writes, aggregation, relations/joins.
  { ...admin, wrap: wrapPrototype },
  { ...finance, wrap: wrapPrototype },
  { ...shop, wrap: wrapPrototype },
  // world engine examples: multiple concurrent actors, reactive + timer-based.
  { ...smarthome, wrap: wrapPrototype },
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
