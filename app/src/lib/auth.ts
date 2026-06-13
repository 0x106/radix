// Server-side auth: turn the InstantDB refresh token the client sends into a
// verified user. The client reads `user.refresh_token` from `db.useAuth()` and
// passes it in the `token` header (see `apiHeaders` in NewProjectChat).

import type { NextRequest } from "next/server";
import { adminDb } from "@/lib/db-admin";

export interface AuthedUser {
  id: string;
  email?: string;
}

/** Verify the request's token header. Returns null when it's missing/invalid. */
export async function verifyUser(req: NextRequest): Promise<AuthedUser | null> {
  const token = req.headers.get("token");
  if (!token) return null;
  try {
    const user = await adminDb.auth.verifyToken(token);
    if (!user) return null;
    return { id: user.id, email: user.email ?? undefined };
  } catch {
    return null;
  }
}
