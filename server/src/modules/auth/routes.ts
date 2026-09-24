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
import type { FastifyPluginAsync, preHandlerHookHandler } from 'fastify';

import type { ServerConfig } from '../../config/env';
import { AppError } from '../../core/errors';
import type { AppDatabase } from '../../db/client';
import { getRemainingQuota } from '../quota/service';
import {
  authenticateInstallation,
  loginWithEmail,
  loginWithWechat,
  registerAnonymous,
} from './service';
import { parseBearerToken } from './token';
import { confirmPasswordReset, issuePasswordResetCode } from './password-reset';
import {
  createPasswordResetMailer,
  type PasswordResetMailer,
} from './password-reset-mailer';
import {
  createWechatClient,
  type WechatClient,
} from './wechat-client';

export interface AuthRoutesOptions {
  config: ServerConfig;
  db: AppDatabase;
  wechatClient?: WechatClient;
  passwordResetMailer?: PasswordResetMailer;
}

export function requireAuth(db: AppDatabase): preHandlerHookHandler {
  return async (request) => {
    const token = parseBearerToken(request.headers.authorization);
    request.authUser = await authenticateInstallation(db, token);
  };
}

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (
  app,
  options,
) => {
  const wechatClient =
    options.wechatClient ??
    createWechatClient({
      appId: options.config.WECHAT_APP_ID,
      appSecret: options.config.WECHAT_APP_SECRET,
      baseUrl: options.config.WECHAT_API_BASE_URL,
      timeoutMs: options.config.WECHAT_TIMEOUT_MS,
    });
  const passwordResetMailer = options.passwordResetMailer ??
    createPasswordResetMailer(options.config);

  app.post('/v1/auth/anonymous', async (request, reply) => {
    const parsed = AnonymousAuthRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', '请确认已满 14 周岁', 400);
    }

    const token = parseBearerToken(request.headers.authorization);
    const authUser = await registerAnonymous(
      options.db,
      token,
      parsed.data.ageConfirmed14Plus,
    );
    const remainingFreePractices = await getRemainingQuota(
      options.db,
      authUser.userId,
      options.config.freePracticeLimit,
    );
    const body = AnonymousAuthResponseSchema.parse({
      userId: authUser.userId,
      kind: 'guest',
      remainingFreePractices,
    });

    return reply.status(authUser.created ? 201 : 200).send(body);
  });

  app.post('/v1/auth/email', async (request, reply) => {
    const parsed = EmailAuthRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', '邮箱或密码格式无效', 400);
    }

    const token = parseBearerToken(request.headers.authorization);
    const current = await authenticateInstallation(options.db, token);
    const authUser = await loginWithEmail(
      options.db,
      current,
      parsed.data.email,
      parsed.data.password,
    );
    const remainingFreePractices = await getRemainingQuota(
      options.db,
      authUser.userId,
      options.config.freePracticeLimit,
    );
    const body = EmailAuthResponseSchema.parse({
      userId: authUser.userId,
      kind: 'registered',
      remainingFreePractices,
    });

    return reply.status(authUser.created ? 201 : 200).send(body);
  });

  app.post('/v1/auth/password-reset/request', async (request, reply) => {
    const parsed = PasswordResetRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', '请输入有效的邮箱地址', 400);
    }
    if (!passwordResetMailer) {
      throw new AppError(
        'PASSWORD_RESET_UNAVAILABLE', '密码重置暂时不可用，请稍后重试', 503, true,
      );
    }

    const startedAt = Date.now();
    const issued = await issuePasswordResetCode(options.db, parsed.data.email);
    if (issued) {
      try {
        await passwordResetMailer.sendCode(issued.email, issued.code);
      } catch {
        request.log.warn({ errorType: 'PasswordResetDeliveryFailure' }, 'Password reset delivery failed');
      }
    }
    await waitForMinimumDuration(startedAt, 750);
    reply.header('cache-control', 'no-store');
    return reply.status(200).send(PasswordResetRequestResponseSchema.parse({
      message: '如果该邮箱已注册，重置验证码将发送至邮箱',
    }));
  });

  app.post('/v1/auth/password-reset/confirm', async (request, reply) => {
    const parsed = PasswordResetConfirmSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', '请检查邮箱、验证码和新密码', 400);
    }
    if (!passwordResetMailer) {
      throw new AppError(
        'PASSWORD_RESET_UNAVAILABLE', '密码重置暂时不可用，请稍后重试', 503, true,
      );
    }
    await confirmPasswordReset(
      options.db,
      parsed.data.email,
      parsed.data.code,
      parsed.data.newPassword,
    );
    reply.header('cache-control', 'no-store');
    return reply.status(200).send(PasswordResetConfirmResponseSchema.parse({
      message: '密码已重置，请重新登录',
    }));
  });

  app.post('/v1/auth/wechat', async (request, reply) => {
    const parsed = WechatAuthRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', '微信授权码无效', 400);
    }

    const token = parseBearerToken(request.headers.authorization);
    const current = await authenticateInstallation(options.db, token);
    const authUser = await loginWithWechat(
      options.db,
      current,
      parsed.data.code,
      wechatClient,
    );
    const remainingFreePractices = await getRemainingQuota(
      options.db,
      authUser.userId,
      options.config.freePracticeLimit,
    );
    const body = WechatAuthResponseSchema.parse({
      userId: authUser.userId,
      kind: 'registered',
      remainingFreePractices,
    });

    return reply.status(authUser.created ? 201 : 200).send(body);
  });
};

async function waitForMinimumDuration(startedAt: number, minimumMs: number): Promise<void> {
  const remainingMs = minimumMs - (Date.now() - startedAt);
  if (remainingMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, remainingMs));
  }
}
