const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Run the actual submit handler with synthetic persistence; no network or personal data.
const app = fs.readFileSync(process.env.DASHBOARD_APP || path.join(__dirname, '../public/app.js'), 'utf8');
const start = app.indexOf("    if(e.target.matches('#dailyTaskForm'))");
const end = app.indexOf("    if(e.target.matches('#dailyMoveForm'))", start);
assert.ok(start >= 0 && end > start, 'Daily submit handler must be present');
const handler = app.slice(start, end);
const sourceKey = '11111111-1111-4111-8111-111111111111:message1';
const existing = { id: 'task1', day: '2026-10-01', position: 1, title: 'Existing', source_type: 'mail', source_key: sourceKey };

function fixture(rows, overrides = {}) {
  const calls = { add: [], update: [], open: [], errors: [], confirm: 0 };
  const button = { disabled: false };
  const values = { day: '2026-10-01', title: 'Review letter', details: '', taskId: '', draftId: 'stable-draft', sourceType: 'mail', sourceKey, sourceLabel: 'Synthetic subject', firstFocus: 'false', replace: '', ...overrides };
  const form = { dataset: {}, elements: Object.fromEntries(Object.entries(values).map(([k,v]) => [k,{ value: v }])), querySelector: () => button, matches: s => s === '#dailyTaskForm' };
  const ctx = vm.createContext({ e: { target: form, preventDefault() {} }, authEpoch: 1, sheetSerial: 1,
    dailyToday: () => '2026-10-01', dateFromSql: s => new Date(s+'T12:00:00Z'), ymd: d => d.toISOString().slice(0,10),
    dailyTaskById: id => rows.find(r=>r.id===id), dailyDays: new Map(), dailyZone: 'UTC', priorityDate: '',
    nextDailySlot: data => [1,2,3].find(n=>!data.some(r=>r.position===n)),
    backend: { listDailyTasks: async () => rows, addDailyTask: async fields => { calls.add.push(fields); return [fields]; } },
    updateDailyTask: async (id, fields) => { calls.update.push({id,...fields}); return {id,...fields}; },
    syncDailyDay: async () => {}, closeSheet() {}, openView: (...args) => calls.open.push(args),
    inlineMessage: (id, message) => calls.errors.push(message), dailyErrorText: err=>err.message,
    confirm: () => { calls.confirm++; return true; }
  });
  return { calls, form, ctx, run: () => vm.runInContext('(async()=>{'+handler+'})()', ctx) };
}
const full = () => [existing, {id:'task2',position:2}, {id:'task3',position:3}];

test('same source on a full day reopens existing task without writes', async () => {
  const f=fixture(full()); await f.run();
  assert.deepEqual(f.calls.errors, []);
  assert.equal(f.calls.open[0]?.[1], existing.id);
  assert.equal(f.calls.add.length+f.calls.update.length, 0);
});
test('same source takes precedence over a selected replacement', async () => {
  const f=fixture(full(), {replace:'task2'}); await f.run();
  assert.equal(f.calls.open[0]?.[1], existing.id);
  assert.equal(f.calls.update.length, 0);
  assert.equal(f.calls.confirm, 0);
});
test('different account source is not incorrectly deduplicated', async () => {
  const f=fixture([existing], {sourceKey:'22222222-2222-4222-8222-222222222222:message1'}); await f.run();
  assert.equal(f.calls.add.length, 1);
  assert.equal(f.calls.add[0].position, 2);
  assert.equal(f.calls.add[0].details, '');
  assert.equal(f.calls.add[0].id, 'stable-draft');
});
test('new source on a full day stays unsaved', async () => {
  const f=fixture(full(), {sourceKey:'new-source'}); await f.run();
  assert.equal(f.calls.errors.length, 1);
  assert.equal(f.calls.add.length+f.calls.update.length, 0);
});
test('repeat submit during an in-flight save makes one write', async () => {
  const f=fixture([]); let resolve;
  f.ctx.backend.listDailyTasks = () => new Promise(r=>{resolve=r});
  const first=f.run(); await f.run(); resolve([]); await first;
  assert.equal(f.calls.add.length, 1);
});
test('source already exists on the changed target day', async () => {
  const f=fixture([{...existing,day:'2026-10-02'}],{day:'2026-10-02'}); await f.run();
  assert.equal(f.calls.open[0]?.[1], existing.id);
  assert.equal(f.calls.open[0]?.[2], '2026-10-02');
  assert.equal(f.calls.add.length, 0);
});
