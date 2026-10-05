import { enforceRateLimit } from '../core/rate-limit';
import type { ApiEnv } from '../env';

const NOTE_INTERVAL_MS = 30 * 60_000;

/**
 * Emails MODERATION_NOTIFY_EMAIL that bottles or reports wait for review, at most once every
 * half hour, so reports get a timely answer without a mail per bottle. Unset address: no mail.
 * Never fails the request that triggered it.
 */
export async function notifyModerators(env: ApiEnv, consoleUrl: string): Promise<void> {
  const to = env.MODERATION_NOTIFY_EMAIL?.trim();
  if (!to || !env.RESEND_API_KEY || !env.PASSWORD_RESET_FROM_EMAIL) return;
  try {
    await enforceRateLimit(env, 'moderation-notify', 'all', 1, NOTE_INTERVAL_MS);
  } catch {
    return; // A note went out within the half hour.
  }
  try {
    const waiting = await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM message_bottles WHERE status = 'pending') AS pending,
      (SELECT COUNT(*) FROM message_bottle_reports WHERE resolved_at IS NULL) AS reports`)
      .first<{ pending: number; reports: number }>();
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: env.PASSWORD_RESET_FROM_EMAIL,
        to: [to],
        subject: '黑洞英语：有留言等待审核',
        text: `${waiting?.pending ?? 0} 条留言等待审核，${waiting?.reports ?? 0} 条举报还没处理。\n审核后台：${consoleUrl}\n半小时内不再重复提醒。`,
      }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error('moderation note not accepted');
  } catch {
    console.error({ errorType: 'ModerationNotifyFailed' });
  }
}
