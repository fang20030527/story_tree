import type { SpeakingMaterial, SpeakingStore } from './model';
import { speakingSeriesId, speakingSeriesSearchText } from './series';
import { speakingPodcastId, speakingPodcastSearchText } from './podcasts';
const retiredExamples = new Set(['curiosity', 'conversation', 'small-steps']);
export const speakingSourceLabel = (material: SpeakingMaterial) =>
  material.origin === 'file' ? '我的文件' : material.category === '播客' ? '播客原声'
    : material.mediaType === 'video' ? '影片原声' : '音频原声';
export const speakingSectionTitle = (category: string) =>
  category.trim() === '电影对白' ? '电影' : category.trim();
const speakingSectionOrder = ['日常表达', '访谈对话', '演讲片段', '电影', '美剧/英剧', '播客'];

/** 未分组栏目的首页预览；电视剧、播客分别按剧和节目呈现入口。 */
export function speakingSectionPreview(materials: SpeakingMaterial[], limit: number): SpeakingMaterial[] {
  const seen = new Set<string>();
  return materials.filter(material => {
    const group = material.category === '美剧/英剧' ? speakingSeriesId(material.id)
      : material.category === '播客' ? speakingPodcastId(material.id) : undefined;
    const key = group ?? material.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}

export function speakingSections(materials: SpeakingMaterial[], query = '') {
  const keyword = query.trim().toLowerCase();
  const sections = new Map<string, SpeakingMaterial[]>();
  for (const material of materials) {
    if (material.origin !== 'platform') continue;
    const title = speakingSectionTitle(material.category) || '其他素材';
    const seriesTitle = title === '美剧/英剧' ? speakingSeriesSearchText(material) : '';
    const podcastTitle = title === '播客' ? speakingPodcastSearchText(material) : '';
    if (!`${material.title} ${material.subtitle} ${title} ${seriesTitle} ${podcastTitle}`.toLowerCase().includes(keyword)) continue;
    const items = sections.get(title) ?? [];
    items.push(material);
    sections.set(title, items);
  }
  // 已有栏目保持固定顺序，新栏目按目录中的首次出现顺序接在后面。
  const titles = [...speakingSectionOrder, ...[...sections.keys()].filter(title => !speakingSectionOrder.includes(title))];
  return titles.flatMap(title => {
    const items = sections.get(title);
    return items ? [{ title, materials: items }] : [];
  });
}

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
