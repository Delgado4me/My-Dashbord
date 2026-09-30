// Only public browser configuration belongs here. No passwords or server tokens.
// A deployment may provide these values; the connection form stores a local override.
(function () {
  const defaults = {"url":"https://kkdkqeptywizkuretujh.supabase.co","publishableKey":"sb_publishable_VuHq7arKc-z_f__3py0OVQ_xNdBAH0t"};
  const key = 'my-dashboard-connection-v1';
  function validate(value) {
    const url = new URL(String(value.url || '').trim());
    if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) || url.username || url.password || url.port || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error('Вкажіть Project URL вигляду https://project.supabase.co.');
    const publishableKey = String(value.publishableKey || '').trim();
    let publicKey = /^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey);
    if (!publicKey && publishableKey.split('.').length === 3) {
      try { const part=publishableKey.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');publicKey=JSON.parse(atob(part)).role==='anon'; } catch {}
    }
    if (!publicKey) throw new Error('Потрібен publishable або anon key. Secret і service_role key тут не використовуються.');
    return { url: url.origin, publishableKey };
  }
  let config = defaults;
  try { const saved=JSON.parse(localStorage.getItem(key)); if(saved)config=validate(saved); } catch {}
  window.DASHBOARD_SUPABASE = config;
  window.dashboardConnection = {
    validate,
    save(value) { const next=validate(value);localStorage.setItem(key,JSON.stringify(next));return next; }
  };
})();
