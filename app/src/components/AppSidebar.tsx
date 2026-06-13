"use client";

import Link from "next/link";
import { Boxes, Coins, LayoutGrid, LogOut, Plus } from "lucide-react";
import { db } from "@/lib/db";
import type { InstaQLEntity } from "@instantdb/react";
import type { AppSchema } from "@/instant.schema";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";

export type Project = InstaQLEntity<AppSchema, "projects", { bundle: {} }>;

export function AppSidebar({
  projects,
  selectedId,
  onSelect,
  onNewProject,
  userEmail,
}: {
  projects: Project[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNewProject: () => void;
  userEmail?: string;
}) {
  // Owner-scoped by permissions, so this returns just this user's wallet.
  const { data: accountData } = db.useQuery({ accounts: {} });
  const balance = accountData?.accounts?.[0]?.tokenBalance;

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
                  onClick={onNewProject}
                  className="font-medium"
                >
                  <Plus />
                  <span>New project</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Projects</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {projects.length === 0 ? (
                <p className="px-2 py-1.5 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
                  No projects yet.
                </p>
              ) : (
                projects.map((project) => (
                  <SidebarMenuItem key={project.id}>
                    <SidebarMenuButton
                      tooltip={project.name}
                      isActive={project.id === selectedId}
                      onClick={() => onSelect(project.id)}
                    >
                      <LayoutGrid />
                      <span className="truncate">{project.name}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
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
    </Sidebar>
  );
}
