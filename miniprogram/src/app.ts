import { services, ensureSession, logout, apiOrigin, type Services } from './api';
export interface MiniApp { services: Services; ensureSession: typeof ensureSession; logout: typeof logout; apiOrigin: string }
App<MiniApp>({ services, ensureSession, logout, apiOrigin });
