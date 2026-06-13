// Radix runtime types — the root surface.
//
// `RadixRuntime` is everything a prototype can reach outside itself, exposed in
// the iframe as `window.radix`. The two foundations are co-equal: the data
// foundation (`db`) and the world foundation (`events`/`clock`/`random`/`actor`/
// `services`), tied together by `log` and `stub`.
//
// This module re-exports the full type surface so consumers can import from a
// single entry point (`../runtime/types`).

import type { Db } from "./db";
import type { Events, Clock, Random, Log, Services, ActorConfig, Actor, Stub } from "./world";

export * from "./db";
export * from "./world";

export interface RadixRuntime {
  db: Db;
  events: Events;
  clock: Clock;
  random: Random;
  log: Log;
  /** Create a stateful, async-capable world actor. */
  actor(config: ActorConfig): Actor;
  /** Simulated external service stubs. */
  services: Services;
  /** Declare faked/partial functionality — the real-vs-faked boundary. */
  stub: Stub;
}

declare global {
  interface Window {
    radix: RadixRuntime;
  }
}
