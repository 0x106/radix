// Push the example prototypes to a user's Radix account via the admin SDK.
//
// Usage (from repo root):
//   npx tsx src/tests/push-examples.ts [owner-email]
//
// Defaults to jordan.evan.campbell@gmail.com. The owner must have signed into
// the Radix app at least once so their $users row exists.

import { wrapReactApp } from "../lib/htmlTemplate";
import { pushProject } from "../lib/pushProject";
import { counter } from "./examples/counter";
import { todo } from "./examples/todo";

const ownerEmail = process.argv[2] ?? "jordan.evan.campbell@gmail.com";

const examples = [counter, todo];

async function main() {
  for (const ex of examples) {
    const html = wrapReactApp({ title: ex.name, componentSource: ex.source });
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
