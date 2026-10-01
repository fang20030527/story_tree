import { z } from 'zod';
import { SpeakingCueSchema } from '@context-reader/contracts';

export { SpeakingCueSchema };
export type SpeakingCue = z.infer<typeof SpeakingCueSchema>;
export const SpeakingMaterialSchema = z.object({
  id: z.string(), title: z.string(), subtitle: z.string(), category: z.string(),
  origin: z.enum(['platform', 'file']), mediaType: z.enum(['audio', 'video']),
  mediaId: z.string().optional(), duration: z.number().finite().nonnegative(),
  cues: z.array(SpeakingCueSchema), createdAt: z.string().optional(),
  storage: z.literal('cloud').optional(), assetId: z.string().uuid().optional(),
  videoId: z.string().optional(), revision: z.number().int().positive().optional(),
  cueCount: z.number().int().nonnegative().optional(), summary: z.boolean().optional(),
}).strict();
export type SpeakingMaterial = z.infer<typeof SpeakingMaterialSchema>;
export const SpeakingSessionSchema = z.object({
  id: z.string(), materialId: z.string(), title: z.string(), date: z.string(),
  elapsedMs: z.number().finite().nonnegative(), cueCount: z.number().int().nonnegative(),
  cloudPending: z.boolean().optional(),
  position: z.number().finite().nonnegative().optional(),
}).strict();
export type SpeakingSession = z.infer<typeof SpeakingSessionSchema>;
export const SpeakingStoreSchema = z.object({
  files: z.array(SpeakingMaterialSchema),
  cues: z.record(z.string(), z.array(SpeakingCueSchema)),
  saved: z.record(z.string(), z.array(z.string())),
  notes: z.record(z.string(), z.record(z.string(), z.string())),
  positions: z.record(z.string(), z.number().finite().nonnegative()),
  history: z.array(SpeakingSessionSchema),
  recordings: z.record(z.string(), z.object({ mediaId: z.string(), durationMs: z.number().nonnegative(), cueId: z.string(), assetId: z.string().uuid().optional(), cloudPending: z.boolean().optional() }).strict()).default({}),
  cloudMaterials: z.array(SpeakingMaterialSchema).default([]),
  cloudStateRevisions: z.record(z.string(), z.number().int().nonnegative()).default({}),
  localSubtitleOverrides: z.record(z.string(), z.array(SpeakingCueSchema)).default({}),
}).strict();
export type SpeakingStore = z.infer<typeof SpeakingStoreSchema>;
export const emptySpeakingStore = (): SpeakingStore => ({ files: [], cues: {}, saved: {}, notes: {}, positions: {}, history: [], recordings: {}, cloudMaterials: [], cloudStateRevisions: {}, localSubtitleOverrides: {} });
export const isRemoteSpeakingMaterial = (material: SpeakingMaterial) =>
  (material.origin === 'platform' && material.mediaType === 'video') || (material.origin === 'file' && material.storage === 'cloud');
export const speakingId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
export function formatSpeakingTime(seconds: number) {
  const time = Math.floor(Number.isFinite(seconds) ? Math.max(0, seconds) : 0);
  const hours = Math.floor(time / 3600);
  return `${hours ? `${String(hours).padStart(2, '0')}:` : ''}${String(Math.floor(time / 60) % 60).padStart(2, '0')}:${String(time % 60).padStart(2, '0')}`;
}
export function currentCueIndex(cues: SpeakingCue[], seconds: number) {
  return Math.max(0, cues.findLastIndex(cue => cue.start <= seconds));
}
