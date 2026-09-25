import {
  AnonymousAuthRequestSchema,
  AnonymousAuthResponseSchema,
  EmailAuthRequestSchema,
  EmailAuthResponseSchema,
  PasswordResetConfirmResponseSchema,
  PasswordResetConfirmSchema,
  PasswordResetRequestResponseSchema,
  PasswordResetRequestSchema,
  WechatAuthRequestSchema,
  WechatAuthResponseSchema,
} from '@context-reader/contracts';

import type { ApiEnv } from '../env';
import { readJsonBody } from '../core/http';
import { AppError } from '../../../../server/src/core/errors';
import { getRemainingQuota, registerAnonymous, requireAuth } from './database';
import { confirmPasswordReset, issuePasswordResetCode } from './password-reset';
import { loginWithEmail, loginWithWechat } from './providers';

export { requireAuth } from './database';
export type { AuthContext } from './database';

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

export async function handleAuthRoute(
  request: Request,
  env: ApiEnv,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (
    path !== '/v1/auth/anonymous' &&
    path !== '/v1/auth/email' &&
    path !== '/v1/auth/wechat' &&
    path !== '/v1/auth/password-reset/request' &&
    path !== '/v1/auth/password-reset/confirm'
  ) return null;

  if (request.method !== 'POST') {
    throw new AppError('VALIDATION_ERROR', '不支持此请求方式', 405);
  }

  const input = await readJsonBody(request);
  if (path === '/v1/auth/anonymous') {
    const parsed = AnonymousAuthRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', '请确认已满 14 周岁', 400);
    }
    const authUser = await registerAnonymous(request, env, parsed.data.ageConfirmed14Plus);
    const remainingFreePractices = await getRemainingQuota(env.DB, authUser.userId);
    return jsonResponse(AnonymousAuthResponseSchema.parse({
      userId: authUser.userId,
      kind: 'guest',
      remainingFreePractices,
    }), authUser.created ? 201 : 200);
  }

  if (path === '/v1/auth/email') {
    const parsed = EmailAuthRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', '邮箱或密码格式无效', 400);
    }
    const current = await requireAuth(request, env);
    const authUser = await loginWithEmail(
      env, current, parsed.data.email, parsed.data.password,
    );
    const remainingFreePractices = await getRemainingQuota(env.DB, authUser.userId);
    return jsonResponse(EmailAuthResponseSchema.parse({
      userId: authUser.userId,
      kind: 'registered',
      remainingFreePractices,
    }), authUser.created ? 201 : 200);
  }

  if (path === '/v1/auth/wechat') {
    const parsed = WechatAuthRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', '微信授权码无效', 400);
    }
    const current = await requireAuth(request, env);
    const authUser = await loginWithWechat(env, current, parsed.data.code);
    const remainingFreePractices = await getRemainingQuota(env.DB, authUser.userId);
    return jsonResponse(WechatAuthResponseSchema.parse({
      userId: authUser.userId,
      kind: 'registered',
      remainingFreePractices,
    }), authUser.created ? 201 : 200);
  }

  if (path === '/v1/auth/password-reset/request') {
    const parsed = PasswordResetRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', '请输入有效的邮箱地址', 400);
    }
    await issuePasswordResetCode(env, parsed.data.email);
    return jsonResponse(PasswordResetRequestResponseSchema.parse({
      message: '如果该邮箱已注册，重置验证码将发送至邮箱',
    }));
  }

  const parsed = PasswordResetConfirmSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', '请检查邮箱、验证码和新密码', 400);
  }
  await confirmPasswordReset(
    env, parsed.data.email, parsed.data.code, parsed.data.newPassword,
  );
  return jsonResponse(PasswordResetConfirmResponseSchema.parse({
    message: '密码已重置，请重新登录',
  }));
}
