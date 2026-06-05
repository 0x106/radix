"use client";

import { Boxes } from "lucide-react";
import type { Project } from "@/components/AppSidebar";

export function ProjectFrame({ project }: { project: Project | null }) {
  if (!project) {
    return (
      <div className="flex h-full flex-1 flex-col items-center justify-center gap-3 bg-muted/30 text-center">
        <div className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Boxes className="size-6" />
        </div>
        <div>
          <p className="font-medium">No project selected</p>
          <p className="text-sm text-muted-foreground">
            Pick a project from the sidebar to run it.
          </p>
        </div>
      </div>
    );
  }

  const url = project.bundle?.url;

  if (!url) {
    return (
      <div className="flex h-full flex-1 items-center justify-center bg-muted/30 text-center">
        <p className="text-sm text-muted-foreground">
          This project has no bundle to render.
        </p>
      </div>
    );
  }

  return (
    <iframe
      // key forces a fresh frame (clean scope) when switching projects.
      key={project.id}
      src={url}
      title={project.name}
      sandbox="allow-scripts"
      className="h-full w-full flex-1 border-0 bg-white"
    />
  );
}
