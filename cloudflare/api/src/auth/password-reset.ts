import type { ApiEnv } from '../env';
import { AppError } from '../../../../server/src/core/errors';
import { hashEmailPasswordOnCpuBoundary } from '../cpu/client';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 12;
const CODE_LIFETIME_MS = 15 * 60_000;
const REQUEST_COOLDOWN_MS = 60_000;
const REQUEST_WINDOW_MS = 60 * 60_000;
const MAX_REQUESTS_PER_WINDOW = 5;
const MAX_CODE_ATTEMPTS = 5;

interface EmailAccountRow {
  id: string;
  userId: string;
}

async function findActiveAccount(env: ApiEnv, email: string): Promise<EmailAccountRow | null> {
  return env.DB.prepare(`
    SELECT e.id, e.user_id AS userId
    FROM email_accounts AS e
    JOIN users AS u ON u.id = e.user_id
    WHERE e.email = ? AND u.deleted_at IS NULL
    LIMIT 1
  `).bind(email).first<EmailAccountRow>();
}

function createPasswordResetCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte & 31]).join('');
}

async function hashPasswordResetCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqualHex(actual: string, expected: string): boolean {
  if (actual.length !== 64 || expected.length !== 64) return false;
  let difference = 0;
  for (let index = 0; index < 64; index += 1) {
    difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

function unavailable(): AppError {
  return new AppError(
    'PASSWORD_RESET_UNAVAILABLE',
    '密码重置暂时不可用，请稍后重试',
    503,
    true,
  );
}

function invalidCode(): AppError {
  return new AppError('PASSWORD_RESET_CODE_INVALID', '验证码无效或已过期', 400);
}

function assertMailerConfigured(env: ApiEnv): asserts env is ApiEnv & {
  RESEND_API_KEY: string;
  PASSWORD_RESET_FROM_EMAIL: string;
} {
  if (!env.RESEND_API_KEY || !env.PASSWORD_RESET_FROM_EMAIL) throw unavailable();
}

async function sendCode(env: ApiEnv, email: string, code: string): Promise<void> {
  assertMailerConfigured(env);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: env.PASSWORD_RESET_FROM_EMAIL,
      to: [email],
      subject: '黑洞英语：重置密码验证码',
      text: `你的密码重置验证码是 ${code.slice(0, 4)} ${code.slice(4, 8)} ${code.slice(8)}。\n验证码 15 分钟内有效；若非本人操作，请忽略此邮件。`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error('Password reset email delivery failed');
}

export async function issuePasswordResetCode(env: ApiEnv, email: string): Promise<void> {
  assertMailerConfigured(env);
  const startedAt = Date.now();
  const normalizedEmail = email.trim().toLowerCase();
  const account = await findActiveAccount(env, normalizedEmail);
  if (account) {
    const code = createPasswordResetCode();
    const codeHash = await hashPasswordResetCode(code);
    const now = new Date();
    const nowIso = now.toISOString();
    const expiresIso = new Date(now.getTime() + CODE_LIFETIME_MS).toISOString();
    const windowCutoff = new Date(now.getTime() - REQUEST_WINDOW_MS).toISOString();
    const cooldownCutoff = new Date(now.getTime() - REQUEST_COOLDOWN_MS).toISOString();

    // One SQLite statement atomically enforces the cooldown and rolling
    // request count, including concurrent requests from separate isolates.
    const issued = await env.DB.prepare(`
      INSERT INTO email_password_resets
        (email_account_id, code_hash, created_at, expires_at,
         attempts_remaining, window_started_at, request_count)
      SELECT e.id, ?, ?, ?, ?, ?, 1
      FROM email_accounts AS e
      JOIN users AS u ON u.id = e.user_id
      WHERE e.id = ? AND u.deleted_at IS NULL
      ON CONFLICT(email_account_id) DO UPDATE SET
        code_hash = excluded.code_hash,
        created_at = excluded.created_at,
        expires_at = excluded.expires_at,
        attempts_remaining = excluded.attempts_remaining,
        window_started_at = CASE
          WHEN email_password_resets.window_started_at > ?
            THEN email_password_resets.window_started_at
          ELSE excluded.window_started_at
        END,
        request_count = CASE
          WHEN email_password_resets.window_started_at > ?
            THEN email_password_resets.request_count + 1
          ELSE 1
        END
      WHERE email_password_resets.created_at <= ?
        AND (
          email_password_resets.window_started_at <= ?
          OR email_password_resets.request_count < ?
        )
      RETURNING email_account_id
    `).bind(
      codeHash, nowIso, expiresIso, MAX_CODE_ATTEMPTS, nowIso, account.id,
      windowCutoff, windowCutoff, cooldownCutoff,
      windowCutoff, MAX_REQUESTS_PER_WINDOW,
    ).first<{ email_account_id: string }>();
    if (issued) {
      try {
        await sendCode(env, normalizedEmail, code);
      } catch {
        // Keep the response identical for known and unknown addresses.
      }
    }
  }
  const remainingMs = 750 - (Date.now() - startedAt);
  if (remainingMs > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, remainingMs));
  }
}

export async function confirmPasswordReset(
  env: ApiEnv,
  email: string,
  code: string,
  newPassword: string,
): Promise<void> {
  assertMailerConfigured(env);
  const account = await findActiveAccount(env, email.trim().toLowerCase());
  if (!account) throw invalidCode();

  const reset = await env.DB.prepare(`
    SELECT code_hash AS codeHash, expires_at AS expiresAt,
           attempts_remaining AS attemptsRemaining
    FROM email_password_resets WHERE email_account_id = ?
  `).bind(account.id).first<{
    codeHash: string;
    expiresAt: string;
    attemptsRemaining: number;
  }>();
  if (!reset || reset.expiresAt <= new Date().toISOString()
    || reset.attemptsRemaining <= 0) {
    throw invalidCode();
  }

  const actualHash = await hashPasswordResetCode(code.trim().toUpperCase());
  if (!constantTimeEqualHex(actualHash, reset.codeHash)) {
    await env.DB.prepare(`
      UPDATE email_password_resets
      SET attempts_remaining = attempts_remaining - 1
      WHERE email_account_id = ? AND code_hash = ?
        AND attempts_remaining > 0 AND expires_at > ?
    `).bind(account.id, reset.codeHash, new Date().toISOString()).run();
    throw invalidCode();
  }

  // Retain scrypt-v1 for existing clients and migrated accounts. This call is
  // intentionally not replaced with PBKDF2 or an unsalted fast hash.
  const passwordHash = await hashEmailPasswordOnCpuBoundary(env, newPassword);
  const now = new Date().toISOString();
  const results = await env.DB.batch([
    env.DB.prepare(`
      UPDATE email_accounts
      SET password_hash = ?
      WHERE id = ?
        AND EXISTS (
          SELECT 1 FROM email_password_resets
          WHERE email_account_id = ? AND code_hash = ?
            AND attempts_remaining > 0 AND expires_at > ?
        )
        AND EXISTS (
          SELECT 1 FROM users
          WHERE id = email_accounts.user_id AND deleted_at IS NULL
        )
      RETURNING user_id AS userId
    `).bind(passwordHash, account.id, account.id, reset.codeHash, now),
    env.DB.prepare(`
      UPDATE installations SET revoked_at = ?
      WHERE user_id = ? AND revoked_at IS NULL
        AND EXISTS (
          SELECT 1 FROM email_accounts
          WHERE id = ? AND user_id = ? AND password_hash = ?
        )
    `).bind(now, account.userId, account.id, account.userId, passwordHash),
    env.DB.prepare(`
      DELETE FROM email_password_resets
      WHERE email_account_id = ? AND code_hash = ?
        AND EXISTS (
          SELECT 1 FROM email_accounts
          WHERE id = ? AND password_hash = ?
        )
    `).bind(account.id, reset.codeHash, account.id, passwordHash),
  ]) as Array<{ results?: Array<{ userId: string }> }>;
  if (!results[0]?.results?.[0]) throw invalidCode();
}
