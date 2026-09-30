/* Supabase Data API client for the private dashboard. The publishable key is
   intentionally public; every table is protected by user-scoped RLS. */
(function () {
  'use strict';
  const config = window.DASHBOARD_SUPABASE;
  if (!config || !config.url || !config.publishableKey) return;
  const origin = config.url.replace(/\/$/, '');
  const storageKey = 'my-dashboard-supabase-session-v1:' + origin;
  let sessionVersion = 0, refreshPromise = null;
  let session = null;
  try { session = JSON.parse(localStorage.getItem(storageKey)); } catch { /* no stored session */ }

  function keep(data) {
    session = data && data.access_token ? {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
      user: data.user || session?.user || null
    } : null;
    if (session) localStorage.setItem(storageKey, JSON.stringify(session));
    else localStorage.removeItem(storageKey);
  }

  async function send(path, options = {}, token = null) {
    const response = await fetch(origin + path, {
      ...options,
      signal: options.signal || AbortSignal.timeout(20000),
      headers: {
        apikey: config.publishableKey,
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(options.headers || {})
      }
    });
    if (response.status === 204) return null;
    const raw = await response.text();
    let data;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
    if (!response.ok) throw new Error(data?.msg || data?.error_description || data?.message || data?.error || 'Помилка сервера (' + response.status + ')');
    return data;
  }

  async function token() {
    if (!session) return null;
    if (session.expires_at > Math.floor(Date.now() / 1000) + 60) return session.access_token;
    if (refreshPromise) return refreshPromise;
    const version = sessionVersion, refreshToken = session.refresh_token;
    const pending = (async () => {
      try {
        const data = await send('/auth/v1/token?grant_type=refresh_token', {
          method: 'POST', body: JSON.stringify({ refresh_token: refreshToken })
        });
        if (version !== sessionVersion || !session) throw new Error('Сеанс завершено. Увійдіть знову.');
        keep(data);
        return session.access_token;
      } catch (error) {
        if (version === sessionVersion && /invalid|expired|revoked|refresh/i.test(error.message)) keep(null);
        throw error;
      }
    })();
    refreshPromise = pending;
    try { return await pending; }
    finally { if (refreshPromise === pending) refreshPromise = null; }
  }

  async function restore() {
    if (!session) return false;
    const version = sessionVersion;
    const access = await token();
    if (version !== sessionVersion || !session) return false;
    const user = await send('/auth/v1/user', { method: 'GET' }, access);
    if (version !== sessionVersion || !session) return false;
    session.user = user;
    localStorage.setItem(storageKey, JSON.stringify(session));
    return true;
  }

  async function signIn(email, password) {
    const version = ++sessionVersion;
    refreshPromise = null;
    const data = await send('/auth/v1/token?grant_type=password', {
      method: 'POST', body: JSON.stringify({ email: email.trim(), password })
    });
    if (version !== sessionVersion) throw new Error('Спробу входу скасовано.');
    ++sessionVersion;refreshPromise=null;keep(data);
    return data.user;
  }

  async function signUp(email, password) {
    const version = ++sessionVersion;
    refreshPromise = null;
    const data = await send('/auth/v1/signup', {
      method: 'POST', body: JSON.stringify({ email: email.trim(), password })
    });
    if (version !== sessionVersion) throw new Error('Спробу реєстрації скасовано.');
    if (data.access_token) { ++sessionVersion;refreshPromise=null;keep(data); }
    return Boolean(data.access_token);
  }

  async function signOut() {
    ++sessionVersion;
    refreshPromise = null;
    const access = session?.access_token;
    keep(null);
    if (access) { try { await send('/auth/v1/logout', { method: 'POST' }, access); } catch { /* local sign-out is complete */ } }
  }

  window.addEventListener?.('storage', event => {
    if (event.key !== storageKey && event.key !== null) return;
    ++sessionVersion;
    refreshPromise = null;
    try { session = JSON.parse(event.newValue); } catch { session = null; }
  });

  async function table(path, options = {}) {
    const access = await token();
    if (!access) throw new Error('Спершу увійдіть у Supabase.');
    return send('/rest/v1/' + path, options, access);
  }

  async function google(action, options = {}) {
    const access = await token();
    if (!access) throw new Error('Спершу увійдіть у Supabase.');
    const query = new URLSearchParams({ action });
    for (const key of ['day', 'start', 'end', 'id', 'folder', 'pageToken']) if (options[key]) query.set(key, options[key]);
    const path = '/functions/v1/dashboard-google?' + query;
    const request = () => send(path, {
      method: options.method || 'GET',
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
    }, access);
    try { return await request(); }
    catch (error) {
      if (action !== 'snapshot' || !(error instanceof TypeError)) throw error;
      await new Promise(resolve => setTimeout(resolve, 700));
      try { return await request(); }
      catch (retryError) {
        if (retryError instanceof TypeError) throw new Error('З’єднання із сервером перервано. Натисніть ↻ для повтору.');
        throw retryError;
      }
    }
  }

  const headers = { Prefer: 'return=representation' };
  async function byId(tableName, id) {
    const rows = await table(tableName + '?id=eq.' + encodeURIComponent(id) + '&select=*');
    return rows[0] || null;
  }
  async function reconcileWrite(tableName, id, fields, write) {
    try { return await write(); }
    catch (error) {
      // A timeout can happen after PostgREST committed a write. Read the stable ID
      // before offering another attempt; inserts use the same ID on every retry.
      if (!(error instanceof TypeError) && !/duplicate|unique|conflict|already exists|409|abort|timeout/i.test(error.name + ' ' + error.message)) throw error;
      const row = await byId(tableName, id);
      if (row && Object.entries(fields).every(([key, value]) => row[key] === value)) return [row];
      throw error;
    }
  }
  window.dashboardBackend = {
    restore, signIn, signUp, signOut, sessionStorageKey: storageKey,
    async dailyTimezone(zone) {
      await table('dashboard_daily_settings?on_conflict=user_id', {
        method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify({ timezone: zone })
      });
      const rows = await table('dashboard_daily_settings?select=timezone&limit=1');
      return rows[0]?.timezone || zone;
    },
    listDailyTasks: day => table('dashboard_daily_tasks?select=*&day=eq.' + encodeURIComponent(day) + '&order=position.asc'),
    addDailyTask: draft => reconcileWrite('dashboard_daily_tasks', draft.id,
      { title: draft.title, day: draft.day, position: draft.position },
      () => table('dashboard_daily_tasks', { method: 'POST', headers, body: JSON.stringify(draft) })),
    editDailyTask: (id, fields) => reconcileWrite('dashboard_daily_tasks', id,
      Object.fromEntries(Object.entries(fields).filter(([k]) => k !== 'updated_at' && k !== 'completed_at')),
      () => table('dashboard_daily_tasks?id=eq.' + encodeURIComponent(id), {
        method: 'PATCH', headers, body: JSON.stringify({ ...fields, updated_at: new Date().toISOString() })
      })),
    deleteDailyTask: id => table('dashboard_daily_tasks?id=eq.' + encodeURIComponent(id), { method: 'DELETE' }),
    googleStatus: () => google('status'),
    googleStart: () => google('start', { method: 'POST' }),
    googleSnapshot: (day, start, end) => google('snapshot', { day, start, end }),
    googleCalendarMonth: (start, end) => google('calendar-month', { start, end }),
    googleCalendarCreate: draft => google('calendar-create', { method: 'POST', body: draft }),
    googleMessage: id => google('message', { id }),
    googleList: (folder, pageToken) => google('list', { folder, pageToken }),
    googleArchive: id => google('archive', { id, method: 'POST' }),
    googleSetLabel: (id, kind, enabled) => google('set-label', { id, method: 'POST', body: { kind, enabled } }),
    googleDisconnect: () => google('disconnect', { method: 'POST' }),
    obsidianSnapshot: () => token().then(access => {
      if (!access) throw new Error('Спершу увійдіть у Supabase.');
      return send('/functions/v1/dashboard-obsidian', { method: 'GET' }, access);
    }),
    obsidianRead: path => token().then(access => {
      if (!access) throw new Error('Спершу увійдіть у Supabase.');
      return send('/functions/v1/dashboard-obsidian?action=read&path=' + encodeURIComponent(path), { method: 'GET' }, access);
    }),
    obsidianResolve: (name, from) => token().then(access => {
      if (!access) throw new Error('Спершу увійдіть у Supabase.');
      return send('/functions/v1/dashboard-obsidian?action=resolve&name=' + encodeURIComponent(name) + '&from=' + encodeURIComponent(from), { method: 'GET' }, access);
    }),
    listObsidianFavorites: () => table('dashboard_obsidian_favorites?select=path,created_at&order=created_at.desc'),
    addObsidianFavorite: path => table('dashboard_obsidian_favorites', {
      method: 'POST', body: JSON.stringify({ path })
    }),
    removeObsidianFavorite: path => table('dashboard_obsidian_favorites?path=eq.' + encodeURIComponent(path), { method: 'DELETE' }),
    isSignedIn: () => Boolean(session),
    listNotes: () => table('dashboard_notes?select=id,title,body,created_at,updated_at&order=updated_at.desc'),
    addNote: (title, body, id) => reconcileWrite('dashboard_notes', id, { title, body },
      () => table('dashboard_notes', { method: 'POST', headers, body: JSON.stringify({ id, title, body }) })),
    editNote: (id, title, body) => reconcileWrite('dashboard_notes', id, { title, body },
      () => table('dashboard_notes?id=eq.' + encodeURIComponent(id), { method: 'PATCH', headers, body: JSON.stringify({ title, body, updated_at: new Date().toISOString() }) })),
    deleteNote: id => table('dashboard_notes?id=eq.' + encodeURIComponent(id), { method: 'DELETE' }),
    listBirthdays: () => table('dashboard_birthdays?select=id,name,birth_month,birth_day,birth_year,relationship,note,remind_days,enabled,created_at,updated_at&order=birth_month.asc,birth_day.asc,name.asc'),
    addBirthday: (fields, id) => reconcileWrite('dashboard_birthdays', id, fields,
      () => table('dashboard_birthdays', { method: 'POST', headers, body: JSON.stringify({ id, ...fields }) })),
    editBirthday: (id, fields) => reconcileWrite('dashboard_birthdays', id, fields,
      () => table('dashboard_birthdays?id=eq.' + encodeURIComponent(id), { method: 'PATCH', headers,
        body: JSON.stringify({ ...fields, updated_at: new Date().toISOString() }) })),
    deleteBirthday: id => table('dashboard_birthdays?id=eq.' + encodeURIComponent(id), { method: 'DELETE' }),
    listReminders: () => table('dashboard_reminders?select=id,title,due_on,due_time,show_from,timezone,source_type,source_key,source_label,status,completed_at,created_at&order=created_at.desc'),
    addReminder: (title, dueOn, dueTime, timezone, id) => {
      const fields = { title, due_on: dueOn || null, due_time: dueOn && dueTime ? dueTime : null, show_from: dueOn ? shiftDate(dueOn, -2) : null, timezone, source_type: 'manual' };
      return reconcileWrite('dashboard_reminders', id, fields,
        () => table('dashboard_reminders', { method: 'POST', headers, body: JSON.stringify({ id, ...fields }) }));
    },
    addMailReminder: async (title, dueOn, dueTime, timezone, id, messageId, subject) => {
      if (!/^[a-z\d_-]{1,100}$/i.test(messageId)) throw new Error('Невірний ідентифікатор листа.');
      const find = () => table('dashboard_reminders?select=*&source_type=eq.mail&source_key=eq.' + encodeURIComponent(messageId) + '&limit=1');
      const existing = await find();
      if (existing.length) return existing;
      const fields = { title, due_on: dueOn || null, due_time: dueOn && dueTime ? dueTime : null, show_from: dueOn ? shiftDate(dueOn, -2) : null, timezone,
        source_type: 'mail', source_key: messageId, source_label: ('Gmail: ' + subject).slice(0, 250) };
      try {
        return await reconcileWrite('dashboard_reminders', id, fields,
          () => table('dashboard_reminders', { method: 'POST', headers, body: JSON.stringify({ id, ...fields }) }));
      } catch (error) {
        // A concurrent tap or a timed-out insert may have committed this source.
        const saved = await find();
        if (saved.length) return saved;
        throw error;
      }
    },
    addBirthdayReminder: async (title, dueOn, timezone, id, birthdayId, name) => {
      if (!/^[a-f\d-]{36}$/i.test(birthdayId) || !/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) throw new Error('Некоректний день народження.');
      const key = birthdayId + ':' + dueOn.slice(0, 4);
      const find = () => table('dashboard_reminders?select=*&source_type=eq.birthday&source_key=eq.' + encodeURIComponent(key) + '&limit=1');
      const existing = await find();
      if (existing.length) return existing;
      const fields = { title, due_on: dueOn, due_time: null, show_from: shiftDate(dueOn, -2), timezone,
        source_type: 'birthday', source_key: key, source_label: ('День народження: ' + name).slice(0, 250) };
      try { return await reconcileWrite('dashboard_reminders', id, fields,
        () => table('dashboard_reminders', { method: 'POST', headers, body: JSON.stringify({ id, ...fields }) })); }
      catch (error) { const saved = await find(); if (saved.length) return saved; throw error; }
    },
    editReminder: (id, title, dueOn, dueTime, timezone) => {
      const fields = { title, due_on: dueOn || null, due_time: dueOn && dueTime ? dueTime : null,
        show_from: dueOn ? shiftDate(dueOn, -2) : null, timezone };
      return reconcileWrite('dashboard_reminders', id, fields,
        () => table('dashboard_reminders?id=eq.' + encodeURIComponent(id), {
          method: 'PATCH', headers, body: JSON.stringify({ ...fields, updated_at: new Date().toISOString() })
        }));
    },
    setReminderComplete: (id, done) => reconcileWrite('dashboard_reminders', id, { status: done ? 'completed' : 'active' },
      () => table('dashboard_reminders?id=eq.' + encodeURIComponent(id), { method: 'PATCH', headers, body: JSON.stringify({ status: done ? 'completed' : 'active', completed_at: done ? new Date().toISOString() : null, updated_at: new Date().toISOString() }) }))
  };

  function shiftDate(value, amount) {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + amount));
    return date.toISOString().slice(0, 10);
  }
})();
