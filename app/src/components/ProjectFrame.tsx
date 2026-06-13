"use client";

import { forwardRef } from "react";
import { Boxes } from "lucide-react";
import type { Project } from "@/components/AppSidebar";

export const ProjectFrame = forwardRef<
  HTMLIFrameElement,
  { project: Project | null }
>(function ProjectFrame({ project }, ref) {
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
      ref={ref}
      // key forces a fresh frame (clean scope) when switching projects.
      key={project.id}
      src={url}
      title={project.name}
      // allow-scripts runs the bundle; allow-same-origin gives the frame a real
      // (storage) origin so the runtime's IndexedDB persistence works. The bundle
      // is served from the cross-origin InstantDB storage host, so this does NOT
      // grant access to the Radix app's origin. allow-forms lets prototypes use
      // <form> elements without the browser hard-blocking submit events (apps
      // should still preventDefault to avoid a frame-reloading navigation).
      sandbox="allow-scripts allow-same-origin allow-forms"
      className="h-full w-full flex-1 border-0 bg-white"
    />
  );
});
