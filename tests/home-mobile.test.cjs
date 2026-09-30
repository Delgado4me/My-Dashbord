// Frontend integration QA with synthetic records only. No network or live writes.
// Requires Playwright and an installed Chromium. Optional DASHBOARD_TEST_CHROMIUM.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../public');
const output=process.env.DASHBOARD_QA_OUTPUT;
if(output)fs.mkdirSync(output,{recursive:true});

async function openPage(browser,width,options={}){
  const context=await browser.newContext({viewport:{width,height:800},timezoneId:options.browserZone||'Europe/Paris',isMobile:true,hasTouch:true});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.hostname!=='dashboard.test')return route.abort();
    const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
    if(['config.js','backend.js'].includes(name))return route.fulfill({contentType:'application/javascript',body:''});
    const file=path.join(root,name);
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
    const types={'.js':'application/javascript','.html':'text/html','.css':'text/css'};
    await route.fulfill({contentType:types[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
  });
  await page.addInitScript(options=>{
    const clock=Date.parse(options.now||'2026-09-30T10:00:00Z'),RealDate=Date;
    window.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[clock]))}static now(){return clock}};
    const day=options.day||'2026-09-30';
    const tasks=options.empty?[]:[
      {id:'task-one',day,timezone:'Europe/Istanbul',position:1,title:'Контрольна справа без часу',is_complete:false,is_focus:true},
      {id:'task-two',day,timezone:'Europe/Istanbul',position:2,title:'Друга звичайна справа',is_complete:false,is_focus:false}];
    const yesterday=new RealDate(day+'T12:00:00Z');yesterday.setUTCDate(yesterday.getUTCDate()-1);
    const tomorrow=new RealDate(day+'T12:00:00Z');tomorrow.setUTCDate(tomorrow.getUTCDate()+1);
    const reminders=options.empty?[]:[
      {id:'rem-overdue',title:'Прострочене контрольне нагадування',due_on:yesterday.toISOString().slice(0,10),due_time:null,show_from:null,status:'active'},
      {id:'rem-visible',title:'Нагадування з наступним терміном',due_on:tomorrow.toISOString().slice(0,10),due_time:null,show_from:day,status:'active'}];
    const events=options.empty?[]:[
      {id:'event-next',title:'Тестова зустріч із довгою українською назвою',start:day+'T14:00:00+03:00',end:day+'T15:00:00+03:00'},
      {id:'event-later',title:'Друга тестова подія',start:day+'T16:00:00+03:00',end:day+'T17:00:00+03:00'},
      {id:'event-note',kind:'note',title:'Датований контрольний запис',start:day,end:tomorrow.toISOString().slice(0,10)}];
    const [year,month,date]=day.split('-').map(Number);
    const birthdays=options.empty?[]:[{id:'birthday-test',name:'Тестова людина',enabled:true,birth_month:month,birth_day:date,birth_year:null,remind_days:2}];
    const clone=value=>JSON.parse(JSON.stringify(value));
    const state=window.dashboardQA={tasks,reminders,events,birthdays,writes:[],snapshots:[]};
    window.dashboardBackend={
      isSignedIn:()=>true,restore:async()=>true,
      dailyTimezone:async()=>options.savedZone||'Europe/Istanbul',
      listDailyTasks:async query=>clone(tasks.filter(x=>x.day===query)),
      listBirthdays:async()=>clone(birthdays),listNotes:async()=>[{id:'note-test',title:'Особиста тестова нотатка',body:'Контрольний текст',updated_at:day+'T08:00:00Z'}],
      listReminders:async()=>clone(reminders),listObsidianFavorites:async()=>[],
      obsidianSnapshot:async()=>({notes:[],checkedAt:day+'T10:00:00Z'}),
      googleStatus:async()=>{if(options.offline)throw new Error('Контрольний збій мережі');return {configured:true,connected:true,canArchive:true,canCreateCalendar:true,email:'qa@example.test'}},
      googleSnapshot:async(query,min,max)=>{state.snapshots.push({day:query,min,max});return {events:query===day?clone(events):[],mails:[],errors:{}}},
      googleCalendarMonth:async()=>({events:clone(events),truncated:false}),
      editDailyTask:async(id,fields)=>{state.writes.push({type:'task',id,fields});const row=tasks.find(x=>x.id===id);Object.assign(row,fields);return clone([row])},
      setReminderComplete:async(id,done)=>{state.writes.push({type:'reminder',id,done});const row=reminders.find(x=>x.id===id);row.status=done?'completed':'active';return clone([row])}
    };
  },options);
  await page.goto('http://dashboard.test/',{waitUntil:'load'});
  await page.waitForFunction(()=>window.dashboardQA&&document.querySelector('#todayTitle')?.textContent==='Сьогодні'&&!document.querySelector('#events')?.textContent.includes('Завантажуємо'));
  await page.waitForFunction(()=>document.querySelector('#mails')?.textContent.includes('немає')||document.querySelector('#mails')?.textContent.includes('пошту'));
  return {context,page,errors};
}

async function noOverflow(page){
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'horizontal page overflow');
  assert.equal(await page.evaluate(()=>!document.querySelector('#viewShell').hidden?document.querySelector('#viewContent').scrollWidth<=document.querySelector('#viewContent').clientWidth:true),true,'horizontal view overflow');
}

(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.DASHBOARD_TEST_CHROMIUM||undefined,args:['--no-sandbox']});
  try{
    for(const width of [360,390,430]){
      const {context,page,errors}=await openPage(browser,width);
      await page.waitForFunction(()=>document.querySelectorAll('#events .home-day-row').length===4);
      assert.equal(await page.locator('.focus-card').count(),0);
      assert.equal(await page.locator('.bottom-nav button:visible').count(),5);
      assert.equal(await page.locator('#home > section:visible').count(),2);
      const order=await page.locator('#events .home-day-row strong').allTextContents();
      assert.deepEqual(order,['Прострочене контрольне нагадування','Тестова зустріч із довгою українською назвою','Друга тестова подія','Тестова людина']);
      await noOverflow(page);
      const controls=await page.locator('#events button').evaluateAll(nodes=>nodes.map(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})));
      assert(controls.every(x=>x.width>=44&&x.height>=44),'home controls must have 44 px touch areas');
      if(output)await page.screenshot({path:path.join(output,'D11.1-'+width+'.png')});
      await page.locator('#events [data-event="event-next"]').click();
      await page.waitForFunction(()=>document.querySelector('#viewContent')?.textContent.includes('Тестова зустріч'));
      assert.equal(await page.evaluate(()=>window.dashboardQA.writes.length),0,'opening source must not write');
      await page.locator('#viewBack').click();await page.waitForFunction(()=>document.querySelector('#viewShell').hidden);
      await page.locator('.home-all-day').click();
      await page.waitForFunction(()=>document.querySelectorAll('#viewContent [data-daily-open]').length===2);
      for(const text of ['Датований контрольний запис','Тестова людина','Контрольна справа без часу','Друга звичайна справа','Нагадування з наступним терміном'])assert((await page.locator('#viewContent').innerText()).includes(text),text+' missing from full day');
      assert((await page.locator('#viewContent [data-event="event-next"]').innerText()).includes('14:00'),'full day timezone differs from home');
      await noOverflow(page);
      if(output&&width===390)await page.screenshot({path:path.join(output,'D11.1-full-day.png')});
      await page.locator('[data-calendar-month="1"]').click();
      await page.locator('#viewBack').click();await page.waitForFunction(()=>document.querySelector('#viewShell').hidden);
      assert((await page.locator('#selectedDateLabel').innerText()).includes('30 вересня'),'home date leaked from calendar');
      assert.deepEqual(await page.locator('#events .home-day-row strong').allTextContents(),order);
      await page.locator('#home .home-add').click();
      assert((await page.locator('#sheetContent').innerText()).includes('30 вересня'),'capture inherited other calendar date');
      assert.equal(await page.locator('[data-calendar-kind="daily"]').count(),1);
      await page.locator('#closeSheet').click();
      await page.locator('#events [data-done="rem-overdue"]').click();
      await page.waitForFunction(()=>document.querySelector('#events [data-daily-done="task-one"]'));
      await page.locator('#events [data-daily-done="task-one"]').click();
      await page.waitForFunction(()=>window.dashboardQA.tasks[0].is_complete);
      assert.equal(await page.evaluate(()=>window.dashboardQA.tasks[0].is_focus),true,'focus flag changed');
      assert.equal(await page.evaluate(()=>window.dashboardQA.writes.filter(x=>x.type==='task').some(x=>Object.hasOwn(x.fields,'is_focus'))),false);
      await page.locator('[data-go="notes"]').click();
      assert.equal(await page.locator('.notes-sources button').count(),2);
      await page.locator('.notes-sources [data-open-section="obsidian"]').click();
      assert.equal(await page.locator('#viewTitle').innerText(),'Obsidian');
      assert.deepEqual(errors,[]);
      await context.close();
      console.log('PASS '+width+' px: four rows, all records, source opening, stable home, checkboxes, focus preserved, notes, no overflow');
    }
    for(const options of [{empty:true},{empty:true,offline:true},{empty:true,now:'2026-09-30T22:30:00Z',day:'2026-10-01',browserZone:'America/Los_Angeles'}]){
      const {context,page,errors}=await openPage(browser,360,options);
      assert.equal(await page.locator('.bottom-nav button:visible').count(),5);
      assert.equal(await page.locator('#remindersBadge:visible').count(),0);
      assert.equal(await page.locator('#events .home-day-row').count(),0);
      assert((await page.locator('#events').innerText()).includes('записів немає'));
      assert(!(await page.locator('#home').innerText()).includes('Зустріч щодо проєкту'),'private mode leaked demo');
      if(options.offline)assert.equal(await page.locator('#calendarError:visible').count(),1);
      if(options.day){assert((await page.locator('#selectedDateLabel').innerText()).includes('1 жовтня'));const snapshots=await page.evaluate(()=>window.dashboardQA.snapshots);assert.equal(snapshots[0].min,'2026-09-30T21:00:00.000Z')}
      await noOverflow(page);assert.deepEqual(errors,[]);await context.close();
    }
    console.log('PASS: empty/offline private mode, permanent navigation, saved timezone across midnight');
  }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
