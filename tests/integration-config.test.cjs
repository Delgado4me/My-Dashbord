const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const env={SUPABASE_URL:'https://test-project.supabase.co',DASHBOARD_SITE_URL:'https://dashboard.example.test',DASHBOARD_OWNER_USER_ID:'owner',DASHBOARD_ALLOWED_ORIGINS:'https://preview.example.test',DASHBOARD_OBSIDIAN_REPOSITORY:'example/notes',DASHBOARD_OBSIDIAN_PATH_PREFIX:'notes',DASHBOARD_OBSIDIAN_GITHUB_TOKEN:'mock'};
function api(name,overrides={}){let handler;vm.runInNewContext(fs.readFileSync('supabase/functions/'+name+'/index.js','utf8'),{Deno:{env:{get:key=>({...env,...overrides})[key]},serve:fn=>handler=fn},fetch:async()=>Response.json({id:'owner'}),Request,Response,URL,Set,TextEncoder,Uint8Array});return handler;}
for(const name of ['dashboard-google','dashboard-obsidian'])test(name+' exact CORS including rejected origins',async()=>{
 const handler=api(name);
 for(const origin of [env.DASHBOARD_SITE_URL,'https://preview.example.test']){const res=await handler(new Request('https://example.test',{method:'OPTIONS',headers:{origin}}));assert.equal(res.status,204);assert.equal(res.headers.get('access-control-allow-origin'),origin);}
 const res=await handler(new Request('https://example.test',{method:'OPTIONS',headers:{origin:'https://preview.example.test.attacker.test'}}));assert.equal(res.status,403);assert.notEqual(res.headers.get('access-control-allow-origin'),'https://preview.example.test.attacker.test');
});
test('Obsidian rejects files outside configured folder',async()=>{
 const handler=api('dashboard-obsidian');
 const res=await handler(new Request('https://example.test?action=read&path=private/note.md',{headers:{origin:env.DASHBOARD_SITE_URL,authorization:'Bearer mock'}}));assert.equal(res.status,400);
});
