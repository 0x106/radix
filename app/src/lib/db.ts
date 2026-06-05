import { init } from "@instantdb/react";
import schema from "@/instant.schema";

const appId = process.env.NEXT_PUBLIC_INSTANT_APP_ID;

if (!appId) {
  throw new Error("Missing NEXT_PUBLIC_INSTANT_APP_ID in environment");
}

// Module-scope singleton client, shared across the app.
export const db = init({ appId, schema, devtool: false });
