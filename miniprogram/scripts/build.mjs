import { build } from 'esbuild';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const workspace = path.resolve(root, '..');
const local = path.join(root, 'config.local.json');
let config = { apiOrigin: '', appid: '', allowLocalHttp: false };
if (existsSync(local)) config = { ...config, ...JSON.parse(await readFile(local, 'utf8')) };
if (!config.apiOrigin && existsSync(path.join(workspace, 'app/.env'))) {
  const env = await readFile(path.join(workspace, 'app/.env'), 'utf8');
  const value = env.match(/^EXPO_PUBLIC_API_BASE_URL\s*=\s*(.+?)\s*$/mu)?.[1];
  if (value) config.apiOrigin = value.replace(/^['"]|['"]$/gu, '');
}
if (!config.apiOrigin) config = { ...JSON.parse(await readFile(path.join(root, 'config.example.json'), 'utf8')), ...config, apiOrigin: 'https://api.blackholeenglish.com' };
const origin = new URL(config.apiOrigin);
if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || (origin.protocol !== 'https:' && !(config.allowLocalHttp && origin.protocol === 'http:'))) {
  throw new Error('请在 config.local.json 配置无路径的 HTTPS apiOrigin；本地 HTTP 需显式设置 allowLocalHttp。');
}
const output = path.join(root, 'dist');
await mkdir(path.join(output, 'lib'), { recursive: true });
const define = { __API_ORIGIN__: JSON.stringify(origin.origin) };
await build({ stdin: { contents: "import URL from 'core-js-pure/actual/url'; globalThis.URL = URL; require('./src/app.ts');", resolveDir: root }, bundle: true, platform: 'neutral', format: 'cjs', target: 'es2020', outfile: path.join(output, 'app.js'), define, minify: true, legalComments: 'eof' });
await build({ entryPoints: [path.join(root, 'src/controller.ts')], bundle: true, platform: 'neutral', format: 'cjs', target: 'es2020', outfile: path.join(output, 'lib/controller.js'), minify: true, legalComments: 'eof' });
const pages = ['home', 'shelf', 'words', 'profile', 'article', 'reader', 'vocabulary', 'practice', 'generating', 'topics', 'quiz', 'result', 'import', 'import-preview', 'login', 'settings', 'vip', 'guide', 'recent'];
const titles = { home: '外刊', shelf: '书架', words: '词库', profile: '我的', article: '文章概述', reader: '阅读', vocabulary: '我的生词本', practice: '新建阅读练习', generating: '正在生成', topics: '阅读练习', quiz: '语境自测', result: '学习结果', import: '导入文章', 'import-preview': '确认文章', login: '登录黑洞英语', settings: '设置', vip: '开通 VIP', guide: '功能指南', recent: '最近阅读' };
for (const page of pages) {
  const dir = path.join(output, 'pages', page); await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'index.js'), `require('../../lib/controller').registerPage('${page}');\n`);
  await writeFile(path.join(dir, 'index.wxml'), '<include src="../../lib/screen.wxml" />\n');
  await writeFile(path.join(dir, 'index.json'), JSON.stringify({ navigationBarTitleText: titles[page], enablePullDownRefresh: ['home', 'shelf', 'words', 'profile', 'vocabulary', 'recent'].includes(page), ...(pages.indexOf(page) < 4 ? { navigationStyle: 'custom' } : {}) }));
  await writeFile(path.join(dir, 'index.wxss'), '');
}
await copyFile(path.join(root, 'src/screen.wxml'), path.join(output, 'lib/screen.wxml'));
await copyFile(path.join(root, 'src/app.wxss'), path.join(output, 'app.wxss'));
await mkdir(path.join(output, 'assets'), { recursive: true });
await copyFile(path.join(workspace, 'app/assets/images/icon.png'), path.join(output, 'assets/logo.png'));
await writeFile(path.join(output, 'app.json'), JSON.stringify({ pages: pages.map(page => `pages/${page}/index`), window: { navigationBarBackgroundColor: '#FBFAF6', navigationBarTextStyle: 'black', backgroundColor: '#FBFAF6' }, tabBar: { custom: true, color: '#6E7366', selectedColor: '#B53720', backgroundColor: '#FBFAF6', list: pages.slice(0, 4).map(page => ({ pagePath: `pages/${page}/index`, text: titles[page] })) }, lazyCodeLoading: 'requiredComponents', sitemapLocation: 'sitemap.json' }, null, 2));
await writeFile(path.join(output, 'sitemap.json'), JSON.stringify({ desc: '学习工作区不公开索引', rules: [{ action: 'disallow', page: '*' }] }));
const component = path.join(output, 'custom-tab-bar'); await mkdir(component, { recursive: true });
await copyFile(path.join(root, 'src/tab-bar.wxml'), path.join(component, 'index.wxml'));
await copyFile(path.join(root, 'src/tab-bar.wxss'), path.join(component, 'index.wxss'));
await writeFile(path.join(component, 'index.json'), '{"component":true}');
await writeFile(path.join(component, 'index.js'), `Component({data:{selected:'home',dark:false,tabs:[{id:'home',label:'外刊'},{id:'shelf',label:'书架'},{id:'words',label:'词库'},{id:'profile',label:'我的'}]},methods:{switchTab(event){wx.switchTab({url:'/pages/'+event.currentTarget.dataset.id+'/index'});}}});\n`);
const project = JSON.parse(await readFile(path.join(root, 'project.config.json'), 'utf8'));
if (config.appid) project.appid = config.appid;
await writeFile(path.join(root, 'project.config.json'), JSON.stringify(project, null, 2) + '\n');
const files = await import('node:fs/promises');
async function bytes(dir) { let size = 0; for (const item of await files.readdir(dir, { withFileTypes: true })) size += item.isDirectory() ? await bytes(path.join(dir, item.name)) : (await files.stat(path.join(dir, item.name))).size; return size; }
const size = await bytes(output);
if (size > 2 * 1024 * 1024) throw new Error('小程序主包超过 2 MiB，请拆分分包');
console.log(`微信小程序已构建：${pages.length} 个原生页面，主包 ${(size / 1024).toFixed(0)} KiB。`);
