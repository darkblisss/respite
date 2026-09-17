/* ============================================================
   Respite · events.js · The Heralds
   ------------------------------------------------------------
   A small publish/subscribe emitter. The rules announce what
   happened (a level, a death, a crafted piece); listeners decide
   what to do about it: the chronicle writes the camp log, the
   browser shows toasts and redraws.
   ============================================================ */

export function createEmitter() {
  const handlers = new Map();

  return {
    // Returns a function that removes the handler again. "*" hears everything.
    on(type, fn) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(fn);
      return () => handlers.get(type).delete(fn);
    },
    emit(type, payload) {
      const exact = handlers.get(type);
      if (exact) exact.forEach((fn) => fn(payload || {}, type));
      const all = handlers.get("*");
      if (all) all.forEach((fn) => fn(payload || {}, type));
    },
  };
}

// For rules run where nobody is listening: projections and tests.
export const SILENT = Object.freeze({ emit() {}, party: null, fx: false });

/* How the rules announce things. Every payload carries `at` (the simulated
   millisecond it happened, the save's clock unless given) and `state` (the
   save it happened in), so a listener such as the chronicle can date and
   file it. Listeners must leave payload.state alone, the chronicle aside. */
export function emit(state, env, type, payload) {
  if (!env || typeof env.emit !== "function") return;
  const p = Object.assign({}, payload);
  if (p.at == null) p.at = state.clock;
  p.state = state;
  env.emit(type, p);
}
