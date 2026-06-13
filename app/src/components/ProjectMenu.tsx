"use client";

import { useState } from "react";
import { FolderInput, Pencil, Shapes, Trash2, SquareArrowOutUpRight } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RenameDialog } from "@/components/RenameDialog";
import { IconDialog } from "@/components/IconDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  deleteProject,
  moveProject,
  renameProject,
  setProjectIcon,
} from "@/lib/projects";

export type MenuProject = {
  id: string;
  name: string;
  icon?: string | null;
  workspace?: { id: string } | null;
};

export type MenuWorkspace = { id: string; name: string };

/**
 * The per-project action menu (rename, set icon, move to workspace, delete),
 * plus an optional "Open" entry. Shared by the sidebar and the dashboard so the
 * actions and dialogs stay consistent. `trigger` is the clickable element.
 */
export function ProjectMenu({
  project,
  workspaces,
  trigger,
  onOpen,
  align = "start",
}: {
  project: MenuProject;
  workspaces: MenuWorkspace[];
  trigger: React.ReactNode;
  onOpen?: () => void;
  align?: "start" | "end";
}) {
  const [renaming, setRenaming] = useState(false);
  const [pickingIcon, setPickingIcon] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const currentWorkspaceId = project.workspace?.id ?? null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent align={align}>
          {onOpen && (
            <>
              <DropdownMenuItem onSelect={onOpen}>
                <SquareArrowOutUpRight />
                Open
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
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <FolderInput />
              Move to workspace
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem
                disabled={currentWorkspaceId === null}
                onSelect={() => moveProject(project.id, null, currentWorkspaceId)}
              >
                None (Unassigned)
              </DropdownMenuItem>
              {workspaces.length > 0 && <DropdownMenuSeparator />}
              {workspaces.map((w) => (
                <DropdownMenuItem
                  key={w.id}
                  disabled={w.id === currentWorkspaceId}
                  onSelect={() =>
                    moveProject(project.id, w.id, currentWorkspaceId)
                  }
                >
                  {w.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
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
        title="Rename project"
        initialValue={project.name}
        onSubmit={(name) => renameProject(project.id, name)}
      />
      <IconDialog
        open={pickingIcon}
        onOpenChange={setPickingIcon}
        title="Set project icon"
        value={project.icon}
        onSelect={(icon) => setProjectIcon(project.id, icon)}
      />
      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title="Delete project?"
        description={`"${project.name}" and its build will be permanently deleted. This can't be undone.`}
        confirmLabel="Delete"
        onConfirm={() => deleteProject(project.id)}
      />
    </>
  );
}
