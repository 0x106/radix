import { id } from "@instantdb/admin";
import { adminDb } from "./instant";

/**
 * Push a single self-contained HTML prototype to InstantDB as a `projects`
 * record owned by `ownerEmail`, with its HTML stored in Instant Storage and
 * linked via `bundle`.
 *
 * The owner must have signed into the Radix app at least once so a `$users`
 * row exists for their email.
 *
 * Re-running with the same (owner, name) replaces the previous project so the
 * seed stays idempotent.
 */
export async function pushProject(opts: {
  ownerEmail: string;
  name: string;
  description?: string;
  html: string;
}): Promise<{ projectId: string; fileId: string }> {
  const { ownerEmail, name, description, html } = opts;

  const user = await adminDb.auth
    .getUser({ email: ownerEmail })
    .catch(() => null);
  if (!user) {
    throw new Error(
      `No Instant user for ${ownerEmail}. Sign into the Radix app once first, then re-run.`,
    );
  }
  const userId = user.id;

  // Replace any existing project with the same name for this owner (idempotent).
  const existing = await adminDb.query({
    $users: {
      $: { where: { id: userId } },
      projects: { bundle: {} },
    },
  });
  const dupes = (existing.$users[0]?.projects ?? []).filter(
    (p) => p.name === name,
  );
  for (const p of dupes) {
    const txs: ReturnType<typeof adminDb.tx.projects[string]["delete"]>[] = [
      adminDb.tx.projects[p.id].delete(),
    ];
    if (p.bundle) {
      txs.push(adminDb.tx.$files[p.bundle.id].delete() as never);
    }
    await adminDb.transact(txs);
  }

  const projectId = id();
  const path = `projects/${userId}/${projectId}/index.html`;
  const { data } = await adminDb.storage.uploadFile(
    path,
    Buffer.from(html, "utf8"),
    { contentType: "text/html" },
  );
  const fileId = data.id;

  await adminDb.transact([
    adminDb.tx.projects[projectId]
      .update({ name, description, createdAt: Date.now() })
      .link({ owner: userId, bundle: fileId }),
  ]);

  return { projectId, fileId };
}
