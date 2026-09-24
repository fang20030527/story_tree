import type { ServerConfig } from '../../config/env';

export interface PasswordResetMailer {
  sendCode(email: string, code: string): Promise<void>;
}

export function createPasswordResetMailer(
  config: Pick<ServerConfig, 'RESEND_API_KEY' | 'PASSWORD_RESET_FROM_EMAIL'>,
): PasswordResetMailer | null {
  if (!config.RESEND_API_KEY || !config.PASSWORD_RESET_FROM_EMAIL) return null;

  return {
    async sendCode(email, code) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.RESEND_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: config.PASSWORD_RESET_FROM_EMAIL,
          to: [email],
          subject: '黑洞英语：重置密码验证码',
          text: `你的密码重置验证码是 ${code.slice(0, 4)} ${code.slice(4, 8)} ${code.slice(8)}。\n验证码 15 分钟内有效；若非本人操作，请忽略此邮件。`,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error('Password reset email delivery failed');
    },
  };
}
