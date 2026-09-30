const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

const base = 'https://test-project.supabase.co';
const site = 'https://dashboard.example.test';
const ownerId = '00000000-0000-4000-8000-000000000001';
let credential = 'mock-private-repo-token';

function handler(fetch) {
  let serve;
  vm.runInNewContext(readFileSync('supabase/functions/dashboard-obsidian/index.js', 'utf8'), {
    Deno: { env: { get: key => ({ SUPABASE_URL: base, DASHBOARD_SITE_URL: site, DASHBOARD_OWNER_USER_ID: ownerId, DASHBOARD_OBSIDIAN_REPOSITORY: 'example/notes', DASHBOARD_OBSIDIAN_BRANCH: 'main', SUPABASE_ANON_KEY: 'publishable-key', DASHBOARD_OBSIDIAN_GITHUB_TOKEN: credential })[key] }, serve: fn => { serve = fn } },
    fetch, Request, Response, URL, Date, Error, AbortSignal, JSON, Set, Map, Promise,
    encodeURIComponent, Uint8Array, TextDecoder, atob
  });
  return serve;
}

async function run() {
  const auth = async (url) => {
    if (url === base + '/auth/v1/user') return Response.json({ id: ownerId });
    const request = new URL(url);
    if (request.pathname.endsWith('/contents')) return Response.json([
      { type: 'dir', name: 'Haven', path: 'Haven' },
      { type: 'dir', name: '.obsidian', path: '.obsidian' },
      { type: 'dir', name: 'Дашборд', path: 'Дашборд' },
      { type: 'dir', name: 'Cartoons', path: 'Cartoons' }
    ]);
    if (request.pathname.endsWith('/git/trees/main')) return Response.json({ truncated: false, tree: [
      { type: 'blob', path: 'Haven/Secret.md' },
      { type: 'blob', path: 'Дашборд/Новий план.md' },
      { type: 'blob', path: 'Дашборд/План.md' },
      { type: 'blob', path: 'Cartoons/План.md' }
    ] });
    if (decodeURIComponent(request.pathname).endsWith('/contents/Дашборд/Новий план.md'))
      return Response.json({ type: 'file', encoding: 'base64', size: 19,
        content: Buffer.from('# Приватний план\n[[План]]').toString('base64'), sha: 'file-sha' });
    if (request.pathname.endsWith('/commits')) return Response.json([{ sha: 'newer' }, { sha: 'older' }]);
    if (request.pathname.endsWith('/commits/newer')) return Response.json({ sha: 'newer', commit: { committer: { date: '2026-09-26T09:00:00Z' } }, files: [
      { filename: 'Haven/private.md', status: 'modified' },
      { filename: 'Дашборд/Новий план.md', status: 'added' },
      { filename: 'Старий.md', status: 'removed' },
      { filename: 'Новий у корені.md', previous_filename: 'Корінь.md', status: 'renamed' },
      { filename: 'Дашборд/.private.md', status: 'modified' }
    ] });
    if (request.pathname.endsWith('/commits/older')) return Response.json({ sha: 'older', commit: { committer: { date: '2026-09-25T09:00:00Z' } }, files: [
      { filename: 'Старий.md', status: 'modified' },
      { filename: 'Корінь.md', status: 'modified' },
      { filename: 'Cartoons/Попередній план.md', status: 'modified' }
    ] });
    throw new Error('Unexpected request: ' + url);
  };
  const api = handler(auth);
  const request = new Request(base + '/functions/v1/dashboard-obsidian', { headers: { origin: site, authorization: 'Bearer owner-token' } });
  const response = await api(request);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.notes.length, 3);
  assert.equal(data.notes[0].name, 'Новий план.md');
  assert.equal(data.notes[1].name, 'Новий у корені.md');
  assert.equal(data.notes.some(note => ['Старий.md','Корінь.md'].includes(note.path)), false);
  assert.equal(data.notes[0].kind, 'added');
  assert.equal(data.notes[0].url, 'https://github.com/example/notes/blob/main/%D0%94%D0%B0%D1%88%D0%B1%D0%BE%D1%80%D0%B4/%D0%9D%D0%BE%D0%B2%D0%B8%D0%B9%20%D0%BF%D0%BB%D0%B0%D0%BD.md');
  assert.equal(data.notes.some(note => note.path.startsWith('Haven/')), false);

  const read = path => new Request(base + '/functions/v1/dashboard-obsidian?action=read&path=' + encodeURIComponent(path),
    { headers: { origin: site, authorization: 'Bearer owner-token' } });
  const note = await (await api(read('Дашборд/Новий план.md'))).json();
  assert.equal(note.body, '# Приватний план\n[[План]]');
  assert.equal(note.sha, 'file-sha');
  assert.equal((await api(read('Haven/Secret.md'))).status, 400);
  assert.equal((await api(read('Дашборд/../Haven/Secret.md'))).status, 400);
  const resolve = name => new Request(base + '/functions/v1/dashboard-obsidian?action=resolve&name=' + encodeURIComponent(name) + '&from=' + encodeURIComponent('Дашборд/Новий план.md'),
    { headers: { origin: site, authorization: 'Bearer owner-token' } });
  assert.deepEqual((await (await api(resolve('План'))).json()).matches, ['Дашборд/План.md', 'Cartoons/План.md']);
  assert.deepEqual((await (await api(resolve('Secret'))).json()).matches, []);

  const outsider = handler(async (url) => url === base + '/auth/v1/user' ? Response.json({ id: 'other-user' }) : auth(url));
  assert.equal((await outsider(request)).status, 403);
  assert.equal((await outsider(read('Дашборд/Новий план.md'))).status, 403);
  credential = '';
  assert.equal((await handler(auth)(request)).status, 503);
  console.log('PASS: private Obsidian snapshot, Markdown read, link resolution and Haven exclusion');
}

run().catch(error => { console.error(error); process.exitCode = 1 });
