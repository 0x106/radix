// Radix runtime types — the data foundation.
//
// These declare the shape of `window.radix.db`: the schema-driven entity store a
// prototype uses for all persistent state. The store is a synchronous in-memory
// working set persisted through to IndexedDB so state survives reloads; `reset()`
// wipes it back to the declared seed (the determinism / reset-replay guarantee).
//
// Authoring-time only — nothing here is imported at runtime. The implementation
// ships to the iframe as a browser-JS source string (../source.ts). These types
// document the surface precisely and keep the example prototypes honest about what
// they depend on.

/** A stored entity. Every row carries a string `id`; the rest is app-defined. */
export type Entity = { id: string } & Record<string, unknown>;

/**
 * Filter passed to `db.query`. Each key is matched by equality, or by set
 * membership with `{ in: [...] }` — the single supported operator. The escape
 * hatch for richer filtering is to query broadly and filter in app code.
 */
export type Where = Record<string, unknown | { in: unknown[] }>;

/** Ordering for `db.query`. One field, asc/desc. */
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

/** Field declaration: shorthand type name or full spec. */
export type FieldDef =
  | "string" | "number" | "boolean" | "json" | "ref"
  | {
      type: string;
      values?: string[];        // for enum
      default?: unknown;
      required?: boolean;
      collection?: string;      // for ref
    };

export type SchemaDef = Record<
  string,
  {
    fields?: Record<string, FieldDef>;
    seed?: Record<string, unknown>[];
    /** Append-only: rows may be created but never updated or deleted. */
    immutable?: boolean;
  }
>;

/**
 * The schema-driven entity store. A single seeded store: a synchronous in-memory
 * working set persisted through to IndexedDB so state survives reloads. `reset()`
 * wipes back to the seed.
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
  /** Return all collections and their rows — for inspection and debugging. */
  dump(): Record<string, Entity[]>;
  /**
   * Declare collections: field types (validated on create/update), defaults,
   * seed rows (replayed on reset), and per-collection `immutable: true`
   * (append-only — update/delete throw in strict mode, warn-refuse otherwise).
   */
  define(schema: SchemaDef, opts?: { strict?: boolean }): void;
  /** The registered schema, as normalized by `define`. */
  schema(): Record<string, unknown>;
}
