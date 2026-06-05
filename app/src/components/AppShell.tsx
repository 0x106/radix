"use client";

import { useState } from "react";
import type { User } from "@instantdb/react";
import { db } from "@/lib/db";
import { AppSidebar } from "@/components/AppSidebar";
import { ProjectFrame } from "@/components/ProjectFrame";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

export function AppShell({ user }: { user: User }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data } = db.useQuery({
    projects: {
      $: { order: { createdAt: "desc" } },
      bundle: {},
    },
  });

  const projects = data?.projects ?? [];
  const selected = projects.find((p) => p.id === selectedId) ?? null;

  return (
    <SidebarProvider>
      <AppSidebar
        projects={projects}
        selectedId={selectedId}
        onSelect={setSelectedId}
        userEmail={user.email ?? undefined}
      />
      <SidebarInset className="h-screen overflow-hidden">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <SidebarTrigger />
          <span className="text-sm font-medium">
            {selected?.name ?? "Radix"}
          </span>
        </header>
        <div className="min-h-0 flex-1">
          <ProjectFrame project={selected} />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
