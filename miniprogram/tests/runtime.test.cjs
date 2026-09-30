const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const vm = require('node:vm');
const { transformSync } = require('esbuild');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const id = 'b8627372-5f64-4b6e-83e2-4237d5c7b7e0';
let store, requests, response, application, pages, ctx, timerIds;
beforeEach(() => {
  store = new Map(); requests = []; pages = []; timerIds = [];
  response = options => options.success({ statusCode: 200, data: { practiceId: id, status: 'queued', remainingFreePractices: 2, pollAfterMs: 2500 } });
  const wx = {
    getStorageSync: key => store.get(key) ?? '', setStorageSync: (key, value) => store.set(key, value), removeStorageSync: key => store.delete(key), getStorageInfoSync: () => ({ keys: [...store.keys()] }),
    getRandomValues: options => options.success({ randomValues: Uint8Array.from({ length: options.length }, (_, index) => index + 1).buffer }),
    request: options => { requests.push(options); response(options); },
    showModal: options => options.success({ confirm: true }), getWindowInfo: () => ({ statusBarHeight: 20 }), stopPullDownRefresh() {},
    navigateTo: options => pages.push(options.url), redirectTo: options => pages.push(options.url), switchTab: options => pages.push(options.url),
  };
  ctx = vm.createContext({ wx, App: options => { application = options; }, Page: options => { ctx.pageDefinition = options; }, getApp: () => application, console,
    setTimeout: (...args) => { const timer = setTimeout(...args); timerIds.push(timer); return timer; }, clearTimeout,
    setInterval: (...args) => { const timer = setInterval(...args); timerIds.push(timer); return timer; }, clearInterval, URL, Date, Uint8Array, ArrayBuffer,
  });
  vm.runInContext(readFileSync(path.join(root, 'dist/app.js'), 'utf8'), ctx);
});
afterEach(() => timerIds.forEach(timer => { clearTimeout(timer); clearInterval(timer); }));
const practiceInput = { source: 'vocabulary', targetCount: 6, format: 'topic_set' };
test('network retry keeps the same key, rejects changed payload, and validates shared contracts', async () => {
  response = options => options.fail({});
  await assert.rejects(application.services.createPractice(practiceInput), /网络连接失败/);
  const key = requests[0].header['Idempotency-Key'];
  await assert.rejects(application.services.createPractice({ ...practiceInput, targetCount: 7 }), /原内容重试/);
  assert.equal(requests.length, 1);
  response = options => options.success({ statusCode: 200, data: { practiceId: id, status: 'queued', remainingFreePractices: 2, pollAfterMs: 2500 } });
  await application.services.createPractice(practiceInput);
  assert.equal(requests[1].header['Idempotency-Key'], key);
  assert.equal([...store.keys()].some(key => key.startsWith('bhe:operation:')), false);
  assert.throws(() => application.services.createPractice({ ...practiceInput, targetCount: 0 }));
});
test('rejects invalid server data and never turns a failure into success', async () => {
  response = options => options.success({ statusCode: 200, data: { status: 'ready' } });
  await assert.rejects(application.services.createPractice(practiceInput), /数据格式/);
  response = options => options.success({ statusCode: 403, data: { error: { code: 'QUOTA_EXHAUSTED', message: '免费额度已用完', retryable: false, requestId: id } } });
  await assert.rejects(application.services.createPractice(practiceInput), /免费额度已用完/);
});
test('native crypto produces a persistent 256-bit installation token and logout removes pending operations', async () => {
  await application.services.createPractice(practiceInput);
  const auth = requests[0].header.Authorization;
  assert.match(auth, /^Bearer [0-9a-f]{64}$/);
  assert.equal(store.get('bhe:installation:v1'), auth.slice(7));
  store.set('bhe:operation:old', {}); application.logout();
  assert.equal(store.has('bhe:installation:v1'), false);
  assert.equal(store.has('bhe:operation:old'), false);
});
function page(kind, options = {}) {
  ctx.module = { exports: {} }; vm.runInContext(readFileSync(path.join(root, 'dist/lib/controller.js'), 'utf8'), ctx); ctx.module.exports.registerPage(kind);
  const definition = ctx.pageDefinition;
  const page = { ...definition, data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } };
  page.onLoad(options); return page;
}
const flush = () => new Promise(resolve => setImmediate(resolve));
test('logout prevents delayed crypto and login responses from restoring old credentials', async () => {
  const originalCrypto = ctx.wx.getRandomValues;
  let completeCrypto;
  ctx.wx.getRandomValues = options => { completeCrypto = () => originalCrypto(options); };
  const creating = application.services.createPractice(practiceInput);
  const rejectedCreate = assert.rejects(creating, /登录状态已变化/);
  application.logout(); completeCrypto(); await rejectedCreate;
  assert.equal(store.has('bhe:installation:v1'), false);
  assert.equal(requests.length, 0);

  store.set('bhe:installation:v1', 'ab'.repeat(32));
  const mutating = application.services.createPractice(practiceInput);
  const rejectedMutation = assert.rejects(mutating, /登录状态已变化/);
  await flush(); application.logout(); completeCrypto(); await rejectedMutation;
  assert.equal([...store.keys()].some(key => key.startsWith('bhe:operation:')), false);
  assert.equal(requests.length, 0);

  ctx.wx.getRandomValues = originalCrypto;
  store.set('bhe:age', true);
  let completeLogin;
  response = options => { completeLogin = () => options.success({ statusCode: 200, data: { userId: id, kind: 'registered', remainingFreePractices: 3 } }); };
  const loggingIn = application.services.login('reader@example.com', 'test-password');
  const rejectedLogin = assert.rejects(loggingIn, /登录状态已变化/);
  await flush(); application.logout(); completeLogin(); await rejectedLogin;
  assert.equal(store.has('bhe:user'), false);
  assert.equal(store.has('bhe:installation:v1'), false);
});
const article = (id, source, category) => ({ id, titleEn: 'Read the world', titleZh: '读世界', source, category, minutes: 8, wordCount: 400, image: 'https://example.com/image.jpg', summaryZh: '真实文章摘要', keyPointsZh: [], level: '雅思 6.5', section: 'today', publishedAt: '2026-09-30', hasAudio: false });
test('filters change discovery while the native daily card still opens its overview', async () => {
  const hero = article('remote-daily-feature', 'BBC', '自然');
  response = options => options.success({ statusCode: 200, data: { featuredArticleId: hero.id, articles: [hero, article('remote-tech-article', 'The Economist', '科技')] } });
  const home = page('home'); home.onShow(); await flush();
  assert.equal(home.data.articles.length, 1);
  home.filter({ currentTarget: { dataset: { field: 'topic', value: '科技' } } });
  home.filter({ currentTarget: { dataset: { field: 'publication', value: 'The Economist' } } });
  assert.equal(home.data.hero.id, hero.id);
  home.openArticle({ currentTarget: { dataset: { id: hero.id } } });
  assert.equal(pages.at(-1), '/pages/article/index?id=remote-daily-feature&source=editorial');
  home.onUnload();
});
test('late network responses do not update an unloaded native page', async () => {
  let resolve; response = options => { resolve = () => options.success({ statusCode: 200, data: { articles: [article('remote-one-article', 'BBC', '自然')] } }); };
  const home = page('home'); home.onShow(); home.onUnload(); resolve(); await flush();
  assert.equal(home.data.hero, null);
});
test('smart practice submits FSRS selection without exposing or sending a custom word list', async () => {
  store.set('bhe:age', true);
  const setup = page('practice'); setup.createPractice(); await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0].data)), practiceInput);
  assert.equal(pages.at(-1), `/pages/generating/index?id=${id}`);
  setup.onUnload();
});
test('all native routes and WXML expressions are present, with no unsupported calls or HTML tags', () => {
  const manifest = JSON.parse(readFileSync(path.join(root, 'dist/app.json'), 'utf8'));
  assert.equal(manifest.pages.length, 19); assert.equal(manifest.tabBar.custom, true);
  for (const route of manifest.pages) for (const extension of ['js', 'json', 'wxml', 'wxss']) assert.equal(existsSync(path.join(root, 'dist', `${route}.${extension}`)), true);
  const template = readFileSync(path.join(root, 'dist/lib/screen.wxml'), 'utf8');
  assert.equal(/<(?:br|div|span|a|html|body)\b/u.test(template), false);
  for (const [, expression] of template.matchAll(/\{\{([\s\S]*?)\}\}/gu)) {
    const decoded = expression.replace(/&amp;/gu, '&').replace(/&lt;/gu, '<').replace(/&gt;/gu, '>');
    new vm.Script(`(${decoded})`);
    assert.equal(/\b\w+\.\w+\s*\(/u.test(decoded), false);
  }
  for (const [, condition] of template.matchAll(/wx:if="([^"]+)"/gu)) assert.equal(condition.startsWith('{{'), true);
});
test('local calendar crosses year boundary, ignores future days and splits real time at midnight', () => {
  ctx.module = { exports: {} }; vm.runInContext(transformSync(readFileSync(path.join(root, 'src/model.ts'), 'utf8'), { loader: 'ts', format: 'cjs' }).code, ctx);
  const model = ctx.module.exports; const grid = model.heatmap({ '2026-12-31': 660_000 }, new Date(2027, 0, 2));
  assert.equal(grid.length, 13); assert.equal(grid.flatMap(week => week.days).length, 91);
  assert.equal(grid[0].days[0].key, '2026-10-04');
  assert.equal(grid.flatMap(week => week.days).find(day => day.key === '2026-12-31').minutes, 11);
  assert.equal(model.utf8Bytes('英文🌏'), Buffer.byteLength('英文🌏'));
  ctx.require = () => model; ctx.module = { exports: {} };
  vm.runInContext(transformSync(readFileSync(path.join(root, 'src/storage.ts'), 'utf8'), { loader: 'ts', format: 'cjs' }).code, ctx);
  const start = new Date(2026, 8, 30, 23, 59, 59).getTime();
  ctx.module.exports.recordStudy(start, start + 2000);
  const totals = store.get('bhe:local:guest:study');
  assert.equal(totals['2026-09-30'], 1000);
  assert.equal(totals['2026-10-01'], 1000);
});
