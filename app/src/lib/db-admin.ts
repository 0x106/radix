// Server-only InstantDB admin client. The admin token bypasses permission
// rules, so this module must never be imported into client code — it lives
// behind API route handlers only.

import { init, id } from "@instantdb/admin";
import schema from "@/instant.schema";

const appId = process.env.NEXT_PUBLIC_INSTANT_APP_ID;
const adminToken = process.env.INSTANT_APP_ADMIN_TOKEN;

if (!appId) {
  throw new Error("Missing NEXT_PUBLIC_INSTANT_APP_ID in environment");
}
if (!adminToken) {
  throw new Error("Missing INSTANT_APP_ADMIN_TOKEN in environment");
}

export const adminDb = init({ appId, adminToken, schema });

// Convenience re-export so route handlers can build ids without a second import.
export { id };
