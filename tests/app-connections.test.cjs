const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const root=require('node:path').resolve(__dirname,'..');
function appHarness(){
  const elements=new Map(),events={},intervals=[];
  const element=id=>{
    if(!elements.has(id))elements.set(id,{id,hidden:['sheetBackdrop','viewShell'].includes(id),innerHTML:'',textContent:'',scrollTop:0,disabled:false,isConnected:true,style:{},dataset:{},classList:{toggle(){},contains(){return false},add(){},remove(){}},setAttribute(){},focus(){},querySelector(){return null},querySelectorAll(){return []},addEventListener(){}});
    return elements.get(id);
  };
  const document={getElementById:id=>id==='focusSample'?null:element(id),querySelector:element,querySelectorAll:()=>[],body:{style:{}},addEventListener:(type,fn)=>{(events[type]??=[]).push(fn)},hidden:false};
  let now=Date.parse('2026-09-30T10:00:00Z');
  class Clock extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}}
  const location={hash:'',pathname:'/',search:'',href:'http://localhost/'};
  const history={state:null,pushState(s,_,url){this.state=s;location.hash=url.startsWith('#')?url:''},replaceState(s,_,url){this.state=s;location.hash=url.startsWith('#')?url:''},back(){}};
  const calls={snapshot:0,month:0,birthdays:0,reminders:0,daily:0};
  const backend={isSignedIn:()=>false,googleSnapshot:async()=>{calls.snapshot++;return {events:[{id:'new',title:'New event',start:'2026-09-30T16:00:00+03:00',end:'2026-09-30T17:00:00+03:00'}],mails:[],errors:{}}},googleCalendarMonth:async()=>{calls.month++;return {events:[]}},listBirthdays:async()=>{calls.birthdays++;return []},listReminders:async()=>{calls.reminders++;return []},listDailyTasks:async()=>{calls.daily++;return []}};
  const window={DASHBOARD_SUPABASE:{},dashboardBackend:backend,addEventListener:(type,fn)=>{(events['window:'+type]??=[]).push(fn)},scrollTo(){},scrollY:0};
  const source=fs.readFileSync(root+'/public/app.js','utf8');
  const marker='  updateMode();renderFocus();renderDate();renderPriorities();renderFiles();renderMail();renderNotes();renderView();';
  assert(source.includes(marker));
  const instrumented=source.slice(0,source.lastIndexOf(marker))+'  window.auditEval = input => eval(input);\n})();';
  vm.runInNewContext(instrumented,{window,document,location,history,Date:Clock,Intl,localStorage:{getItem(){return null},setItem(){},removeItem(){}},crypto:webcrypto,URL,URLSearchParams,setInterval:fn=>intervals.push(fn),setTimeout,requestAnimationFrame:fn=>fn(),confirm:()=>true,alert(){},console,FormData,Map,Set,Error,TypeError});
  return {run:window.auditEval,elements,events,intervals,backend,calls,location,setNow:n=>{now=Date.parse(n)}};
}

test('Obsidian shows login before a successful connection',()=>{
 const h=appHarness();
 const html=h.run("sectionView('obsidian').html");
 assert.match(html,/Увійдіть/);assert.doesNotMatch(html,/Немає змін/);
});
test('latest notes are sorted, deduplicated and retained after a failed refresh',async()=>{
 const h=appHarness();h.run('signedIn=true');
 h.backend.obsidianSnapshot=async()=>({checkedAt:'2026-09-30T10:00:00Z',partial:true,notes:[
  {path:'notes/Old.md',name:'Old',kind:'edited',updatedAt:'2026-09-29T10:00:00Z'},
  {path:'notes/New.md',name:'New',kind:'added',updatedAt:'2026-09-30T10:00:00Z'},
  {path:'notes/New.md',name:'New',kind:'added',updatedAt:'2026-09-30T10:00:00Z'}]});
 await h.run('refreshObsidian()');
 assert.equal(h.run("files.map(f=>f.name).join(',')"),'New,Old');
 assert.match(h.run("sectionView('obsidian').html"),/Частковий огляд/);
 h.backend.obsidianSnapshot=async()=>{throw new Error('Offline')};
 await h.run('refreshObsidian()');
 const html=h.run("sectionView('obsidian').html");
 assert.match(html,/Показано попередній список/);assert.match(html,/Offline/);
 assert.equal(h.run('files.length'),2);
});
test('duplicate Obsidian refreshes share one request and old auth cannot repopulate notes',async()=>{
 const h=appHarness();h.run('signedIn=true');let release,calls=0;
 h.backend.obsidianSnapshot=()=>{calls++;return new Promise(r=>release=r)};
 const pending=h.run('refreshObsidian()');await h.run('refreshObsidian()');assert.equal(calls,1);
 h.run('++authEpoch;++obsidianRequest;signedIn=false;files=[];obsidianLoading=false');
 release({notes:[{path:'notes/Private.md'}]});await pending;
 assert.equal(h.run('files.length'),0);
});
test('Gmail full message opens through the existing route',async()=>{
 const h=appHarness();h.run("signedIn=true;googleConnected=true;googleChecked=true;googleDay='2026-09-30';realMails=[{id:'mail1',subject:'Mail',from:'Test'}]");
 let calls=0;h.backend.googleMessage=async id=>{calls++;return {id,subject:'Mail',body:'Full content',available:true,attachments:[],unread:true}};
 h.run("openView('mail','mail1')");
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls,1);assert.equal(h.run("mailDetails.get('mail1').status"),'loaded');
 assert.match(h.run("detailView('mail','mail1').html"),/Full content/);
});

test('birthday alerts recur at 5, 3 and 0 days, including year boundary and leap day',()=>{
 const h=appHarness();h.run("birthdays=[{id:'newyear',name:'Test',birth_month:1,birth_day:2,enabled:true}]");
 for(const [day,count,offset] of [['2026-12-28',1,5],['2026-12-29',0],['2026-12-30',1,3],['2027-01-02',1,0],['2027-01-03',0]]){
  const result=h.run("birthdayAlertsOn(dateFromSql('"+day+"'))");assert.equal(result.length,count,day);if(count)assert.equal(result[0].offset,offset);
 }
 h.run("birthdays=[{id:'leap',name:'Leap',birth_month:2,birth_day:29,enabled:true},{id:'disabled',name:'Hidden',birth_month:2,birth_day:28,enabled:false}]");
 assert.equal(h.run("birthdayAlertsOn(dateFromSql('2027-02-23'))[0].offset"),5);
 assert.equal(h.run("birthdayAlertsOn(dateFromSql('2027-02-28')).length"),1);
 assert.equal(h.run("birthdayAlertsOn(dateFromSql('2028-02-24'))[0].offset"),5);
 assert.equal(h.run("birthdayAlertsOn(dateFromSql('2028-02-28')).length"),0);
});
test('birthday alert appears once on home and is available in reminders and calendar',()=>{
 const h=appHarness();h.run("signedIn=true;birthdays=[{id:'test-b',name:'Birthday test',birth_month:10,birth_day:5,enabled:true}];dailyZoneReady=true;googleChecked=true;dailyZone='UTC'");
 assert.match(h.run('homeDayCandidates().join(\"\")'),/через 5 дн/);
 assert.match(h.run("sectionView('reminders').html"),/Birthday test/);
 h.run("selected=dateFromSql('2026-10-05')");
 assert.equal((h.run('calendarDayList()').match(/data-birthday="test-b"/g)||[]).length,1);
});
