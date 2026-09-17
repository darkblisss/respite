/* ============================================================
   Respite · db.js · The Cellar
   ------------------------------------------------------------
   The handler talks to Postgres through one small shape:

     db.transaction(async (q) => ...)   one transaction
     q(text, params) -> rows            one statement, $1 style

   These adapters give that shape to postgres.js (the Edge
   Function) and to PGlite (the tests). Rows come back as the
   driver made them: int8 may be a string or a number and jsonb
   may be parsed or not, so the handler converts what it reads.

   Writing SQL for q: pass jsonb as JSON text cast through text,
   `$1::text::jsonb`. postgres.js asks the server for parameter
   types and JSON-encodes anything bound to a jsonb parameter,
   so JSON text bound straight to `$1::jsonb` is stored as one
   long JSON string. PGlite doesn't, so only the wire tests
   (SERVER_TEST_DRIVER=postgres) would notice.
   ============================================================ */

// npm postgres v3. Pass the sql from postgres(url, { prepare: false }).
export function postgresJsAdapter(sql) {
  return {
    async transaction(fn) {
      // begin() treats an array returned by its callback as queries to await, so the value
      // travels in a box.
      const box = await sql.begin(async (tx) => {
        const q = async (text, params = []) => Array.from(await tx.unsafe(text, params));
        return { value: await fn(q) };
      });
      return box.value;
    },
  };
}

// @electric-sql/pglite. One connection, so callers must not run requests side by side.
export function pgliteAdapter(pg) {
  return {
    transaction(fn) {
      return pg.transaction((tx) => fn(async (text, params = []) => (await tx.query(text, params)).rows));
    },
  };
}
