import { UuidSchema } from '@context-reader/contracts';

import { AppError } from '../../../../server/src/core/errors';
import { getClientIp } from '../core/client-ip';
import { enforceRateLimit } from '../core/rate-limit';
import type { ApiEnv } from '../env';

// The moderation console: one page plus a small JSON API, all behind the ADMIN_TOKEN Worker
// secret (unset: every path here is a 404). It lists bottles waiting for review, reported and
// hidden ones, and lets the moderator approve, hide or delete a bottle and ban its author.

const PAGE_PATH = '/v1/admin/moderation';
const LIST_PATH = '/v1/admin/message-bottles';
const BOTTLE_ACTION = /^\/v1\/admin\/message-bottles\/([^/]+)\/(approve|hide|delete)$/u;
const USER_ACTION = /^\/v1\/admin\/users\/([^/]+)\/(ban|unban)$/u;
const VIEWS = {
  pending: "bottle.status = 'pending'",
  reported: 'EXISTS (SELECT 1 FROM message_bottle_reports AS open WHERE open.bottle_id = bottle.id AND open.resolved_at IS NULL)',
  hidden: "bottle.status = 'hidden'",
  recent: '1 = 1',
} as const;
const PAGE_SIZE = 50;
const FAILED_LOGINS_PER_TEN_MINUTES = 20;

interface BottleRow {
  id: string; content: string; createdAt: string; status: string; reviewedAt: string | null;
  authorId: string; username: string | null; kind: string; bannedAt: string | null;
}
interface ReportRow { bottleId: string; reason: string; detail: string | null; createdAt: string }

const json = (body: unknown) => Response.json(body, { headers: { 'cache-control': 'no-store' } });

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

/** Compares digests, so neither the token's length nor a matching prefix shows in the timing. */
async function sameSecret(provided: string, expected: string): Promise<boolean> {
  const [left, right] = await Promise.all([digest(provided), digest(expected)]);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index]! ^ right[index]!;
  return difference === 0;
}

function consoleEnabled(env: ApiEnv): string {
  const token = env.ADMIN_TOKEN?.trim();
  if (!token || token.length < 24) throw new AppError('NOT_FOUND', '资源不存在', 404);
  return token;
}

async function requireModerator(request: Request, env: ApiEnv): Promise<void> {
  const expected = consoleEnabled(env);
  const provided = /^Bearer (.+)$/u.exec(request.headers.get('authorization') ?? '')?.[1] ?? '';
  if (await sameSecret(provided, expected)) return;
  // Only failures count, so guessing the token is slow while normal use is not limited.
  await enforceRateLimit(env, 'admin-login', await getClientIp(request, env), FAILED_LOGINS_PER_TEN_MINUTES, 600_000);
  throw new AppError('UNAUTHORIZED', '审核口令无效', 401);
}

function idOf(raw: string): string {
  if (!UuidSchema.safeParse(raw).success) throw new AppError('NOT_FOUND', '资源不存在', 404);
  return raw;
}

async function listBottles(url: URL, env: ApiEnv): Promise<Response> {
  const view = url.searchParams.get('view') ?? 'pending';
  if (!(view in VIEWS)) throw new AppError('VALIDATION_ERROR', '列表类型无效', 400);
  const rows = (await env.DB.prepare(`
    SELECT bottle.id, bottle.content, bottle.created_at AS createdAt, bottle.status, bottle.reviewed_at AS reviewedAt,
      author.id AS authorId, COALESCE(author.username, bottle.username) AS username, author.kind,
      moderation.posting_banned_at AS bannedAt
    FROM message_bottles AS bottle
    JOIN users AS author ON author.id = bottle.user_id
    LEFT JOIN user_moderation AS moderation ON moderation.user_id = author.id
    WHERE ${VIEWS[view as keyof typeof VIEWS]}
    ORDER BY bottle.created_at DESC, bottle.id DESC LIMIT ?
  `).bind(PAGE_SIZE).all<BottleRow>()).results;
  const reports = rows.length === 0 ? [] : (await env.DB.prepare(`
    SELECT bottle_id AS bottleId, reason, detail, created_at AS createdAt
    FROM message_bottle_reports
    WHERE resolved_at IS NULL AND bottle_id IN (SELECT value FROM json_each(?))
    ORDER BY created_at
  `).bind(JSON.stringify(rows.map((row) => row.id))).all<ReportRow>()).results;
  return json({
    view,
    items: rows.map((row) => ({
      id: row.id, content: row.content, createdAt: row.createdAt, status: row.status, reviewedAt: row.reviewedAt,
      author: { id: row.authorId, username: row.username, registered: row.kind === 'registered', banned: row.bannedAt !== null },
      reports: reports.filter((report) => report.bottleId === row.id)
        .map(({ reason, detail, createdAt }) => ({ reason, detail, createdAt })),
    })),
  });
}

export async function bottleAction(env: ApiEnv, id: string, action: 'approve' | 'hide' | 'delete'): Promise<Response> {
  const exists = await env.DB.prepare('SELECT id FROM message_bottles WHERE id = ?').bind(id).first();
  if (!exists) throw new AppError('NOT_FOUND', '留言不存在', 404);
  const now = new Date().toISOString();
  if (action === 'delete') {
    await env.DB.prepare('DELETE FROM message_bottles WHERE id = ?').bind(id).run();
  } else {
    await env.DB.batch([
      env.DB.prepare('UPDATE message_bottles SET status = ?, reviewed_at = ? WHERE id = ?')
        .bind(action === 'approve' ? 'visible' : 'hidden', now, id),
      env.DB.prepare('UPDATE message_bottle_reports SET resolved_at = ? WHERE bottle_id = ? AND resolved_at IS NULL')
        .bind(now, id),
    ]);
  }
  return json({ ok: true });
}

export async function userAction(env: ApiEnv, id: string, action: 'ban' | 'unban'): Promise<Response> {
  const exists = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(id).first();
  if (!exists) throw new AppError('NOT_FOUND', '账号不存在', 404);
  const now = new Date().toISOString();
  const statements = [env.DB.prepare(`
    INSERT INTO user_moderation (user_id, posting_banned_at, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET posting_banned_at = excluded.posting_banned_at, updated_at = excluded.updated_at
  `).bind(id, action === 'ban' ? now : null, now)];
  if (action === 'ban') {
    // A ban takes the author's other bottles down too; each can still be approved again.
    statements.push(env.DB.prepare(`UPDATE message_bottles SET status = 'hidden', reviewed_at = ?
      WHERE user_id = ? AND status <> 'hidden'`).bind(now, id));
    statements.push(env.DB.prepare(`UPDATE message_bottle_reports SET resolved_at = ?
      WHERE resolved_at IS NULL AND bottle_id IN (SELECT id FROM message_bottles WHERE user_id = ?)`).bind(now, id));
  }
  await env.DB.batch(statements);
  return json({ ok: true });
}

export async function handleModerationRoute(request: Request, env: ApiEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/v1/admin/')) return null;
  if (url.pathname === PAGE_PATH) {
    if (request.method !== 'GET') throw new AppError('VALIDATION_ERROR', '不支持此请求方式', 405);
    consoleEnabled(env);
    return moderationPage();
  }
  await requireModerator(request, env);
  if (url.pathname === LIST_PATH && request.method === 'GET') return listBottles(url, env);
  const bottle = BOTTLE_ACTION.exec(url.pathname);
  if (bottle && request.method === 'POST') {
    return bottleAction(env, idOf(bottle[1]!), bottle[2] as 'approve' | 'hide' | 'delete');
  }
  const user = USER_ACTION.exec(url.pathname);
  if (user && request.method === 'POST') return userAction(env, idOf(user[1]!), user[2] as 'ban' | 'unban');
  throw new AppError('NOT_FOUND', '资源不存在', 404);
}

function moderationPage(): Response {
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>留言审核</title>
<style nonce="${nonce}">
:root{--bg:#f6f3ec;--card:#fff;--text:#1c1b19;--muted:#6b665d;--line:#e2ddd2;--accent:#b4442c;--ok:#2f6b3a}
@media (prefers-color-scheme:dark){:root{--bg:#121212;--card:#1d1d1b;--text:#ece8df;--muted:#a39d91;--line:#34322e;--accent:#e0775c;--ok:#7cc18a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
main{max-width:760px;margin:0 auto;padding:20px 16px 48px}h1{font-size:22px;margin:0 0 4px}p.hint{color:var(--muted);margin:0 0 16px}
.tabs{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 16px}button{font:inherit;border:1px solid var(--line);background:var(--card);color:var(--text);border-radius:999px;padding:6px 14px;cursor:pointer}
button.active{background:var(--text);color:var(--bg)}button.danger{color:var(--accent)}button.ok{color:var(--ok)}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin-bottom:10px}
.meta{color:var(--muted);font-size:13px;display:flex;gap:10px;flex-wrap:wrap}.content{white-space:pre-wrap;word-break:break-word;margin:8px 0}
.reports{font-size:13px;color:var(--accent);margin:6px 0}.actions{display:flex;gap:8px;flex-wrap:wrap}
input{font:inherit;padding:8px 12px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--text);width:100%;max-width:420px}
#login{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.status{font-weight:600}
</style></head><body><main>
<h1>留言审核</h1><p class="hint">待审核的留言通过后才公开；被 3 人举报的留言会自动隐藏，等你处理。</p>
<form id="login"><input id="token" type="password" autocomplete="off" placeholder="审核口令（ADMIN_TOKEN）"><button type="submit">进入</button></form>
<div id="panel" hidden>
<div class="tabs" id="tabs"><button data-view="pending">待审核</button><button data-view="reported">被举报</button><button data-view="hidden">已隐藏</button><button data-view="recent">最近留言</button><button id="logout">退出</button></div>
<p class="hint" id="message"></p><div id="list"></div></div>
</main><script nonce="${nonce}">
const KEY='bhe-moderation-token';const reasons={spam:'垃圾广告',abuse:'辱骂骚扰',sexual:'色情低俗',illegal:'违法违规',other:'其他'};
const statuses={visible:'公开',pending:'待审核',hidden:'已隐藏'};let view='pending';
const $=(id)=>document.getElementById(id);
function token(){try{return sessionStorage.getItem(KEY)}catch{return null}}
function show(loggedIn){$('login').hidden=loggedIn;$('panel').hidden=!loggedIn}
async function api(path,method){const response=await fetch(path,{method:method||'GET',headers:{authorization:'Bearer '+token()}});
if(response.status===401){try{sessionStorage.removeItem(KEY)}catch{}show(false);throw new Error('口令无效，请重新输入')}
if(!response.ok){const body=await response.json().catch(()=>null);throw new Error(body&&body.error?body.error.message:'请求失败')}return response.json()}
function el(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node}
function button(label,className,run){const node=el('button',label,className);node.type='button';node.addEventListener('click',async()=>{node.disabled=true;try{await run();await load()}catch(error){$('message').textContent=error.message;node.disabled=false}});return node}
async function load(){$('message').textContent='正在读取…';for(const tab of document.querySelectorAll('[data-view]'))tab.classList.toggle('active',tab.dataset.view===view);
try{const data=await api('/v1/admin/message-bottles?view='+view);const list=$('list');list.replaceChildren();
$('message').textContent=data.items.length?'共 '+data.items.length+' 条（最多显示 50 条）':'这里没有留言';
for(const item of data.items){const card=el('div',undefined,'card');const meta=el('div',undefined,'meta');
meta.append(el('span',item.author.username||'（无用户名）'),el('span',new Date(item.createdAt).toLocaleString('zh-CN')),el('span',statuses[item.status]||item.status,'status'));
if(item.author.banned)meta.append(el('span','作者已禁言'));card.append(meta,el('div',item.content,'content'));
if(item.reports.length){const reports=el('div',undefined,'reports');reports.textContent='举报 '+item.reports.length+' 次：'+item.reports.map((report)=>reasons[report.reason]+(report.detail?'（'+report.detail+'）':'')).join('；');card.append(reports)}
const actions=el('div',undefined,'actions');
if(item.status!=='visible'||item.reports.length)actions.append(button(item.status==='visible'?'驳回举报':'通过并公开','ok',()=>api('/v1/admin/message-bottles/'+item.id+'/approve','POST')));
if(item.status!=='hidden')actions.append(button('隐藏','danger',()=>api('/v1/admin/message-bottles/'+item.id+'/hide','POST')));
actions.append(button('删除','danger',async()=>{if(confirm('永久删除这条留言？'))await api('/v1/admin/message-bottles/'+item.id+'/delete','POST')}));
actions.append(item.author.banned?button('解除禁言',undefined,()=>api('/v1/admin/users/'+item.author.id+'/unban','POST'))
:button('禁言作者并隐藏其留言','danger',async()=>{if(confirm('禁言后对方不能再发布留言，其全部留言也会隐藏。确定？'))await api('/v1/admin/users/'+item.author.id+'/ban','POST')}));
card.append(actions);list.append(card)}}catch(error){$('message').textContent=error.message}}
$('login').addEventListener('submit',(event)=>{event.preventDefault();try{sessionStorage.setItem(KEY,$('token').value.trim())}catch{}$('token').value='';show(true);load()});
$('tabs').addEventListener('click',(event)=>{const target=event.target.closest('[data-view]');if(target){view=target.dataset.view;load()}});
$('logout').addEventListener('click',()=>{try{sessionStorage.removeItem(KEY)}catch{}show(false)});
if(token()){show(true);load()}else show(false);
</script></body></html>`;
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      'referrer-policy': 'no-referrer',
      'x-frame-options': 'DENY',
    },
  });
}
