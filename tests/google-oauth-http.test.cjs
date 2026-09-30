const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const base = 'https://test-project.supabase.co';
const site = 'https://dashboard.example.test';
const env = {
  SUPABASE_URL: base,
  DASHBOARD_SITE_URL: site, DASHBOARD_OWNER_USER_ID: 'owner-1', DASHBOARD_GOOGLE_EMAIL: 'owner@example.test',
  SUPABASE_SERVICE_ROLE_KEY: 'mock-server-secret',
  SUPABASE_ANON_KEY: 'mock-public-key',
  DASHBOARD_GOOGLE_CLIENT_ID: 'mock-client-id',
  DASHBOARD_GOOGLE_CLIENT_SECRET: 'mock-client-secret'
};

function functionHandler(path, fetch) {
  let handler;
  vm.runInNewContext(readFileSync(path, 'utf8'), {
    Deno: { env: { get: key => env[key] }, serve: fn => { handler = fn; } },
    fetch, crypto: webcrypto, TextEncoder, TextDecoder, Request, Response,
    URL, URLSearchParams, Date, Uint8Array, Set, JSON, Error, btoa, atob,
    console: { warn: () => {} }
  }, { filename: path });
  return handler;
}

async function testStart() {
  let inserted = false;
  const fetch = async (url, options) => {
    if (url === base + '/auth/v1/user') return Response.json({ id: 'owner-1' });
    if (url === base + '/rest/v1/dashboard_google_states' && options.method === 'POST') {
      inserted = true;
      return new Response(null, { status: 201 }); // PostgREST default write response
    }
    throw new Error('Unexpected request ' + url);
  };
  const handler = functionHandler('supabase/functions/dashboard-google/index.js', fetch);
  const result = await handler(new Request(base + '/functions/v1/dashboard-google?action=start', {
    method: 'POST', headers: { origin: site, authorization: 'Bearer mock-user-jwt' }
  }));
  assert.equal(result.status, 200);
  assert.equal(inserted, true);
  const authorization = new URL((await result.json()).url);
  assert.equal(authorization.hostname, 'accounts.google.com');
  assert.equal(authorization.searchParams.get('redirect_uri'), base + '/functions/v1/dashboard-google-callback');
  assert.match(authorization.searchParams.get('scope'), /gmail\.modify/);
  assert.match(authorization.searchParams.get('scope'), /calendar\.events(?:\s|$)/);
}

async function testCallback() {
  let inserted = false;
  const fetch = async (url, options) => {
    if (url.startsWith(base + '/rest/v1/dashboard_google_states?') && options.method === 'DELETE')
      return Response.json([{ user_id: 'owner-1' }]);
    if (url === 'https://oauth2.googleapis.com/token')
      return Response.json({ access_token: 'mock-google-access', refresh_token: 'mock-google-refresh', scope: 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar.events' });
    if (url === 'https://openidconnect.googleapis.com/v1/userinfo')
      return Response.json({ email: 'owner@example.test', email_verified: true });
    if (url.startsWith(base + '/rest/v1/dashboard_google_connections?') && options.method === 'POST') {
      inserted = true;
      return new Response(null, { status: 201 });
    }
    throw new Error('Unexpected request ' + url);
  };
  const handler = functionHandler('supabase/functions/dashboard-google-callback/index.js', fetch);
  const state = 'x'.repeat(43);
  const result = await handler(new Request(base + '/functions/v1/dashboard-google-callback?state=' + state + '&code=mock-code'));
  assert.equal(result.status, 303);
  assert.equal(result.headers.get('location'), site + '/?google=connected');
  assert.equal(inserted, true);
}

async function testRejectedTokenHasSafeReason() {
  const fetch = async (url, options) => {
    if (url.startsWith(base + '/rest/v1/dashboard_google_states?') && options.method === 'DELETE')
      return Response.json([{ user_id: 'owner-1' }]);
    if (url === 'https://oauth2.googleapis.com/token')
      return Response.json({ error: 'invalid_client' }, { status: 401 });
    throw new Error('Unexpected request ' + url);
  };
  const handler = functionHandler('supabase/functions/dashboard-google-callback/index.js', fetch);
  const response = await handler(new Request(base + '/functions/v1/dashboard-google-callback?state=' + 'x'.repeat(43) + '&code=mock-code'));
  const redirect = new URL(response.headers.get('location'));
  assert.equal(redirect.searchParams.get('google'), 'error');
  assert.equal(redirect.searchParams.get('reason'), 'token_exchange');
  assert.equal(redirect.searchParams.has('code'), false);
}

async function testIndependentGoogleFeeds() {
  const root = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(env.SUPABASE_SERVICE_ROLE_KEY), 'HKDF', false, ['deriveKey']);
  const key = await webcrypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('dashboard-google-oauth-v1'), info: new TextEncoder().encode('refresh-token') }, root, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const iv = new Uint8Array(12);
  const cipher = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode('mock-refresh')));
  const fetch = async input => {
    const url = String(input);
    if (url === base + '/auth/v1/user') return Response.json({ id: 'owner-1' });
    if (url.startsWith(base + '/rest/v1/dashboard_google_connections?')) return Response.json([{google_email:'owner@example.test',refresh_token_ciphertext:Buffer.from(cipher).toString('base64'),refresh_token_iv:Buffer.from(iv).toString('base64')}]);
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'mock-access' });
    if (url.startsWith('https://www.googleapis.com/calendar/v3/')) return Response.json({ error: { details: [{ reason: 'SERVICE_DISABLED' }] } }, { status: 403 });
    if (url.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/messages/')) {
      const id=url.split('/messages/')[1].split('?')[0];
      return Response.json({ id,threadId:'thread-'+id,labelIds:id==='read-mail'?['INBOX']:['INBOX','UNREAD'],snippet:'Тест',payload:{headers:[{name:'From',value:'Alex'},{name:'Subject',value:'Перевірка'}]} });
    }
    if (url.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/messages?')) {
      assert.equal(new URL(url).searchParams.get('q'),'in:inbox -category:promotions -category:social');
      return Response.json({ messages:[{id:'mail-1'},{id:'read-mail'}] });
    }
    throw new Error('Unexpected request ' + url);
  };
  const handler = functionHandler('supabase/functions/dashboard-google/index.js', fetch);
  const url = base + '/functions/v1/dashboard-google?action=snapshot&day=2026-09-26&start=2026-09-25T21%3A00%3A00.000Z&end=2026-09-26T21%3A00%3A00.000Z';
  const response = await handler(new Request(url, { headers: {origin:site, authorization:'Bearer mock-user-jwt'} }));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.mails[0].subject, 'Перевірка');
  assert.equal(data.mails[0].unread,true);
  assert.equal(data.mails[1].unread,false);
  assert.deepEqual(data.events, []);
  assert.match(data.errors.calendar, /API вимкнено в Google Cloud \(403\)/);
  assert.equal(data.errors.mail, undefined);
}

async function testFullMessageReadAndIsolation() {
  const root = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(env.SUPABASE_SERVICE_ROLE_KEY), 'HKDF', false, ['deriveKey']);
  const key = await webcrypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('dashboard-google-oauth-v1'), info: new TextEncoder().encode('refresh-token') }, root, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const iv = new Uint8Array(12);
  const cipher = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode('mock-refresh')));
  const fetch = async url => {
    if (url === base + '/auth/v1/user') return Response.json({ id: 'owner-1' });
    if (url.startsWith(base + '/rest/v1/dashboard_google_connections?')) return Response.json([{ google_email: 'owner@example.test', refresh_token_ciphertext: Buffer.from(cipher).toString('base64'), refresh_token_iv: Buffer.from(iv).toString('base64') }]);
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'mock-access' });
    if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/html-1?format=full') return Response.json({
      id: 'html-1', threadId: 'thread-2', payload: { mimeType: 'text/html', headers: [],
        body: { data: Buffer.from('<style>bad</style><p>Дата: <b>завтра</b> &amp; квиток</p><script>evil()</script><img src="https://tracker.example/pixel">').toString('base64url') } }
    });
    if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/mail-1?format=full') return Response.json({
      id: 'mail-1', threadId: 'thread-1', payload: { mimeType: 'multipart/mixed', headers: [
        { name: 'Subject', value: 'Гарантія' }, { name: 'From', value: 'Sender <s@example.com>' },
        { name: 'To', value: 'owner@example.test' }, { name: 'Date', value: 'Sat, 26 Sep 2026 08:00:00 +0300' }
      ], parts: [
        { mimeType: 'multipart/alternative', parts: [
          { mimeType: 'text/plain', body: { data: Buffer.from('Повний текст.\nДругий рядок.').toString('base64url') } },
          { mimeType: 'text/html', body: { data: Buffer.from('<img src="https://tracker.example/pixel"><script>alert(1)</script>').toString('base64url') } }
        ] },
        { filename: 'Гарантія.pdf', mimeType: 'application/pdf', body: { attachmentId: 'private-attachment-id', size: 42 } }
      ] }
    });
    throw new Error('Unexpected request ' + url);
  };
  const handler = functionHandler('supabase/functions/dashboard-google/index.js', fetch);
  const headers = { origin: site, authorization: 'Bearer mock-user-jwt' };
  const response = await handler(new Request(base + '/functions/v1/dashboard-google?action=message&id=mail-1', { headers }));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.body, 'Повний текст.\nДругий рядок.');
  assert.equal(data.account, 'owner@example.test');
  assert.deepEqual(data.attachments.map(x => x.name), ['Гарантія.pdf']);
  assert.equal(JSON.stringify(data).includes('private-attachment-id'), false);
  assert.equal(JSON.stringify(data).includes('tracker.example'), false);
  const htmlResponse = await handler(new Request(base + '/functions/v1/dashboard-google?action=message&id=html-1', { headers }));
  assert.equal(htmlResponse.status, 200);
  const html = await htmlResponse.json();
  assert.match(html.body, /Дата:\s+завтра\s+& квиток/);
  assert.equal(/bad|evil|tracker|<b>/.test(html.body), false);
  const invalid = await handler(new Request(base + '/functions/v1/dashboard-google?action=message&id=../Haven', { headers }));
  assert.equal(invalid.status, 400);
  const outsider = await handler(new Request(base + '/functions/v1/dashboard-google?action=message&id=mail-1', { headers: { origin: site } }));
  assert.equal(outsider.status, 401);
}

async function testMailboxPagesAndFilters() {
  const root = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(env.SUPABASE_SERVICE_ROLE_KEY), 'HKDF', false, ['deriveKey']);
  const key = await webcrypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('dashboard-google-oauth-v1'), info: new TextEncoder().encode('refresh-token') }, root, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const iv = new Uint8Array(12), cipher = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode('mock-refresh')));
  const fetch = async input => {
    const url = String(input);
    if (url === base + '/auth/v1/user') return Response.json({ id: 'owner-1' });
    if (url.startsWith(base + '/rest/v1/dashboard_google_connections?')) return Response.json([{ google_email: 'owner@example.test', refresh_token_ciphertext: Buffer.from(cipher).toString('base64'), refresh_token_iv: Buffer.from(iv).toString('base64') }]);
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'mock-access' });
    if (url.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/messages?')) {
      const query = new URL(url).searchParams;
      assert.equal(query.get('maxResults'), '20');
      if (query.get('q') === 'is:important') return Response.json({ messages: [{ id: 'important' }] });
      if (query.get('pageToken') === 'next_1') return Response.json({ messages: [{ id: 'older' }] });
      assert.equal(query.get('q'), 'in:inbox');
      return Response.json({ messages: [{ id: 'recent' }], nextPageToken: 'next_1' });
    }
    if (url.includes('?format=metadata')) {
      const id = url.split('/messages/')[1].split('?')[0];
      return Response.json({ id, threadId: 'thread-' + id, labelIds: id === 'older' ? [] : ['UNREAD','IMPORTANT'], payload: { headers: [{ name: 'From', value: 'Sender' }, { name: 'Subject', value: id }] }, snippet: 'Text' });
    }
    throw new Error('Unexpected request ' + url);
  };
  const handler = functionHandler('supabase/functions/dashboard-google/index.js', fetch);
  const headers = { origin: site, authorization: 'Bearer mock-user-jwt' };
  const get = async params => handler(new Request(base + '/functions/v1/dashboard-google?action=list&' + params, { headers }));
  const first = await (await get('folder=inbox')).json();
  assert.equal(first.mails[0].id, 'recent');
  assert.equal(first.mails[0].unread, true);
  assert.equal(first.nextPageToken, 'next_1');
  const next = await (await get('folder=inbox&pageToken=next_1')).json();
  assert.equal(next.mails[0].id, 'older');
  assert.equal(next.mails[0].unread, false);
  assert.equal(next.nextPageToken, '');
  assert.equal((await (await get('folder=important')).json()).mails[0].important, true);
  assert.equal((await get('folder=spam')).status, 400);
  assert.equal((await get('folder=inbox&pageToken=%2Fbad')).status, 400);
}

async function testArchiveRequiresConsentAndUpdatesGmail() {
  const root = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(env.SUPABASE_SERVICE_ROLE_KEY), 'HKDF', false, ['deriveKey']);
  const key = await webcrypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('dashboard-google-oauth-v1'), info: new TextEncoder().encode('refresh-token') }, root, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const iv = new Uint8Array(12), cipher = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode('mock-refresh')));
  let scope='https://www.googleapis.com/auth/gmail.readonly', inbox=true, unread=true, important=false, writes=0;
  const labels=()=>[...(inbox?['INBOX']:[]),...(unread?['UNREAD']:[]),...(important?['IMPORTANT']:[])];
  const fetch = async (input,options={}) => {
    const url=String(input);
    if(url===base+'/auth/v1/user')return Response.json({id:'owner-1'});
    if(url.startsWith(base+'/rest/v1/dashboard_google_connections?'))return Response.json([{google_email:'owner@example.test',scopes:scope,refresh_token_ciphertext:Buffer.from(cipher).toString('base64'),refresh_token_iv:Buffer.from(iv).toString('base64')}]);
    if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'mock-access'});
    if(url==='https://gmail.googleapis.com/gmail/v1/users/me/messages/mail-1?format=metadata&fields=id,labelIds')return Response.json({id:'mail-1',labelIds:labels()});
    if(url==='https://gmail.googleapis.com/gmail/v1/users/me/messages/mail-1/modify'){
      assert.equal(options.method,'POST');const change=JSON.parse(options.body);writes++;
      for(const label of change.removeLabelIds||[]){assert.ok(['INBOX','UNREAD','IMPORTANT'].includes(label));if(label==='INBOX')inbox=false;if(label==='UNREAD')unread=false;if(label==='IMPORTANT')important=false}
      for(const label of change.addLabelIds||[]){assert.ok(['UNREAD','IMPORTANT'].includes(label));if(label==='UNREAD')unread=true;if(label==='IMPORTANT')important=true}
      return Response.json({id:'mail-1',labelIds:labels()});
    }
    throw new Error('Unexpected request '+url);
  };
  const handler=functionHandler('supabase/functions/dashboard-google/index.js',fetch);
  const req=(id,headers={origin:site,authorization:'Bearer mock-user-jwt'})=>handler(new Request(base+'/functions/v1/dashboard-google?action=archive&id='+id,{method:'POST',headers}));
  const set=(kind,enabled,id='mail-1',headers={origin:site,authorization:'Bearer mock-user-jwt'})=>handler(new Request(base+'/functions/v1/dashboard-google?action=set-label&id='+id,{method:'POST',headers,body:JSON.stringify({kind,enabled})}));
  assert.equal((await (await handler(new Request(base+'/functions/v1/dashboard-google?action=status',{headers:{origin:site,authorization:'Bearer mock-user-jwt'}}))).json()).canArchive,false);
  assert.equal((await req('mail-1')).status,403);
  assert.equal((await set('unread',false)).status,403);
  assert.equal((await req('../other')).status,400);
  assert.equal((await req('mail-1',{origin:site})).status,401);
  assert.equal(writes,0);
  scope='https://www.googleapis.com/auth/gmail.modify';
  assert.equal((await (await handler(new Request(base+'/functions/v1/dashboard-google?action=status',{headers:{origin:site,authorization:'Bearer mock-user-jwt'}}))).json()).canArchive,true);
  assert.equal((await (await req('mail-1')).json()).archived,true);
  assert.equal(writes,1);
  assert.equal((await (await req('mail-1')).json()).archived,true);
  assert.equal(writes,1);
  assert.equal((await set('unread',false,'../other')).status,400);
  assert.equal((await set('unread',false,'mail-1',{origin:site})).status,401);
  assert.equal((await set('TRASH',true)).status,400);
  assert.equal((await set('important','yes')).status,400);
  const read=await (await set('unread',false)).json();
  assert.deepEqual([read.unread,read.important,read.inbox],[false,false,false]);
  assert.equal(writes,2);
  assert.equal((await (await set('unread',false)).json()).unread,false);
  assert.equal(writes,2);
  const flagged=await (await set('important',true)).json();
  assert.deepEqual([flagged.unread,flagged.important,flagged.inbox],[false,true,false]);
  assert.equal(writes,3);
  assert.equal((await (await set('unread',true)).json()).unread,true);
  assert.equal((await (await set('important',false)).json()).important,false);
  assert.equal(writes,5);
}

async function testCalendarMonthAndCreate() {
  const root=await webcrypto.subtle.importKey('raw',new TextEncoder().encode(env.SUPABASE_SERVICE_ROLE_KEY),'HKDF',false,['deriveKey']);
  const key=await webcrypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:new TextEncoder().encode('dashboard-google-oauth-v1'),info:new TextEncoder().encode('refresh-token')},root,{name:'AES-GCM',length:256},false,['encrypt']);
  const iv=new Uint8Array(12),cipher=new Uint8Array(await webcrypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode('mock-refresh')));
  let scope='https://www.googleapis.com/auth/calendar.events.readonly',writes=0,stored=null;
  const fetch=async (input,options={})=>{
    const url=String(input);
    if(url===base+'/auth/v1/user')return Response.json({id:'owner-1'});
    if(url.startsWith(base+'/rest/v1/dashboard_google_connections?'))return Response.json([{google_email:'owner@example.test',scopes:scope,refresh_token_ciphertext:Buffer.from(cipher).toString('base64'),refresh_token_iv:Buffer.from(iv).toString('base64')}]);
    if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'mock-access'});
    if(url.startsWith('https://www.googleapis.com/calendar/v3/calendars/primary/events?')){
      assert.equal(new URL(url).searchParams.get('maxResults'),'250');
      return Response.json({items:[{id:'known',summary:'Подія',start:{date:'2026-09-27'},end:{date:'2026-09-28'}}]});
    }
    if(url==='https://www.googleapis.com/calendar/v3/calendars/primary/events'&&options.method==='POST'){
      writes++;stored=JSON.parse(options.body);return Response.json({...stored,htmlLink:'https://calendar.google.com/event?eid=mock'});
    }
    throw Error('Unexpected request '+url);
  };
  const handler=functionHandler('supabase/functions/dashboard-google/index.js',fetch),headers={origin:site,authorization:'Bearer mock-user-jwt'};
  const month=await handler(new Request(base+'/functions/v1/dashboard-google?action=calendar-month&start=2026-09-01T00%3A00%3A00.000Z&end=2026-10-01T00%3A00%3A00.000Z',{headers}));
  assert.equal(month.status,200);assert.equal((await month.json()).events[0].title,'Подія');
  const bad=await handler(new Request(base+'/functions/v1/dashboard-google?action=calendar-month&start=2026-01-01T00%3A00%3A00.000Z&end=2026-12-01T00%3A00%3A00.000Z',{headers}));assert.equal(bad.status,400);
  const draft={id:'a'.repeat(32),kind:'event',date:'2026-09-27',title:'Зустріч',description:'План',time:'12:30',startsAt:'2026-09-27T09:30:00.000Z'};
  const create=body=>handler(new Request(base+'/functions/v1/dashboard-google?action=calendar-create',{method:'POST',headers,body:JSON.stringify(body)}));
  assert.equal((await (await handler(new Request(base+'/functions/v1/dashboard-google?action=status',{headers}))).json()).canCreateCalendar,false);
  assert.equal((await create(draft)).status,403);assert.equal(writes,0);
  scope='https://www.googleapis.com/auth/calendar.events';
  assert.equal((await create({...draft,id:'../other'})).status,400);
  assert.equal((await create({...draft,time:'99:99'})).status,400);
  assert.equal((await create({...draft,kind:'note',time:'12:30'})).status,400);
  assert.equal((await create(draft)).status,200);
  assert.equal(stored.start.dateTime,'2026-09-27T09:30:00.000Z');
  assert.equal(stored.end.dateTime,'2026-09-27T10:30:00.000Z');
  assert.equal(stored.extendedProperties.private.dashboardKind,'event');
  assert.equal(writes,1);
  assert.equal((await create({...draft,id:'b'.repeat(32),kind:'note',time:'',startsAt:undefined})).status,200);
  assert.deepEqual([stored.start.date,stored.end.date],['2026-09-27','2026-09-28']);
}

Promise.all([testStart(), testCallback(), testRejectedTokenHasSafeReason(), testIndependentGoogleFeeds(), testFullMessageReadAndIsolation(), testMailboxPagesAndFilters(), testArchiveRequiresConsentAndUpdatesGmail(), testCalendarMonthAndCreate()]).then(() => {
  console.log('PASS: OAuth, inbox, labels, archive, calendar month and create authorization');
}).catch(error => { console.error(error); process.exitCode = 1; });
