"use client";

import { useState } from "react";
import { Pencil, Plus, Shapes, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RenameDialog } from "@/components/RenameDialog";
import { IconDialog } from "@/components/IconDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  deleteWorkspace,
  renameWorkspace,
  setWorkspaceIcon,
} from "@/lib/projects";

export type MenuWorkspaceFull = {
  id: string;
  name: string;
  icon?: string | null;
};

/**
 * The per-workspace action menu (rename, set icon, new project here, delete).
 * Shared by the sidebar and the dashboard. `trigger` is the clickable element;
 * `onNewProject` starts a new project assigned to this workspace.
 */
export function WorkspaceMenu({
  workspace,
  trigger,
  onNewProject,
  align = "start",
}: {
  workspace: MenuWorkspaceFull;
  trigger: React.ReactNode;
  onNewProject?: () => void;
  align?: "start" | "end";
}) {
  const [renaming, setRenaming] = useState(false);
  const [pickingIcon, setPickingIcon] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent align={align}>
          {onNewProject && (
            <>
              <DropdownMenuItem onSelect={onNewProject}>
                <Plus />
                New project here
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem onSelect={() => setRenaming(true)}>
            <Pencil />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setPickingIcon(true)}>
            <Shapes />
            Set icon
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => setConfirmingDelete(true)}
          >
            <Trash2 />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <RenameDialog
        open={renaming}
        onOpenChange={setRenaming}
        title="Rename workspace"
        initialValue={workspace.name}
        onSubmit={(name) => renameWorkspace(workspace.id, name)}
      />
      <IconDialog
        open={pickingIcon}
        onOpenChange={setPickingIcon}
        title="Set workspace icon"
        value={workspace.icon}
        onSelect={(icon) => setWorkspaceIcon(workspace.id, icon)}
      />
      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title="Delete workspace?"
        description={`"${workspace.name}" will be deleted. Its projects are kept and become Unassigned.`}
        confirmLabel="Delete"
        onConfirm={() => deleteWorkspace(workspace.id)}
      />
    </>
  );
}
