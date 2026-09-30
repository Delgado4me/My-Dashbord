(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const today=new Date();today.setHours(12,0,0,0);
  let selected=new Date(today);
  let activeFilter='all';
  const ymd=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  const addDays=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x};
  const dayDiff=d=>Math.round((Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())-Date.UTC(today.getFullYear(),today.getMonth(),today.getDate()))/86400000);
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function read(key,fallback){try{const value=JSON.parse(localStorage.getItem('daily-demo-'+key));return value===null?fallback:value}catch{return fallback}}
  function save(key,value){try{localStorage.setItem('daily-demo-'+key,JSON.stringify(value))}catch{}}
  const completed=read('completed',{});
  const checked=read('priorities',{});
  const backend=window.dashboardBackend;
  let signedIn=false,sessionChecking=Boolean(backend?.isSignedIn()),authEpoch=0;
  let noteLoadError='',reminderLoadError='',sessionRestoreError='';
  let birthdays=[],birthdayLoadError='';
  let googleConnected=false,googleCanArchive=false,googleCanCreateCalendar=false,googleChecked=false,googleConfigured=false,googleStatusError='',googleEmail='',realEvents=[],realMails=[],googleRequest=0,googleDay='',lastGoogleFetch=0;
  let homeGoogleDay='',homeEvents=[],homeCalendarError='';
  let monthEvents=[],monthKey='',monthLoading=false,monthError='',monthTruncated=false,monthRequest=0;
  const monthId=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
  const eventCoversDay=(e,day)=>{if(!e.start||!e.end)return false;const key=ymd(day);return e.start.length===10?e.start<=key&&key<e.end:dayInZone(new Date(e.start))<=key&&key<=dayInZone(new Date(new Date(e.end).getTime()-1))};
  const eventsOnDay=day=>monthKey===monthId(day)?monthEvents.filter(e=>eventCoversDay(e,day)):homeGoogleDay===ymd(day)?homeEvents:googleDay===ymd(day)?realEvents:[];
  async function loadCalendarMonth(force=false){
    if(!googleConnected)return;
    const key=monthId(selected);if(!force&&(monthKey===key||monthRequestKey===key&&(monthLoading||monthError)))return;
    const request=++monthRequest,epoch=authEpoch;monthRequestKey=key;monthLoading=true;monthError='';if(currentView)renderView();
    const first=new Date(selected.getFullYear(),selected.getMonth(),1),last=new Date(selected.getFullYear(),selected.getMonth()+1,1);
    try{const result=await backend.googleCalendarMonth(dayStart(ymd(first)),dayStart(ymd(last)));if(request!==monthRequest||epoch!==authEpoch)return;monthEvents=result.events||[];monthKey=key;monthTruncated=Boolean(result.truncated)}
    catch(error){if(request!==monthRequest||epoch!==authEpoch)return;monthError=error.message;if(monthKey!==key){monthEvents=[];monthKey=''}}
    finally{if(request===monthRequest&&epoch===authEpoch){monthLoading=false;renderHomeDay();if(currentView)renderView()}}
  }
  let monthRequestKey='';
  const mailDetails=new Map();
  let mailRows=[],mailFilter='inbox',mailNext='',mailLoading=false,mailLoaded=false,mailError='',mailRequest=0;
  function resetMailbox(){++mailRequest;mailRows=[];mailNext='';mailLoading=false;mailLoaded=false;mailError=''}
  let pdfLibrary=null,pdfFont=null,mailPdfUrl='';
  const obsidianDeferred=false; // Read-only Obsidian is enabled; Markdown export remains available.
  let files=[],favoritePaths=[],obsidianRequest=0,obsidianLoading=false,obsidianError='',favoriteError='',obsidianCheckedAt='',obsidianPartial=false,lastObsidianFetch=0;
  const priorities=['Скласти план на тиждень','Відповісти на важливий лист','Розібрати нові нотатки'];
  let dailyZone=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC',dailyZoneReady=false,priorityDate='';
  const dailyDays=new Map(),dailyLoading=new Set(),dailyErrors=new Map();
  const dayInZone=(instant)=>{const parts=new Intl.DateTimeFormat('en-US',{timeZone:dailyZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(instant);const value=Object.fromEntries(parts.map(p=>[p.type,p.value]));return value.year+'-'+value.month+'-'+value.day};
  const dailyToday=()=>dayInZone(new Date());
  const homeDate=()=>dateFromSql(dailyToday());
  function dayStart(day){
    const date=dateFromSql(day),base=Date.UTC(date.getFullYear(),date.getMonth(),date.getDate());let instant=base;
    const format=new Intl.DateTimeFormat('en-GB',{timeZone:dailyZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
    for(let i=0;i<3;i++){const p=Object.fromEntries(format.formatToParts(new Date(instant)).map(x=>[x.type,x.value]));instant=base-(Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),Number(p.hour),Number(p.minute),Number(p.second))-instant)}
    return new Date(instant).toISOString();
  }

  const leap=year=>year%4===0&&(year%100!==0||year%400===0);
  const birthdayOccurrence=(b,year)=>new Date(year,b.birth_month-1,b.birth_month===2&&b.birth_day===29&&!leap(year)?28:b.birth_day,12);
  const birthdaysOn=day=>birthdays.filter(b=>b.enabled&&ymd(birthdayOccurrence(b,day.getFullYear()))===ymd(day));
  const nextBirthday=(b,from)=>{let d=birthdayOccurrence(b,from.getFullYear());if(ymd(d)<ymd(from))d=birthdayOccurrence(b,from.getFullYear()+1);return d};
  const birthdayAge=(b,year)=>b.birth_year==null?'':year-b.birth_year;
  const birthdayHint=(b,day)=>{const age=birthdayAge(b,day.getFullYear());return (age>=0&&age!==''?'Виповнюється '+age:'День народження')+(b.relationship?' · '+b.relationship:'')+(b.birth_month===2&&b.birth_day===29&&!leap(day.getFullYear())?' · 29 лютого → 28 лютого':'')};
  function birthdayRow(b,day){return '<button type="button" class="calendar-entry birthday-entry" data-birthday="'+esc(b.id)+'"><span class="calendar-entry-icon">✦</span><span><strong>'+esc(b.name)+'</strong><small>'+esc(birthdayHint(b,day))+'</small></span><span aria-hidden="true">›</span></button>'}
  const birthdayOffsets=[5,3,0];
  function birthdayAlertsOn(day){
    const utc=d=>Date.UTC(d.getFullYear(),d.getMonth(),d.getDate());
    return birthdays.filter(b=>b.enabled).map(b=>{const occurrence=nextBirthday(b,day),offset=Math.round((utc(occurrence)-utc(day))/86400000);return {birthday:b,occurrence,offset}}).filter(item=>birthdayOffsets.includes(item.offset));
  }
  function birthdayAlertRow(item){const b=item.birthday;return '<button type="button" class="calendar-entry birthday-entry" data-birthday="'+esc(b.id)+'"><span class="calendar-entry-icon">✦</span><span><strong>'+esc(b.name)+'</strong><small>'+(item.offset?'День народження через '+item.offset+' дн. · '+esc(dateFormat.format(item.occurrence)):'Сьогодні · '+esc(birthdayHint(b,item.occurrence)))+'</small></span><span aria-hidden="true">›</span></button>'}
  function renderBirthdays(){renderHomeDay()}
  const dayDiffFrom=(a,b)=>Math.round((Date.UTC(b.getFullYear(),b.getMonth(),b.getDate())-Date.UTC(a.getFullYear(),a.getMonth(),a.getDate()))/86400000);
  async function loadBirthdays(){if(!signedIn)return;const epoch=authEpoch;try{const rows=await backend.listBirthdays();if(epoch!==authEpoch)return;birthdays=rows;birthdayLoadError=''}catch(error){if(epoch!==authEpoch)return;birthdayLoadError='Не вдалося завантажити дні народження.'}renderBirthdays();if(currentView)renderView()}
  const dailyRows=day=>dailyDays.get(day)||[];
  const nextDailySlot=rows=>[1,2,3].find(n=>!rows.some(r=>r.position===n));
  const dailyDateLabel=day=>new Intl.DateTimeFormat('uk-UA',{weekday:'long',day:'numeric',month:'long'}).format(dateFromSql(day));
  function renderDaily(){renderPriorities();renderHomeDay();if(viewRoute()?.section==='priorities'||viewRoute()?.section==='today')renderView()}
  async function loadDailyDay(day,force=false){
    if(!signedIn||!dailyZoneReady||!/^\d{4}-\d{2}-\d{2}$/.test(day)||dailyLoading.has(day)||!force&&dailyDays.has(day))return;
    const epoch=authEpoch;dailyLoading.add(day);dailyErrors.delete(day);renderDaily();
    try{const rows=await backend.listDailyTasks(day);if(epoch!==authEpoch)return;dailyDays.set(day,rows)}
    catch(error){if(epoch!==authEpoch)return;dailyErrors.set(day,error.message)}
    finally{if(epoch===authEpoch){dailyLoading.delete(day);renderDaily()}}
  }
  async function updateDailyTask(id,fields){const rows=await backend.editDailyTask(id,fields);if(!rows.length)throw new Error('Справу не знайдено. Оновіть сторінку.');return rows[0]}
  async function syncDailyDay(day){await loadDailyDay(day,true);if(dailyErrors.has(day))throw new Error(dailyErrors.get(day))}
  function dailyErrorText(error){return /23505|duplicate|unique|conflict/i.test(error.message)?'Цей слот, фокус або джерело вже зайняті. Оновіть день і спробуйте ще раз.':error.message}
  const events=[{id:1,day:0,time:'10:30',title:'Зустріч щодо проєкту',subtitle:'Демонстраційна подія · 30 хв',detail:'Обговорити наступний крок і зафіксувати рішення.'},{id:2,day:0,time:'14:00',title:'Час для роботи над проєктом',subtitle:'Демонстраційна подія · 1 год',detail:'Відкрити план і зосередитися на одному завданні.'},{id:3,day:1,time:'11:00',title:'Огляд тижня',subtitle:'Демонстраційна подія · 30 хв',detail:'Переглянути пріоритети наступних днів.'},{id:4,day:2,time:'09:30',title:'Планування',subtitle:'Демонстраційна подія · 20 хв',detail:'Вибрати найважливіше завдання.'}];
  const demoReminders=[{id:'parcel',title:'Забрати посилку',due:1,icon:'📦',source:'Приклад листа про доставку'},{id:'insurance',title:'Оплатити страховку',due:2,icon:'▣',source:'Приклад листа про рахунок'}];
  let reminders=demoReminders;
  const mails=[{from:'Команда проєкту',subject:'Оновлення плану',snippet:'Є кілька пунктів, які варто переглянути…',time:'08:14',text:'Це демонстраційний лист. Коли пошту буде підключено, тут відкриватиметься справжній запис.'},{from:'Календар',subject:'Запрошення на зустріч',snippet:'Нагадуємо про заплановану розмову…',time:'09:27',text:'Демонстраційне запрошення на зустріч.'},{from:'Доставка',subject:'Ваша посилка в дорозі',snippet:'Перевірте дату отримання…',time:'11:36',text:'Демонстраційний приклад повідомлення про доставку.'},{from:'Сервіс',subject:'Оновлення облікового запису',snippet:'Ми підготували короткий огляд…',time:'12:11',text:'Демонстраційне повідомлення від сервісу.'},{from:'Страхування',subject:'Інформація про платіж',snippet:'Перегляньте дані перед оплатою…',time:'13:02',text:'Демонстраційний приклад повідомлення про страховку.'},{from:'Команда',subject:'Нові матеріали',snippet:'Надсилаємо нотатки з обговорення…',time:'14:18',text:'Демонстраційний лист із матеріалами.'}];
  let notes=read('notes',null);if(!Array.isArray(notes))notes=[{id:'demo1',title:'Ідеї для продукту',body:'Покращити онбординг.\nДодати інтеракції.\nДослідити конкурентів.',date:'Приклад'},{id:'demo2',title:'План на тиждень',body:'Презентація\nЗустрічі з клієнтами\nАналіз результатів',date:'Приклад'}];
  const dateFormat=new Intl.DateTimeFormat('uk-UA',{weekday:'long',day:'numeric',month:'long'});
  const dateFromSql=value=>{if(!value)return null;const [y,m,d]=value.split('-').map(Number);return new Date(y,m-1,d,12)};
  const isDone=r=>signedIn?r.status==='completed':Boolean(completed[r.id]);
  const reminderDate=r=>r.due===null?'Без дати':dateFormat.format(addDays(today,r.due))+(r.dueTime?' · '+r.dueTime:'');
  const mapReminder=r=>({id:r.id,title:r.title,due:r.due_on?dayDiff(dateFromSql(r.due_on)):null,dueTime:r.due_time?String(r.due_time).slice(0,5):'',timezone:r.timezone,showFrom:r.show_from?dayDiff(dateFromSql(r.show_from)):null,icon:'🔔',source:r.source_label||'Створено вручну',sourceType:r.source_type,sourceKey:r.source_key,status:r.status});
  function suggestMailReminder(m){
    // Incoming mail is untrusted data: fixed, limited rules only; never follow its instructions.
    const value=((m.subject||'')+' '+(m.snippet||'')+' '+(m.body||'')).slice(0,3500).toLowerCase();
    if(/посил|пакун|поштомат|pakke|parcel|package|shipment|gls|postnord|\bdhl\b|\bdpd\b/.test(value))
      return {title:/забрат|самовив|afhent|hent din|pakkeshop|pickup|pick up|ready for collection|collect your/.test(value)?'Забрати посилку':'Перевірити доставку посилки',kind:'📦'};
    if(/авіаквит|літак|виліт|посадк|\bflight\b|boarding|flybillet|flyrejse|check-in/.test(value))return {title:'Перевірити підготовку до рейсу',kind:'✈️'};
    if(/страхов|forsikr|insurance/.test(value))return {title:'Перевірити страховку або оплату',kind:'▣'};
    if(/рахунк|фактур|\binvoice\b|\bfaktura\b|betalingsfrist/.test(value))return {title:'Перевірити рахунок',kind:'▣'};
    return null;
  }
  function mailReminderSuggestions(){
    const seen=new Set();
    return [...realMails,...mailRows].filter(m=>m?.id&&!seen.has(m.id)&&seen.add(m.id))
      .map(m=>({mail:m,suggestion:suggestMailReminder(m)}))
      .filter(x=>x.suggestion&&!reminders.some(r=>r.sourceType==='mail'&&r.sourceKey===x.mail.id)).slice(0,5);
  }
  function updateMode(){
    $('notesSubheading').textContent=signedIn?(noteLoadError?'Не вдалося завантажити':'Збережено у Supabase'):sessionChecking?'Перевіряємо вхід…':'Швидкі записи на цьому пристрої';
    $('refreshGoogle').hidden=!googleConnected;
    $('refreshObsidian').hidden=!signedIn;
    const banner=$('connectionBanner');
    if(banner){
      banner.hidden=signedIn;
      $('connectionStatus').textContent=sessionRestoreError|| (sessionChecking?'Перевіряємо вхід…':backend?'Зараз показано приклади. Увійдіть, щоб бачити свої дані.':'Підключіть сховище, щоб увійти та бачити свої дані.');
      $('connectionAction').textContent=backend?'Увійти':'Налаштувати';
      $('connectionAction').dataset.action=backend?'sign-in':'connection-settings';
      $('connectionAction').disabled=sessionChecking&&!sessionRestoreError;
    }
  }
  function renderFocus(){
    if(!$('focusSample'))return;
    $('focusSample').hidden=signedIn||sessionChecking;
    const day=dailyToday(),rows=dailyRows(day),focus=rows.find(r=>r.is_focus),error=dailyErrors.get(day);
    $('focusTitle').textContent=sessionChecking||signedIn&&!dailyZoneReady||dailyLoading.has(day)&&!dailyDays.has(day)?'Завантажуємо фокус…':signedIn?error&&!dailyDays.has(day)?'Не вдалося завантажити':focus?focus.title:rows.length?'Обрати фокус':'Що головне хотіли зробити сьогодні?':'План на день';
    $('focusDescription').textContent=signedIn?focus?(focus.is_complete?'Виконано · ':'')+'1 з '+rows.length+' пріоритетів':error&&!dailyDays.has(day)?'Натисніть, щоб повторити.':rows.length?'У вас '+rows.length+' справи на сьогодні. Оберіть головну.':'Щоденні справи з’являться після першого запису.':sessionChecking?'Перевіряємо особисті дані.':'Оберіть одну важливу справу на сьогодні.';
    $('focusOpen').setAttribute('aria-label',focus?'Відкрити фокус: '+focus.title:'Додати або вибрати головний фокус');
  }
  function googleErrors(errors={}){
    for(const [source,id] of [['calendar','calendarError'],['mail','mailError']]){
      $(id).hidden=!errors[source];$(id).textContent=errors[source]||'';
    }
  }
  async function loadPrivateData(){
    const epoch=++authEpoch;
    ++obsidianRequest;obsidianLoading=false;obsidianCheckedAt='';obsidianError='';favoriteError='';files=[];favoritePaths=[];
    signedIn=true;sessionChecking=false;sessionRestoreError='';googleChecked=false;googleStatusError='';googleConnected=false;googleCanArchive=false;googleCanCreateCalendar=false;googleEmail='';googleDay='';homeGoogleDay='';homeEvents=[];homeCalendarError='';realEvents=[];realMails=[];monthKey='';monthRequestKey='';monthEvents=[];monthError='';monthLoading=false;monthTruncated=false;++monthRequest;mailDetails.clear();resetMailbox();noteLoadError='';reminderLoadError='';notes=[];reminders=[];
    dailyDays.clear();dailyLoading.clear();dailyErrors.clear();dailyZoneReady=false;priorityDate='';
    googleErrors();updateMode();renderFocus();renderPriorities();renderDate(false);renderMail();renderNotes();renderReminders();
    const zoneReady=backend.dailyTimezone(dailyZone).then(zone=>{if(epoch!==authEpoch)return;dailyZone=zone;dailyZoneReady=true;priorityDate=dailyToday();if(!currentView)selected=homeDate();renderDate(false);renderDaily();loadDailyDay(priorityDate)}).catch(error=>{if(epoch!==authEpoch)return;dailyZoneReady=true;priorityDate=dailyToday();dailyErrors.set(priorityDate,error.message);renderDaily()});
    loadBirthdays();
    const [noteResult,reminderResult]=await Promise.allSettled([backend.listNotes(),backend.listReminders()]);
    if(epoch!==authEpoch)return;
    if(noteResult.status==='fulfilled')notes=noteResult.value.map(n=>({id:n.id,title:n.title,body:n.body,date:new Intl.DateTimeFormat('uk-UA',{day:'numeric',month:'long'}).format(new Date(n.updated_at))}));
    else noteLoadError='Не вдалося завантажити нотатки. Оновіть сторінку.';
    if(reminderResult.status==='fulfilled')reminders=reminderResult.value.map(mapReminder);
    else reminderLoadError='Не вдалося завантажити нагадування. Оновіть сторінку.';
    renderNotes();renderReminders();updateMode();if(currentView)renderView();
    backend.listObsidianFavorites().then(rows=>{if(epoch!==authEpoch)return;favoritePaths=rows.map(row=>row.path);favoriteError='';renderFiles();if(currentView)renderView()}).catch(error=>{if(epoch!==authEpoch)return;favoriteError='Не вдалося завантажити фаворити: '+error.message;renderFiles();if(currentView)renderView()});
    refreshObsidian();
    await zoneReady;if(epoch!==authEpoch)return;
    try{const status=await backend.googleStatus();if(epoch!==authEpoch)return;googleChecked=true;googleConfigured=Boolean(status.configured);googleConnected=Boolean(status.connected);googleCanArchive=Boolean(status.canArchive);googleCanCreateCalendar=Boolean(status.canCreateCalendar);googleEmail=status.email||'';googleErrors();updateMode();renderDate(false);renderMail();if(currentView)renderView();if(googleConnected){await refreshGoogleDay();loadCalendarMonth()}}
    catch(error){if(epoch!==authEpoch)return;googleChecked=true;googleStatusError=error.message;homeCalendarError='Не вдалося перевірити підключення календаря.';googleErrors({calendar:'Не вдалося перевірити підключення календаря.',mail:'Не вдалося перевірити підключення пошти.'});updateMode();renderDate(false);renderMail();if(currentView)renderView()}
  }
  async function refreshGoogleDay(day=selected){
    if(!googleConnected)return;
    const sequence=++googleRequest,d=new Date(day),next=addDays(d,1),key=ymd(d);
    lastGoogleFetch=Date.now();$('refreshGoogle').disabled=true;
    try{
      const snapshot=await backend.googleSnapshot(key,dayStart(key),dayStart(ymd(next)));
      if(sequence!==googleRequest)return;
      realEvents=snapshot.events||[];realMails=snapshot.mails||[];googleDay=key;googleErrors(snapshot.errors);
      if(key===dailyToday()){homeEvents=realEvents;homeGoogleDay=key;homeCalendarError=snapshot.errors?.calendar||''}
      else if(homeGoogleDay!==dailyToday()){
        const base=homeDate(),end=addDays(base,1),homeSnapshot=await backend.googleSnapshot(ymd(base),dayStart(ymd(base)),dayStart(ymd(end)));
        if(sequence!==googleRequest)return;
        homeEvents=homeSnapshot.events||[];homeGoogleDay=ymd(base);homeCalendarError=homeSnapshot.errors?.calendar||'';realMails=homeSnapshot.mails||[];
      }
      renderDate(false);renderMail();updateMode();
    }catch(error){
      if(sequence===googleRequest){realEvents=[];realMails=[];googleDay=key;if(key===dailyToday()){homeEvents=[];homeGoogleDay=key;homeCalendarError=error.message}googleErrors({calendar:error.message,mail:error.message});renderDate(false);renderMail();updateMode()}
    }finally{if(sequence===googleRequest){$('refreshGoogle').disabled=false;if(currentView)renderView()}}
  }

  async function fetchMail(id){
    if(!signedIn||!googleConnected||mailDetails.get(id)?.status==='loading')return;
    const epoch=authEpoch;
    mailDetails.set(id,{status:'loading'});
    try{const letter=await backend.googleMessage(id);if(epoch!==authEpoch)return;mailDetails.set(id,{status:'loaded',letter});for(const m of [...realMails,...mailRows])if(m.id===id)Object.assign(m,{unread:letter.unread,important:letter.important,inbox:letter.inbox});renderMail()}
    catch(error){if(epoch!==authEpoch)return;mailDetails.set(id,{status:'error',message:error.message})}
    if(currentView===routeKey('mail',id))renderView();
  }
  async function loadMailbox(reset=false){
    if(!googleConnected||mailLoading)return;
    if(reset)resetMailbox();
    const request=++mailRequest,epoch=authEpoch,folder=mailFilter,token=mailNext;
    mailLoading=true;mailError='';if(currentView===routeKey('mail'))renderView();
    try{
      const page=await backend.googleList(folder,token);
      if(request!==mailRequest||epoch!==authEpoch||folder!==mailFilter)return;
      const known=new Set(mailRows.map(row=>row.id));
      mailRows.push(...(page.mails||[]).filter(row=>row.id&&!known.has(row.id)&&known.add(row.id)));
      mailNext=page.nextPageToken||'';mailLoaded=true;
      if(page.partial)mailError='Деякі листи не завантажилися. Оновіть список.';
    }catch(error){if(request===mailRequest&&epoch===authEpoch)mailError=error.message}
    finally{if(request===mailRequest){mailLoading=false;if(currentView===routeKey('mail'))renderView()}}
  }
  async function refreshObsidian(){
    if(obsidianDeferred||!signedIn||obsidianLoading)return;
    const sequence=++obsidianRequest,epoch=authEpoch;
    obsidianLoading=true;lastObsidianFetch=Date.now();renderFiles();
    $('refreshObsidian').disabled=true;if(currentView)renderView();
    try{
      const snapshot=await backend.obsidianSnapshot();
      if(sequence!==obsidianRequest||epoch!==authEpoch||!signedIn)return;
      const unique=new Map();
      for(const f of Array.isArray(snapshot.notes)?snapshot.notes:[]){
        if(safeObsidianPath(f.path)&&!unique.has(f.path))unique.set(f.path,f);
      }
      files=[...unique.values()].sort((a,b)=>(Date.parse(b.updatedAt)||0)-(Date.parse(a.updatedAt)||0));
      obsidianCheckedAt=snapshot.checkedAt||'';obsidianPartial=Boolean(snapshot.partial);obsidianError='';
    }catch(error){if(sequence===obsidianRequest&&epoch===authEpoch)obsidianError=error.message}
    finally{if(sequence===obsidianRequest&&epoch===authEpoch){obsidianLoading=false;$('refreshObsidian').disabled=false;renderFiles();updateMode();if(currentView)renderView()}}
  }
  function remindersForDay(date,includeDone=false){
    const diff=dayDiff(date);
    return (sessionChecking?[]:reminders).filter(r=>r.status!=='dismissed'&&r.status!=='needs_review'&&
      (isDone(r)?includeDone&&r.due===diff:(r.showFrom==null||r.showFrom<=diff)&&
        (r.due!=null&&r.due<=diff||r.showFrom!=null&&r.showFrom<=diff||r.due==null&&r.showFrom==null)));
  }
  function homeDayCandidates(){
    const date=homeDate(),day=ymd(date),diff=dayDiff(date),now=new Date();
    const clockParts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:dailyZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
    const clock=clockParts.hour+':'+clockParts.minute;
    const candidates=[],add=(key,rank,time,html)=>candidates.push({key,rank,time,html});
    const listed=googleConnected?eventsOnDay(date):signedIn||sessionChecking?[]:events.filter(e=>e.day===diff);
    for(const e of listed){
      const allDay=googleConnected&&e.start.length===10;
      const time=allDay?'':googleConnected?new Intl.DateTimeFormat('uk-UA',{timeZone:dailyZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(e.start)):e.time;
      add('event:'+e.id,allDay?3:time>=clock?1:2,time||'3',
        '<button type="button" class="home-day-row" data-event="'+esc(e.id)+'" data-event-day="'+day+'"><span class="home-day-time">'+esc(allDay?'Увесь день':time)+'</span><span class="home-day-copy"><strong>'+esc(e.title)+'</strong><small>'+(e.kind==='note'?'Запис':googleConnected?'Подія':'Приклад')+'</small></span></button>');
    }
    for(const item of birthdayAlertsOn(date)){const b=item.birthday;add('birthday:'+b.id,0,'birthday:'+b.name,
      '<button type="button" class="home-day-row" data-birthday="'+esc(b.id)+'"><span class="home-day-time">✦</span><span class="home-day-copy"><strong>'+esc(b.name)+'</strong><small>'+esc(item.offset?'День народження через '+item.offset+' дн.':birthdayHint(b,date))+'</small></span></button>')}
    if(signedIn)for(const r of dailyRows(day))add('daily:'+r.id,r.is_complete?4:3,'1:'+r.position,
      '<div class="home-day-row home-task-row"><button type="button" class="daily-check'+(r.is_complete?' is-complete':'')+'" data-daily-done="'+esc(r.id)+'" aria-label="'+(r.is_complete?'Відновити: ':'Виконати: ')+esc(r.title)+'">'+(r.is_complete?'✓':'')+'</button><button type="button" class="home-day-copy'+(r.is_complete?' is-complete':'')+'" data-daily-open="'+esc(r.id)+'"><strong>'+esc(r.title)+'</strong><small>Справа дня</small></button></div>');
    for(const r of remindersForDay(date)){
      const overdue=r.due!=null&&(r.due<diff||r.due===diff&&r.dueTime&&r.dueTime<clock);
      const relative=r.due==null?'Без дати':r.due<diff?'Прострочено':r.due===diff?'Сьогодні':dateFormat.format(addDays(today,r.due));
      add('reminder:'+r.id,overdue?0:r.due===diff&&r.dueTime?1:3,(overdue?String(r.due).padStart(6,'0')+':':'')+(r.dueTime||'2'),
        '<div class="home-day-row home-task-row"><button type="button" class="daily-check" data-done="'+esc(r.id)+'" aria-label="Виконати: '+esc(r.title)+'"></button><button type="button" class="home-day-copy" data-reminder="'+esc(r.id)+'"><strong>'+esc(r.title)+'</strong><small>Нагадування · '+esc(relative)+(r.dueTime?' · '+esc(r.dueTime):'')+'</small></button></div>');
    }
    return candidates.sort((a,b)=>a.rank-b.rank||a.time.localeCompare(b.time,'uk')||a.key.localeCompare(b.key)).map(x=>x.html);
  }
  function renderHomeDay(){
    const box=$('events');if(!box)return;
    const rows=homeDayCandidates();
    const day=dailyToday(),waiting=sessionChecking||signedIn&&(!googleChecked||!dailyZoneReady||dailyLoading.has(day)&&!dailyDays.has(day))||googleConnected&&homeGoogleDay!==day&&monthKey!==monthId(homeDate());
    const problems=[signedIn?dailyErrors.get(day):'',birthdayLoadError,reminderLoadError].filter(Boolean);
    box.innerHTML=(rows.length?rows.slice(0,4).join(''):'<div class="empty">'+(waiting?'Завантажуємо справи дня…':problems.length?'Частина записів недоступна.':'Сьогодні записів немає. Додайте «+ Запис».')+'</div>')+(problems.length?'<p class="sync-error" role="status">'+esc(problems.join(' '))+' <button type="button" data-home-retry>Повторити</button></p>':'');
    $('todayTitle').textContent='Сьогодні';$('selectedDateLabel').textContent=dateFormat.format(homeDate());
    $('calendarError').hidden=!homeCalendarError;$('calendarError').textContent=homeCalendarError;
  }
  function renderDate(fetchGoogle=true){$('dateInput').value=ymd(selected);
    renderHomeDay();renderReminders();if(googleConnected&&fetchGoogle){refreshGoogleDay();loadCalendarMonth()}}
  function dueText(r){if(r.due===null)return 'Без дати';const diff=r.due-dayDiff(selected),label=diff<0?'Прострочено':diff===0?'Сьогодні':diff===1?'Завтра':diff===2?'Через 2 дні':'Через '+diff+' дн.';return label+(r.dueTime?' · '+r.dueTime:'')}
  function isVisibleReminder(r,diff){return !isDone(r)&&r.status!=='dismissed'&&r.status!=='needs_review'&&(signedIn?(r.showFrom===null||r.showFrom<=diff):(r.due-diff<=2))}
  function renderReminders(){const active=remindersForDay(homeDate()).length;$('remindersTab').hidden=false;$('remindersBadge').hidden=!active;$('remindersBadge').textContent=active||'';renderHomeDay()}
  function dailyRow(r){return '<div class="daily-row"><button type="button" class="daily-check'+(r.is_complete?' is-complete':'')+'" data-daily-done="'+esc(r.id)+'" aria-label="'+(r.is_complete?'Відновити: ':'Виконати: ')+esc(r.title)+'">'+(r.is_complete?'✓':'')+'</button><button type="button" class="daily-open'+(r.is_complete?' is-complete':'')+'" data-daily-open="'+esc(r.id)+'"><span>'+esc(r.title)+'</span>'+'</button></div>'}
  function renderPriorities(){const day=dailyToday(),rows=dailyRows(day),error=dailyErrors.get(day);$('prioritySubheading').textContent=signedIn?'Сьогодні · '+dailyDateLabel(day):sessionChecking?'Перевіряємо особисті дані…':'На цей день · приклади';$('prioritiesList').innerHTML=signedIn?error&&!dailyDays.has(day)?'<div class="empty">Не вдалося завантажити справи. <button type="button" data-daily-retry="'+day+'">Повторити</button></div>':!dailyZoneReady||dailyLoading.has(day)&&!dailyDays.has(day)?'<div class="empty">Завантажуємо справи…</div>':rows.length?rows.map(dailyRow).join(''):'<div class="empty">До 3 справ на день. Поки користуйтеся нотатками й нагадуваннями.</div>':sessionChecking?'<div class="empty">Завантажуємо особисті дані…</div>':priorities.map((t,i)=>'<label class="priority-row"><input type="checkbox" data-priority="'+i+'" '+(checked[i]?'checked':'')+'><span>'+esc(t)+'</span></label>').join('')}
  function safeObsidianPath(path){return typeof path==='string'&&path.endsWith('.md')&&path.length<=500&&!path.split('/').some(part=>!part||part==='Haven'||part.startsWith('.'))}
  function obsidianUrl(path){const url=files.find(f=>f.path===path)?.url||'';return /^https:\/\/github\.com\/[^/]+\/[^/]+\/blob\//.test(url)?url:''}
  function fileByPath(path){return files.find(f=>f.path===path)||{path,name:path.split('/').at(-1),folder:path.split('/').slice(0,-1).join('/'),kind:'pinned',url:obsidianUrl(path)}}
  function fileRow(f){const pinned=favoritePaths.includes(f.path),time=f.updatedAt?new Date(f.updatedAt).toLocaleString('uk-UA',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'Закріплено';return '<div class="file-row"><a class="file-open" href="/reader.html?path='+encodeURIComponent(f.path)+'" target="_blank" rel="noopener noreferrer" aria-label="Відкрити в новій вкладці: '+esc(f.name)+'"><span class="file-icon"><svg><use href="#i-file"/></svg></span><span class="file-main"><strong>'+esc(f.name)+'</strong><small>'+esc(f.folder)+' · '+esc(time)+'</small></span><span class="file-status">'+(f.kind==='added'?'Додано':f.kind==='edited'?'Змінено':'')+'</span></a><button type="button" class="favorite-toggle'+(pinned?' is-favorite':'')+'" data-favorite-path="'+esc(f.path)+'" aria-label="'+(pinned?'Прибрати з фаворитів: ':'Додати до фаворитів: ')+esc(f.name)+'" aria-pressed="'+pinned+'">'+(pinned?'★':'☆')+'</button></div>'}
  function renderFiles(){
    const pinned=favoritePaths.filter(safeObsidianPath).map(fileByPath);
    $('pinnedSection').hidden=!signedIn||!pinned.length;
    $('pinnedFiles').innerHTML=pinned.map(fileRow).join('');
    const recent=files.filter(f=>!favoritePaths.includes(f.path)&&(activeFilter==='all'||f.kind===activeFilter));
    $('files').innerHTML=recent.length?recent.slice(0,5).map(fileRow).join(''):'<div class="empty">'+(!signedIn?'Увійдіть, щоб переглядати свої файли Obsidian.':obsidianLoading&&!files.length?'Завантажуємо зміни…':obsidianError&&!files.length?'Не вдалося завантажити зміни.':'Немає інших змін для цього фільтра.')+'</div>';
    $('obsidianError').hidden=!obsidianError;
    $('obsidianError').textContent=obsidianError;
    $('obsidianSubheading').textContent=obsidianCheckedAt?'GitHub · перевірено '+new Date(obsidianCheckedAt).toLocaleTimeString('uk-UA',{hour:'2-digit',minute:'2-digit'})+(obsidianPartial?' · частковий огляд':''):'Останні зміни · GitHub';
  }
  function mailSenderName(value){
    const raw=String(value||'').trim();
    const name=raw.replace(/\s*<[^<>]+>\s*$/,'').trim().replace(/^"(.*)"$/,'$1').trim();
    if(name&&!name.includes('@'))return name;
    const address=raw.match(/<?([^<>\s,]+@[^<>\s,]+)>?/);
    if(!address)return raw||'Невідомий відправник';
    const [local,domain]=address[1].split('@');
    const label=/^(no.?reply|notifications?|mailer|support|info|contact)$/i.test(local)?domain.split('.').slice(-2)[0]:local;
    const readable=label.replace(/[._-]+/g,' ').trim();
    return readable?readable[0].toLocaleUpperCase('uk-UA')+readable.slice(1):'Невідомий відправник';
  }
  function mailRow(m,i,home=false){
    const unread=!googleConnected||Boolean(m.unread),state=unread?'Непрочитано':'Прочитано';
    const id=esc(m.id||'demo-'+i),canSwipe=googleConnected&&m.inbox!==false;
    const sender=mailSenderName(m.from);
    const row='<button type="button" class="mail-row '+(unread?'is-unread':'is-read')+'" '+(home?'data-mail="'+i+'"':'data-mail-id="'+id+'"')+' aria-label="'+state+': '+esc(sender)+', '+esc(m.subject)+'"><span class="unread-dot"'+(unread?'':' hidden')+'></span><span class="sender-avatar">'+esc(sender[0])+'</span><span class="mail-copy"><strong>'+esc(sender)+'</strong><span>'+esc(m.subject)+'</span><small>'+state+' · '+esc(m.snippet)+'</small></span>'+(home?'<span class="mail-time">'+esc(googleConnected?(m.date?new Date(m.date).toLocaleTimeString('uk-UA',{hour:'2-digit',minute:'2-digit'}):''):m.time)+'</span>':'')+'</button>';
    return canSwipe?'<div class="mail-swipe" data-swipe-id="'+id+'"><button type="button" class="mail-archive" data-mail-archive="'+id+'" aria-label="Архівувати: '+esc(m.subject)+'" hidden>Архівувати</button>'+row+'</div>':row;
  }
  function renderMail(){
    const list=googleConnected?realMails:signedIn||sessionChecking?[]:mails;
    $('mailSubheading').textContent=googleConnected?'Вхідні · Gmail':signedIn?googleStatusError?'Помилка Google':googleChecked?googleConfigured?'Google не підключено':'Google не налаштовано':'Перевіряємо Google…':sessionChecking?'Перевіряємо вхід…':'Непрочитані · приклади';
    $('mailCount').textContent=googleConnected?list.filter(m=>m.unread).length:list.length;
    $('mailCount').title=googleConnected?'Непрочитаних серед показаних листів':'Показано листів';
    $('mails').innerHTML=list.length?list.map((m,i)=>mailRow(m,i,true)).join(''):'<div class="empty">'+(googleConnected?$('mailError').hidden?'У вхідних листів немає.':'Пошта недоступна.':signedIn?googleStatusError?'Не вдалося перевірити пошту.':googleChecked?googleConfigured?'Підключіть Google у розділі «Ще», щоб бачити листи.':'Google ще не налаштовано.':'Перевіряємо підключення пошти…':sessionChecking?'Перевіряємо особистий вхід…':'Непрочитаних листів немає.')+'</div>';
  }
  function renderNotes(){$('notesList').innerHTML=(sessionChecking?[]:notes).map(n=>'<button type="button" class="note-tile" data-note="'+esc(n.id)+'"><strong>'+esc(n.title)+'</strong><span>'+esc(n.body)+'</span><small>'+esc(n.date||'На цьому пристрої')+'</small></button>').join('')+(noteLoadError?'<p class="sync-error" role="status">'+esc(noteLoadError)+'</p>':'')+(sessionChecking?'':'<button type="button" class="note-tile add-tile" data-action="new-note">+ Додати нотатку</button>')}
  const viewScroll=new Map();
  let currentView='',viewOrigin=null,homeScroll=0;
  const viewNames={today:'Календар',birthdays:'Дні народження',mail:'Пошта',notes:'Нотатки',obsidian:'Obsidian',reminders:'Нагадування',priorities:'Мої пріоритети'};
  function viewRoute(){
    if(!location.hash.startsWith('#view/'))return null;
    try{
      const parts=location.hash.slice(6).split('/').map(decodeURIComponent);
      if(!Object.hasOwn(viewNames,parts[0])||parts.length>4||parts.some(part=>part.length>500))return {invalid:true};
      return {section:parts[0],id:parts[1]||'',day:parts[2]||''};
    }catch{return {invalid:true}}
  }
  function routeKey(section,id='',day=''){return '#view/'+[section,id,day].filter(Boolean).map(encodeURIComponent).join('/')}
  function openView(section,id='',day='',button=null){
    if(button)viewOrigin=button;
    if(!currentView)homeScroll=window.scrollY;
    else viewScroll.set(currentView,$('viewContent').scrollTop);
    if(!id&&['notes','obsidian'].includes(section))save('notes-source',section);
    const target=routeKey(section,id,day);
    if(location.hash===target){renderView();return}
    history.pushState({dashboardView:true,parent:currentView||'home'},'',target);
    renderView();
  }
  function backView(){
    if(!$('sheetBackdrop').hidden){closeSheet();return}
    if(history.state?.dashboardView&&history.state.parent)history.back();
    else {history.replaceState(null,'',location.pathname+location.search);renderView()}
  }
  function viewMissing(message){return '<div class="view-card empty-list">'+esc(message||'Запис не знайдено або він більше недоступний.')+'</div>'}
  function calendarMonthGrid(){
    const start=new Date(selected.getFullYear(),selected.getMonth(),1),count=new Date(selected.getFullYear(),selected.getMonth()+1,0).getDate();
    const offset=(start.getDay()+6)%7,cells=Array.from({length:offset},()=>'<span class="calendar-blank"></span>');
    for(let day=1;day<=count;day++){
      const d=new Date(selected.getFullYear(),selected.getMonth(),day,12),date=ymd(d),has=monthKey===monthId(d)&&monthEvents.some(e=>eventCoversDay(e,d)),due=reminders.some(r=>r.due===dayDiff(d)&&!isDone(r)),birthday=birthdayAlertsOn(d).length;
      cells.push('<button type="button" class="calendar-day'+(date===ymd(selected)?' selected':'')+(date===dailyToday()?' today':'')+'" data-calendar-day="'+date+'" aria-label="'+esc(dateFormat.format(d))+(has?', є події':'')+(birthday?', є дні народження':'')+(due?', є завдання':'')+'" aria-pressed="'+(date===ymd(selected))+'"><span>'+day+'</span>'+(has||birthday||due?'<span class="calendar-dots" aria-hidden="true">'+(has?'<i></i>':'')+(birthday?'<i class="birthday-dot"></i>':'')+(due?'<i class="has-task"></i>':'')+'</span>':'')+'</button>');
    }
    return '<div class="calendar-month"><div class="calendar-month-head"><button type="button" data-calendar-month="-1" aria-label="Попередній місяць">‹</button><strong>'+esc(new Intl.DateTimeFormat('uk-UA',{month:'long',year:'numeric'}).format(start))+'</strong><button type="button" data-calendar-month="1" aria-label="Наступний місяць">›</button></div><div class="calendar-grid">'+['пн','вт','ср','чт','пт','сб','нд'].map(s=>'<span class="calendar-weekday">'+s+'</span>').join('')+cells.join('')+'</div></div>';
  }
  function calendarDayList(){
    const listed=googleConnected?eventsOnDay(selected):signedIn?[]:events.filter(e=>e.day===dayDiff(selected));
    const tasks=remindersForDay(selected,true);
    const selectedDay=ymd(selected),prioritiesForDay=signedIn?dailyRows(selectedDay):[];
    const rows=listed.map(e=>'<button type="button" class="calendar-entry" data-event="'+esc(e.id)+'"><span class="calendar-entry-icon">'+(e.kind==='note'?'✎':'◷')+'</span><span><strong>'+esc(e.title)+'</strong><small>'+(e.kind==='note'?'Запис · увесь день':!googleConnected?esc(e.time):e.start.length===10?'Подія · увесь день':esc(new Date(e.start).toLocaleTimeString('uk-UA',{timeZone:dailyZone,hour:'2-digit',minute:'2-digit'})))+'</small></span><span aria-hidden="true">›</span></button>').join('');
    const birthRows=birthdaysOn(selected).map(b=>birthdayRow(b,selected)).join('');
    const taskRows=tasks.map(r=>'<div class="calendar-task"><button type="button" class="done-button" data-done="'+esc(r.id)+'" aria-label="'+(isDone(r)?'Відновити':'Виконати')+': '+esc(r.title)+'">'+(isDone(r)?'✓':'')+'</button><button type="button" data-reminder="'+esc(r.id)+'"><strong'+(isDone(r)?' class="is-complete"':'')+'>'+esc(r.title)+'</strong><small>Завдання'+(r.dueTime?' · '+esc(r.dueTime):'')+' · '+(isDone(r)?'виконано':'у плані')+'</small></button></div>').join('');
    const priorityRows=prioritiesForDay.map(dailyRow).join('');
    const priorityError=dailyErrors.get(selectedDay);
    const priorityGroup=signedIn?'<h3 class="calendar-group-label">Справи дня</h3><div class="calendar-day-entries">'+(priorityError?'<p class="view-error">Не вдалося завантажити справи. <button type="button" data-daily-retry="'+selectedDay+'">Повторити</button></p>':!dailyZoneReady||dailyLoading.has(selectedDay)&&!dailyDays.has(selectedDay)?'<p class="calendar-empty">Завантажуємо справи…</p>':priorityRows||'<p class="calendar-empty">Справ ще немає.</p>')+(dailyZoneReady&&nextDailySlot(prioritiesForDay)?'<button type="button" class="daily-empty-slot" data-daily-new="'+selectedDay+'">+ Справа</button>':'')+'</div>':'';
    const group=(title,content)=>content?'<h3 class="calendar-group-label">'+title+'</h3><div class="calendar-day-entries">'+content+'</div>':'';
    return '<h2 class="calendar-day-title">'+esc(dateFormat.format(selected))+'</h2>'+(monthError?'<p class="view-error">Не вдалося завантажити місяць: '+esc(monthError)+' <button type="button" data-calendar-refresh>Повторити</button></p>':'')+(monthTruncated?'<p class="view-error">Показано перші 1250 подій місяця.</p>':'')+(birthdayLoadError?'<p class="view-error">'+esc(birthdayLoadError)+' <button type="button" data-birthday-retry>Повторити</button></p>':'')+(group('Події та записи',rows)+group('Дні народження',birthRows)+group('Нагадування про дні народження',birthdayAlertsOn(selected).filter(item=>item.offset>0).map(birthdayAlertRow).join(''))+priorityGroup+group('Завдання',taskRows)||'<div class="calendar-day-entries"><p class="calendar-empty">'+(monthLoading?'Завантажуємо записи…':'Записів на цей день немає.')+'</p></div>');
  }
  function sectionView(section){
    if(section==='today'){
      return {html:calendarMonthGrid()+'<button type="button" class="birthday-list-link" data-open-section="birthdays">✦ Усі дні народження ›</button>'+calendarDayList(),header:'<button type="button" data-action="calendar-new">+ Запис</button>'};
    }
    if(section==='birthdays'){
      const base=dateFromSql(dailyToday()),months=Array.from({length:12},(_,i)=>(base.getMonth()+i)%12+1);
      const list=months.map(month=>{const rows=birthdays.filter(b=>b.birth_month===month).sort((a,b)=>a.birth_day-b.birth_day||a.name.localeCompare(b.name,'uk'));return rows.length?'<h2 class="birthday-month">'+esc(new Intl.DateTimeFormat('uk-UA',{month:'long'}).format(new Date(2000,month-1,1)))+'</h2><div class="calendar-day-entries">'+rows.map(b=>birthdayRow(b,birthdayOccurrence(b,month<base.getMonth()+1?base.getFullYear()+1:base.getFullYear()))).join('')+'</div>':''}).join('');
      return {subtitle:signedIn?'Щороку · нагадування за 5, 3 дні та в сам день': 'Увійдіть для перегляду особистих дат',header:signedIn?'<button type="button" data-birthday-new>+ Додати</button>':'',html:(birthdayLoadError?'<p class="view-error">'+esc(birthdayLoadError)+' <button type="button" data-birthday-retry>Повторити</button></p>':'')+(list||viewMissing('Додайте першу людину. Дата з’явиться в календарі щороку.'))};
    }
    if(section==='mail'){
      const list=googleConnected?mailRows:signedIn?[]:mails;
      return {subtitle:googleConnected?'Gmail · показано '+list.length:signedIn?'Підключіть Google, щоб бачити пошту.':'Демонстраційні листи',
        html:(googleConnected?'<div class="filters mail-filters" aria-label="Папка пошти">'+[['inbox','Вхідні'],['all','Уся пошта'],['unread','Непрочитані'],['important','Важливі']].map(([id,label])=>'<button type="button" class="chip '+(mailFilter===id?'active':'')+'" data-mail-filter="'+id+'" aria-pressed="'+(mailFilter===id)+'">'+label+'</button>').join('')+'</div>':'')+
          (mailError?'<p class="view-error">'+esc(mailError)+'</p>':'')+
          '<div class="view-list">'+(list.length?list.map((m,i)=>mailRow(m,i)).join(''):viewMissing(mailLoading?'Завантажуємо листи…':googleConnected?mailError?'Не вдалося завантажити листи.':mailLoaded?'Листів у цьому розділі немає.':'Завантажуємо листи…':signedIn?'Пошта поки недоступна.':'Немає листів.'))+'</div>'+
          (googleConnected?(mailLoading?'<p class="view-subtitle">Завантажуємо…</p>':mailNext?'<button type="button" class="mail-more secondary-action" data-mail-more>Показати ще листи</button>':mailError?'<button type="button" class="mail-more secondary-action" data-mail-retry>Спробувати ще раз</button>':''):'')};
    }
    if(section==='notes'){
      return {subtitle:signedIn?'Особисті записи · Supabase':'Приклади на цьому пристрої',header:'<button type="button" data-action="new-note">+ Нова</button>'+(notes.length&&!sessionChecking&&!noteLoadError?'<button type="button" data-action="export-notes-md" aria-label="Зберегти всі нотатки у Markdown">↓ MD</button>':''),
        html:'<div class="notes-sources"><button type="button" class="active" data-open-section="notes" aria-pressed="true">Особисті записи</button><button type="button" data-open-section="obsidian">Obsidian</button></div>'+(noteLoadError?'<p class="view-error">'+esc(noteLoadError)+'</p>':'')+'<div class="view-list">'+(notes.length?notes.map(n=>'<button type="button" class="note-tile" data-note="'+esc(n.id)+'"><strong>'+esc(n.title)+'</strong><span>'+esc(n.body)+'</span><small>'+esc(n.date||'')+'</small></button>').join(''):viewMissing('Нотаток ще немає.'))+'</div>'};
    }
    if(section==='obsidian'){
      const sources='<div class="notes-sources"><button type="button" data-open-section="notes">Особисті записи</button><button type="button" class="active" data-open-section="obsidian" aria-pressed="true">Obsidian</button></div>';
      if(obsidianDeferred)return {subtitle:'Тимчасове збереження в Markdown',html:sources+'<div class="view-card empty-list"><p>Підключення Obsidian відкладено. Записуйте в «Особисті записи» та зберігайте нотатки у .md для подальшого перенесення.</p><button type="button" class="primary-action" data-open-section="notes">Відкрити особисті записи</button></div>'};
      if(!signedIn)return {subtitle:'Останні нотатки з GitHub',html:sources+'<div class="view-card empty-list"><p>Увійдіть, щоб переглядати свої нотатки Obsidian.</p><button type="button" class="primary-action" data-action="sign-in">Увійти</button></div>'};
      const matches=f=>activeFilter==='all'||f.kind===activeFilter;
      const recent=files.filter(f=>!favoritePaths.includes(f.path)&&matches(f));
      const checked=obsidianCheckedAt?'Перевірено '+new Date(obsidianCheckedAt).toLocaleString('uk-UA',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';
      const status=obsidianLoading?'Оновлюємо нотатки…':obsidianError?(checked?'Показано попередній список. '+checked:'Нотатки не завантажено.'):checked||'Очікуємо перевірки';
      return {subtitle:'Останні додані та змінені нотатки',header:'<button type="button" data-action="obsidian-refresh"'+(obsidianLoading?' disabled':'')+' aria-label="Оновити нотатки Obsidian">'+(obsidianLoading?'Оновлюємо…':'Оновити')+'</button>',
        html:sources+'<p class="view-subtitle" role="status">'+esc(status)+'</p>'+
          (obsidianError?'<p class="view-error" role="status">'+esc(obsidianError)+' <button type="button" data-action="obsidian-refresh"'+(obsidianLoading?' disabled':'')+'>Повторити</button></p>':'')+
          (favoriteError?'<p class="view-error">'+esc(favoriteError)+'</p>':'')+
          (obsidianPartial?'<p class="view-error">Частковий огляд: не всю історію GitHub вдалося перевірити.</p>':'')+
          (favoritePaths.length?'<h2 class="favorites-title">★ Фаворити</h2><div class="view-list">'+favoritePaths.filter(safeObsidianPath).map(fileByPath).map(fileRow).join('')+'</div>':'')+
          '<div class="filters" aria-label="Фільтр змін">'+[['all','Усі'],['added','Додані'],['edited','Змінені']].map(([id,label])=>'<button type="button" class="chip '+(activeFilter===id?'active':'')+'" data-filter="'+id+'" aria-pressed="'+(activeFilter===id)+'">'+label+'</button>').join('')+'</div>'+
          '<div class="view-list">'+(recent.length?recent.map(fileRow).join(''):viewMissing(obsidianLoading?'Завантажуємо нотатки…':obsidianError?'Спробуйте оновити список.':files.length?'Немає інших нотаток для цього фільтра.':'Нотаток поки немає. Надішліть Markdown-файл у підключений GitHub.'))+'</div><p class="view-subtitle">Показуємо зміни, надіслані в GitHub. Локальні збереження Obsidian з’являться після синхронізації.</p>'};
    }
    if(section==='reminders'){
      const proposals=signedIn&&googleConnected?mailReminderSuggestions():[];
      const proposalHtml=proposals.length?'<section class="reminder-proposals"><h2>Пропозиції з останніх листів</h2><p class="view-subtitle">Перевірте лист, а потім підтвердьте назву й дату справи.</p><div class="view-list">'+proposals.map(({mail,suggestion})=>'<button type="button" class="reminder-proposal" data-suggest-mail="'+esc(mail.id)+'"><span class="reminder-proposal-icon">'+suggestion.kind+'</span><span><strong>'+esc(suggestion.title)+'</strong><small>'+esc(mail.subject||'Лист Gmail')+'</small></span><svg aria-hidden="true"><use href="#i-arrow"/></svg></button>').join('')+'</div></section>':'';
      return {subtitle:signedIn?'Особисті справи · Supabase':'Демонстраційні справи',header:signedIn?'<button type="button" data-action="new-reminder">+ Нова</button>':'',
        html:(signedIn&&birthdayAlertsOn(dateFromSql(dailyToday())).length?'<h2>Дні народження</h2><div class="calendar-day-entries">'+birthdayAlertsOn(dateFromSql(dailyToday())).map(birthdayAlertRow).join('')+'</div>':'')+(reminderLoadError?'<p class="view-error">'+esc(reminderLoadError)+'</p>':'')+proposalHtml+'<div class="view-list">'+(reminders.length?reminders.map(r=>'<div class="manage-row"><button type="button" data-reminder="'+esc(r.id)+'">'+esc(r.title)+'<small>'+esc(reminderDate(r))+' · '+(isDone(r)?'Виконано':'Активне')+'</small></button><button class="done-button" type="button" data-done="'+esc(r.id)+'" aria-label="'+(isDone(r)?'Відновити: ':'Виконати: ')+esc(r.title)+'"><svg><use href="#i-check"/></svg></button></div>').join(''):viewMissing('Нагадувань ще немає.'))+'</div>'};
    }
    if(section==='priorities'){
      if(!signedIn)return {html:'<div class="view-card empty-list">Увійдіть у Supabase, щоб вести свої пріоритети.</div>'};
      const day=priorityDate||dailyToday(),rows=dailyRows(day),error=dailyErrors.get(day),slot=nextDailySlot(rows);
      const controls='<div class="daily-day-bar"><button type="button" data-daily-day="-1" aria-label="Попередній день">‹</button><strong>'+esc(dailyDateLabel(day))+'</strong><button type="button" data-daily-day="1" aria-label="Наступний день">›</button></div><label class="daily-date-picker">Інша дата <input type="date" id="priorityDateInput" value="'+day+'"></label>';
      const hint=day===dailyToday()?'Сьогодні':'Справи цього дня';
      const yesterday=day===dailyToday()?ymd(addDays(dateFromSql(day),-1)):'';
      const unfinished=yesterday?dailyRows(yesterday).filter(r=>!r.is_complete):[];
      const carry=slot&&unfinished.length?'<div class="daily-carry">Вчора не закрито: '+esc(unfinished[0].title)+'<button type="button" data-daily-carry="'+esc(unfinished[0].id)+'">Перенести на сьогодні</button></div>':'';
      return {subtitle:hint+' · '+esc(dailyZone),header:'<button type="button" data-daily-new="'+day+'">+ Справа</button>',html:controls+(error?'<p class="view-error">'+esc(dailyErrorText(new Error(error)))+' <button type="button" data-daily-retry="'+day+'">Повторити</button></p>':'')+(dailyLoading.has(day)&&!dailyDays.has(day)?'<div class="view-card empty-list">Завантажуємо справи…</div>':'<div class="view-card"><p class="daily-limit">До трьох справ на день</p>'+[1,2,3].map(n=>{const row=rows.find(r=>r.position===n);return row?dailyRow(row):'<button type="button" class="daily-empty-slot" data-daily-new="'+day+'">+ Додати справу '+n+'</button>'}).join('')+'</div>')+carry};
    }
    return {html:viewMissing()};
  }
  function noteMarkdown(note){return '# '+String(note.title||'Без назви').replace(/[\r\n]+/g,' ').trim()+'\n\n'+String(note.body||'')+'\n'}
  function downloadMarkdown(items){
    if(!items.length)return;
    const name=items.length===1?String(items[0].title||'Нотатка').replace(/[\\/:*?"<>|\u0000-\u001f]/g,'-').trim().slice(0,80)||'Нотатка':'Мої-нотатки';
    const content=items.map(noteMarkdown).join('\n---\n\n'),url=URL.createObjectURL(new Blob([content],{type:'text/markdown;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download=name+'.md';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
  }
  function detailView(section,id){
    if(section==='birthdays'){
      const b=birthdays.find(row=>row.id===id);if(!b)return null;
      const occurrence=nextBirthday(b,dateFromSql(dailyToday())),age=birthdayAge(b,occurrence.getFullYear());
      const reminder=reminders.find(r=>r.sourceType==='birthday'&&r.sourceKey===b.id+':'+occurrence.getFullYear());
      return {title:b.name,html:'<p class="meta">✦ ДЕНЬ НАРОДЖЕННЯ · ЩОРОКУ</p><h2>'+esc(b.name)+'</h2><p>'+esc(new Intl.DateTimeFormat('uk-UA',{day:'numeric',month:'long'}).format(occurrence))+(b.birth_year?' · '+b.birth_year:'')+'</p><p>'+esc(birthdayHint(b,occurrence))+'</p>'+(b.note?'<div class="preview">'+esc(b.note)+'</div>':'')+'<p class="view-subtitle">Нагадування за 5, 3 дні та в сам день · '+(b.enabled?'Увімкнено':'Вимкнено')+'</p>',actions:'<button type="button" class="primary-action" data-birthday-reminder="'+esc(b.id)+'">'+(reminder?'Відкрити нагадування':'Створити нагадування')+'</button><button type="button" class="secondary-action" data-birthday-edit="'+esc(b.id)+'">Змінити</button>'+(ymd(occurrence)===dailyToday()?'<button type="button" class="secondary-action" data-birthday-priority="'+esc(b.id)+'">У пріоритети на сьогодні</button>':'')+'<button type="button" class="birthday-delete" data-birthday-delete="'+esc(b.id)+'">Видалити</button>'};
    }
    if(section==='today'){
      const e=googleConnected?[...monthEvents,...realEvents].find(x=>String(x.id)===id):signedIn?null:events.find(x=>String(x.id)===id);
      return e?{title:e.title,html:'<p class="meta">'+(googleConnected?e.kind==='note'?'ЗАПИС · GOOGLE CALENDAR':'ПОДІЯ · GOOGLE CALENDAR':'КАЛЕНДАР · ДЕМО')+'</p><h2>'+esc(e.title)+'</h2><p>'+esc(googleConnected?(e.start.length===10?'Увесь день · '+dateFormat.format(dateFromSql(e.start)):new Date(e.start).toLocaleString('uk-UA',{timeZone:dailyZone})):dateFormat.format(addDays(today,e.day))+' · '+e.time)+'</p><div class="preview">'+esc(googleConnected?(e.description||e.location||'Подія з календаря'):e.detail)+'</div>',actions:googleConnected&&/^https:\/\/calendar\.google\.com\//.test(e.link||'')?'<a class="secondary-action" target="_blank" rel="noopener noreferrer" href="'+esc(e.link)+'">У Google Calendar ↗</a>':''}:null;
    }
    if(section==='mail'){
      const state=mailDetails.get(id);
      const m=(googleConnected?[...mailRows,...realMails]:signedIn?[]:mails).find((x,i)=>String(x.id||'demo-'+i)===id)||state?.letter;
      if(!m)return null;
      const letter=state?.letter;
      const account=letter?.account||googleEmail;
      const gmailLink=googleConnected&&m.threadId&&account?'https://mail.google.com/mail/u/'+encodeURIComponent(account)+'/#all/'+encodeURIComponent(m.threadId):'';
      const body=googleConnected?state?.status==='loaded'?(letter.available?'<div class="preview mail-body">'+esc(letter.body)+'</div>':'<p class="view-error">'+esc(letter.reason||'Текст листа недоступний.')+'</p>'):state?.status==='error'?'<p class="view-error">Не вдалося прочитати лист: '+esc(state.message)+'</p><button type="button" class="secondary-action" data-reload-mail="'+esc(id)+'">Спробувати ще раз</button>':'<p class="view-subtitle">Завантажуємо повний текст листа…</p>':'<div class="preview">'+esc(m.text)+'</div>';
      const files=letter?.attachments?.length?'<h3>Вкладення</h3><ul class="mail-attachments">'+letter.attachments.map(f=>'<li>'+esc(f.name)+'</li>').join('')+'</ul><p class="view-subtitle">Вкладення не входять у PDF цього листа. Відкрийте їх у Gmail окремо.</p>':'';
      const ready=state?.status==='loaded',unread=Boolean(letter?.unread??m.unread),important=Boolean(letter?.important??m.important),inbox=letter?.inbox??m.inbox;
      const existingReminder=reminders.find(r=>r.sourceType==='mail'&&r.sourceKey===id),suggestion=ready&&letter?.available?suggestMailReminder(letter):null;
      const reminderAction=ready&&letter?.available?'<div class="mail-reminder-prompt">'+(suggestion?'<span class="meta">'+suggestion.kind+' МОЖЛИВА СПРАВА З ЛИСТА</span><strong>'+esc(suggestion.title)+'</strong>':'<span class="meta">СПРАВА З ЛИСТА</span>')+'<button type="button" class="secondary-action" data-action="mail-reminder">'+(existingReminder?'Відкрити нагадування':'Створити нагадування')+'</button></div>':'';
      const readLabel=unread?'Позначити прочитаним':'Позначити непрочитаним',importantLabel=important?'Зняти важливість':'Позначити важливим';
      const icon=name=>'<svg aria-hidden="true"><use href="#i-'+name+'"/></svg>';
      const toolbar=googleConnected?'<div class="mail-toolbar" role="group" aria-label="Дії з листом">'+
        '<button type="button" class="mail-tool calendar-tool" data-action="mail-calendar" aria-label="Додати в календар" title="Додати в календар">'+icon('cal')+'</button>'+
        '<button type="button" class="mail-tool" data-mail-state="unread" data-mail-value="'+!unread+'" aria-label="'+readLabel+'" title="'+readLabel+'"'+(ready?'':' disabled')+'>'+icon(unread?'mail-open':'mail')+'</button>'+
        '<button type="button" class="mail-tool'+(important?' is-important':'')+'" data-mail-state="important" data-mail-value="'+!important+'" aria-label="'+importantLabel+'" title="'+importantLabel+'" aria-pressed="'+important+'"'+(ready?'':' disabled')+'>'+icon('star')+'</button>'+
        '<button type="button" class="mail-tool" data-mail-archive="'+esc(id)+'" aria-label="'+(inbox===false?'Вже в архіві':'Архівувати')+'" title="'+(inbox===false?'Вже в архіві':'Архівувати')+'"'+(ready&&inbox!==false?'':' disabled')+'>'+icon('archive')+'</button></div>':'';
      return {title:letter?.subject||m.subject,header:toolbar,html:'<p class="meta">'+(googleConnected?'GMAIL':'ПОШТА · ДЕМО')+'</p><h2>'+esc(letter?.subject||m.subject)+'</h2><p>Від: '+esc(letter?.from||m.from)+'</p>'+(letter?.to?'<p>Кому: '+esc(letter.to)+'</p>':'')+(letter?.date?'<p>Дата: '+esc(letter.date)+'</p>':'')+body+files+reminderAction,actions:(googleConnected&&letter?.available?'<button type="button" class="primary-action" data-action="download-mail-pdf">Зберегти PDF</button>':'')+(gmailLink?'<a class="secondary-action" target="_blank" rel="noopener noreferrer" href="'+esc(gmailLink)+'">У Gmail ↗</a>':'')};
    }
    if(section==='notes'){
      const n=notes.find(x=>String(x.id)===id);
      return n?{title:n.title,html:'<p class="meta">'+(signedIn?'НОТАТКА · SUPABASE':'НОТАТКА · ПРИКЛАД')+'</p><h2>'+esc(n.title)+'</h2><div class="preview">'+esc(n.body)+'</div>',actions:'<button type="button" class="primary-action" data-edit="'+esc(n.id)+'">Редагувати</button><button type="button" class="secondary-action" data-export-note="'+esc(n.id)+'">Зберегти .md</button><button type="button" class="secondary-action" data-delete="'+esc(n.id)+'">Видалити</button>'}:null;
    }
    if(section==='obsidian'){
      if(!safeObsidianPath(id))return null;
      const f=files.find(x=>x.path===id)||favoritePaths.includes(id)&&fileByPath(id);
      return f?{title:f.name,html:'<p class="meta">OBSIDIAN · GITHUB</p><h2>'+esc(f.name)+'</h2><p>'+esc(f.folder)+'</p><p>Читач Markdown відкривається в окремій вкладці.</p>',actions:'<a class="primary-action" target="_blank" rel="noopener noreferrer" href="/reader.html?path='+encodeURIComponent(id)+'">Читати ↗</a>'+(obsidianUrl(id)?'<a class="secondary-action" target="_blank" rel="noopener noreferrer" href="'+esc(obsidianUrl(id))+'">Відкрити у GitHub ↗</a>':'')}:null;
    }
    if(section==='reminders'){
      const r=reminders.find(x=>String(x.id)===id);
      return r?{title:r.title,html:'<p class="meta">НАГАДУВАННЯ · '+(signedIn?'SUPABASE':'ДЕМО')+'</p><h2>'+esc(r.title)+'</h2><p>Термін: '+esc(reminderDate(r))+'</p><div class="preview">Джерело: '+esc(r.source)+'</div>',actions:'<button type="button" class="primary-action" data-done="'+esc(r.id)+'">'+(isDone(r)?'Відновити':'Виконано')+'</button>'+(signedIn?'<button type="button" class="secondary-action" data-edit-reminder="'+esc(r.id)+'">Редагувати</button>':'')+(r.sourceType==='mail'&&r.sourceKey&&googleConnected?'<button type="button" class="secondary-action" data-open-reminder-mail="'+esc(r.sourceKey)+'">Відкрити лист</button>':'')}:null;
    }
    if(section==='priorities'){
      const task=[...dailyDays.values()].flat().find(r=>r.id===id);
      if(!task)return null;
      return {title:task.title,html:'<p class="meta">ПРІОРИТЕТ · '+esc(dailyDateLabel(task.day))+'</p><h2>'+esc(task.title)+'</h2>'+(task.details?'<div class="preview">'+esc(task.details)+'</div>':'')+'<p class="view-subtitle">'+(task.is_complete?'✓ Виконано':'У плані')+(task.is_focus?' · ◎ Головний фокус':'')+'</p>'+(task.source_type?'<p class="view-subtitle">Джерело: '+esc(task.source_label||task.source_type)+'</p>':'')+'<div class="daily-detail-more">'+(task.source_type?'<button type="button" class="secondary-action" data-daily-source="'+esc(task.id)+'">Відкрити джерело</button>':'')+'<button type="button" class="secondary-action" data-daily-move="'+esc(task.id)+'">Перенести на інший день</button><button type="button" class="daily-delete" data-daily-delete="'+esc(task.id)+'">Видалити справу</button></div>',actions:'<button type="button" class="primary-action" data-daily-done="'+esc(task.id)+'">'+(task.is_complete?'Відновити':'Виконати')+'</button><button type="button" class="secondary-action" data-daily-focus="'+esc(task.id)+'">'+(task.is_focus?'Зняти фокус':'Зробити фокусом')+'</button><button type="button" class="secondary-action" data-daily-edit="'+esc(task.id)+'">Змінити</button>'};
    }
    return null;
  }
  function renderView(){
    const route=viewRoute(),shell=$('viewShell'),content=$('viewContent');
    if(currentView&&!shell.hidden)viewScroll.set(currentView,content.scrollTop);
    if(!route){currentView='';renderHomeDay();if(signedIn&&dailyZoneReady&&!dailyDays.has(dailyToday())&&!dailyLoading.has(dailyToday())&&!dailyErrors.has(dailyToday()))loadDailyDay(dailyToday());if(googleConnected&&googleDay&&homeGoogleDay!==dailyToday()&&!$('refreshGoogle').disabled)refreshGoogleDay(homeDate());shell.hidden=true;shell.classList.remove('mail-open');$('home').inert=false;document.querySelector('.bottom-nav').inert=false;document.body.style.overflow=$('sheetBackdrop').hidden?'':'hidden';window.scrollTo(0,homeScroll);if(viewOrigin?.isConnected)viewOrigin.focus();return}
    const key=location.hash,changed=key!==currentView;currentView=key;
    shell.hidden=false;shell.classList.toggle('mail-open',route.section==='mail'&&Boolean(route.id));$('home').inert=true;document.querySelector('.bottom-nav').inert=true;document.body.style.overflow='hidden';
    const title=route.invalid?'Невідомий екран':viewNames[route.section],actions=$('viewActions');
    let state;
    if(sessionChecking)state={html:'<div class="view-card empty-list">'+esc(sessionRestoreError||'Перевіряємо особистий вхід…')+(sessionRestoreError?'<button type="button" class="primary-action" data-action="sign-in">Увійти знову</button>':'')+'</div>'};
    else if(route.invalid)state={html:viewMissing('Такого екрана немає.')};
    else if(route.id&&route.section==='today'&&route.day&&/^\d{4}-\d{2}-\d{2}$/.test(route.day)&&ymd(selected)!==route.day){
      const day=dateFromSql(route.day);if(day&&!Number.isNaN(day.getTime())&&ymd(day)===route.day){selected=day;renderDate();if(googleConnected)state={html:'<div class="view-card empty-list">Завантажуємо подію…</div>'};}
    }
    if(!state&&route.id){
      const item=detailView(route.section,route.id);
      const pending=signedIn&&(route.section==='mail'&&!googleChecked||route.section==='mail'&&googleConnected&&(!googleDay||!mailDetails.has(route.id)||mailDetails.get(route.id)?.status==='loading')||route.section==='today'&&!googleChecked||route.section==='today'&&googleConnected&&googleDay!==ymd(selected)||route.section==='obsidian'&&obsidianLoading||route.section==='priorities'&&(!dailyZoneReady||dailyLoading.has(route.day||priorityDate||dailyToday())));
      state=item?{html:'<article class="view-card">'+item.html+'</article>'+((signedIn&&['mail','today','notes','reminders','obsidian'].includes(route.section))?'<button type="button" class="daily-from-source" data-daily-from-source="'+esc(route.section)+'">+ У пріоритети на сьогодні</button>':''),actions:item.actions,header:item.header,title:item.title}:{html:pending?'<div class="view-card empty-list">Завантажуємо запис…</div>':viewMissing(signedIn?'Запис не знайдено або він більше недоступний.':'Запис недоступний. Увійдіть, щоб перевірити особисті дані.')};
    }
    if(!state)state=sectionView(route.section);
    $('viewTitle').textContent=state.title||title;
    $('viewHeaderAction').innerHTML=state.header||'';
    content.innerHTML=(state.subtitle?'<p class="view-subtitle">'+esc(state.subtitle)+'</p>':'')+state.html;
    actions.innerHTML=state.actions||'';actions.hidden=!state.actions;
    content.scrollTop=changed?(viewScroll.get(key)||0):content.scrollTop;
    if(route.section==='obsidian'&&!route.id&&signedIn&&!obsidianLoading&&!obsidianError&&!obsidianCheckedAt)refreshObsidian();
    if(route.section==='today'&&googleConnected&&!sessionChecking&&monthKey!==monthId(selected))loadCalendarMonth();
    if(route.section==='today'&&!route.id&&signedIn&&dailyZoneReady&&!dailyDays.has(ymd(selected))&&!dailyLoading.has(ymd(selected))&&!dailyErrors.has(ymd(selected)))loadDailyDay(ymd(selected));
    if(route.section==='mail'&&route.id&&googleConnected&&!mailDetails.has(route.id)&&!sessionChecking)fetchMail(route.id);
    if(route.section==='mail'&&!route.id&&googleConnected&&!mailLoaded&&!mailLoading&&!mailError)loadMailbox();
    if(route.section==='priorities'&&signedIn&&dailyZoneReady){const day=route.day||priorityDate||dailyToday();if(!dailyDays.has(day)&&!dailyLoading.has(day)&&!dailyErrors.has(day))loadDailyDay(day);if(!route.id&&day===dailyToday()){const yesterday=ymd(addDays(dateFromSql(day),-1));if(!dailyDays.has(yesterday)&&!dailyLoading.has(yesterday)&&!dailyErrors.has(yesterday))loadDailyDay(yesterday)}}
    if(changed)$('viewBack').focus();
  }
  window.addEventListener('popstate',renderView);
  window.addEventListener('hashchange',renderView);
  $('viewContent').addEventListener('scroll',()=>{if(currentView)viewScroll.set(currentView,$('viewContent').scrollTop)},{passive:true});
  let sheetStart='',sheetSerial=0;
  function formSnapshot(form){return form?JSON.stringify([...new FormData(form)]):''}
  function showSheet(html){++sheetSerial;$('sheetContent').innerHTML=html;sheetStart=formSnapshot($('sheetContent').querySelector('form'));$('sheetBackdrop').hidden=false;document.body.style.overflow='hidden';$('closeSheet').focus()}
  function closeSheet(force=false){
    const form=$('sheetContent').querySelector('form');
    if(!force&&form&&form.id!=='authForm'&&formSnapshot(form)!==sheetStart&&!confirm('Закрити й втратити незбережені зміни?'))return false;
    ++sheetSerial;$('sheetBackdrop').hidden=true;document.body.style.overflow=currentView?'hidden':'';$('sheetContent').innerHTML='';
    if(currentView)$('viewBack').focus();return true;
  }
  function editReminder(date='',fromCalendar=false,existing=null){
    const editing=Boolean(existing),due=editing?(existing.due===null?'':ymd(addDays(today,existing.due))):date;
    showSheet('<p class="meta">SUPABASE · '+(editing?'РЕДАГУВАННЯ':'НОВА СПРАВА')+'</p><h2 id="sheetTitle">'+(editing?'Редагувати нагадування':'Нагадування')+'</h2><form id="reminderForm"'+(fromCalendar?' data-from-calendar="true"':'')+'>'+
      (editing?'<input type="hidden" name="reminderId" value="'+esc(existing.id)+'">':'<input type="hidden" name="draftId" value="'+crypto.randomUUID()+'">')+
      '<label for="reminderTitle">Що потрібно зробити</label><input type="text" id="reminderTitle" name="title" maxlength="120" required value="'+(editing?esc(existing.title):'')+'">'+
      '<label for="reminderDue">Термін (необов’язково)</label><input type="date" id="reminderDue" name="due" value="'+esc(due)+'">'+
      '<label for="reminderTime">Час (необов’язково)</label><input type="time" id="reminderTime" name="time" value="'+(editing?esc(existing.dueTime||''):'')+'" '+(due?'':'disabled')+'>'+
      '<p class="meta">Час можна додати після вибору дати. З датою справа з’явиться за два дні до терміну; без дати — одразу.</p><p id="reminderError" class="form-error" hidden></p><div class="sheet-actions"><button type="submit" class="primary-action">'+(editing?'Зберегти зміни':'Зберегти')+'</button><button type="button" class="secondary-action" data-action="close">Скасувати</button></div></form>');
    $('reminderTitle').focus();
  }
  function mailReminderDraft(){
    const route=viewRoute(),id=route?.section==='mail'&&route.id,letter=mailDetails.get(id)?.letter;
    if(!signedIn||!googleConnected||!letter?.available)return;
    const existing=reminders.find(r=>r.sourceType==='mail'&&r.sourceKey===id);
    if(existing){openView('reminders',existing.id);return}
    const title=suggestMailReminder(letter)?.title||('Розібрати лист: '+(letter.subject||'без теми')).slice(0,120);
    showSheet('<p class="meta">GMAIL → НАГАДУВАННЯ</p><h2 id="sheetTitle">Справа з листа</h2><p class="mail-draft-source">'+esc(letter.subject||'Лист без теми')+'</p><p>Це пропозиція. Перевірте дію, дату й за потреби час у листі перед збереженням. Лист не змінюється.</p><form id="reminderForm"><input type="hidden" name="draftId" value="'+crypto.randomUUID()+'"><input type="hidden" name="sourceMailId" value="'+esc(id)+'"><label for="reminderTitle">Що потрібно зробити</label><input type="text" id="reminderTitle" name="title" maxlength="120" required value="'+esc(title)+'"><label for="reminderDue">Термін (необов’язково)</label><input type="date" id="reminderDue" name="due"><label for="reminderTime">Час (необов’язково)</label><input type="time" id="reminderTime" name="time" disabled><p class="meta">Дату й час із листа не визначено автоматично. Без дати справа з’явиться одразу; з датою — за два дні до терміну.</p><p id="reminderError" class="form-error" hidden></p><div class="sheet-actions"><button type="submit" class="primary-action">Додати нагадування</button><button type="button" class="secondary-action" data-action="close">Скасувати</button></div></form>');$('reminderTitle').focus();
  }
  function calendarNew(){showSheet('<p class="meta">'+esc(dateFormat.format(selected))+'</p><h2 id="sheetTitle">Новий запис</h2><p>Оберіть, що додати на цей день.</p><div class="calendar-kind-actions"><button type="button" data-calendar-kind="event">◷ Подія <small>Час або цілий день · Google Calendar</small></button><button type="button" data-calendar-kind="note">✎ Запис <small>Коротка замітка на дату · Google Calendar</small></button><button type="button" data-calendar-kind="daily">☑ Справа дня <small>До трьох справ · без обов’язкового фокусу</small></button><button type="button" data-calendar-kind="task">☑ Завдання <small>З терміном і позначкою виконання</small></button><button type="button" data-calendar-kind="birthday">✦ День народження <small>Особиста дата · повтор щороку</small></button></div>')}
  function calendarEditor(kind){
    if(kind==='daily'){dailyTaskEditor(ymd(selected));return}
    if(kind==='birthday'){birthdayEditor(null,ymd(selected));return}
    if(kind==='task'){if(!signedIn){signInSheet();return}editReminder(ymd(selected),true);return}
    if(!signedIn||!googleConnected){showSheet('<h2 id="sheetTitle">Підключіть календар</h2><p>Увійдіть і підключіть Google у розділі «Ще», щоб зберігати записи.</p>');return}
    if(!googleCanCreateCalendar){showSheet('<h2 id="sheetTitle">Дозвіл на запис у календар</h2><p>Поточне підключення дозволяє перегляд. Для створення подій і записів відкрийте «Ще» → «Оновити доступ Google».</p><button type="button" class="primary-action" data-action="google-connect">Оновити доступ Google</button><p id="googleMessage" class="form-error" hidden></p>');return}
    showSheet('<p class="meta">'+(kind==='note'?'ЗАПИС':'ПОДІЯ')+' · GOOGLE CALENDAR</p><h2 id="sheetTitle">'+(kind==='note'?'Новий запис':'Нова подія')+'</h2><form id="calendarEntryForm"><input type="hidden" name="kind" value="'+kind+'"><input type="hidden" name="draftId" value="'+crypto.randomUUID().replaceAll('-','')+'"><label for="calendarTitle">Назва</label><input id="calendarTitle" name="title" type="text" maxlength="120" required><label for="calendarDate">Дата</label><input id="calendarDate" name="date" type="date" value="'+ymd(selected)+'" required>'+(kind==='event'?'<label for="calendarTime">Час (необов’язково)</label><input id="calendarTime" name="time" type="time"><p class="meta">Без часу подія займе цілий день; із часом — одну годину.</p>':'<p class="meta">Запис відображатиметься на вибрану дату.</p>')+'<label for="calendarDescription">Деталі (необов’язково)</label><textarea id="calendarDescription" name="description" maxlength="2000"></textarea><p id="calendarEntryError" class="form-error" hidden></p><div class="sheet-actions"><button type="submit" class="primary-action">Зберегти в календарі</button><button type="button" class="secondary-action" data-action="close">Скасувати</button></div></form>');$('calendarTitle').focus();
  }
  function birthdayEditor(b=null,date=''){
    if(!signedIn){signInSheet();return}
    const value=b?ymd(new Date(b.birth_year||2000,b.birth_month-1,b.birth_day,12)):date;
    showSheet('<p class="meta">ОСОБИСТИЙ КАЛЕНДАР · ЩОРОКУ</p><h2 id="sheetTitle">'+(b?'Змінити день народження':'Додати день народження')+'</h2><form id="birthdayForm"><input type="hidden" name="birthdayId" value="'+esc(b?.id||'')+'"><input type="hidden" name="draftId" value="'+crypto.randomUUID()+'"><label for="birthdayName">Ім’я</label><input id="birthdayName" name="name" type="text" maxlength="120" required value="'+esc(b?.name||'')+'"><label for="birthdayDate">День і місяць</label><input id="birthdayDate" name="date" type="date" required value="'+esc(value||'')+'"><p class="meta">Рік у даті потрібен лише для вибору дня. Якщо рік народження відомий, укажіть його окремо.</p><label for="birthdayYear">Рік народження (необов’язково)</label><input id="birthdayYear" name="year" type="number" min="1800" max="2100" value="'+esc(b?.birth_year||'')+'"><label for="birthdayRelationship">Зв’язок (необов’язково)</label><input id="birthdayRelationship" name="relationship" type="text" maxlength="60" value="'+esc(b?.relationship||'')+'"><p class="view-subtitle">Нагадування щороку: за 5 днів, за 3 дні та в сам день. Вони з’являться у «Сьогодні», календарі й «Нагадування».</p><label for="birthdayNote">Нотатка (необов’язково)</label><textarea id="birthdayNote" name="note" maxlength="1000">'+esc(b?.note||'')+'</textarea><label class="birthday-switch"><input type="checkbox" name="enabled"'+(b?.enabled===false?'':' checked')+'> Показувати в календарі</label><p id="birthdayError" class="form-error" hidden></p><div class="sheet-actions"><button type="submit" class="primary-action">Зберегти</button><button type="button" class="secondary-action" data-action="close">Скасувати</button></div></form>');$('birthdayName').focus()
  }
  function editNote(id){const n=notes.find(x=>x.id===id);showSheet('<p class="meta">НОТАТКИ · '+(signedIn?'SUPABASE':'НА ЦЬОМУ ПРИСТРОЇ')+'</p><h2 id="sheetTitle">'+(n?'Редагувати нотатку':'Нова нотатка')+'</h2><form id="noteForm"><input type="hidden" name="noteId" value="'+esc(id||'')+'"><input type="hidden" name="draftId" value="'+crypto.randomUUID()+'"><label for="noteTitle">Назва</label><input id="noteTitle" name="title" type="text" maxlength="80" required value="'+esc(n?n.title:'')+'"><label for="noteBody">Текст</label><textarea id="noteBody" name="body" maxlength="2000" required>'+esc(n?n.body:'')+'</textarea><p id="noteError" class="form-error" hidden></p><div class="sheet-actions"><button type="submit" class="primary-action">Зберегти</button><button type="button" class="secondary-action" data-action="close">Скасувати</button></div></form>');$('noteTitle').focus()}
  function calendarFromMail(){const route=viewRoute();if(!signedIn||!googleConnected||route?.section!=='mail'||!route.id)return;const m=[...mailRows,...realMails].find(x=>x.id===route.id)||mailDetails.get(route.id)?.letter;if(!m)return;showSheet('<p class="meta">ЛИСТ → GOOGLE CALENDAR</p><h2 id="sheetTitle">Додати в календар</h2><p>Перевірте дату в листі. Подія з’явиться лише після збереження в Google Calendar.</p><form id="calendarDraftForm"><label for="eventTitle">Назва</label><input id="eventTitle" name="title" type="text" maxlength="120" required value="'+esc(m.subject)+'"><label for="eventDate">Дата події</label><input id="eventDate" name="date" type="date" required><label for="eventTime">Час (необов’язково)</label><input id="eventTime" name="time" type="time"><p class="meta">Без часу подія займе цілий день. Перед збереженням перевірте акаунт у Google.</p><p id="calendarDraftMessage" class="form-info" hidden></p><a id="calendarDraftFallback" class="secondary-action" target="_blank" rel="noopener noreferrer" hidden>Відкрити чернетку повторно ↗</a><div class="sheet-actions"><button type="submit" class="primary-action">Відкрити чернетку</button><button type="button" class="secondary-action" data-action="close">Скасувати</button></div></form>');$('eventTitle').focus()}
  function loadPdfTools(){
    if(!pdfLibrary)pdfLibrary=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/vendor/jspdf-4.2.1.umd.min.js';script.onload=()=>window.jspdf?.jsPDF?resolve(window.jspdf.jsPDF):reject(new Error('Бібліотека PDF не завантажилася.'));script.onerror=()=>reject(new Error('Бібліотека PDF недоступна.'));document.head.append(script)}).catch(error=>{pdfLibrary=null;throw error});
    if(!pdfFont)pdfFont=fetch('/vendor/DejaVuSans.ttf').then(response=>{if(!response.ok)throw new Error('Шрифт для PDF недоступний.');return response.arrayBuffer()}).then(buffer=>new Uint8Array(buffer)).catch(error=>{pdfFont=null;throw error});
    return Promise.all([pdfLibrary,pdfFont]);
  }
  async function downloadMailPdf(button){
    const route=viewRoute(),letter=mailDetails.get(route?.id)?.letter;
    if(!signedIn||!googleConnected||route?.section!=='mail'||!letter?.available)return;
    const epoch=authEpoch,key=currentView;
    button.disabled=true;button.textContent='Готуємо PDF…';
    try{
      const [JsPDF,font]=await loadPdfTools();
      if(epoch!==authEpoch||key!==currentView)return;
      const result=window.dashboardMailPdf.create(letter,JsPDF,font);
      if(epoch!==authEpoch||key!==currentView)return;
      if(mailPdfUrl)URL.revokeObjectURL(mailPdfUrl);
      mailPdfUrl=URL.createObjectURL(new Blob([result.bytes],{type:'application/pdf'}));
      showSheet('<p class="meta">ЛИСТ · PDF ГОТОВИЙ</p><h2 id="sheetTitle">Зберегти PDF</h2><p>Готово: '+result.pages+' '+(result.pages===1?'сторінка':'сторінок')+'. Файл містить повний підтримуваний текст листа.</p>'+(letter.attachments?.length?'<p class="view-error">Вкладення не входять у цей PDF. Для них відкрийте оригінал у Gmail.</p>':'')+'<div class="sheet-actions"><a class="primary-action pdf-download" href="'+mailPdfUrl+'" download="'+esc(result.name)+'">Завантажити PDF</a><button type="button" class="secondary-action" data-action="close">Закрити</button></div>');
    }catch(error){if(epoch===authEpoch)alert('Не вдалося створити PDF: '+error.message)}
    finally{button.disabled=false;button.textContent='Зберегти PDF'}
  }
  function googleCalendarDraft(title,date,time){
    const [year,month,day]=date.split('-').map(Number),local=new Date(year,month-1,day,12);
    if(!year||ymd(local)!==date)throw new Error('Перевірте дату події.');
    const compact=value=>value.replaceAll('-','');
    let start=compact(date),end=compact(ymd(addDays(local,1)));
    if(time){if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw new Error('Перевірте час події.');const [hour,minute]=time.split(':').map(Number),finish=new Date(year,month-1,day,hour,minute+60);start+='T'+time.replace(':','')+'00';end=compact(ymd(finish))+'T'+String(finish.getHours()).padStart(2,'0')+String(finish.getMinutes()).padStart(2,'0')+'00'}
    const zone=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
    const mail=[...mailRows,...realMails].find(m=>m.id===viewRoute()?.id);
    const source=mail?.threadId?'https://mail.google.com/mail/u/'+encodeURIComponent(googleEmail)+'/#all/'+encodeURIComponent(mail.threadId):'';
    const params=new URLSearchParams({action:'TEMPLATE',text:title,dates:start+'/'+end,ctz:zone,details:source?'Лист у Gmail: '+source:'Створено з листа Gmail.',authuser:googleEmail});
    return 'https://calendar.google.com/calendar/render?'+params;
  }
  function about(){
    const googleAccount=googleConnected
      ? '<div class="connected-account"><span class="account-dot" aria-hidden="true"></span><div class="account-info"><strong>'+esc(googleEmail||'Google-акаунт')+'</strong><small>Gmail і календар підключені</small></div><button type="button" class="secondary-action" data-action="google-disconnect">Від’єднати</button></div>'+(!googleCanArchive||!googleCanCreateCalendar?'<p>'+(googleCanArchive?'':'Для архівування й позначення листів потрібен дозвіл Gmail. ')+(googleCanCreateCalendar?'':'Для створення подій і записів потрібен дозвіл Google Calendar.')+'</p><button type="button" class="primary-action" data-action="google-connect">Оновити доступ Google</button>':'')
      : '<p>'+(!signedIn?'Увійдіть у Supabase, щоб підключити пошту.':googleStatusError?'Не вдалося перевірити Google. Оновіть сторінку.':!googleChecked?'Перевіряємо підключення…':googleConfigured?'Підключених пошт поки немає.':'Google ще не налаштовано.')+'</p>'+(signedIn&&googleChecked&&googleConfigured&&!googleStatusError?'<button type="button" class="primary-action" data-action="google-connect">Підключити Google</button>':'');
    showSheet('<p class="meta">ОСОБИСТІ НАЛАШТУВАННЯ</p><h2 id="sheetTitle">Ще</h2>'+
      '<section class="account-group"><h3>Поштові акаунти</h3>'+googleAccount+'<p id="googleMessage" class="form-error" hidden></p></section>'+
      '<section class="account-group"><h3>Особисті записи</h3><p>'+(sessionRestoreError?esc(sessionRestoreError):signedIn?'Supabase підключено · нотатки й нагадування зберігаються між пристроями.':sessionChecking?'Перевіряємо особистий вхід…':'Демо-режим · особисті записи доступні після входу.')+'</p><button type="button" class="secondary-action" data-action="'+(signedIn?'sign-out':'sign-in')+'"'+(sessionChecking?' disabled':'')+'>'+(signedIn?'Вийти із Supabase':'Увійти в Supabase')+'</button></section>'+
      '<section class="account-group"><h3>Obsidian</h3><p>'+(obsidianDeferred?'Тимчасово: особисті записи та експорт .md.':!signedIn?'Доступний після особистого входу.':obsidianLoading?'Перевіряємо нотатки…':obsidianError?esc(obsidianError):obsidianCheckedAt?'Підключено · перевірено '+esc(new Date(obsidianCheckedAt).toLocaleTimeString('uk-UA',{hour:'2-digit',minute:'2-digit'})):'Очікує перевірки.')+'</p><button type="button" class="secondary-action" data-action="open-obsidian">Останні нотатки</button></section>'+
      '<section class="account-group"><h3>Сховище</h3><button type="button" class="secondary-action" data-action="connection-settings">Налаштування підключення</button></section>'+
      '<section class="account-group"><h3>Календар</h3><button type="button" class="secondary-action" data-action="manage-birthdays">Дні народження</button></section>'+
      '<section class="account-group"><h3>Нагадування</h3><button type="button" class="secondary-action" data-action="manage-reminders">Керувати нагадуваннями</button></section>');
  }
  function connectionSheet(){
    const config=window.DASHBOARD_SUPABASE||{};
    showSheet('<p class="meta">ПІДКЛЮЧЕННЯ</p><h2 id="sheetTitle">Особисте сховище</h2><p>Параметри вашого тестового проєкту Supabase. Зберігаються лише в цьому браузері.</p><form id="connectionForm"><label for="connectionUrl">Project URL</label><input id="connectionUrl" name="url" type="url" autocomplete="off" required placeholder="https://project.supabase.co" value="'+esc(config.url||'')+'"><label for="connectionKey">Publishable або anon key</label><input id="connectionKey" name="publishableKey" autocomplete="off" spellcheck="false" required value="'+esc(config.publishableKey||'')+'"><p class="view-subtitle">Це публічний ключ застосунку. Secret key, service_role, паролі й токени GitHub сюди не вставляйте.</p><p id="connectionError" class="form-error" hidden></p><div class="sheet-actions"><button type="submit" class="primary-action">Зберегти підключення</button></div></form>');
  }
  function signInSheet(){
    if(!backend){connectionSheet();return}
    showSheet('<p class="meta">ОСОБИСТИЙ ВХІД</p><h2 id="sheetTitle">Увійти</h2><p>Вхід до ваших нотаток і справ. Gmail і календар підключаються після входу в розділі «Ще».</p><form id="authForm"><label for="authEmail">Електронна пошта</label><input id="authEmail" type="email" name="email" autocomplete="email" inputmode="email" required><label for="authPassword">Пароль</label><input id="authPassword" type="password" name="password" minlength="6" autocomplete="current-password" required><p id="authMessage" role="status" hidden></p><div class="sheet-actions"><button type="submit" class="primary-action">Увійти</button><button type="button" class="secondary-action" data-action="sign-up">Створити акаунт</button></div></form><p class="view-subtitle">Після реєстрації підтвердьте адресу пошти, потім поверніться для входу.</p><button type="button" class="link-btn" data-action="connection-settings">Налаштування підключення</button>');$('authEmail').focus();
  }
  function dailyTaskById(id){return [...dailyDays.values()].flat().find(r=>r.id===id)}
  function dailyTaskEditor(day=dailyToday(),task=null,source=null,first=false){
    if(!signedIn){signInSheet();return}
    if(!dailyZoneReady){alert('Зачекайте, поки завантажаться особисті справи.');return}
    const rows=dailyRows(day),slot=nextDailySlot(rows),full=!task&&!slot;
    showSheet('<p class="meta">МОЇ ПРІОРИТЕТИ · '+esc(dailyDateLabel(day))+'</p><h2 id="sheetTitle">'+(task?'Змінити справу':first?'Головний фокус':'Нова справа')+'</h2><form id="dailyTaskForm"><input type="hidden" name="taskId" value="'+esc(task?.id||'')+'"><input type="hidden" name="draftId" value="'+crypto.randomUUID()+'"><input type="hidden" name="firstFocus" value="'+(first?'true':'false')+'"><input type="hidden" name="sourceType" value="'+esc(source?.type||task?.source_type||'')+'"><input type="hidden" name="sourceKey" value="'+esc(source?.key||task?.source_key||'')+'"><input type="hidden" name="sourceLabel" value="'+esc(source?.label||task?.source_label||'')+'"><label for="dailyTitle">Назва справи</label><input id="dailyTitle" name="title" type="text" maxlength="160" required value="'+esc(task?.title||source?.title||'')+'"><label for="dailyDetails">Деталі (необов’язково)</label><textarea id="dailyDetails" name="details" maxlength="2000">'+esc(task?.details||'')+'</textarea>'+(first?'':'<label for="dailyDate">Дата</label><input id="dailyDate" name="day" type="date" required value="'+day+'">')+(full?'<p class="view-error">На цей день уже три справи. Змініть дату або виберіть, яку справу замінити.</p><label for="dailyReplace">Замінити справу (необов’язково)</label><select id="dailyReplace" name="replace"><option value="">Оберіть інший день</option>'+rows.map(r=>'<option value="'+esc(r.id)+'">'+esc(r.title)+'</option>').join('')+'</select>':'')+'<p id="dailyTaskError" class="form-error" hidden></p><div class="sheet-actions"><button type="submit" class="primary-action">'+(first?'Зберегти як фокус':'Зберегти справу')+'</button><button type="button" class="secondary-action" data-action="close">Скасувати</button></div></form>');$('dailyTitle').focus();
  }
  function dailyMoveEditor(task){showSheet('<p class="meta">ПЕРЕНЕСЕННЯ · '+esc(task.title)+'</p><h2 id="sheetTitle">Інший день</h2><p>Справа перейде на нову дату лише після збереження. У цільовому дні має бути вільний слот.</p><form id="dailyMoveForm"><input type="hidden" name="taskId" value="'+esc(task.id)+'"><label for="dailyMoveDate">Нова дата</label><input id="dailyMoveDate" name="day" type="date" required value="'+dailyToday()+'"><p id="dailyMoveError" class="form-error" hidden></p><div class="sheet-actions"><button type="submit" class="primary-action">Перенести</button><button type="button" class="secondary-action" data-action="close">Скасувати</button></div></form>')}
  async function setDailyFocus(task){const old=dailyRows(task.day).find(r=>r.is_focus);if(old?.id===task.id)await updateDailyTask(task.id,{is_focus:false});else{if(old)await updateDailyTask(old.id,{is_focus:false});await updateDailyTask(task.id,{is_focus:true})}}
  function inlineMessage(id,message,success=false){const p=$(id);if(!p)return;p.textContent=message;p.className=success?'form-info':'form-error';p.hidden=false}
  async function signOut(){++authEpoch;++googleRequest;++monthRequest;++obsidianRequest;signedIn=false;sessionChecking=false;sessionRestoreError='';noteLoadError='';reminderLoadError='';birthdays=[];birthdayLoadError='';dailyZoneReady=false;dailyDays.clear();dailyLoading.clear();dailyErrors.clear();priorityDate='';googleConnected=false;googleCanArchive=false;googleCanCreateCalendar=false;googleChecked=false;googleConfigured=false;googleStatusError='';googleEmail='';googleDay='';homeGoogleDay='';homeEvents=[];homeCalendarError='';realEvents=[];realMails=[];monthEvents=[];monthKey='';monthRequestKey='';monthError='';monthLoading=false;monthTruncated=false;mailDetails.clear();resetMailbox();if(mailPdfUrl){URL.revokeObjectURL(mailPdfUrl);mailPdfUrl=''}googleErrors();files=[];favoritePaths=[];obsidianCheckedAt='';obsidianError='';favoriteError='';obsidianLoading=false;obsidianPartial=false;lastObsidianFetch=0;notes=read('notes',[]);reminders=demoReminders;updateMode();renderFocus();renderPriorities();renderDate(false);renderMail();renderNotes();renderReminders();renderFiles();closeSheet(true);history.replaceState(null,'',location.pathname);renderView();await backend.signOut()}
  async function archiveMail(id,button){
    if(!signedIn||!googleConnected||!id||button.disabled)return;
    if(!googleCanArchive){about();inlineMessage('googleMessage','Натисніть «Оновити доступ Google», щоб дозволити архівування.');return}
    const epoch=authEpoch;button.disabled=true;
    try{
      await backend.googleArchive(id);
      if(epoch!==authEpoch)return;
      realMails=realMails.filter(m=>m.id!==id);
      if(mailFilter==='inbox'||mailFilter==='unread')mailRows=mailRows.filter(m=>m.id!==id);
      else for(const m of mailRows)if(m.id===id)m.inbox=false;
      renderMail();
      if(viewRoute()?.section==='mail'&&viewRoute()?.id===id){history.replaceState({dashboardView:true,parent:'home'},'',routeKey('mail'));renderView()}
      else if(currentView===routeKey('mail'))renderView();
    }catch(error){if(epoch===authEpoch){button.disabled=false;alert('Не вдалося підтвердити архівування в Gmail: '+error.message);refreshGoogleDay();if(currentView===routeKey('mail'))loadMailbox(true)}}
  }
  function applyMailLabels(id,labels){
    for(const m of [...realMails,...mailRows])if(m.id===id)Object.assign(m,{unread:labels.unread,important:labels.important,inbox:labels.inbox});
    const detail=mailDetails.get(id);if(detail?.status==='loaded')Object.assign(detail.letter,{unread:labels.unread,important:labels.important,inbox:labels.inbox});
    if(mailFilter==='unread'&&!labels.unread||mailFilter==='important'&&!labels.important)mailRows=mailRows.filter(m=>m.id!==id);
    renderMail();if(currentView)renderView();
  }
  async function setMailLabel(kind,enabled,button){
    const route=viewRoute(),id=route?.section==='mail'&&route.id;
    if(!signedIn||!googleConnected||!id||button.disabled||!['unread','important'].includes(kind))return;
    if(!googleCanArchive){about();inlineMessage('googleMessage','Натисніть «Оновити доступ Google», щоб змінювати позначки листів.');return}
    const epoch=authEpoch;button.disabled=true;
    try{const labels=await backend.googleSetLabel(id,kind,enabled);if(epoch===authEpoch)applyMailLabels(id,labels)}
    catch(error){if(epoch!==authEpoch)return;try{const current=await backend.googleMessage(id);if(epoch!==authEpoch)return;applyMailLabels(id,current);if(Boolean(current[kind])!==enabled)alert('Зміну в Gmail не підтверджено: '+error.message)}catch{if(epoch===authEpoch)alert('Не вдалося перевірити стан листа в Gmail: '+error.message)} }
    finally{if(button.isConnected)button.disabled=false}
  }
  function setActive(name){document.querySelectorAll('.bottom-nav button').forEach(b=>b.classList.toggle('active',b.dataset.go===name))}
  function go(name,button=null){if(name==='more'){about();return}if(name==='home'){if(currentView){history.replaceState(null,'',location.pathname);renderView()}else window.scrollTo({top:0,behavior:'smooth'});setActive(name);return}const section=name==='notes'&&read('notes-source','notes')==='obsidian'?'obsidian':name;if(Object.hasOwn(viewNames,section)){if(section==='priorities')priorityDate=dailyToday();openView(section,'','',button);setActive(name)}}
  let swipe=null;
  document.addEventListener('touchstart',e=>{const row=e.target.closest('.mail-swipe');if(!row||!googleConnected||e.touches.length!==1)return;const point=e.touches[0];swipe={row,x:point.clientX,y:point.clientY,horizontal:false}},{passive:true});
  document.addEventListener('touchmove',e=>{if(!swipe||e.touches.length!==1)return;const point=e.touches[0],dx=point.clientX-swipe.x,dy=point.clientY-swipe.y;if(Math.abs(dx)>12&&Math.abs(dx)>Math.abs(dy)*1.4)swipe.horizontal=true;if(swipe.horizontal)e.preventDefault()},{passive:false});
  document.addEventListener('touchend',e=>{if(!swipe)return;const {row,x,horizontal}=swipe;swipe=null;if(!horizontal||!row.isConnected)return;const dx=e.changedTouches[0].clientX-x;if(Math.abs(dx)<55)return;document.querySelectorAll('.mail-swipe.revealed').forEach(el=>{if(el!==row){el.classList.remove('revealed');el.querySelector('.mail-archive').hidden=true}});row.classList.toggle('revealed',dx<0);row.querySelector('.mail-archive').hidden=dx>=0;e.preventDefault()},{passive:false});
  document.addEventListener('touchcancel',()=>{swipe=null},{passive:true});
  document.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;
    if(b.dataset.calendarMonth){selected=new Date(selected.getFullYear(),selected.getMonth()+Number(b.dataset.calendarMonth),Math.min(selected.getDate(),new Date(selected.getFullYear(),selected.getMonth()+Number(b.dataset.calendarMonth)+1,0).getDate()),12);renderDate();renderView();return}
    if(b.dataset.calendarDay){selected=dateFromSql(b.dataset.calendarDay);renderDate();renderView();return}
    if(b.hasAttribute('data-calendar-refresh')){loadCalendarMonth(true);return}
    if(b.dataset.calendarKind){calendarEditor(b.dataset.calendarKind);return}
    if(b.hasAttribute('data-home-retry')){const epoch=authEpoch;b.disabled=true;await Promise.allSettled([loadDailyDay(dailyToday(),true),loadBirthdays(),(async()=>{try{const rows=await backend.listReminders();if(epoch===authEpoch){reminders=rows.map(mapReminder);reminderLoadError=''}}catch(error){if(epoch===authEpoch)reminderLoadError='Не вдалося завантажити нагадування.'}})()]);if(epoch===authEpoch)renderHomeDay();if(b.isConnected)b.disabled=false;return}
    if(b.hasAttribute('data-birthday-retry')){loadBirthdays();return}
    if(b.hasAttribute('data-birthday-new')){birthdayEditor();return}
    if(b.dataset.birthday){if(b.closest('#home'))selected=homeDate();openView('birthdays',b.dataset.birthday,'',b);return}
    if(b.dataset.birthdayEdit){const row=birthdays.find(x=>x.id===b.dataset.birthdayEdit);if(row)birthdayEditor(row);return}
    if(b.dataset.birthdayDelete){const row=birthdays.find(x=>x.id===b.dataset.birthdayDelete);if(!row||!confirm('Видалити день народження «'+row.name+'»?'))return;const epoch=authEpoch;b.disabled=true;try{await backend.deleteBirthday(row.id);if(epoch!==authEpoch)return;birthdays=birthdays.filter(x=>x.id!==row.id);renderBirthdays();renderDate(false);history.replaceState({dashboardView:true,parent:'home'},'',routeKey('birthdays'));renderView()}catch(error){if(epoch===authEpoch)alert('Не вдалося видалити: '+error.message)}finally{if(b.isConnected)b.disabled=false}return}
    if(b.dataset.birthdayReminder){const row=birthdays.find(x=>x.id===b.dataset.birthdayReminder);if(!row)return;const day=nextBirthday(row,dateFromSql(dailyToday())),key=row.id+':'+day.getFullYear(),existing=reminders.find(x=>x.sourceType==='birthday'&&x.sourceKey===key);if(existing){openView('reminders',existing.id,'',b);return}const epoch=authEpoch;b.disabled=true;try{const rows=await backend.addBirthdayReminder('Привітати '+row.name,ymd(day),dailyZone,crypto.randomUUID(),row.id,row.name);if(epoch!==authEpoch)return;const item=mapReminder(rows[0]);if(!reminders.some(x=>x.id===item.id))reminders.unshift(item);renderReminders();openView('reminders',item.id,'',b)}catch(error){if(epoch===authEpoch)alert('Не вдалося створити нагадування: '+error.message)}finally{if(b.isConnected)b.disabled=false}return}
    if(b.dataset.birthdayPriority){const row=birthdays.find(x=>x.id===b.dataset.birthdayPriority);if(!row||!birthdaysOn(dateFromSql(dailyToday())).includes(row))return;const day=dailyToday();b.disabled=true;try{await loadDailyDay(day,true);if(dailyErrors.has(day))throw Error(dailyErrors.get(day));const existing=dailyRows(day).find(x=>x.source_type==='birthday'&&x.source_key===row.id);if(existing){priorityDate=day;openView('priorities',existing.id,day,b)}else dailyTaskEditor(day,null,{type:'birthday',key:row.id,title:'Привітати '+row.name,label:row.name})}catch(error){alert('Не вдалося відкрити пріоритети: '+error.message)}finally{if(b.isConnected)b.disabled=false}return}
    if(b.dataset.action==='calendar-new'){if(b.closest('#home')){selected=homeDate();renderDate(false)}calendarNew();return}
    if(b.dataset.mailState){setMailLabel(b.dataset.mailState,b.dataset.mailValue==='true',b);return}
    if(b.dataset.mailArchive){archiveMail(b.dataset.mailArchive,b);return}
    if(b.id==='refreshGoogle'){refreshGoogleDay();if(currentView===routeKey('mail'))loadMailbox(true);return}
    if(b.id==='refreshObsidian'||b.dataset.action==='obsidian-refresh'){refreshObsidian();return}
    if(b.id==='viewBack'){backView();return}
    if(b.dataset.dailyRetry){dailyErrors.delete(b.dataset.dailyRetry);loadDailyDay(b.dataset.dailyRetry,true);return}
    if(b.dataset.dailyDay){priorityDate=ymd(addDays(dateFromSql(priorityDate||dailyToday()),Number(b.dataset.dailyDay)));loadDailyDay(priorityDate);renderView();return}
    if(b.dataset.dailyNew){dailyTaskEditor(b.dataset.dailyNew);return}
    if(b.dataset.dailyOpen){const task=dailyTaskById(b.dataset.dailyOpen);if(task){priorityDate=task.day;openView('priorities',task.id,task.day,b)}return}
    if(b.dataset.dailyEdit){const task=dailyTaskById(b.dataset.dailyEdit);if(task)dailyTaskEditor(task.day,task);return}
    if(b.dataset.dailyMove){const task=dailyTaskById(b.dataset.dailyMove);if(task)dailyMoveEditor(task);return}
    if(b.dataset.dailyDone||b.dataset.dailyFocus){const task=dailyTaskById(b.dataset.dailyDone||b.dataset.dailyFocus);if(!task||b.disabled)return;const epoch=authEpoch;b.disabled=true;try{if(b.dataset.dailyDone)await updateDailyTask(task.id,{is_complete:!task.is_complete,completed_at:task.is_complete?null:new Date().toISOString()});else await setDailyFocus(task);if(epoch===authEpoch)await syncDailyDay(task.day)}catch(error){if(epoch===authEpoch){await loadDailyDay(task.day,true);alert('Не вдалося зберегти: '+dailyErrorText(error))}}finally{if(b.isConnected)b.disabled=false}return}
    if(b.dataset.dailyDelete){const task=dailyTaskById(b.dataset.dailyDelete);if(!task||!confirm('Видалити справу «'+task.title+'»?'))return;const epoch=authEpoch;b.disabled=true;try{await backend.deleteDailyTask(task.id);if(epoch!==authEpoch)return;await syncDailyDay(task.day);history.replaceState({dashboardView:true,parent:'home'},'',routeKey('priorities'));renderView()}catch(error){if(epoch===authEpoch)alert('Не вдалося видалити справу: '+dailyErrorText(error))}finally{if(b.isConnected)b.disabled=false}return}
    if(b.dataset.dailyCarry){const task=dailyTaskById(b.dataset.dailyCarry);if(task)dailyMoveEditor(task);return}
    if(b.dataset.dailySource){const task=dailyTaskById(b.dataset.dailySource);if(!task)return;const type={mail:'mail',event:'today',note:'notes',reminder:'reminders',obsidian:'obsidian',birthday:'birthdays'}[task.source_type],eventKey=type==='today'?task.source_key.split('|'):[],eventDay=eventKey.length===2?eventKey[0]:'',sourceId=type==='today'&&eventDay?eventKey[1]:task.source_key,exists=type==='mail'?googleConnected:type==='today'?googleConnected:type==='notes'?notes.some(n=>n.id===sourceId):type==='reminders'?reminders.some(r=>r.id===sourceId):type==='obsidian'?safeObsidianPath(sourceId):type==='birthdays'?birthdays.some(x=>x.id===sourceId):false;if(exists){if(type==='obsidian')window.open('/reader.html?path='+encodeURIComponent(sourceId),'_blank','noopener,noreferrer');else openView(type,sourceId,eventDay,b)}else alert('Джерело недоступне. Справу збережено.');return}
    if(b.dataset.dailyFromSource){const route=viewRoute(),type={mail:'mail',today:'event',notes:'note',reminders:'reminder',obsidian:'obsidian'}[route?.section],id=route?.id;if(!type||!id)return;const row=type==='mail'?mailDetails.get(id)?.letter:type==='event'?[...monthEvents,...realEvents].find(x=>String(x.id)===id):type==='note'?notes.find(x=>x.id===id):type==='reminder'?reminders.find(x=>x.id===id):files.find(x=>x.path===id)||favoritePaths.includes(id)&&fileByPath(id);if(!row){alert('Джерело недоступне.');return}const day=dailyToday(),key=type==='event'?(route.day||ymd(selected))+'|'+id:id;b.disabled=true;try{await loadDailyDay(day,true);if(dailyErrors.has(day))throw new Error(dailyErrors.get(day));const existing=dailyRows(day).find(r=>r.source_type===type&&r.source_key===key);if(existing){priorityDate=day;openView('priorities',existing.id,day,b)}else dailyTaskEditor(day,null,{type,key,title:row.title||row.subject||row.name||'Нова справа',label:row.title||row.subject||row.name||'Джерело'})}catch(error){alert('Не вдалося відкрити денні справи: '+dailyErrorText(error))}finally{if(b.isConnected)b.disabled=false}return}
    if(b.classList.contains('home-all-day')){selected=homeDate();renderDate();openView('today','','',b);requestAnimationFrame(()=>{const content=$('viewContent'),day=content.querySelector('.calendar-day-title');if(day)content.scrollTop=day.offsetTop-content.offsetTop-8});return}
    if(b.dataset.openSection){if(b.dataset.openSection==='priorities')priorityDate=dailyToday();openView(b.dataset.openSection,'','',b);return}
    if(b.dataset.go){go(b.dataset.go,b);return}
    if(b.dataset.date){const [y,m,d]=b.dataset.date.split('-').map(Number);selected=new Date(y,m-1,d,12);renderDate();if(currentView)renderView();return}
    if(b.dataset.filter){activeFilter=b.dataset.filter;document.querySelectorAll('.chip').forEach(c=>{const on=c===b;c.classList.toggle('active',on);c.setAttribute('aria-pressed',on)});renderFiles();if(currentView)renderView();return}
    if(b.dataset.mailFilter){if(mailFilter!==b.dataset.mailFilter){mailFilter=b.dataset.mailFilter;resetMailbox();renderView()}return}
    if(b.hasAttribute('data-mail-more')){loadMailbox();return}
    if(b.hasAttribute('data-mail-retry')){loadMailbox(true);return}
    if(b.dataset.favoritePath){const path=b.dataset.favoritePath;if(!signedIn||!safeObsidianPath(path))return;const epoch=authEpoch;b.disabled=true;const pinned=favoritePaths.includes(path);try{if(pinned){await backend.removeObsidianFavorite(path);if(epoch!==authEpoch)return;favoritePaths=favoritePaths.filter(p=>p!==path)}else{await backend.addObsidianFavorite(path);if(epoch!==authEpoch)return;favoritePaths.unshift(path)}renderFiles();if(currentView)renderView()}catch(error){if(epoch!==authEpoch)return;b.disabled=false;alert('Не вдалося зберегти фаворита: '+error.message)}return}
    if(b.dataset.event){openView('today',b.dataset.event,b.dataset.eventDay||ymd(selected),b);return}
    if(b.dataset.filePath){openView('obsidian',b.dataset.filePath,'',b);return}
    if(b.dataset.reloadMail){mailDetails.delete(b.dataset.reloadMail);fetchMail(b.dataset.reloadMail);renderView();return}
    if(b.dataset.mailId){if(b.closest('.mail-swipe.revealed')){b.closest('.mail-swipe').classList.remove('revealed');b.closest('.mail-swipe').querySelector('.mail-archive').hidden=true;return}openView('mail',b.dataset.mailId,'',b);return}
    if(b.dataset.mail){if(b.closest('.mail-swipe.revealed')){b.closest('.mail-swipe').classList.remove('revealed');b.closest('.mail-swipe').querySelector('.mail-archive').hidden=true;return}const m=(googleConnected?realMails:mails)[Number(b.dataset.mail)];if(m)openView('mail',m.id||'demo-'+b.dataset.mail,'',b);return}
    if(b.dataset.suggestMail){openView('mail',b.dataset.suggestMail,'',b);return}
    if(b.dataset.openReminderMail){if(googleConnected)openView('mail',b.dataset.openReminderMail,'',b);return}
    if(b.dataset.editReminder){const reminder=reminders.find(r=>r.id===b.dataset.editReminder);if(signedIn&&reminder)editReminder('',false,reminder);return}
    if(b.dataset.note){openView('notes',b.dataset.note,'',b);return}
    if(b.dataset.reminder){openView('reminders',b.dataset.reminder,'',b);return}
    if(b.dataset.done){const r=reminders.find(x=>x.id===b.dataset.done);if(!r)return;if(signedIn){const epoch=authEpoch;b.disabled=true;try{const rows=await backend.setReminderComplete(r.id,!isDone(r));if(epoch!==authEpoch)return;if(!rows.length)throw new Error('Нагадування не знайдено.');Object.assign(r,mapReminder(rows[0]));renderReminders();if(currentView)renderView()}catch(error){if(epoch!==authEpoch)return;b.disabled=false;alert('Не вдалося зберегти нагадування: '+error.message)}}else{completed[r.id]=!completed[r.id];save('completed',completed);renderReminders();if(currentView)renderView()}return}
    if(b.dataset.edit){editNote(b.dataset.edit);return}
    if(b.dataset.delete){if(!confirm('Видалити цю нотатку?'))return;const epoch=authEpoch;b.disabled=true;try{if(signedIn)await backend.deleteNote(b.dataset.delete);if(epoch!==authEpoch)return;notes=notes.filter(n=>n.id!==b.dataset.delete);if(!signedIn)save('notes',notes);renderNotes();closeSheet(true);if(currentView){history.replaceState({dashboardView:true,parent:'home'},'',routeKey('notes'));renderView()}}catch(error){if(epoch!==authEpoch)return;b.disabled=false;alert('Не вдалося видалити нотатку: '+error.message)}return}
    if(b.dataset.action==='manage-reminders'){if(!$('sheetBackdrop').hidden)closeSheet();openView('reminders','','',b);return}
    if(b.dataset.action==='manage-birthdays'){if(!$('sheetBackdrop').hidden)closeSheet();openView('birthdays','','',b);return}
    if(b.dataset.exportNote){const note=notes.find(n=>String(n.id)===b.dataset.exportNote);if(note)downloadMarkdown([note]);return}
    if(b.dataset.action==='export-notes-md'){if(!sessionChecking&&!noteLoadError)downloadMarkdown(notes);return}
    if(b.dataset.action==='new-note'){editNote(null);return}
    if(b.dataset.action==='new-reminder'){editReminder();return}
    if(b.dataset.action==='mail-reminder'){mailReminderDraft();return}
    if(b.dataset.action==='mail-calendar'){calendarFromMail();return}
    if(b.dataset.action==='download-mail-pdf'){downloadMailPdf(b);return}
    if(b.dataset.action==='open-obsidian'){closeSheet(true);openView('obsidian');return}
    if(b.dataset.action==='connection-settings'){connectionSheet();return}
    if(b.dataset.action==='sign-in'){signInSheet();return}
    if(b.dataset.action==='google-connect'){
      const popup=window.open('about:blank','_blank');
      if(!popup){inlineMessage('googleMessage','Дозвольте відкриття нової вкладки та спробуйте ще раз.');return}
      popup.opener=null;b.disabled=true;
      try{const result=await backend.googleStart(),url=new URL(result.url);if(url.origin!=='https://accounts.google.com')throw Error('Неправильна адреса входу Google.');popup.location.replace(url.href);inlineMessage('googleMessage','Завершіть вхід Google у новій вкладці. Потім оновіть дашборд.')}
      catch(error){popup.close();inlineMessage('googleMessage',error.message)}finally{b.disabled=false}return
    }
    if(b.dataset.action==='google-disconnect'){b.disabled=true;try{await backend.googleDisconnect();googleConnected=false;googleCanArchive=false;googleCanCreateCalendar=false;googleChecked=true;googleStatusError='';googleEmail='';googleDay='';homeGoogleDay='';homeEvents=[];homeCalendarError='';realEvents=[];realMails=[];monthEvents=[];monthKey='';++monthRequest;mailDetails.clear();resetMailbox();googleErrors();renderDate(false);renderMail();updateMode();about()}catch(error){inlineMessage('googleMessage',error.message);b.disabled=false}return}
    if(b.dataset.action==='sign-out'){await signOut();return}
    if(b.dataset.action==='sign-up'){const form=$('authForm');if(!form.reportValidity())return;b.disabled=true;try{const loggedIn=await backend.signUp(form.elements.email.value,form.elements.password.value);if(loggedIn){await loadPrivateData();closeSheet()}else inlineMessage('authMessage','Перевірте пошту, підтвердьте реєстрацію й поверніться сюди для входу.',true)}catch(error){inlineMessage('authMessage',error.message)}finally{b.disabled=false}return}
    if(b.dataset.action==='close'){closeSheet();return}
    if(b.id==='prevDay'||b.id==='nextDay'){selected=addDays(selected,b.id==='prevDay'?-1:1);renderDate();if(currentView)renderView();return}
    if(b.dataset.action==='choose-day'){const picker=$('dateInput');if(picker.showPicker)picker.showPicker();else picker.click();return}
    if(b.id==='openDatePicker'){go('today',b);return}
    if(b.id==='focusOpen'){if(!signedIn){signInSheet();return}const day=dailyToday(),rows=dailyRows(day),task=rows.find(r=>r.is_focus);if(dailyErrors.has(day)&&!dailyDays.has(day)){dailyErrors.delete(day);loadDailyDay(day,true)}else if(task){priorityDate=day;openView('priorities',task.id,day,b)}else if(!rows.length)dailyTaskEditor(day,null,null,true);else{priorityDate=day;openView('priorities','','',b)}return}
    if(b.id==='addNote'){editNote(null);return}
    if(b.id==='closeSheet'){closeSheet();return}
  });
  document.addEventListener('change',e=>{if(e.target.dataset.priority!==undefined&&!signedIn&&!sessionChecking){checked[e.target.dataset.priority]=e.target.checked;save('priorities',checked)}if(e.target.id==='priorityDateInput'&&e.target.value){priorityDate=e.target.value;loadDailyDay(priorityDate);renderView()}if(e.target.id==='dateInput'&&e.target.value){const [y,m,d]=e.target.value.split('-').map(Number);selected=new Date(y,m-1,d,12);renderDate();if(currentView)renderView()}if(e.target.id==='reminderDue'){const time=e.target.form?.elements.time;if(time){time.disabled=!e.target.value;if(!e.target.value)time.value=''}}});
  function refreshVisibleMail(){renderHomeDay();if(googleConnected&&Date.now()-lastGoogleFetch>10000){refreshGoogleDay(currentView?selected:homeDate());if(currentView===routeKey('mail'))loadMailbox(true)}}
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshVisibleMail();if(!document.hidden&&signedIn){renderDaily();loadDailyDay(dailyToday(),true)}if(!document.hidden&&signedIn&&Date.now()-lastObsidianFetch>300000)refreshObsidian()});
  window.addEventListener('focus',()=>{refreshVisibleMail();if(signedIn&&Date.now()-lastObsidianFetch>300000)refreshObsidian()});
  let lastPriorityToday=dailyToday();setInterval(()=>{const day=dailyToday();if(day!==lastPriorityToday){lastPriorityToday=day;renderDaily();if(signedIn)loadDailyDay(day)}},60000);
  document.addEventListener('submit',async e=>{
    if(e.target.matches('#birthdayForm')){e.preventDefault();const form=e.target,button=form.querySelector('[type=submit]');if(form.dataset.saving)return;form.dataset.saving='true';button.disabled=true;const epoch=authEpoch,serial=sheetSerial;
      try{const value=form.elements.date.value,date=dateFromSql(value),name=form.elements.name.value.trim(),yearText=form.elements.year.value,year=yearText?Number(yearText):null;
        if(!date||ymd(date)!==value||!name)throw new Error('Вкажіть ім’я та правильну дату.');
        if(year!==null&&(year<1800||year>2100||date.getMonth()===1&&date.getDate()===29&&!leap(year)))throw new Error('Перевірте рік народження.');
        const fields={name,birth_month:date.getMonth()+1,birth_day:date.getDate(),birth_year:year,relationship:form.elements.relationship.value.trim(),note:form.elements.note.value.trim(),remind_days:0,enabled:form.elements.enabled.checked};
        const id=form.elements.birthdayId.value,rows=id?await backend.editBirthday(id,fields):await backend.addBirthday(fields,form.elements.draftId.value);if(epoch!==authEpoch)return;if(!rows.length)throw new Error('День народження не збережено.');
        birthdays=birthdays.filter(x=>x.id!==rows[0].id).concat(rows[0]);birthdayLoadError='';renderBirthdays();selected=birthdayOccurrence(rows[0],selected.getFullYear());renderDate(false);if(serial===sheetSerial){closeSheet(true);openView('birthdays',rows[0].id)}
      }catch(error){if(epoch===authEpoch&&serial===sheetSerial)inlineMessage('birthdayError',error.message)}finally{delete form.dataset.saving;button.disabled=false}return}
    if(e.target.matches('#dailyTaskForm')){e.preventDefault();const form=e.target,button=form.querySelector('[type=submit]');if(form.dataset.saving)return;form.dataset.saving='true';button.disabled=true;const epoch=authEpoch,serial=sheetSerial;
      try{
        const day=form.elements.day?.value||dailyToday(),title=form.elements.title.value.trim(),details=form.elements.details.value.trim();
        if(!title||!/^\d{4}-\d{2}-\d{2}$/.test(day)||ymd(dateFromSql(day))!==day)throw new Error('Вкажіть назву й правильну дату.');
        const task=form.elements.taskId.value?dailyTaskById(form.elements.taskId.value):null;
        if(form.elements.taskId.value&&!task)throw new Error('Справу не знайдено. Оновіть сторінку.');
        const rows=await backend.listDailyTasks(day);if(epoch!==authEpoch)return;dailyDays.set(day,rows);
        const slot=task?.day===day?task.position:nextDailySlot(rows),replacement=form.elements.replace?.value?rows.find(r=>r.id===form.elements.replace.value):null;
        let saved;
        if(task){if(!slot)throw new Error('Сьогодні вже три справи. Змініть одну або поставте нову на інший день.');saved=await updateDailyTask(task.id,{day,position:slot,timezone:dailyZone,title,details})}
        else if(replacement){if(!confirm('Замінити справу «'+replacement.title+'» новою?'))return;saved=await updateDailyTask(replacement.id,{title,details,is_complete:false,completed_at:null,source_type:form.elements.sourceType.value||null,source_key:form.elements.sourceKey.value||null,source_label:form.elements.sourceLabel.value||null})}
        else{if(!slot)throw new Error('Сьогодні вже три справи. Змініть одну або поставте нову на інший день.');const sourceType=form.elements.sourceType.value||null,sourceKey=form.elements.sourceKey.value||null;const existing=sourceKey&&rows.find(r=>r.source_type===sourceType&&r.source_key===sourceKey);if(existing)saved=existing;else{const first=form.elements.firstFocus.value==='true';saved=(await backend.addDailyTask({id:form.elements.draftId.value,day,timezone:dailyZone,position:slot,title,details,is_focus:first,source_type:sourceType,source_key:sourceKey,source_label:form.elements.sourceLabel.value||null}))[0]}}
        if(!saved)throw new Error('Справу не збережено.');await syncDailyDay(day);if(task&&task.day!==day)await syncDailyDay(task.day);
        if(epoch===authEpoch&&serial===sheetSerial){closeSheet(true);priorityDate=day;openView('priorities',saved.id,day)}
      }catch(error){if(epoch===authEpoch&&serial===sheetSerial)inlineMessage('dailyTaskError',dailyErrorText(error))}
      finally{delete form.dataset.saving;button.disabled=false}return;
    }
    if(e.target.matches('#dailyMoveForm')){e.preventDefault();const form=e.target,button=form.querySelector('[type=submit]');if(form.dataset.saving)return;form.dataset.saving='true';button.disabled=true;const epoch=authEpoch,serial=sheetSerial;try{const task=dailyTaskById(form.elements.taskId.value),day=form.elements.day.value;if(!task||!day||ymd(dateFromSql(day))!==day)throw new Error('Перевірте справу й дату.');if(task.day===day)throw new Error('Оберіть інший день.');const rows=await backend.listDailyTasks(day);if(epoch!==authEpoch)return;dailyDays.set(day,rows);const slot=nextDailySlot(rows);if(!slot)throw new Error('У цьому дні вже три справи. Оберіть інший день.');await updateDailyTask(task.id,{day,position:slot,timezone:dailyZone,is_focus:false});await syncDailyDay(task.day);await syncDailyDay(day);if(epoch===authEpoch&&serial===sheetSerial){closeSheet(true);priorityDate=day;openView('priorities',task.id,day)}}catch(error){if(epoch===authEpoch&&serial===sheetSerial)inlineMessage('dailyMoveError',dailyErrorText(error))}finally{delete form.dataset.saving;button.disabled=false}return}
    if(e.target.matches('#calendarEntryForm')){e.preventDefault();const form=e.target,button=form.querySelector('[type=submit]');if(form.dataset.saving)return;form.dataset.saving='true';button.disabled=true;const epoch=authEpoch,serial=sheetSerial;
      try{const date=form.elements.date.value,time=form.elements.time?.value||'',start=time?new Date(date+'T'+time+':00'):null;if(start&&!Number.isFinite(start.getTime()))throw new Error('Перевірте час.');const draft={id:form.elements.draftId.value,kind:form.elements.kind.value,title:form.elements.title.value.trim(),description:form.elements.description.value.trim(),date,time,...(start?{startsAt:start.toISOString()}:{})};const result=await backend.googleCalendarCreate(draft);if(epoch!==authEpoch)return;selected=dateFromSql(date);monthEvents=monthKey===monthId(selected)?[...monthEvents.filter(x=>x.id!==result.event.id),result.event]:[result.event];monthKey=monthId(selected);monthError='';renderDate(false);if(serial===sheetSerial){closeSheet(true);openView('today',result.event.id,date)}loadCalendarMonth(true);refreshGoogleDay()}catch(error){if(epoch===authEpoch&&serial===sheetSerial)inlineMessage('calendarEntryError',error.message)}finally{delete form.dataset.saving;button.disabled=false}return}
    if(e.target.matches('#calendarDraftForm')){e.preventDefault();const form=e.target;try{const url=googleCalendarDraft(form.elements.title.value.trim(),form.elements.date.value,form.elements.time.value);const link=$('calendarDraftFallback');link.href=url;link.hidden=false;inlineMessage('calendarDraftMessage','Перевірте акаунт і збережіть подію в Google Calendar. Якщо вкладка не відкрилася, скористайтеся посиланням нижче.',true);window.open(url,'_blank','noopener,noreferrer');sheetStart=formSnapshot(form)}catch(error){inlineMessage('calendarDraftMessage',error.message)}return}
    if(e.target.matches('#connectionForm')){
      e.preventDefault();const form=e.target;
      try{window.dashboardConnection.validate({url:form.elements.url.value,publishableKey:form.elements.publishableKey.value});if(backend)await backend.signOut();window.dashboardConnection.save({url:form.elements.url.value,publishableKey:form.elements.publishableKey.value});location.reload()}catch(error){inlineMessage('connectionError',error.message)}return;
    }
    if(e.target.matches('#authForm')){e.preventDefault();const form=e.target,button=form.querySelector('[type="submit"]');if(form.dataset.saving)return;form.dataset.saving='true';button.disabled=true;try{await backend.signIn(form.elements.email.value,form.elements.password.value);await loadPrivateData();closeSheet(true)}catch(error){inlineMessage('authMessage',error.message)}finally{delete form.dataset.saving;button.disabled=false}return}
    if(e.target.matches('#reminderForm')&&e.target.elements.reminderId?.value){
      e.preventDefault();const form=e.target,button=form.querySelector('[type="submit"]');if(form.dataset.saving)return;
      form.dataset.saving='true';button.disabled=true;const epoch=authEpoch,serial=sheetSerial;
      try{
        const current=reminders.find(r=>r.id===form.elements.reminderId.value);
        if(!signedIn||!current)throw new Error('Нагадування не знайдено. Оновіть сторінку.');
        const title=form.elements.title.value.trim(),due=form.elements.due.value,time=form.elements.time.value;
        if(time&&!due)throw new Error('Спочатку виберіть дату для часу.');
        const rows=await backend.editReminder(current.id,title,due,time,current.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC');
        if(epoch!==authEpoch)return;
        if(!rows.length)throw new Error('Нагадування не знайдено. Оновіть сторінку.');
        Object.assign(current,mapReminder(rows[0]));reminderLoadError='';renderReminders();
        if(serial===sheetSerial){closeSheet(true);renderView()}
      }catch(error){if(epoch===authEpoch&&serial===sheetSerial)inlineMessage('reminderError',error.message)}
      finally{delete form.dataset.saving;button.disabled=false}
      return;
    }
    if(e.target.matches('#reminderForm')){e.preventDefault();const form=e.target,button=form.querySelector('[type="submit"]');if(form.dataset.saving)return;form.dataset.saving='true';button.disabled=true;const epoch=authEpoch,serial=sheetSerial;try{const mailId=form.elements.sourceMailId?.value,letter=mailId?mailDetails.get(mailId)?.letter:null;if(mailId&&!letter?.available)throw new Error('Спершу відкрийте повний лист.');const title=form.elements.title.value.trim(),due=form.elements.due.value,time=form.elements.time.value,zone=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC',draftId=form.elements.draftId.value;if(time&&!due)throw new Error('Спочатку виберіть дату для часу.');const rows=mailId?await backend.addMailReminder(title,due,time,zone,draftId,mailId,letter.subject||'Лист без теми'):await backend.addReminder(title,due,time,zone,draftId);if(epoch!==authEpoch)return;if(!rows.length)throw new Error('Нагадування не збережено.');reminderLoadError='';const item=mapReminder(rows[0]);if(!reminders.some(r=>r.id===item.id))reminders.unshift(item);renderReminders();updateMode();if(serial===sheetSerial){const calendar=form.dataset.fromCalendar==='true';closeSheet(true);if(calendar){if(due)selected=dateFromSql(due);renderDate();openView('today')}else openView('reminders',String(rows[0].id))}}catch(error){if(epoch===authEpoch&&serial===sheetSerial)inlineMessage('reminderError',error.message)}finally{delete form.dataset.saving;button.disabled=false}return}
    if(!e.target.matches('#noteForm'))return;e.preventDefault();const form=e.target,data=new FormData(form),oldId=data.get('noteId'),title=String(data.get('title')||'').trim(),body=String(data.get('body')||'').trim();if(!title||!body||form.dataset.saving)return;form.dataset.saving='true';const button=form.querySelector('[type="submit"]');button.disabled=true;const epoch=authEpoch,serial=sheetSerial;
    try{let entry;if(signedIn){const rows=oldId?await backend.editNote(oldId,title,body):await backend.addNote(title,body,String(data.get('draftId')));if(epoch!==authEpoch)return;if(!rows.length)throw new Error('Нотатку не збережено.');noteLoadError='';const n=rows[0];entry={id:n.id,title:n.title,body:n.body,date:new Intl.DateTimeFormat('uk-UA',{day:'numeric',month:'long'}).format(new Date(n.updated_at))}}else entry={id:oldId||String(data.get('draftId')),title,body,date:new Intl.DateTimeFormat('uk-UA',{day:'numeric',month:'long'}).format(new Date())};const i=notes.findIndex(n=>n.id===entry.id);if(i>=0)notes[i]=entry;else notes.unshift(entry);if(!signedIn)save('notes',notes);renderNotes();updateMode();if(serial===sheetSerial){closeSheet(true);openView('notes',String(entry.id))}}catch(error){if(epoch===authEpoch&&serial===sheetSerial)inlineMessage('noteError',error.message)}finally{delete form.dataset.saving;button.disabled=false}
  });
  $('sheetBackdrop').addEventListener('click',e=>{if(e.target===$('sheetBackdrop'))closeSheet()});document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(!$('sheetBackdrop').hidden)closeSheet();else if(currentView)backView();return}if(e.key!=='Tab')return;const box=!$('sheetBackdrop').hidden?$('sheetBackdrop'):currentView?$('viewShell'):null;if(!box)return;const focusable=[...box.querySelectorAll('button:not([disabled]):not([hidden]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled])')].filter(el=>el.getClientRects().length);if(!focusable.length)return;const first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&(document.activeElement===first||!box.contains(document.activeElement))){e.preventDefault();last.focus()}else if(!e.shiftKey&&(document.activeElement===last||!box.contains(document.activeElement))){e.preventDefault();first.focus()}});
  updateMode();renderFocus();renderDate();renderPriorities();renderFiles();renderMail();renderNotes();renderView();
  if(backend)backend.restore().then(async ok=>{if(ok)await loadPrivateData();else if(sessionChecking){sessionChecking=false;updateMode();renderFocus();renderPriorities();renderDate(false);renderMail();renderNotes();renderReminders();renderView()}const params=new URL(location.href).searchParams,result=params.get('google');if(result){const errors={invalid_state:'Термін спроби підключення минув. Почніть її ще раз.',declined:'Доступ до Gmail або календаря не надано.',missing_code:'Google не надіслав код підтвердження.',token_exchange:'Google відхилив дані OAuth-клієнта. Перевірте Client ID і Client Secret у Supabase.',missing_refresh:'Google не надав доступу для повторного входу.',missing_permissions:'Не надано дозвіл на зміну Gmail і запис у Google Calendar.',profile_failed:'Не вдалося перевірити Google-акаунт.',wrong_account:'Виберіть Google-акаунт, дозволений у налаштуваннях сервера.',state_failed:'Не вдалося перевірити спробу підключення на сервері.',token_failed:'Не вдалося завершити перевірку токена Google.',encryption_failed:'Не вдалося захистити Google-доступ на сервері.',save_failed:'Не вдалося зберегти підключення в Supabase.'};history.replaceState(null,'',location.pathname);renderView();about();inlineMessage('googleMessage',result==='connected'&&googleConnected?'Google підключено.':errors[params.get('reason')]||'Не вдалося підключити Google. Спробуйте ще раз.',result==='connected'&&googleConnected)}}).catch(error=>{sessionRestoreError='Не вдалося відновити вхід: '+error.message;sessionChecking=Boolean(backend.isSignedIn());signedIn=false;googleConnected=false;googleStatusError='';noteLoadError='';reminderLoadError='';updateMode();renderFocus();renderPriorities();renderDate(false);renderMail();renderNotes();renderReminders();renderView();updateMode()});
})();
