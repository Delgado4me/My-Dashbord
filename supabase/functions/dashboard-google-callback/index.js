const env = key => Deno.env.get(key) || '';
const site = env('DASHBOARD_SITE_URL').replace(/\/$/, '');
const ownerId = env('DASHBOARD_OWNER_USER_ID');
const allowedGoogleEmail = env('DASHBOARD_GOOGLE_EMAIL').trim().toLowerCase();
const callback = env('SUPABASE_URL').replace(/\/$/, '') + '/functions/v1/dashboard-google-callback';
function baseConfigured() {
  try { const url = new URL(site); return url.protocol === 'https:' && url.origin === site && Boolean(ownerId) && Boolean(env('SUPABASE_URL')); } catch { return false; }
}
// The only unauthenticated route: one-use random state is its credential.
const secret=()=>env('SUPABASE_SERVICE_ROLE_KEY')||JSON.parse(env('SUPABASE_SECRET_KEYS')||'{}').default;
const bytes=value=>new TextEncoder().encode(value);
const b64=raw=>btoa(String.fromCharCode(...raw));
async function hash(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes(value)))).map(x=>x.toString(16).padStart(2,'0')).join('')}
async function encryptionKey(){const root=await crypto.subtle.importKey('raw',bytes(secret()),'HKDF',false,['deriveKey']);return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:bytes('dashboard-google-oauth-v1'),info:bytes('refresh-token')},root,{name:'AES-GCM',length:256},false,['encrypt'])}
async function encrypt(token){const iv=crypto.getRandomValues(new Uint8Array(12));return {refresh_token_ciphertext:b64(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await encryptionKey(),bytes(token)))),refresh_token_iv:b64(iv)}}
async function admin(path,options={}){const key=secret();if(!key)throw new Error('Server key missing');const r=await fetch(env('SUPABASE_URL')+'/rest/v1/'+path,{...options,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',...(options.headers||{})}});if(!r.ok)throw new Error('Storage error '+r.status);const body=await r.text();return body?JSON.parse(body):null}
function done(ok,reason=''){const url=new URL(site);url.searchParams.set('google',ok);if(reason)url.searchParams.set('reason',reason);return new Response(null,{status:303,headers:{Location:url.href,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}})}
Deno.serve(async req=>{
  if(!baseConfigured()||!allowedGoogleEmail||!env('DASHBOARD_GOOGLE_CLIENT_ID')||!env('DASHBOARD_GOOGLE_CLIENT_SECRET'))return new Response('Google OAuth server configuration is incomplete.',{status:503});
  if(req.method!=='GET')return new Response('Method not allowed',{status:405});
  const url=new URL(req.url),state=url.searchParams.get('state')||'',code=url.searchParams.get('code');
  if(!/^[A-Za-z0-9_-]{40,60}$/.test(state))return done('error','invalid_state');
  let stage='state';
  try{
    // DELETE ... RETURNING is atomic: a replay cannot consume the same state twice.
    const rows=await admin('dashboard_google_states?state_hash=eq.'+await hash(state)+'&expires_at=gt.'+encodeURIComponent(new Date().toISOString())+'&select=user_id',{method:'DELETE',headers:{Prefer:'return=representation'}});
    if(!rows?.length||rows[0].user_id!==ownerId)return done('error','invalid_state');
    if(url.searchParams.has('error'))return done('error','declined');
    if(!code)return done('error','missing_code');
    stage='token';
    const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:env('DASHBOARD_GOOGLE_CLIENT_ID'),client_secret:env('DASHBOARD_GOOGLE_CLIENT_SECRET'),redirect_uri:callback,grant_type:'authorization_code'})});
    if(!response.ok){console.warn('OAuth token exchange failed, HTTP '+response.status);return done('error','token_exchange')}
    const token=await response.json();if(!token.refresh_token||!token.access_token)return done('error','missing_refresh');
    const granted=new Set((token.scope||'').split(' '));
    if(!granted.has('https://www.googleapis.com/auth/gmail.modify')||(!granted.has('https://www.googleapis.com/auth/calendar.events')&&!granted.has('https://www.googleapis.com/auth/calendar.events.readonly')))return done('error','missing_permissions');
    stage='profile';
    const profile=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:'Bearer '+token.access_token}});
    if(!profile.ok)return done('error','profile_failed');
    const googleUser=await profile.json();
    if(googleUser.email?.toLowerCase()!==allowedGoogleEmail||!googleUser.email_verified)return done('error','wrong_account');
    stage='encryption';
    const encrypted=await encrypt(token.refresh_token);
    stage='save';
    await admin('dashboard_google_connections?on_conflict=user_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates'},body:JSON.stringify({user_id:rows[0].user_id,google_email:googleUser.email,scopes:token.scope||'',updated_at:new Date().toISOString(),...encrypted})});
    return done('connected');
  }catch{console.warn('OAuth callback failed at '+stage);return done('error',stage+'_failed')}
});
