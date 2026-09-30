const env = key => Deno.env.get(key) || '';
const site = env('DASHBOARD_SITE_URL').replace(/\/$/, '');
const ownerId = env('DASHBOARD_OWNER_USER_ID');
const allowedOrigins = [site, ...env('DASHBOARD_ALLOWED_ORIGINS').split(',').map(x=>x.trim().replace(/\/$/,''))].filter(value=>{try{const url=new URL(value);return url.protocol==='https:'&&url.origin===value}catch{return false}});
const repository = env('DASHBOARD_OBSIDIAN_REPOSITORY');
const branch = env('DASHBOARD_OBSIDIAN_BRANCH') || 'main';
const prefix = env('DASHBOARD_OBSIDIAN_PATH_PREFIX').replace(/^\/+|\/+$/g, '');
const api = 'https://api.github.com/repos/' + repository;
function configured() {
  try { const url=new URL(site);return url.protocol==='https:' && url.origin===site && Boolean(ownerId) && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) && branch.length<250 && !/[\x00-\x1f]/.test(branch) && (!prefix||!prefix.split('/').some(p=>!p||p==='.'||p==='..'||p.startsWith('.'))); } catch { return false; }
}
function originalUrl(path) { return 'https://github.com/' + repository + '/blob/' + encodeURIComponent(branch) + '/' + path.split('/').map(encodeURIComponent).join('/'); }
// Read-only snapshot of Markdown changes in the owner's private Obsidian vault.
// The repository credential stays in Supabase Edge Function secrets.
const headers = {
  'Access-Control-Allow-Origin': site,
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Cache-Control': 'no-store',
  'Vary': 'Origin'
};
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { ...headers, 'Content-Type': 'application/json' }
});
const publishable = () => env('SUPABASE_ANON_KEY') || JSON.parse(env('SUPABASE_PUBLISHABLE_KEYS') || '{}').default;

async function owner(request) {
  const bearer = request.headers.get('Authorization') || '';
  if (!bearer.startsWith('Bearer ')) return false;
  const response = await fetch(env('SUPABASE_URL') + '/auth/v1/user', {
    headers: { apikey: publishable(), Authorization: bearer }
  });
  if (!response.ok) return false;
  const user = await response.json();
  return user.id === ownerId;
}

async function github(path) {
  const response = await fetch(api + path, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + env('DASHBOARD_OBSIDIAN_GITHUB_TOKEN'),
      'X-GitHub-Api-Version': '2022-11-28'
    },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(response.status === 404
    ? 'Файл не знайдено в GitHub або до нього немає доступу.'
    : response.status === 401 || response.status === 403
    ? 'Перевірте доступ токена до приватного репозиторію Obsidian.'
    : 'GitHub тимчасово не відповідає (' + response.status + ').');
  return response.json();
}

function allowed(path) {
  return typeof path === 'string' && path.length <= 500 && /\.md$/i.test(path) && (!prefix || path.startsWith(prefix + '/')) &&
    !/[\\\u0000-\u001f]/.test(path) && !path.split('/').some(part =>
      !part || part === '.' || part === '..' || part === 'Haven' || part.startsWith('.') || part === 'node_modules'
    );
}

async function readNote(path) {
  if (!allowed(path)) return json({ error: 'Цей шлях недоступний.' }, 400);
  const parts = path.split('/');
  const response = await github('/contents/' + parts.map(encodeURIComponent).join('/') + '?ref=' + encodeURIComponent(branch));
  if (response.type !== 'file' || response.encoding !== 'base64' || response.size > 262144 ||
      typeof response.content !== 'string') return json({ error: 'Файл занадто великий або не є текстовим Markdown.' }, 422);
  const bytes = Uint8Array.from(atob(response.content.replace(/\s/g, '')), character => character.charCodeAt(0));
  if (bytes.byteLength > 262144) return json({ error: 'Файл завеликий для перегляду.' }, 422);
  const body = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return json({ path, name: parts.at(-1), folder: parts.slice(0, -1).join('/'),
    body, sha: response.sha, url: originalUrl(path), checkedAt: new Date().toISOString() });
}

async function resolveNote(name, from) {
  if (typeof name !== 'string' || !name.trim() || name.length > 300 ||
      /[\\\u0000-\u001f]/.test(name) || !allowed(from)) return json({ error: 'Недійсне посилання.' }, 400);
  const target = name.trim().replace(/\.md$/i, '') + '.md';
  const tree = await github('/git/trees/' + encodeURIComponent(branch) + '?recursive=1');
  if (tree.truncated || !Array.isArray(tree.tree)) return json({ error: 'Список файлів неповний. Відкрийте файл у GitHub.' }, 503);
  const all = tree.tree.filter(item => item.type === 'blob' && allowed(item.path)).map(item => item.path);
  const folder = from.split('/').slice(0, -1).join('/');
  const exact = folder + '/' + target;
  const candidates = all.filter(path => path === exact || path === target || path.endsWith('/' + target));
  return json({ matches: candidates.sort((a, b) => (a === exact ? -1 : b === exact ? 1 : a.localeCompare(b))).slice(0, 20),
    partial: candidates.length > 20 });
}

async function snapshot() {
  const seen = new Set(), notes = [];
  let partial = false, exhausted = false;
  // GitHub's repository history includes root Markdown and every folder in a
  // single newest-first order. Only the full view uses all 20; home shows five.
  for (let page = 1; page <= 3 && notes.length < 20; page++) {
    const commits = await github('/commits?sha=' + encodeURIComponent(branch) + '&per_page=100&page=' + page);
    if (!Array.isArray(commits)) throw new Error('Не вдалося прочитати історію Obsidian.');
    if (commits.length < 100) exhausted = true;
    for (let index = 0; index < commits.length && notes.length < 20; index += 4) {
      const batch = await Promise.allSettled(commits.slice(index, index + 4).map(entry =>
        github('/commits/' + encodeURIComponent(entry.sha) + '?per_page=100')));
      for (const result of batch) {
        if (result.status === 'rejected') { partial = true; continue; }
        const commit = result.value;
        if (!Array.isArray(commit.files)) { partial = true; continue; }
        if (commit.files.length >= 100) partial = true;
        for (const change of commit.files) {
          if (change.status === 'renamed' && allowed(change.previous_filename)) seen.add(change.previous_filename);
          const path = change.filename;
          if (!allowed(path) || seen.has(path)) continue;
          seen.add(path);
          if (change.status === 'removed' || notes.length >= 20) continue;
          const parts = path.split('/');
          notes.push({ path, name: parts.at(-1), folder: parts.slice(0, -1).join('/'),
            kind: change.status === 'added' ? 'added' : 'edited',
            updatedAt: commit.commit.committer.date, sha: commit.sha,
            url: originalUrl(path) });
        }
      }
    }
    if (exhausted) break;
  }
  if (!exhausted && notes.length < 20) partial = true;
  return { notes, checkedAt: new Date().toISOString(), partial };
}

async function handleRequest(request) {
  if (!configured()) return json({ error: 'Налаштуйте адресу сайту, власника та репозиторій Obsidian на сервері.' }, 503);
  if (request.headers.get('Origin') && !allowedOrigins.includes(request.headers.get('Origin'))) return json({ error: 'Origin forbidden' }, 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  try {
    if (!await owner(request)) return json({ error: 'Доступ лише власнику дашборда.' }, 403);
    if (!env('DASHBOARD_OBSIDIAN_GITHUB_TOKEN')) return json({ error: 'Для читання приватного Obsidian потрібен токен GitHub у налаштуваннях сервера.' }, 503);
    const url = new URL(request.url);
    const action = url.searchParams.get('action') || 'snapshot';
    if (action === 'read') return await readNote(url.searchParams.get('path'));
    if (action === 'resolve') return await resolveNote(url.searchParams.get('name'), url.searchParams.get('from'));
    if (action !== 'snapshot') return json({ error: 'Невідома дія.' }, 400);
    return json(await snapshot());
  } catch (error) {
    return json({ error: error?.message || 'Не вдалося оновити Obsidian.' }, 502);
  }

}
Deno.serve(async request => {
  const response = await handleRequest(request);
  const origin = request.headers.get('Origin');
  if (origin && allowedOrigins.includes(origin)) response.headers.set('Access-Control-Allow-Origin', origin);
  return response;
});
