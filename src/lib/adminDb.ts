import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { init } from "@instantdb/admin";
import type { AppSchema } from "../../app/src/instant.schema";
import schemaImport from "../../app/src/instant.schema";

// app/ has no `"type": "module"`, so under the ESM root tooling the default
// export can arrive wrapped in a CJS namespace ({ default: schema }). Unwrap.
const schema = (
  (schemaImport as { entities?: unknown }).entities
    ? schemaImport
    : (schemaImport as unknown as { default: AppSchema }).default
) as AppSchema;

// Load the same credentials the Next app uses (app/.env).
const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, "../../app/.env") });

const appId = process.env.NEXT_PUBLIC_INSTANT_APP_ID;
const adminToken = process.env.INSTANT_APP_ADMIN_TOKEN;

if (!appId || !adminToken) {
  throw new Error(
    "Missing NEXT_PUBLIC_INSTANT_APP_ID or INSTANT_APP_ADMIN_TOKEN in app/.env",
  );
}

// Admin SDK bypasses permissions — used here only for local seeding/dev tooling.
export const adminDb = init({ appId, adminToken, schema });
