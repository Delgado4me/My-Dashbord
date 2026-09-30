const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const origin = 'https://test-project.supabase.co';
const storageKey = 'my-dashboard-supabase-session-v1:' + origin;

function harness(fetch, initial = {access_token:'old',refresh_token:'refresh',expires_at:0}) {
  const stored = new Map(initial ? [[storageKey, JSON.stringify(initial)]] : []);
  const events = {};
  const window = {DASHBOARD_SUPABASE:{url:origin,publishableKey:'public'},addEventListener:(name,fn)=>events[name]=fn};
  vm.runInNewContext(fs.readFileSync('public/backend.js','utf8'), {
    window,localStorage:{getItem:k=>stored.get(k),setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)},
    fetch, Response, URL, URLSearchParams, AbortSignal, Date, JSON, Math, encodeURIComponent, setTimeout, Promise, Error, TypeError
  });
  return {api:window.dashboardBackend,stored,events};
}

test('parallel requests share one refresh', async()=>{
  let count=0, release;
  const h=harness(async url=>{
    if(url.includes('grant_type=refresh_token')){count++;return new Promise(r=>release=()=>r(Response.json({access_token:'new',refresh_token:'new-r',expires_in:3600})))}
    return Response.json([]);
  });
  const first=h.api.listNotes(),second=h.api.listReminders();
  assert.equal(count,1);release();await Promise.all([first,second]);
});

test('late refresh cannot restore a signed-out session',async()=>{
  let release;
  const h=harness(async url=>url.includes('grant_type=refresh_token')?new Promise(r=>release=()=>r(Response.json({access_token:'late',refresh_token:'late-r'}))):new Response(null,{status:204}));
  const pending=h.api.listNotes();const rejected=assert.rejects(pending,/Сеанс завершено/);
  await h.api.signOut();release();await rejected;
  assert.equal(h.api.isSignedIn(),false);assert.equal(h.stored.has(storageKey),false);
});

test('sign-out in another tab invalidates an in-flight refresh',async()=>{
  let release;
  const h=harness(async()=>new Promise(r=>release=()=>r(Response.json({access_token:'late'}))));
  const pending=h.api.listNotes();const rejected=assert.rejects(pending,/Сеанс завершено/);
  h.stored.delete(storageKey);h.events.storage({key:storageKey,newValue:null});release();await rejected;
  assert.equal(h.api.isSignedIn(),false);assert.equal(h.stored.has(storageKey),false);
});

test('old project session is never used by a new project',async()=>{
  let calls=0;const h=harness(async()=>{calls++;throw new Error('unexpected')},null);
  h.stored.set('my-dashboard-supabase-session-v1:https://other.supabase.co',JSON.stringify({access_token:'other',refresh_token:'other'}));
  assert.equal(await h.api.restore(),false);assert.equal(calls,0);
});

test('public connection form rejects service keys and arbitrary endpoints',()=>{
  const window={},stored=new Map();
  vm.runInNewContext(fs.readFileSync('public/config.js','utf8'),{window,URL,JSON,Error,atob,localStorage:{getItem:k=>stored.get(k),setItem:(k,v)=>stored.set(k,v)}});
  const config=window.dashboardConnection;
  assert.equal(config.save({url:origin+'/',publishableKey:'sb_publishable_test'}).url,origin);
  for(const url of ['http://test-project.supabase.co','https://supabase.co.evil.test','https://test-project.supabase.co/private','https://user:pass@test-project.supabase.co'])assert.throws(()=>config.validate({url,publishableKey:'sb_publishable_test'}));
  assert.throws(()=>config.validate({url:origin,publishableKey:'sb_secret_private'}));
  const jwt=role=>'header.'+Buffer.from(JSON.stringify({role})).toString('base64url')+'.signature';
  assert.throws(()=>config.validate({url:origin,publishableKey:jwt('service_role')}));
  assert.equal(config.validate({url:origin,publishableKey:jwt('anon')}).url,origin);
});
