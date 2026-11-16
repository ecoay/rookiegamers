import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from './d1.js';

// db() keeps one promise per module, so each case loads a fresh copy.
const load = () => import('../src/db.js?' + Math.random());
function counted(DB) {
  let n = 0;
  return { DB: { ...DB, prepare: q => { n++; return DB.prepare(q); } }, count: () => n };
}

test('schema runs once per deploy; later instances read one row', async () => {
  const base = fakeD1();
  const env = { DB: base, CF_VERSION_METADATA: { id: 'v1' } };
  await (await load()).db(env);
  assert.equal(base.raw.prepare("SELECT value FROM meta WHERE key = 'schema'").get().value, 'v1');
  const c = counted(base);
  await (await load()).db({ ...env, DB: c.DB });
  assert.equal(c.count(), 1);
});

test('a failed migration still serves when the database answers', async () => {
  const base = fakeD1();
  const broken = { ...base, batch: async () => { throw new Error('D1_ERROR: Network connection lost'); } };
  const DB = await (await load()).db({ DB: broken, CF_VERSION_METADATA: { id: 'v1' } });
  assert.equal(DB, broken);
});

test('a database that does not answer is offline', async () => {
  const dead = { prepare: () => ({ bind() { return this; }, run: async () => { throw new Error('down'); }, first: async () => { throw new Error('down'); }, all: async () => { throw new Error('down'); } }), batch: async () => { throw new Error('down'); } };
  await assert.rejects((await load()).db({ DB: dead }));
});
