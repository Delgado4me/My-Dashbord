const env = key => Deno.env.get(key) || '';
const site = env('DASHBOARD_SITE_URL').replace(/\/$/, '');
const ownerId = env('DASHBOARD_OWNER_USER_ID');
const allowedOrigins = [site, ...env('DASHBOARD_ALLOWED_ORIGINS').split(',').map(x=>x.trim().replace(/\/$/,''))].filter(value=>{try{const url=new URL(value);return url.protocol==='https:'&&url.origin===value}catch{return false}});
const allowedGoogleEmail = env('DASHBOARD_GOOGLE_EMAIL').trim().toLowerCase();
const callback = env('SUPABASE_URL').replace(/\/$/, '') + '/functions/v1/dashboard-google-callback';
function baseConfigured() {
  try { const url = new URL(site); return url.protocol === 'https:' && url.origin === site && Boolean(ownerId) && Boolean(env('SUPABASE_URL')); } catch { return false; }
}
// Authenticated Google data API and OAuth initiation; Gmail writes require gmail.modify.
const scopes = 'openid email https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar.events';
const secret = () => env('SUPABASE_SERVICE_ROLE_KEY') || JSON.parse(env('SUPABASE_SECRET_KEYS') || '{}').default;
const publishable = () => env('SUPABASE_ANON_KEY') || JSON.parse(env('SUPABASE_PUBLISHABLE_KEYS') || '{}').default;
const headers = {'Access-Control-Allow-Origin':site,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'authorization, apikey, content-type','Vary':'Origin','Cache-Control':'no-store'};
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{...headers,'Content-Type':'application/json'}})}
function configured(){return Boolean(baseConfigured() && allowedGoogleEmail && env('DASHBOARD_GOOGLE_CLIENT_ID') && env('DASHBOARD_GOOGLE_CLIENT_SECRET') && secret())}
const bytes = value => new TextEncoder().encode(value);
async function hash(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes(value)))).map(x=>x.toString(16).padStart(2,'0')).join('')}
function b64(raw){return btoa(String.fromCharCode(...raw))}
function unb64(raw){return Uint8Array.from(atob(raw),x=>x.charCodeAt(0))}
async function encryptionKey(){const root=await crypto.subtle.importKey('raw',bytes(secret()),'HKDF',false,['deriveKey']);return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:bytes('dashboard-google-oauth-v1'),info:bytes('refresh-token')},root,{name:'AES-GCM',length:256},false,['decrypt'])}
async function decrypt(ciphertext,iv){return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(iv)},await encryptionKey(),unb64(ciphertext)))}
async function admin(path,options={}){const key=secret();if(!key)throw new Error('Server key missing');const r=await fetch(env('SUPABASE_URL')+'/rest/v1/'+path,{...options,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',...(options.headers||{})}});if(!r.ok)throw new Error('Storage error '+r.status);const body=await r.text();return body?JSON.parse(body):null}
async function owner(req){const jwt=req.headers.get('Authorization')||'';if(!jwt.startsWith('Bearer '))return null;const r=await fetch(env('SUPABASE_URL')+'/auth/v1/user',{headers:{apikey:publishable(),Authorization:jwt}});if(!r.ok)return null;const user=await r.json();return user.id===ownerId?user:null}
async function google(path,access,options={}){const r=await fetch(path,{...options,headers:{Authorization:'Bearer '+access,...(options.headers||{})}});if(!r.ok){
  if(r.status===403){
    const data=await r.json().catch(()=>null);
    const reason=data?.error?.details?.find(item=>typeof item.reason==='string')?.reason||data?.error?.errors?.[0]?.reason;
    if(reason==='SERVICE_DISABLED'||reason==='accessNotConfigured')throw new Error('API вимкнено в Google Cloud (403)');
    if(reason==='ACCESS_TOKEN_SCOPE_INSUFFICIENT'||reason==='insufficientPermissions')throw new Error('бракує дозволу Google (403)');
    if(['rateLimitExceeded','userRateLimitExceeded','quotaExceeded'].includes(reason))throw new Error('Google тимчасово обмежив запити (403)');
  }
  throw new Error('Google API '+r.status);
}return r.json()}
function dailyRange(value){if(!/^\d{4}-\d\d-\d\d$/.test(value||''))return null;const [y,m,d]=value.split('-').map(Number);const dt=new Date(y,m-1,d);return dt.getFullYear()===y&&dt.getMonth()===m-1&&dt.getDate()===d?value:null}
function hasModifyScope(value){return (value||'').split(/\s+/).includes('https://www.googleapis.com/auth/gmail.modify')}
function hasCalendarWrite(value){return (value||'').split(/\s+/).includes('https://www.googleapis.com/auth/calendar.events')}
function eventRow(e){return {id:e.id,title:e.summary||'Подія',start:e.start?.dateTime||e.start?.date||'',end:e.end?.dateTime||e.end?.date||'',description:e.description||'',location:e.location||'',link:e.htmlLink||'',kind:e.extendedProperties?.private?.dashboardKind==='note'?'note':'event'}}
function decoded(part){
  const raw=part?.body?.data;if(!raw)return '';
  if(raw.length>300000)throw new Error('Лист завеликий для перегляду.');
  const value=raw.replaceAll('-','+').replaceAll('_','/');
  const bytes=Uint8Array.from(atob(value.padEnd(Math.ceil(value.length/4)*4,'=')),c=>c.charCodeAt(0));
  const header=part.headers?.find(h=>h.name?.toLowerCase()==='content-type')?.value||'';
  const charset=header.match(/charset\s*=\s*["']?([^\s;"']+)/i)?.[1]||'utf-8';
  try{return new TextDecoder(charset).decode(bytes)}catch{return new TextDecoder().decode(bytes)}
}
function textPart(part,preferred){
  if(!part)return '';
  if(part.filename||part.body?.attachmentId)return '';
  if((part.mimeType||'').toLowerCase()===preferred)return decoded(part);
  const pieces=(part.parts||[]).map(child=>textPart(child,preferred)).filter(Boolean);
  return pieces.join('\n\n');
}
function plainHtml(html){
  return html.replace(/<!--[^]*?-->|<(script|style|iframe|svg|form)\b[^>]*>[^]*?<\/\1\s*>/gi,' ')
    .replace(/<br\s*\/?\s*>|<\/(p|div|li|h[1-6]|tr)\s*>/gi,'\n')
    .replace(/<[^>]*>/g,' ')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,value)=>{
      if(value[0]==='#')try{return String.fromCodePoint(value[1].toLowerCase()==='x'?parseInt(value.slice(2),16):parseInt(value.slice(1),10))}catch{return ' '}
      return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[value.toLowerCase()]||' ';
    }).replace(/\n[ \t]+/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
function attachments(part,result=[]){if(!part)return result;if(part.filename)result.push({name:part.filename.slice(0,180),size:part.body?.size||0});for(const child of part.parts||[])attachments(child,result);return result.slice(0,30)}
async function mailbox(folder,pageToken,access){
  const filters={all:'',inbox:'in:inbox',unread:'in:inbox is:unread',important:'is:important'};
  if(!Object.hasOwn(filters,folder)||pageToken&&!/^[a-zA-Z0-9_=-]{1,2048}$/.test(pageToken))return json({error:'Неправильний фільтр або сторінка пошти.'},400);
  const url=new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
  url.search=new URLSearchParams({maxResults:'20',...(filters[folder]?{q:filters[folder]}:{}),...(pageToken?{pageToken}:{})}).toString();
  const page=await google(url,access);
  const results=await Promise.allSettled((page.messages||[]).map(async item=>{
    const message=await google('https://gmail.googleapis.com/gmail/v1/users/me/messages/'+encodeURIComponent(item.id)+'?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date',access);
    const fields=Object.fromEntries((message.payload?.headers||[]).map(h=>[h.name.toLowerCase(),h.value]));
    return {id:message.id,threadId:message.threadId,from:fields.from||'',subject:fields.subject||'(без теми)',snippet:message.snippet||'',date:fields.date||'',unread:message.labelIds?.includes('UNREAD')||false,important:message.labelIds?.includes('IMPORTANT')||false,inbox:message.labelIds?.includes('INBOX')||false};
  }));
  return json({mails:results.filter(r=>r.status==='fulfilled').map(r=>r.value),nextPageToken:page.nextPageToken||'',partial:results.some(r=>r.status==='rejected')});
}
async function handleRequest(req){
  if(!baseConfigured())return json({error:'Налаштуйте DASHBOARD_SITE_URL і DASHBOARD_OWNER_USER_ID на сервері.'},503);
  if(req.headers.get('Origin') && !allowedOrigins.includes(req.headers.get('Origin')))return json({error:'Origin forbidden'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  const action=new URL(req.url).searchParams.get('action');
  if(!['status','start','snapshot','disconnect','message','list','archive','set-label','calendar-month','calendar-create'].includes(action))return json({error:'Not found'},404);
  const user=await owner(req);if(!user)return json({error:'Увійдіть у дашборд.'},401);
  try{
    if(action==='status'){
      const rows=await admin('dashboard_google_connections?user_id=eq.'+encodeURIComponent(user.id)+'&select=google_email,scopes');
      return json({configured:configured(),connected:rows.length>0,email:rows[0]?.google_email||null,canArchive:hasModifyScope(rows[0]?.scopes),canCreateCalendar:hasCalendarWrite(rows[0]?.scopes)});
    }
    if(action==='start'){
      if(req.method!=='POST')return json({error:'Method not allowed'},405);
      if(!configured())return json({error:'Google OAuth ще не налаштовано на сервері.'},503);
      const state=b64(crypto.getRandomValues(new Uint8Array(32))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
      await admin('dashboard_google_states',{method:'POST',body:JSON.stringify({state_hash:await hash(state),user_id:user.id,expires_at:new Date(Date.now()+10*60*1000).toISOString()})});
      const params=new URLSearchParams({client_id:env('DASHBOARD_GOOGLE_CLIENT_ID'),redirect_uri:callback,response_type:'code',scope:scopes,state,access_type:'offline',prompt:'consent',login_hint:allowedGoogleEmail});
      return json({url:'https://accounts.google.com/o/oauth2/v2/auth?'+params});
    }
    if(action==='disconnect'){
      if(req.method!=='POST')return json({error:'Method not allowed'},405);
      await admin('dashboard_google_connections?user_id=eq.'+encodeURIComponent(user.id),{method:'DELETE'});
      return json({connected:false});
    }
    if(req.method!==(['archive','set-label','calendar-create'].includes(action)?'POST':'GET'))return json({error:'Method not allowed'},405);
    if(!configured())return json({error:'Google OAuth ще не налаштовано на сервері.'},503);
    const query=new URL(req.url).searchParams;
    const messageId=['message','archive','set-label'].includes(action)?query.get('id'):null;
    if(['message','archive','set-label'].includes(action)&&!/^[a-zA-Z0-9_-]{1,100}$/.test(messageId||''))return json({error:'Неправильний ID листа.'},400);
    if(action==='message'&&query.has('day'))return json({error:'Неправильні параметри листа.'},400);
    let start='',end='';
    if(action==='snapshot'){
    const day=dailyRange(query.get('day'));if(!day)return json({error:'Неправильна дата.'},400);
    start=query.get('start')||'';end=query.get('end')||'';
    const startMs=Date.parse(start),endMs=Date.parse(end);
    if(!/^\d{4}-\d\d-\d\dT/.test(start)||!/^\d{4}-\d\d-\d\dT/.test(end)||!Number.isFinite(startMs)||!Number.isFinite(endMs)||endMs-startMs<20*3600000||endMs-startMs>28*3600000)return json({error:'Неправильний діапазон дня.'},400);
    }
    if(action==='calendar-month'){
      start=query.get('start')||'';end=query.get('end')||'';
      const a=Date.parse(start),b=Date.parse(end);
      if(!/^\d{4}-\d\d-\d\dT/.test(start)||!/^\d{4}-\d\d-\d\dT/.test(end)||!Number.isFinite(a)||!Number.isFinite(b)||b<=a||b-a>45*86400000)return json({error:'Неправильний діапазон календаря.'},400);
    }
    const rows=await admin('dashboard_google_connections?user_id=eq.'+encodeURIComponent(user.id)+'&select=google_email,scopes,refresh_token_ciphertext,refresh_token_iv');
    if(!rows.length)return json({error:'Спершу підключіть Google.'},409);
    if(['archive','set-label'].includes(action)&&!hasModifyScope(rows[0].scopes))return json({error:'Для зміни листів оновіть доступ Google у розділі «Ще».'},403);
    if(action==='calendar-create'&&!hasCalendarWrite(rows[0].scopes))return json({error:'Для запису подій оновіть доступ Google у розділі «Ще».'},403);
    const refresh=await decrypt(rows[0].refresh_token_ciphertext,rows[0].refresh_token_iv);
    const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env('DASHBOARD_GOOGLE_CLIENT_ID'),client_secret:env('DASHBOARD_GOOGLE_CLIENT_SECRET'),refresh_token:refresh,grant_type:'refresh_token'})});
    if(!response.ok)return json({error:'Google-доступ потребує повторного підключення.'},409);
    const {access_token}=await response.json();
    if(action==='calendar-month'){
      const items=[];let pageToken='';
      for(let page=0;page<5;page++){
        const url=new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
        url.search=new URLSearchParams({timeMin:start,timeMax:end,singleEvents:'true',orderBy:'startTime',maxResults:'250',...(pageToken?{pageToken}:{})}).toString();
        const result=await google(url,access_token);items.push(...(result.items||[]).map(eventRow));pageToken=result.nextPageToken||'';
        if(!pageToken)break;
      }
      return json({events:items,truncated:Boolean(pageToken)});
    }
    if(action==='calendar-create'){
      const raw=await req.text();if(raw.length>5000)return json({error:'Запис завеликий.'},400);
      let draft;try{draft=JSON.parse(raw)}catch{return json({error:'Неправильний запис.'},400)}
      if(!draft||!['event','note'].includes(draft.kind)||!dailyRange(draft.date)||typeof draft.title!=='string'||!draft.title.trim()||draft.title.length>120||typeof draft.description!=='string'||draft.description.length>2000||typeof draft.id!=='string'||!/^[0-9a-v]{12,80}$/.test(draft.id)||typeof draft.time!=='string'||(draft.time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time))||(draft.kind==='note'&&draft.time)||draft.time&&(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(draft.startsAt||'')||!Number.isFinite(Date.parse(draft.startsAt))))return json({error:'Перевірте назву, дату й час.'},400);
      const body={id:draft.id,summary:draft.title.trim(),description:draft.description,extendedProperties:{private:{dashboardKind:draft.kind}}};
      if(draft.time){
        const startTime=new Date(draft.startsAt);
        body.start={dateTime:startTime.toISOString()};body.end={dateTime:new Date(startTime.getTime()+3600000).toISOString()};
      }else{body.start={date:draft.date};body.end={date:new Date(Date.parse(draft.date+'T12:00:00Z')+86400000).toISOString().slice(0,10)}}
      const url='https://www.googleapis.com/calendar/v3/calendars/primary/events';
      // A stable ID prevents a double tap or retry from creating a duplicate event.
      try{return json({event:eventRow(await google(url,access_token,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}))})}
      catch(error){if(error.message!=='Google API 409')throw error;
        return json({event:eventRow(await google(url+'/'+encodeURIComponent(draft.id),access_token))});}
    }
    if(action==='archive'){
      const path='https://gmail.googleapis.com/gmail/v1/users/me/messages/'+encodeURIComponent(messageId);
      let message;
      try{message=await google(path+'?format=metadata&fields=id,labelIds',access_token)}
      catch(error){if(error.message==='Google API 404')return json({error:'Лист не знайдено.'},404);throw error}
      if(!message.labelIds?.includes('INBOX'))return json({archived:true,id:messageId});
      const modified=await google(path+'/modify',access_token,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({removeLabelIds:['INBOX']})});
      if(modified.labelIds?.includes('INBOX'))throw new Error('Gmail не підтвердив архівування.');
      return json({archived:true,id:messageId});
    }
    if(action==='set-label'){
      const raw=await req.text();
      if(raw.length>200)return json({error:'Неправильні дані позначки.'},400);
      let change;try{change=JSON.parse(raw)}catch{return json({error:'Неправильні дані позначки.'},400)}
      if(!change||!Object.hasOwn({unread:1,important:1},change.kind)||typeof change.enabled!=='boolean'||Object.keys(change).length!==2)return json({error:'Неправильні дані позначки.'},400);
      const label=change.kind==='unread'?'UNREAD':'IMPORTANT';
      const path='https://gmail.googleapis.com/gmail/v1/users/me/messages/'+encodeURIComponent(messageId);
      let message;
      try{message=await google(path+'?format=metadata&fields=id,labelIds',access_token)}
      catch(error){if(error.message==='Google API 404')return json({error:'Лист не знайдено.'},404);throw error}
      if(Boolean(message.labelIds?.includes(label))!==change.enabled){
        message=await google(path+'/modify',access_token,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(change.enabled?{addLabelIds:[label]}:{removeLabelIds:[label]})});
      }
      if(Boolean(message.labelIds?.includes(label))!==change.enabled)throw new Error('Gmail не підтвердив зміну позначки.');
      return json({id:messageId,unread:message.labelIds?.includes('UNREAD')||false,important:message.labelIds?.includes('IMPORTANT')||false,inbox:message.labelIds?.includes('INBOX')||false});
    }
    if(action==='list')return await mailbox(query.get('folder')||'inbox',query.get('pageToken')||'',access_token);
    if(action==='message'){
      let msg;
      try{msg=await google('https://gmail.googleapis.com/gmail/v1/users/me/messages/'+encodeURIComponent(messageId)+'?format=full',access_token)}
      catch(error){if(error.message==='Google API 404')return json({error:'Лист не знайдено.'},404);throw error}
      const fields=Object.fromEntries((msg.payload?.headers||[]).map(h=>[h.name.toLowerCase(),h.value]));
      const body=textPart(msg.payload,'text/plain')||plainHtml(textPart(msg.payload,'text/html'));
      const tooLong=body.length>180000;
      return json({id:msg.id,threadId:msg.threadId,account:rows[0].google_email,
        from:fields.from||'',to:fields.to||'',date:fields.date||'',subject:fields.subject||'(без теми)',
        body:tooLong?'':body,available:!!body&&!tooLong,
        reason:tooLong?'Лист завеликий для перегляду.':body?'':'Текст листа недоступний у цьому форматі.',
        attachments:attachments(msg.payload),unread:msg.labelIds?.includes('UNREAD')||false,important:msg.labelIds?.includes('IMPORTANT')||false,inbox:msg.labelIds?.includes('INBOX')||false});
    }
    const cal=new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');cal.search=new URLSearchParams({timeMin:start,timeMax:end,singleEvents:'true',orderBy:'startTime',maxResults:'10'}).toString();
    const mail=new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');mail.search=new URLSearchParams({q:'in:inbox -category:promotions -category:social',maxResults:'8'}).toString();
    // A failure in one Google API must not hide data returned by the other.
    const [calendarResult,mailResult]=await Promise.allSettled([google(cal,access_token),google(mail,access_token)]);
    const errors={};
    if(calendarResult.status==='rejected')errors.calendar='Не вдалося завантажити календар ('+calendarResult.reason.message+').';
    if(mailResult.status==='rejected')errors.mail='Не вдалося завантажити пошту ('+mailResult.reason.message+').';
    let letters=[];
    if(mailResult.status==='fulfilled'){
      const results=await Promise.allSettled((mailResult.value.messages||[]).map(async item=>{
        const path='https://gmail.googleapis.com/gmail/v1/users/me/messages/'+encodeURIComponent(item.id)+'?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date';
        const msg=await google(path,access_token),fields=Object.fromEntries((msg.payload?.headers||[]).map(h=>[h.name.toLowerCase(),h.value]));
        return {id:msg.id,threadId:msg.threadId,from:fields.from||'',subject:fields.subject||'(без теми)',snippet:msg.snippet||'',date:fields.date||'',unread:msg.labelIds?.includes('UNREAD')||false,inbox:true};
      }));
      letters=results.filter(r=>r.status==='fulfilled').map(r=>r.value);
      if(results.some(r=>r.status==='rejected'))errors.mail='Деякі листи не вдалося завантажити.';
    }
    const calendar=calendarResult.status==='fulfilled'?calendarResult.value:{items:[]};
    return json({email:rows[0].google_email,events:(calendar.items||[]).slice(0,2).map(eventRow),mails:letters,errors});
  }catch(error){return json({error:error.message||'Помилка інтеграції.'},500)}

}
Deno.serve(async request => {
  const response = await handleRequest(request);
  const origin = request.headers.get('Origin');
  if (origin && allowedOrigins.includes(origin)) response.headers.set('Access-Control-Allow-Origin', origin);
  return response;
});
