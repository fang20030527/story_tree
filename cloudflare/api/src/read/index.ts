import type { ApiEnv } from '../env';
import { handleArticlesRoute } from './articles';
import { handleDashboardRoute } from './dashboard';

/** Returns null when the request is outside the migrated read routes. */
export async function handleReadRoute(
  request: Request,
  env: ApiEnv,
  userId: string,
): Promise<Response | null> {
  return (await handleArticlesRoute(request, env, userId))
    ?? handleDashboardRoute(request, env, userId);
}
