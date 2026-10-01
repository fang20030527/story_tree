import { AppError } from '../../../../server/src/core/errors';
import type { ApiEnv } from '../env';

/** Keep large caption validation/serialization inside the existing CPU boundary. */
export async function handleSpeakingOnCpuBoundary(request: Request, env: ApiEnv, userId: string | null): Promise<Response> {
  if (!env.CPU_BOUNDARY) throw new AppError('MEDIA_UNAVAILABLE', '口语服务暂时不可用', 503, true);
  const stub = env.CPU_BOUNDARY.getByName(userId ? `speaking-${userId}` : 'speaking-public');
  if (!stub.fetch) throw new AppError('MEDIA_UNAVAILABLE', '口语服务暂时不可用', 503, true);
  const forwarded = new Request(request);
  // Identity comes only from the outer Worker's validated bearer token.
  forwarded.headers.delete('authorization');
  forwarded.headers.delete('x-speaking-user-id');
  if (userId) forwarded.headers.set('x-speaking-user-id', userId);
  return stub.fetch(forwarded);
}
