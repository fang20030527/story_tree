import { MessageBottleCursorSchema } from '@context-reader/contracts';
import { AppError } from '../../core/errors';

export const MESSAGE_BOTTLE_WINDOW_MS = 10 * 60 * 1_000;
export const MESSAGE_BOTTLE_POST_LIMIT = 5;
export const messageBottleUsernameKey = (username: string) => username.normalize('NFKC').toLowerCase();
export const encodeMessageBottleCursor = (createdAt: string, id: string) => `${createdAt}_${id}`;
export function decodeMessageBottleCursor(value: string) {
  if (!MessageBottleCursorSchema.safeParse(value).success) {
    throw new AppError('VALIDATION_ERROR', '留言分页游标无效', 400);
  }
  const [createdAt, id] = value.split('_');
  return { createdAt: new Date(createdAt!).toISOString(), id: id! };
}
export function messageBottleLoginRequired() {
  return new AppError('UNAUTHORIZED', '请先登录，再投递留言', 403);
}
export function messageBottleUsernameTaken() {
  return new AppError('STATE_CONFLICT', '这个用户名已被使用，请换一个', 409);
}
export function messageBottleUsernameChanged() {
  return new AppError('STATE_CONFLICT', '请使用账号已设置的用户名', 409);
}
export function messageBottleRateLimited() {
  return new AppError('RATE_LIMITED', '留言过于频繁，10 分钟内最多投递 5 条，请稍后再试', 429, true);
}
