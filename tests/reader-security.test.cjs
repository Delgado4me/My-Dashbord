const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const marked = require('../public/vendor/marked-17.0.5.umd.js').marked;

const elements = Object.fromEntries(['status', 'note', 'content', 'choices', 'login', 'title', 'folder', 'original', 'reload'].map(id => [id, {
  hidden: false, textContent: '', innerHTML: '', href: '', replaceChildren() { this.innerHTML = '' }, addEventListener() {}
}]));
let fetches = 0;
const backend = {
  isSignedIn: () => true,
  restore: async () => true,
  obsidianRead: async () => {
    fetches++;
    return { name: 'Приватна.md', folder: 'Дашборд', sha: 'abc1234567', body:
      '# Заголовок\n<script>alert(1)</script>\n\n[Небезпечно](javascript:alert(1))\n\n![Зображення](https://example.com/track.png)\n\n[[Пов’язане|Читати]]\n\n[План](./План.md)' };
  }
};
const document = { title: '', getElementById: id => elements[id], addEventListener() {} };
const url = 'https://example.test/reader.html?path=' + encodeURIComponent('Дашборд/Приватна.md');
vm.runInNewContext(readFileSync('public/reader.js', 'utf8'), {
  window: { marked, dashboardBackend: backend, addEventListener() {} }, document,
  location: { href: url }, URL, history: { pushState() {} }, decodeURIComponent, encodeURIComponent
});
setImmediate(() => {
  const html = elements.content.innerHTML;
  assert.equal(fetches, 1);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script|<img|javascript:/i);
  assert.match(html, /data-wiki="Пов’язане"/);
  assert.match(html, /data-relative="\.\/План\.md"/);
  assert.equal(elements.note.hidden, false);
  console.log('PASS: Markdown displays safely and keeps internal note links');
});
