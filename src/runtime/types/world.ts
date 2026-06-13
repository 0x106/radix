// Radix runtime types — the world foundation.
//
// These declare the simulation half of `window.radix`: the event bus, the
// steppable simulated clock, seeded randomness, the log, the external-service
// stubs, and the actor primitive. Together they let reactive and time-driven
// prototypes (chat bots, cron workers, games, collaborative apps) have something
// to react to, deterministically.
//
// Authoring-time only — the implementation ships as a browser-JS source string
// (../source.ts). Imports `Db` so the actor context can expose the full runtime.

import type { Db } from "./db";

/** Unsubscribe handle returned by subscription calls. */
export type Unsubscribe = () => void;

/**
 * The world-simulator event bus. Prototypes subscribe to topics and publish onto
 * them; simulated actors publish here too.
 */
export interface Events {
  subscribe<T = unknown>(topic: string, cb: (payload: T) => void): Unsubscribe;
  publish<T = unknown>(topic: string, payload: T): void;
}

/**
 * Simulated time. The prototype reads this instead of the real clock; all
 * delayed/scheduled work routes through `setTimeout` here so it can be paused,
 * stepped, and fast-forwarded for deterministic replay.
 */
export interface Clock {
  /** Current simulated time, ms since the sim epoch. */
  now(): number;
  /** Whether the clock is currently advancing in real time. */
  isRunning(): boolean;
  /** Resume real-time advance. */
  play(): void;
  /** Halt real-time advance (scheduled callbacks still fire via step/fastForward). */
  pause(): void;
  /** Advance simulated time by `ms`, firing anything due in that window. */
  step(ms: number): void;
  /** Alias for a large `step` — jump simulated time forward. */
  fastForward(ms: number): void;
  /** Schedule `fn` to run after `ms` of *simulated* time. Returns a cancel fn. */
  setTimeout(fn: () => void, ms: number): () => void;
  /** Subscribe to clock state/tick changes (for console UIs). Returns unsubscribe. */
  subscribe(cb: (now: number, running: boolean) => void): Unsubscribe;
  /**
   * Per-animation-frame callback while the clock is playing: cb(simNow).
   * For render loops (frame-loop spine). Game logic should still use
   * `setTimeout` at a fixed simulated timestep so pause/step/fastForward
   * replay deterministically.
   */
  onFrame(cb: (now: number) => void): Unsubscribe;
}

/**
 * Seeded randomness. The prototype MUST use this, never real `Math.random()`, or
 * replay breaks. Same seed ⇒ same sequence.
 */
export interface Random {
  /** Float in [0, 1). */
  random(): number;
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** Pick one element from a non-empty array. */
  pick<T>(arr: readonly T[]): T;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  t: number; // simulated time of the entry
  level: LogLevel;
  msg: string;
  data?: unknown;
}

/**
 * Emit to the simulation console's event log. Callable directly, with level
 * helpers, and subscribable so a debug console can render the log.
 */
export interface Log {
  (level: LogLevel, msg: string, data?: unknown): void;
  debug(msg: string, data?: unknown): void;
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;
  /** All entries so far, in order. */
  entries(): LogEntry[];
  /** Subscribe to the growing log; returns unsubscribe. */
  subscribe(cb: (entries: LogEntry[]) => void): Unsubscribe;
}

/**
 * Simulated external service stubs. Delays are clock-based so they honour
 * pause/step/fastForward. Exposed as `window.radix.services` and on actor ctx.
 */
export interface Services {
  email: {
    send(opts: { to: string; subject: string; body?: string }): Promise<void>;
  };
  payment: {
    charge(opts: { amount: number; description?: string }): Promise<{ transactionId: string; amount: number }>;
  };
  sms: {
    send(opts: { to: string; message: string }): Promise<void>;
  };
}

/**
 * Context object passed to every actor handler. Gives the handler access to its
 * own state plus the full runtime (db, events, clock, random, log, services).
 */
export interface ActorCtx {
  /** The actor's current internal state. Read-only reference — use `set` to mutate. */
  readonly state: Record<string, unknown>;
  /** Shallow-merge `patch` into the actor's state. */
  set(patch: Record<string, unknown>): void;
  db: Db;
  events: Events;
  random: Random;
  clock: Clock;
  log: Log;
  services: Services;
}

/** A tick or start handler — receives ctx, may be async. */
export type TickHandler = (ctx: ActorCtx) => void | Promise<void>;
/** A reactive event handler — receives the event payload and ctx, may be async. */
export type EventHandler = (payload: unknown, ctx: ActorCtx) => void | Promise<void>;

/**
 * Configuration for a world actor. Any combination of timer-based (`tick`) and
 * reactive (`on`) behaviour is valid; both are optional.
 */
export interface ActorConfig {
  /** Initial internal state for this actor. */
  state?: Record<string, unknown>;
  /** Called once when `start()` is invoked. May be async. */
  start?: TickHandler;
  /** Called on each timer tick. May be async; the next tick is not scheduled until it resolves. */
  tick?: TickHandler;
  /** Base interval between ticks in simulated ms. */
  everyMs?: number;
  /** Random ± jitter added to each interval (simulated ms). */
  jitterMs?: number;
  /** Map of event topic → handler. Wired to the event bus on start, torn down on stop. */
  on?: Record<string, EventHandler>;
}

export interface Actor {
  /** Begin ticking and wiring event handlers. */
  start(): void;
  /** Stop ticking and remove all event subscriptions. */
  stop(): void;
  /** Whether the actor is currently running. */
  isRunning(): boolean;
}

/** One declared real-vs-faked boundary. */
export interface StubEntry {
  name: string;
  summary: string;
  /** What the fake does NOT do that the real thing would. */
  missing: string[];
  fidelity: "faked" | "partial" | "canned";
}

/**
 * The graceful-degradation hook. Prototypes declare what is faked or partial; the
 * app and the shell can list the declarations to render an honest "what's real"
 * panel. Honesty about the real-vs-faked boundary is the product's core idea, so
 * it gets an API, not a code comment.
 */
export interface Stub {
  declare(name: string, info?: Partial<Omit<StubEntry, "name">>): StubEntry;
  list(): StubEntry[];
}
