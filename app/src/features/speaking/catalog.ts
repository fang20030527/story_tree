import type { SpeakingMaterial, SpeakingStore } from './model';
const retiredExamples = new Set(['curiosity', 'conversation', 'small-steps']);
export const speakingSourceLabel = (material: SpeakingMaterial) =>
  material.origin === 'file' ? '我的文件' : material.mediaType === 'video' ? '影片原声' : '音频原声';
export const speakingCategories = ['日常表达', '访谈对话', '演讲片段', '电影对白'];
export function speakingMaterials(store: SpeakingStore): SpeakingMaterial[] {
  const materials = new Map<string, SpeakingMaterial>();
  // 旧安装缓存可能仍包含已下架的三个占位素材。
  for (const material of store.cloudMaterials.filter(item => item.origin === 'platform' && !retiredExamples.has(item.id))) materials.set(material.id, material);
  for (const material of store.files.filter(item => item.origin === 'file')) materials.set(material.id, material);
  return [...materials.values()].map(material => {
    const override = store.localSubtitleOverrides[material.id];
    return { ...material, cues: override ?? store.cues[material.id] ?? material.cues,
      ...(override ? { cueCount: override.length, summary: false } : {}) };
  });
}
