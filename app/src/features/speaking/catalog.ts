import type { SpeakingMaterial, SpeakingStore } from './model';
import fixture from '../../../assets/speaking/catalog.json';

export const speakingCatalog: SpeakingMaterial[] = fixture.materials.map(material => ({ ...material, origin: 'platform', mediaType: 'audio' }));
const sources: Record<string, number> = {
  curiosity: require('../../../assets/speaking/curiosity.wav'),
  conversation: require('../../../assets/speaking/conversation.wav'),
  'small-steps': require('../../../assets/speaking/small-steps.wav'),
};
export const speakingSource = (id: string) => sources[id];
export const speakingSourceLabel = (material: SpeakingMaterial) =>
  material.origin === 'file' ? '我的文件' : material.mediaType === 'video' ? '影片原声' : '原创合成示范音';
export const speakingCategories = ['日常表达', '访谈对话', '演讲片段', '电影对白'];
export function speakingMaterials(store: SpeakingStore): SpeakingMaterial[] {
  const materials = new Map(speakingCatalog.map(material => [material.id, material]));
  for (const material of store.cloudMaterials.filter(item => item.origin === 'platform')) materials.set(material.id, material);
  for (const material of store.files.filter(item => item.origin === 'file')) materials.set(material.id, material);
  return [...materials.values()].map(material => {
    const override = store.localSubtitleOverrides[material.id];
    return { ...material, cues: override ?? store.cues[material.id] ?? material.cues,
      ...(override ? { cueCount: override.length, summary: false } : {}) };
  });
}
