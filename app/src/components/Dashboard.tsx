"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { User, InstaQLEntity } from "@instantdb/react";
import type { AppSchema } from "@/instant.schema";
import {
  ArrowLeft,
  FolderPlus,
  MoreHorizontal,
  Plus,
} from "lucide-react";
import { db } from "@/lib/db";
import { ProjectIcon } from "@/lib/icons";
import { createWorkspace } from "@/lib/projects";
import { Button } from "@/components/ui/button";
import { ProjectMenu } from "@/components/ProjectMenu";
import { WorkspaceMenu } from "@/components/WorkspaceMenu";
import { RenameDialog } from "@/components/RenameDialog";

type Project = InstaQLEntity<AppSchema, "projects", { workspace: {} }>;
type Workspace = InstaQLEntity<AppSchema, "workspaces">;

function ProjectCard({
  project,
  workspaces,
  onOpen,
}: {
  project: Project;
  workspaces: Workspace[];
  onOpen: () => void;
}) {
  return (
    <div className="group relative flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm transition-colors hover:border-foreground/20">
      <button
        onClick={onOpen}
        className="flex flex-1 flex-col items-start gap-3 text-left"
      >
        <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-foreground [&_svg]:size-5">
          <ProjectIcon name={project.icon} />
        </div>
        <div className="min-w-0">
          <p className="truncate font-medium">{project.name}</p>
          {project.description && (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              {project.description}
            </p>
          )}
        </div>
      </button>
      <ProjectMenu
        project={project}
        workspaces={workspaces}
        align="end"
        onOpen={onOpen}
        trigger={
          <Button
            variant="ghost"
            size="icon-sm"
            className="absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100 aria-expanded:opacity-100"
          >
            <MoreHorizontal />
            <span className="sr-only">Project actions</span>
          </Button>
        }
      />
    </div>
  );
}

function Section({
  title,
  icon,
  projects,
  workspaces,
  action,
  onOpenProject,
  emptyText,
}: {
  title: string;
  icon?: React.ReactNode;
  projects: Project[];
  workspaces: Workspace[];
  action?: React.ReactNode;
  onOpenProject: (id: string) => void;
  emptyText: string;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="font-medium">{title}</h2>
        <span className="text-sm text-muted-foreground">{projects.length}</span>
        <div className="ml-auto">{action}</div>
      </div>
      {projects.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          {emptyText}
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              workspaces={workspaces}
              onOpen={() => onOpenProject(project.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export function Dashboard({ user }: { user: User }) {
  const router = useRouter();
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);

  const { data } = db.useQuery({
    projects: {
      $: { order: { createdAt: "desc" } },
      workspace: {},
    },
    workspaces: { $: { order: { createdAt: "asc" } } },
  });

  const projects = data?.projects ?? [];
  const workspaces = data?.workspaces ?? [];
  const unassigned = projects.filter((p) => !p.workspace);

  const openProject = (id: string) => router.push(`/?project=${id}`);

  return (
    <div className="min-h-screen bg-muted/20">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b bg-background px-6 py-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/">
            <ArrowLeft />
            Back to app
          </Link>
        </Button>
        <h1 className="text-sm font-semibold">Dashboard</h1>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setCreatingWorkspace(true)}>
            <FolderPlus />
            New workspace
          </Button>
          <Button size="sm" asChild>
            <Link href="/?new=1">
              <Plus />
              New project
            </Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-8">
        {workspaces.map((workspace) => (
          <Section
            key={workspace.id}
            title={workspace.name}
            icon={
              <span className="flex size-6 items-center justify-center rounded-md bg-muted [&_svg]:size-3.5">
                <ProjectIcon name={workspace.icon} />
              </span>
            }
            projects={projects.filter((p) => p.workspace?.id === workspace.id)}
            workspaces={workspaces}
            onOpenProject={openProject}
            emptyText="No projects in this workspace yet."
            action={
              <WorkspaceMenu
                workspace={workspace}
                onNewProject={() => router.push(`/?new=1&workspace=${workspace.id}`)}
                align="end"
                trigger={
                  <Button variant="ghost" size="icon-sm">
                    <MoreHorizontal />
                    <span className="sr-only">Workspace actions</span>
                  </Button>
                }
              />
            }
          />
        ))}

        <Section
          title={workspaces.length === 0 ? "Projects" : "Unassigned"}
          projects={unassigned}
          workspaces={workspaces}
          onOpenProject={openProject}
          emptyText="No projects yet. Create one to get started."
        />
      </main>

      <RenameDialog
        open={creatingWorkspace}
        onOpenChange={setCreatingWorkspace}
        title="New workspace"
        initialValue=""
        onSubmit={(name) => createWorkspace(user.id, name)}
      />
    </div>
  );
}
