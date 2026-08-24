/**
 * Process-wide singletons for the in-memory stores.
 *
 * Why this exists: Next.js compiles route handlers, server components and
 * pages into separate server bundles. A plain `const map = new Map()` at module
 * scope is therefore instantiated once PER BUNDLE, so an order created by
 * `POST /api/v1/orders` is invisible to the `/admin/orders` page — they hold
 * different Maps. `next dev` makes it worse: every hot reload re-evaluates the
 * module and throws the previous Map away.
 *
 * Hanging the state off `globalThis` gives every bundle in the process the same
 * object, and lets it survive a hot reload.
 *
 * This is a POC scaffold, not a persistence strategy. It is still per-process,
 * still lost on restart, and still wrong for more than one server instance —
 * a real database replaces it.
 */

const REGISTRY = Symbol.for("coffie.memory-store");

type Registry = Map<string, unknown>;

function registry(): Registry {
  const host = globalThis as typeof globalThis & { [REGISTRY]?: Registry };
  host[REGISTRY] ??= new Map<string, unknown>();
  return host[REGISTRY];
}

/**
 * Get the single instance of `key`, creating it with `create` the first time.
 * Every bundle that asks for the same key gets the same object back.
 */
export function shared<T>(key: string, create: () => T): T {
  const store = registry();
  if (!store.has(key)) {
    store.set(key, create());
  }
  return store.get(key) as T;
}

/** Mutable counters and other scalars, which cannot live behind `shared`. */
export interface Counter {
  value: number;
}

export function sharedCounter(key: string, start: number): Counter {
  return shared<Counter>(key, () => ({ value: start }));
}
