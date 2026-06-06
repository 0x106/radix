"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { User } from "@instantdb/react";
import { db } from "@/lib/db";
import { AppSidebar } from "@/components/AppSidebar";
import { ProjectFrame } from "@/components/ProjectFrame";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

type DbDump = Record<string, Record<string, unknown>[]>;

function DbPanel({
  data,
  onReset,
  onRefresh,
}: {
  data: DbDump | null;
  onReset: () => void;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const collections = data ? Object.keys(data) : [];
  const totalRows = data
    ? collections.reduce((n, c) => n + data[c].length, 0)
    : 0;

  const toggle = (name: string) =>
    setOpen((s) => ({ ...s, [name]: !s[name] }));

  return (
    <div className="flex w-72 shrink-0 flex-col border-l bg-white text-sm">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="font-medium">Database</span>
        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Refresh
          </button>
          <button
            onClick={onReset}
            className="rounded bg-destructive/10 px-2 py-0.5 text-xs text-destructive hover:bg-destructive/20"
          >
            Reset to seed
          </button>
        </div>
      </div>

      {data === null ? (
        <div className="p-4 text-xs text-muted-foreground">
          No data — this project may not use the Radix runtime.
        </div>
      ) : collections.length === 0 ? (
        <div className="p-4 text-xs text-muted-foreground">
          No collections yet.
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="px-3 py-1.5 text-xs text-muted-foreground">
            {collections.length} collection{collections.length !== 1 ? "s" : ""}{" "}
            · {totalRows} row{totalRows !== 1 ? "s" : ""}
          </div>
          {collections.map((name) => {
            const rows = data[name];
            const isOpen = !!open[name];
            return (
              <div key={name} className="border-b last:border-b-0">
                <button
                  onClick={() => toggle(name)}
                  className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-muted/40"
                >
                  <span className="font-medium">{name}</span>
                  <span className="text-xs text-muted-foreground">
                    {rows.length} {isOpen ? "▲" : "▼"}
                  </span>
                </button>
                {isOpen && (
                  <div className="space-y-1 bg-muted/20 px-2 pb-2">
                    {rows.length === 0 ? (
                      <p className="px-1 py-1 text-xs text-muted-foreground">
                        Empty
                      </p>
                    ) : (
                      rows.map((row, i) => (
                        <pre
                          key={i}
                          className="overflow-x-auto rounded bg-white p-1.5 text-xs leading-relaxed"
                        >
                          {JSON.stringify(row, null, 2)}
                        </pre>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function AppShell({ user }: { user: User }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showDb, setShowDb] = useState(false);
  const [dbData, setDbData] = useState<DbDump | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const { data } = db.useQuery({
    projects: {
      $: { order: { createdAt: "desc" } },
      bundle: {},
    },
  });

  const projects = data?.projects ?? [];
  const selected = projects.find((p) => p.id === selectedId) ?? null;

  const requestDump = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage({ type: "radix:dump" }, "*");
  }, []);

  const requestReset = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: "radix:reset" },
      "*"
    );
  }, []);

  useEffect(() => {
    function handler(e: MessageEvent) {
      if (!e.data || typeof e.data !== "object") return;
      if (e.data.type === "radix:dump:response") {
        setDbData(e.data.data as DbDump);
      } else if (e.data.type === "radix:reset:done") {
        setDbData(e.data.data as DbDump);
      }
    }
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // When the panel opens, immediately request a fresh dump.
  const handleToggleDb = () => {
    if (!showDb) {
      setShowDb(true);
      // Small delay to ensure the panel is mounted before the data arrives,
      // but more importantly to give a just-loaded iframe time to initialise.
      setTimeout(requestDump, 50);
    } else {
      setShowDb(false);
    }
  };

  // Clear stale db data when switching projects.
  const handleSelect = (id: string) => {
    setSelectedId(id);
    setDbData(null);
  };

  return (
    <SidebarProvider>
      <AppSidebar
        projects={projects}
        selectedId={selectedId}
        onSelect={handleSelect}
        userEmail={user.email ?? undefined}
      />
      <SidebarInset className="h-screen overflow-hidden">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <SidebarTrigger />
          <span className="flex-1 text-sm font-medium">
            {selected?.name ?? "Radix"}
          </span>
          {selected && (
            <button
              onClick={handleToggleDb}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                showDb
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              DB
            </button>
          )}
        </header>
        <div className="flex min-h-0 flex-1">
          <ProjectFrame ref={iframeRef} project={selected} />
          {showDb && (
            <DbPanel
              data={dbData}
              onReset={requestReset}
              onRefresh={requestDump}
            />
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
