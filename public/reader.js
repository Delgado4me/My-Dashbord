(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const api=window.dashboardBackend;
  let current='',sequence=0,ready=false;
  const esc=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const allowed=path=>typeof path==='string'&&path.length<=500&&path.endsWith('.md')&&
    !/[\\\u0000-\u001f]/.test(path)&&!path.split('/').some(part=>!part||part==='.'||part==='..'||part==='Haven'||part.startsWith('.')||part==='node_modules');
  function clear(message,login=false){++sequence;current='';$('note').hidden=true;$('content').replaceChildren();$('choices').hidden=true;$('status').textContent=message;$('status').hidden=false;$('login').hidden=!login}
  function readerUrl(path){return '/reader.html?path='+encodeURIComponent(path)}
  const markdown=window.marked;
  markdown.use({
    gfm:true,breaks:true,
    renderer:{
      html({text}){return esc(text)},
      image({text}){return '<span class="image-placeholder">[Зображення: '+esc(text||'без опису')+']</span>'},
      link({href,tokens}){
        const label=this.parser.parseInline(tokens);
        if(typeof href!=='string')return label;
        if(/^\.\.?\//.test(href)||(!/^[a-z][a-z\d+.-]*:/i.test(href)&&href.toLowerCase().endsWith('.md')))
          return '<a href="#" data-relative="'+esc(href)+'">'+label+'</a>';
        try{const url=new URL(href,location.href);if((url.protocol==='https:'||url.protocol==='http:')&&/^[a-z][a-z\d+.-]*:/i.test(href))
          return '<a href="'+esc(url.href)+'" target="_blank" rel="noopener noreferrer">'+label+' ↗</a>'}catch{}
        return label;
      }
    },
    extensions:[{name:'wiki',level:'inline',start:source=>source.indexOf('[['),tokenizer(source){const m=/^\[\[([^\]\r\n]{1,300})\]\]/.exec(source);if(!m)return;const [name,alias]=m[1].split('|');return {type:'wiki',raw:m[0],name:name.trim(),label:(alias||name).trim()}},renderer(token){return '<a href="#" data-wiki="'+esc(token.name)+'">'+esc(token.label)+'</a>'}}]
  });
  function normalizeRelative(value){
    if(!current||typeof value!=='string'||/[?#]/.test(value))return null;
    let raw;try{raw=decodeURIComponent(value)}catch{return null}
    const parts=current.split('/').slice(0,-1);
    for(const part of raw.split('/')){if(part==='.'||part==='')continue;if(part==='..'){if(!parts.length)return null;parts.pop()}else parts.push(part)}
    const path=parts.join('/');return allowed(path)?path:null;
  }
  async function load(){
    const path=new URL(location.href).searchParams.get('path');
    clear('Завантажуємо файл…');
    const id=sequence;
    if(!allowed(path)){$('status').textContent='Неправильний або недоступний шлях до Markdown.';return}
    if(!api||!api.isSignedIn()){$('status').textContent='Щоб прочитати приватний файл, увійдіть у Supabase.';$('login').hidden=false;return}
    try{
      await api.restore();if(id!==sequence)return;ready=true;
      const note=await api.obsidianRead(path);if(id!==sequence)return;
      current=path;
      $('title').textContent=note.name;$('folder').textContent=note.folder+' · версія '+String(note.sha||'').slice(0,7);
      document.title=note.name+' · Obsidian';
      $('content').innerHTML=markdown.parse(note.body);
      const original=typeof note.url==='string'&&/^https:\/\/github\.com\/[^/]+\/[^/]+\/blob\//.test(note.url)?note.url:'';
      $('original').hidden=!original;if(original)$('original').href=original;
      $('status').hidden=true;$('note').hidden=false;$('login').hidden=true;
    }catch(error){if(id!==sequence)return;ready=false;$('status').textContent='Не вдалося відкрити файл: '+error.message;$('login').hidden=!/вхід|увійдіть|token|JWT/i.test(error.message)}
  }
  function navigate(path){if(!allowed(path))return;history.pushState(null,'',readerUrl(path));load()}
  $('reload').addEventListener('click',load);
  document.addEventListener('click',async event=>{
    const choice=event.target.closest('button[data-choice]');if(choice){navigate(choice.dataset.choice);return}
    const link=event.target.closest('a[data-relative],a[data-wiki]');if(!link)return;
    event.preventDefault();
    const origin=current;if(!origin)return;
    if(link.dataset.relative){const path=normalizeRelative(link.dataset.relative);if(path)navigate(path);else{$('status').textContent='Недоступне або непідтримуване посилання.';$('status').hidden=false}return}
    const id=sequence;
    try{const result=await api.obsidianResolve(link.dataset.wiki,origin);if(id!==sequence)return;
      const matches=result.matches||[];
      if(!matches.length){$('status').textContent='Пов’язаний файл не знайдено або він недоступний.';$('status').hidden=false;return}
      if(matches.length===1){navigate(matches[0]);return}
      $('choices').innerHTML='<strong>Оберіть пов’язаний файл:</strong>'+matches.map(path=>'<button type="button" data-choice="'+esc(path)+'">'+esc(path)+'</button>').join('')+(result.partial?'<p>Показано лише перші 20 збігів.</p>':'');$('choices').hidden=false;
    }catch(error){if(id!==sequence)return;$('status').textContent='Не вдалося знайти пов’язаний файл: '+error.message;$('status').hidden=false}
  });
  window.addEventListener('popstate',load);
  window.addEventListener('storage',event=>{if((event.key===api?.sessionStorageKey||event.key===null)&&!event.newValue){ready=false;clear('Сеанс завершено. Увійдіть з головного екрана.',true)}});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&ready)load()});
  load();
})();
