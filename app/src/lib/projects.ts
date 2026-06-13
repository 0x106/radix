"use client";

// Client-side project & workspace mutations, shared by the sidebar and the
// dashboard. These are thin wrappers over db.transact; permissions
// (instant.perms.ts) scope every write to the owner, so there is no server
// route involved. Deleting a project cascades to its stored bundle ($files);
// deleting a workspace only unlinks its projects (they become "Unassigned").

import { id } from "@instantdb/react";
import { db } from "@/lib/db";

// ---- Projects ----

export function renameProject(projectId: string, name: string) {
  return db.transact(db.tx.projects[projectId].update({ name: name.trim() }));
}

export function setProjectIcon(projectId: string, icon: string) {
  return db.transact(db.tx.projects[projectId].update({ icon }));
}

export function deleteProject(projectId: string) {
  return db.transact(db.tx.projects[projectId].delete());
}

/**
 * Move a project into `targetWorkspaceId`, or pass null to make it Unassigned.
 * `currentWorkspaceId` is the project's existing workspace (if any) so we can
 * unlink it — Instant's unlink needs the linked id.
 */
export function moveProject(
  projectId: string,
  targetWorkspaceId: string | null,
  currentWorkspaceId: string | null
) {
  if (currentWorkspaceId === targetWorkspaceId) return Promise.resolve();
  let tx = db.tx.projects[projectId];
  if (currentWorkspaceId) tx = tx.unlink({ workspace: currentWorkspaceId });
  if (targetWorkspaceId) tx = tx.link({ workspace: targetWorkspaceId });
  return db.transact(tx);
}

// ---- Workspaces ----

/** Create a workspace owned by the given user; returns its new id. */
export function createWorkspace(userId: string, name: string) {
  const workspaceId = id();
  return db
    .transact(
      db.tx.workspaces[workspaceId]
        .update({ name: name.trim(), createdAt: Date.now() })
        .link({ owner: userId })
    )
    .then(() => workspaceId);
}

export function renameWorkspace(workspaceId: string, name: string) {
  return db.transact(db.tx.workspaces[workspaceId].update({ name: name.trim() }));
}

export function setWorkspaceIcon(workspaceId: string, icon: string) {
  return db.transact(db.tx.workspaces[workspaceId].update({ icon }));
}

export function deleteWorkspace(workspaceId: string) {
  return db.transact(db.tx.workspaces[workspaceId].delete());
}
