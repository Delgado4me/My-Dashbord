const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

const origin = 'https://example.supabase.co';
const id = 'ab08a476-b987-4efe-b04f-23481f995237';
const rows = new Map();
let inserts = 0, failAfterCommit = true, failBeforeCommit = true;
const storage = new Map([['my-dashboard-supabase-session-v1:' + origin, JSON.stringify({
  access_token: 'mock.jwt', refresh_token: 'mock.refresh', expires_at: Math.floor(Date.now() / 1000) + 3600
})]]);
const fetchMock = async (url, options) => {
  const path = new URL(url);
  if (path.pathname !== '/rest/v1/dashboard_notes') throw new Error('Unexpected URL ' + url);
  if (options.method === 'POST') {
    inserts++;
    const note = JSON.parse(options.body);
    if (note.title === 'Before' && failBeforeCommit) {
      failBeforeCommit = false;
      throw new TypeError('network failed before commit');
    }
    if (rows.has(note.id)) return Response.json({ message: 'duplicate key value violates unique constraint' }, { status: 409 });
    rows.set(note.id, { ...note, updated_at: new Date().toISOString() });
    if (failAfterCommit) { failAfterCommit = false; throw new TypeError('network failed after commit'); }
    return Response.json([rows.get(note.id)], { status: 201 });
  }
  if (options.method === 'PATCH') {
    const row = rows.get(path.searchParams.get('id').slice(3));
    Object.assign(row, JSON.parse(options.body));
    throw new TypeError('network failed after patch');
  }
  const row = rows.get(path.searchParams.get('id').slice(3));
  return Response.json(row ? [row] : []);
};
const window = { DASHBOARD_SUPABASE: { url: origin, publishableKey: 'mock-public-key' } };
vm.runInNewContext(readFileSync('public/backend.js', 'utf8'), {
  window, localStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key)
  }, fetch: fetchMock, Response, URL, URLSearchParams, AbortSignal, Date, JSON, Math,
  encodeURIComponent, setTimeout, Promise, Error, TypeError
});
(async () => {
  const backend = window.dashboardBackend;
  const first = await backend.addNote('After', 'Saved despite timeout', id);
  assert.equal(first[0].id, id);
  assert.equal(inserts, 1);
  const retry = await backend.addNote('After', 'Saved despite timeout', id);
  assert.equal(retry[0].id, id);
  assert.equal(rows.size, 1);
  const updated = await backend.editNote(id, 'Updated', 'After uncertain patch');
  assert.equal(updated[0].title, 'Updated');
  const id2 = 'ab08a476-b987-4efe-b04f-23481f995238';
  await assert.rejects(backend.addNote('Before', 'Needs retry', id2), /network failed/);
  assert.equal(rows.has(id2), false);
  const second = await backend.addNote('Before', 'Needs retry', id2);
  assert.equal(second[0].id, id2);
  assert.equal(rows.size, 2);
  console.log('PASS: reconcile committed timeout, unchanged retry ID, uncertain edit and retry after no commit');
})().catch(error => { console.error(error); process.exitCode = 1; });
