"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Boxes,
  Coins,
  FolderPlus,
  LayoutDashboard,
  LogOut,
  MoreHorizontal,
  Plus,
} from "lucide-react";
import { db } from "@/lib/db";
import type { InstaQLEntity } from "@instantdb/react";
import type { AppSchema } from "@/instant.schema";
import { ProjectIcon } from "@/lib/icons";
import { createWorkspace } from "@/lib/projects";
import { ProjectMenu } from "@/components/ProjectMenu";
import { WorkspaceMenu } from "@/components/WorkspaceMenu";
import { RenameDialog } from "@/components/RenameDialog";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";

export type Project = InstaQLEntity<
  AppSchema,
  "projects",
  { bundle: {}; workspace: {} }
>;
export type Workspace = InstaQLEntity<AppSchema, "workspaces">;

function ProjectRow({
  project,
  workspaces,
  selectedId,
  onSelect,
}: {
  project: Project;
  workspaces: Workspace[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        tooltip={project.name}
        isActive={project.id === selectedId}
        onClick={() => onSelect(project.id)}
      >
        <ProjectIcon name={project.icon} />
        <span className="truncate">{project.name}</span>
      </SidebarMenuButton>
      <ProjectMenu
        project={project}
        workspaces={workspaces}
        align="start"
        trigger={
          <SidebarMenuAction showOnHover>
            <MoreHorizontal />
            <span className="sr-only">Project actions</span>
          </SidebarMenuAction>
        }
      />
    </SidebarMenuItem>
  );
}

export function AppSidebar({
  projects,
  workspaces,
  selectedId,
  onSelect,
  onNewProject,
  userId,
  userEmail,
}: {
  projects: Project[];
  workspaces: Workspace[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNewProject: (workspaceId?: string) => void;
  userId: string;
  userEmail?: string;
}) {
  // Owner-scoped by permissions, so this returns just this user's wallet.
  const { data: accountData } = db.useQuery({ accounts: {} });
  const balance = accountData?.accounts?.[0]?.tokenBalance;

  const [creatingWorkspace, setCreatingWorkspace] = useState(false);

  // Group projects by workspace; collect the unassigned ones separately.
  const unassigned = projects.filter((p) => !p.workspace);
  const byWorkspace = (workspaceId: string) =>
    projects.filter((p) => p.workspace?.id === workspaceId);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="cursor-default" tooltip="Radix">
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Boxes className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">Radix</span>
                <span className="truncate text-xs text-muted-foreground">
                  Prototype workspace
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="New project"
                  onClick={() => onNewProject()}
                  className="font-medium"
                >
                  <Plus />
                  <span>New project</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Dashboard" asChild>
                  <Link href="/dashboard">
                    <LayoutDashboard />
                    <span>Dashboard</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="New workspace"
                  onClick={() => setCreatingWorkspace(true)}
                >
                  <FolderPlus />
                  <span>New workspace</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* One group per workspace, each with its own action menu. */}
        {workspaces.map((workspace) => {
          const items = byWorkspace(workspace.id);
          return (
            <SidebarGroup key={workspace.id}>
              <SidebarGroupLabel>
                <ProjectIcon name={workspace.icon} className="mr-1.5 size-3.5" />
                <span className="truncate">{workspace.name}</span>
              </SidebarGroupLabel>
              <WorkspaceMenu
                workspace={workspace}
                onNewProject={() => onNewProject(workspace.id)}
                align="end"
                trigger={
                  <SidebarGroupAction>
                    <MoreHorizontal />
                    <span className="sr-only">Workspace actions</span>
                  </SidebarGroupAction>
                }
              />
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.length === 0 ? (
                    <p className="px-2 py-1.5 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
                      Empty
                    </p>
                  ) : (
                    items.map((project) => (
                      <ProjectRow
                        key={project.id}
                        project={project}
                        workspaces={workspaces}
                        selectedId={selectedId}
                        onSelect={onSelect}
                      />
                    ))
                  )}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}

        {/* Projects with no workspace. Labelled "Projects" when there are no
            workspaces at all, "Unassigned" otherwise. */}
        <SidebarGroup>
          <SidebarGroupLabel>
            {workspaces.length === 0 ? "Projects" : "Unassigned"}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {unassigned.length === 0 ? (
                <p className="px-2 py-1.5 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
                  No projects yet.
                </p>
              ) : (
                unassigned.map((project) => (
                  <ProjectRow
                    key={project.id}
                    project={project}
                    workspaces={workspaces}
                    selectedId={selectedId}
                    onSelect={onSelect}
                  />
                ))
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              tooltip={balance === undefined ? "Tokens" : `${balance} tokens`}
            >
              <Link href="/billing">
                <Coins />
                <span className="flex-1 truncate">
                  {balance === undefined ? "Tokens" : `${balance} tokens`}
                </span>
                <span className="text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
                  Buy
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Sign out"
              onClick={() => db.auth.signOut()}
            >
              <LogOut />
              <span className="truncate">{userEmail ?? "Sign out"}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />

      <RenameDialog
        open={creatingWorkspace}
        onOpenChange={setCreatingWorkspace}
        title="New workspace"
        initialValue=""
        onSubmit={(name) => createWorkspace(userId, name)}
      />
    </Sidebar>
  );
}
