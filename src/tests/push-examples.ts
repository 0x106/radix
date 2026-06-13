// Push the example prototypes to a user's Radix account via the admin SDK.
//
// Usage (from repo root):
//   npx tsx src/tests/push-examples.ts [owner-email]
//
// Defaults to jordan.evan.campbell@gmail.com. The owner must have signed into
// the Radix app at least once so their $users row exists.
//
// Two kinds of examples:
//   - Plain React (counter, todo): no fakes, wrapped with wrapReactApp.
//   - Runtime examples (habits, chat, cron, …): use the window.radix runtime,
//     wrapped with wrapPrototype (which installs the runtime).

import { wrapReactApp, wrapPrototype } from "../runtime/packaging";
import { pushProject } from "../publish/pushProject";
import { counter } from "./examples/counter";
import { todo } from "./examples/todo";
import { habits } from "./examples/habits";
import { chat } from "./examples/chat";
import { cron } from "./examples/cron";
import { admin } from "./examples/admin";
import { finance } from "./examples/finance";
import { shop } from "./examples/shop";
import { smarthome } from "./examples/smarthome";
import { fooddelivery } from "./examples/fooddelivery";
import { taskboard } from "./examples/taskboard";
import { trivia } from "./examples/trivia";
import { socialfeed } from "./examples/socialfeed";
import { rideshare } from "./examples/rideshare";
import { devops } from "./examples/devops";
import { onboarding } from "./examples/onboarding";
import { booking } from "./examples/booking";
import { slackbot } from "./examples/slackbot";
import { music } from "./examples/music";
import { apidashboard } from "./examples/apidashboard";
import { graph } from "./examples/graph";
import { ledger } from "./examples/ledger";
import { spreadsheet } from "./examples/spreadsheet";
import { towerdefence } from "./examples/towerdefence";
import { llmpipeline } from "./examples/llmpipeline";

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
  { ...fooddelivery, wrap: wrapPrototype },
  // batch 2: game, social, market, ops, services
  { ...taskboard, wrap: wrapPrototype },
  { ...trivia, wrap: wrapPrototype },
  { ...socialfeed, wrap: wrapPrototype },
  { ...rideshare, wrap: wrapPrototype },
  { ...devops, wrap: wrapPrototype },
  { ...onboarding, wrap: wrapPrototype },
  { ...booking, wrap: wrapPrototype },
  { ...slackbot, wrap: wrapPrototype },
  { ...music, wrap: wrapPrototype },
  { ...apidashboard, wrap: wrapPrototype },
  // batch 3: boundary cases
  { ...graph, wrap: wrapPrototype },
  { ...ledger, wrap: wrapPrototype },
  { ...spreadsheet, wrap: wrapPrototype },
  { ...towerdefence, wrap: wrapPrototype },
  { ...llmpipeline, wrap: wrapPrototype },
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
