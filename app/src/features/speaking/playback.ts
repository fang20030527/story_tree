export interface ShadowingPlaybackState { currentTime: number; duration: number; playing: boolean; loaded: boolean; error: string; finished: boolean }
export interface ShadowingController { play: () => void; pause: () => void; seek: (time: number) => Promise<void>; setRate: (rate: number) => void }
export const initialShadowingState: ShadowingPlaybackState = { currentTime: 0, duration: 0, playing: false, loaded: false, error: '', finished: false };
