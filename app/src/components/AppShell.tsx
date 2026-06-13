"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { id, type User } from "@instantdb/react";
import { db } from "@/lib/db";
import { AppSidebar } from "@/components/AppSidebar";
import { ProjectFrame } from "@/components/ProjectFrame";
import { NewProjectChat } from "@/components/NewProjectChat";
import { EditProjectChat } from "@/components/EditProjectChat";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

type DbDump = Record<string, Record<string, unknown>[]>;

type SchemaField = {
  type: string;
  required?: boolean;
  default?: unknown;
  values?: string[];
  collection?: string;
};
type DbSchema = Record<string, { fields: Record<string, SchemaField>; strict: boolean }>;

type LogEntry = {
  t: number;
  level: "debug" | "info" | "warn" | "error";
  msg: string;
  data?: unknown;
};

function fmtSimTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

const TYPE_BADGE: Record<string, string> = {
  string: "bg-blue-50 text-blue-600",
  number: "bg-green-50 text-green-700",
  boolean: "bg-purple-50 text-purple-700",
  enum: "bg-amber-50 text-amber-700",
  ref: "bg-pink-50 text-pink-700",
};

function DbPanel({
  data,
  schema,
  onReset,
  onRefresh,
}: {
  data: DbDump | null;
  schema: DbSchema | null;
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

  function renderValue(val: unknown, fieldDef: SchemaField | undefined): React.ReactNode {
    if (val === null || val === undefined) return <span className="text-muted-foreground italic">null</span>;
    if (fieldDef?.type === "enum") {
      return <span className="rounded bg-amber-50 px-1 py-0.5 text-amber-700">{String(val)}</span>;
    }
    if (fieldDef?.type === "ref") {
      return <span className="text-pink-600">→ {fieldDef.collection}/{String(val)}</span>;
    }
    if (typeof val === "boolean") return <span className="text-purple-700">{String(val)}</span>;
    if (typeof val === "number") return <span className="text-green-700">{String(val)}</span>;
    return <span>{String(val)}</span>;
  }

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
            const collSchema = schema?.[name];
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
                {collSchema && (
                  <div className="flex flex-wrap gap-1 px-3 pb-1.5">
                    {Object.entries(collSchema.fields).map(([f, fd]) => (
                      <span
                        key={f}
                        className={`rounded px-1 py-0.5 text-xs ${TYPE_BADGE[fd.type] ?? "bg-muted text-muted-foreground"}`}
                        title={fd.type === "enum" ? fd.values?.join(" | ") : fd.type === "ref" ? `→ ${fd.collection}` : fd.type}
                      >
                        {f}
                      </span>
                    ))}
                  </div>
                )}
                {isOpen && (
                  <div className="space-y-1 bg-muted/20 px-2 pb-2">
                    {rows.length === 0 ? (
                      <p className="px-1 py-1 text-xs text-muted-foreground">
                        Empty
                      </p>
                    ) : (
                      rows.map((row, i) => (
                        <div
                          key={i}
                          className="overflow-x-auto rounded bg-white p-1.5 text-xs leading-relaxed"
                        >
                          {collSchema ? (
                            <table className="w-full">
                              <tbody>
                                {Object.entries(row).map(([k, v]) => (
                                  <tr key={k} className="align-top">
                                    <td className="pr-2 text-muted-foreground">{k}</td>
                                    <td>{renderValue(v, collSchema.fields[k])}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <pre>{JSON.stringify(row, null, 2)}</pre>
                          )}
                        </div>
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

const LEVEL_CLASS: Record<LogEntry["level"], string> = {
  debug: "text-muted-foreground",
  info: "text-blue-600",
  warn: "text-amber-500",
  error: "text-red-500",
};

const STEP_PRESETS = [
  { label: "+1s", ms: 1_000 },
  { label: "+1m", ms: 60_000 },
  { label: "+1h", ms: 3_600_000 },
];

function ConsolePanel({
  clockNow,
  clockRunning,
  logEntries,
  onPlay,
  onPause,
  onStep,
}: {
  clockNow: number;
  clockRunning: boolean;
  logEntries: LogEntry[];
  onPlay: () => void;
  onPause: () => void;
  onStep: (ms: number) => void;
}) {
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView();
  }, [logEntries]);

  return (
    <div className="flex w-80 shrink-0 flex-col border-l bg-white text-sm">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="font-medium">Console</span>
        <span className="font-mono text-xs text-muted-foreground">
          T+{fmtSimTime(clockNow)}
        </span>
      </div>

      <div className="flex items-center gap-1.5 border-b px-3 py-2">
        <button
          onClick={clockRunning ? onPause : onPlay}
          className="min-w-[52px] rounded bg-muted px-2.5 py-1 text-xs font-medium hover:bg-muted/60"
        >
          {clockRunning ? "Pause" : "Play"}
        </button>
        {STEP_PRESETS.map(({ label, ms }) => (
          <button
            key={label}
            onClick={() => onStep(ms)}
            className="rounded bg-muted px-2 py-1 text-xs font-medium hover:bg-muted/60"
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto font-mono">
        {logEntries.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            No log entries yet.
          </p>
        ) : (
          logEntries.map((entry, i) => (
            <div
              key={i}
              className="flex gap-2 border-b border-muted/30 px-3 py-1 text-xs last:border-b-0"
            >
              <span className="shrink-0 text-muted-foreground">
                {fmtSimTime(entry.t)}
              </span>
              <span className={`w-10 shrink-0 uppercase ${LEVEL_CLASS[entry.level]}`}>
                {entry.level}
              </span>
              <span className="min-w-0 break-words">{entry.msg}</span>
            </div>
          ))
        )}
        <div ref={logEndRef} />
      </div>
    </div>
  );
}

// The dashboard links back with ?project=<id> or ?new=1[&workspace=<id>].
// Read those once for the initial view. (This component only mounts on the
// client, after auth resolves, so reading window here is safe.)
function readInitialView(): {
  selectedId: string | null;
  creatingId: string | null;
  creatingWorkspaceId: string | undefined;
} {
  const blank = { selectedId: null, creatingId: null, creatingWorkspaceId: undefined };
  if (typeof window === "undefined") return blank;
  const params = new URLSearchParams(window.location.search);
  if (params.get("new")) {
    return {
      selectedId: null,
      creatingId: id(),
      creatingWorkspaceId: params.get("workspace") ?? undefined,
    };
  }
  return { ...blank, selectedId: params.get("project") };
}

export function AppShell({ user }: { user: User }) {
  const [initialView] = useState(readInitialView);
  const [selectedId, setSelectedId] = useState<string | null>(initialView.selectedId);
  // When set, the iframe area is replaced by the new-project chat. The id is
  // generated up front so the agent can create the project under it.
  const [creatingId, setCreatingId] = useState<string | null>(initialView.creatingId);
  // The workspace a new project should be created in, if any.
  const [creatingWorkspaceId, setCreatingWorkspaceId] = useState<string | undefined>(
    initialView.creatingWorkspaceId
  );
  const [showDb, setShowDb] = useState(false);
  const [showConsole, setShowConsole] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  // Bumped after each successful edit to remount the iframe with fresh bundle.
  const [editNonce, setEditNonce] = useState(0);
  const [dbData, setDbData] = useState<DbDump | null>(null);
  const [dbSchema, setDbSchema] = useState<DbSchema | null>(null);
  const [clockNow, setClockNow] = useState(0);
  const [clockRunning, setClockRunning] = useState(false);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const { data } = db.useQuery({
    projects: {
      $: { order: { createdAt: "desc" } },
      bundle: {},
      workspace: {},
    },
    workspaces: {
      $: { order: { createdAt: "asc" } },
    },
  });

  const projects = data?.projects ?? [];
  const workspaces = data?.workspaces ?? [];
  const selected = projects.find((p) => p.id === selectedId) ?? null;

  // The initial view was derived from the URL params (see readInitialView);
  // strip them now so a refresh doesn't re-trigger the same action.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("project") || params.get("new")) {
      window.history.replaceState({}, "", "/");
    }
  }, []);

  const send = useCallback((msg: object) => {
    iframeRef.current?.contentWindow?.postMessage(msg, "*");
  }, []);

  const requestDump = useCallback(() => send({ type: "radix:dump" }), [send]);
  const requestReset = useCallback(() => send({ type: "radix:reset" }), [send]);
  const clockPlay = useCallback(() => send({ type: "radix:clock:play" }), [send]);
  const clockPause = useCallback(() => send({ type: "radix:clock:pause" }), [send]);
  const clockStep = useCallback((ms: number) => send({ type: "radix:clock:step", ms }), [send]);

  useEffect(() => {
    function handler(e: MessageEvent) {
      if (!e.data || typeof e.data !== "object") return;
      const { type } = e.data as { type: string };
      if (type === "radix:dump:response") {
        setDbData(e.data.data as DbDump);
      } else if (type === "radix:reset:done") {
        setDbData(e.data.data as DbDump);
      } else if (type === "radix:db:schema:response") {
        setDbSchema(e.data.schema as DbSchema);
      } else if (type === "radix:clock:state") {
        setClockNow(e.data.now as number);
        setClockRunning(e.data.running as boolean);
      } else if (type === "radix:log:entries") {
        setLogEntries(e.data.entries as LogEntry[]);
      }
    }
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const handleToggleDb = () => {
    if (!showDb) {
      setShowDb(true);
      setTimeout(() => {
        requestDump();
        send({ type: "radix:db:schema" });
      }, 50);
    } else {
      setShowDb(false);
    }
  };

  const handleToggleConsole = () => {
    if (!showConsole) {
      setShowConsole(true);
      setTimeout(() => {
        send({ type: "radix:clock:get" });
        send({ type: "radix:log:get" });
      }, 50);
    } else {
      setShowConsole(false);
    }
  };

  const resetInspectors = () => {
    setDbData(null);
    setDbSchema(null);
    setClockNow(0);
    setClockRunning(false);
    setLogEntries([]);
  };

  const handleSelect = (projectId: string) => {
    setCreatingId(null);
    setSelectedId(projectId);
    setShowEdit(false);
    resetInspectors();
  };

  const handleNewProject = (workspaceId?: string) => {
    setShowDb(false);
    setShowConsole(false);
    setShowEdit(false);
    setCreatingWorkspaceId(workspaceId);
    setCreatingId(id());
  };

  const handleEdited = () => {
    // Remount the preview iframe and clear any stale inspector data.
    setEditNonce((n) => n + 1);
    resetInspectors();
  };

  const handleCreated = (projectId: string) => {
    // The live query will surface the new project; select it so it renders.
    setCreatingId(null);
    setSelectedId(projectId);
    resetInspectors();
  };

  return (
    <SidebarProvider>
      <AppSidebar
        projects={projects}
        workspaces={workspaces}
        selectedId={creatingId ? null : selectedId}
        onSelect={handleSelect}
        onNewProject={handleNewProject}
        userId={user.id}
        userEmail={user.email ?? undefined}
      />
      <SidebarInset className="h-screen overflow-hidden">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <SidebarTrigger />
          <span className="flex-1 text-sm font-medium">
            {creatingId ? "New project" : selected?.name ?? "Radix"}
          </span>
          {selected && !creatingId && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setShowEdit((v) => !v)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  showEdit
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                Edit
              </button>
              <button
                onClick={handleToggleConsole}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  showConsole
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                Console
              </button>
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
            </div>
          )}
        </header>
        <div className="flex min-h-0 flex-1">
          {creatingId ? (
            <NewProjectChat
              projectId={creatingId}
              workspaceId={creatingWorkspaceId}
              user={user}
              onComplete={handleCreated}
              onCancel={() => setCreatingId(null)}
            />
          ) : (
            <ProjectFrame
              // Remount when the project changes or after an edit, so the iframe
              // reloads the freshly-uploaded bundle.
              key={`${selected?.id ?? "none"}:${selected?.bundle?.url ?? ""}:${editNonce}`}
              ref={iframeRef}
              project={selected}
            />
          )}
          {!creatingId && selected && showEdit && (
            <EditProjectChat
              projectId={selected.id}
              projectName={selected.name}
              user={user}
              onEdited={handleEdited}
              onClose={() => setShowEdit(false)}
            />
          )}
          {!creatingId && showConsole && (
            <ConsolePanel
              clockNow={clockNow}
              clockRunning={clockRunning}
              logEntries={logEntries}
              onPlay={clockPlay}
              onPause={clockPause}
              onStep={clockStep}
            />
          )}
          {showDb && (
            <DbPanel
              data={dbData}
              schema={dbSchema}
              onReset={requestReset}
              onRefresh={requestDump}
            />
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
