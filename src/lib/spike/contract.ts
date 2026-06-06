// Radix runtime contract — PHASE 0 SPIKE.
//
// This file is the *typed half* of the spec we're discovering. It declares the
// shape of `window.radix` — the handles a prototype uses to talk to "the library
// of fakes" (notes.md §5). It is authored-time-only: the actual implementation
// ships to the iframe as a browser-JS source string (see ./runtimeSource.ts),
// so nothing here is imported at runtime. These types exist to (a) document the
// surface precisely, (b) keep the three spike prototypes honest about what they
// depend on, and (c) feed runtime-contract.md.
//
// THROWAWAY: the real, frozen runtime API is Phase 1. This is the dartboard, not
// the dart. Only the handles the three spike apps actually exercise are modelled
// — `db`, `events`, `clock`, `random`, `log`, plus the `actor` simulator
// primitive. The rest of the eventual ~12 handles (`api`, `services`, `sensors`,
// `host`, `storage`, `stub`) are deliberately absent; runtime-contract.md notes
// where they'd slot.

/** A stored entity. Every row carries a string `id`; the rest is app-defined. */
export type Entity = { id: string } & Record<string, unknown>;

/** Filter passed to `db.query`. Equality-only for the spike — see contract notes. */
export type Where = Record<string, unknown>;

/** Ordering for `db.query`. One field, asc/desc — matches what the apps needed. */
export type Order = { field: string; dir: "asc" | "desc" };

/** One inline relation to resolve. `from` is the collection; `on` is the FK field on the queried row. */
export type IncludeSpec = { from: string; on: string };
/** Map of embedded-property-name → relation spec, passed as `args.include` to `db.query`. */
export type Include = Record<string, IncludeSpec>;

export interface QueryArgs {
  where?: Where;
  order?: Order;
  limit?: number;
  include?: Include;
}

/**
 * The schema-driven entity store (plan.md Phase 2). For the spike it is a single
 * hand-written, seeded store: a synchronous in-memory working set persisted
 * through to IndexedDB so state survives reloads. `reset()` wipes back to the
 * seed (the determinism / reset-replay concern, notes.md §9).
 */
export interface Db {
  /** Insert a row into `collection`; returns the created entity (id auto-filled). */
  create(collection: string, data: Record<string, unknown>): Entity;
  /** Shallow-merge `patch` into the row; returns the updated entity. */
  update(collection: string, id: string, patch: Record<string, unknown>): Entity;
  /** Remove a row. */
  delete(collection: string, id: string): void;
  /** Fetch one row by id (or undefined). */
  get(collection: string, id: string): Entity | undefined;
  /** List rows in a collection, optionally filtered/ordered/limited. */
  query(collection: string, args?: QueryArgs): Entity[];
  /** Subscribe to changes in a collection; returns an unsubscribe fn. */
  subscribe(collection: string, cb: (rows: Entity[]) => void): () => void;
  /** Wipe all collections back to the seed (reset-to-seed). */
  reset(): void;
}

/** Unsubscribe handle returned by subscription calls. */
export type Unsubscribe = () => void;

/**
 * The world-simulator event bus (plan.md Phase 3). Prototypes subscribe to topics
 * and publish onto them; simulated actors publish here too.
 */
export interface Events {
  subscribe<T = unknown>(topic: string, cb: (payload: T) => void): Unsubscribe;
  publish<T = unknown>(topic: string, payload: T): void;
}

/**
 * Simulated time (notes.md §9). The prototype reads this instead of the real
 * clock; all delayed/scheduled work routes through `setTimeout` here so it can be
 * paused, stepped, and fast-forwarded for deterministic replay.
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
}

/**
 * Seeded randomness (notes.md §9). The prototype MUST use this, never real
 * `Math.random()`, or replay breaks. Same seed ⇒ same sequence.
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
 * Emit to the simulation console's event log (notes.md §5). Callable directly,
 * with level helpers, and subscribable so a debug console can render the log.
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
 * A simulated actor / world-process (plan.md Phase 3, notes.md §3/§12): a seeded,
 * clock-driven process that publishes events over time. Configured per app (a
 * chat "other person", a cron tick). This is the hand-written precursor to the
 * one configurable simulator engine.
 */
export interface ActorConfig {
  /** Topic the actor publishes onto. */
  topic: string;
  /** Base delay between emissions, in simulated ms. */
  everyMs: number;
  /** Random +/- jitter applied to each delay (simulated ms). Seeded. */
  jitterMs?: number;
  /** Produce the next payload to publish. `n` is the emission index. */
  produce: (n: number) => unknown;
  /** Stop after this many emissions (default: unbounded). */
  count?: number;
}

export interface Actor {
  /** Begin emitting on the clock. */
  start(): void;
  /** Stop emitting. */
  stop(): void;
  /** Whether it is currently running. */
  isRunning(): boolean;
}

/**
 * Everything a Radix prototype can reach outside itself, for the Phase 0 spike.
 * Exposed in the iframe as `window.radix`.
 */
export interface RadixRuntime {
  db: Db;
  events: Events;
  clock: Clock;
  random: Random;
  log: Log;
  /** Spawn a seeded, clock-driven world actor. */
  spawn(config: ActorConfig): Actor;
}

declare global {
  interface Window {
    radix: RadixRuntime;
  }
}
