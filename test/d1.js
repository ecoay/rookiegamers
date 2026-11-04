// A small stand-in for a D1 binding on top of node:sqlite, enough for db.js.
import { DatabaseSync } from 'node:sqlite';

export function fakeD1() {
  const sql = new DatabaseSync(':memory:');
  const stmt = (q, args = []) => ({
    bind: (...a) => stmt(q, a),
    run: async () => { const r = sql.prepare(q).run(...args); return { meta: { changes: Number(r.changes) } }; },
    first: async () => sql.prepare(q).get(...args) ?? null,
    all: async () => ({ results: sql.prepare(q).all(...args) }),
  });
  return { prepare: q => stmt(q), batch: async list => Promise.all(list.map(s => s.run())), raw: sql };
}
