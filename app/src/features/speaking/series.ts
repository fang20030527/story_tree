import type { SpeakingMaterial } from './model';

/** 剧名与口音属于电视剧；季、集编号属于各个跟读素材。 */
const series: Readonly<Record<string, { title: string; englishTitle: string; accent: string }>> = {
  friends: { title: '老友记', englishTitle: 'Friends', accent: '美式' },
  'rick-and-morty': { title: '瑞克和莫蒂', englishTitle: 'Rick and Morty', accent: '美式' },
};

export function speakingSeriesId(id: string): string | undefined {
  return /^(.*)-s\d+e\d+$/iu.exec(id)?.[1] || undefined;
}

export function speakingSeriesAccent(id: string): string | undefined {
  const seriesId = speakingSeriesId(id);
  return seriesId ? series[seriesId]?.accent : undefined;
}

export type SpeakingSeriesEpisode = { material: SpeakingMaterial; season: number; number: number };
export type SpeakingSeriesSeason = { number: number; episodes: SpeakingSeriesEpisode[] };
export type SpeakingSeries = {
  id: string;
  title: string;
  englishTitle: string;
  seasons: SpeakingSeriesSeason[];
  episodeCount: number;
};

export function speakingSeriesSearchText(material: SpeakingMaterial): string {
  const definition = series[speakingSeriesId(material.id) ?? ''];
  return definition ? `${definition.title} ${definition.englishTitle}` : '';
}

/** 搜索只筛选电视剧入口，不缩减选集页中的季数、集数。 */
export function speakingSeriesGroups(materials: SpeakingMaterial[], query = ''): SpeakingSeries[] {
  const groups = new Map<string, SpeakingSeries>();
  const seen = new Set<string>();
  for (const material of materials) {
    if (material.origin !== 'platform' || material.category.trim() !== '美剧/英剧' || seen.has(material.id)) continue;
    seen.add(material.id);
    const match = /^(.*)-s(\d+)e(\d+)$/iu.exec(material.id);
    const id = speakingSeriesId(material.id) ?? material.id;
    const definition = series[id];
    const group: SpeakingSeries = groups.get(id) ?? {
      id,
      title: definition?.title ?? (material.title.replace(/\s*[·—-]?\s*S\d+E\d+\s*$/iu, '').trim() || material.title),
      englishTitle: definition?.englishTitle ?? '',
      seasons: [],
      episodeCount: 0,
    };
    const seasonNumber = match ? Number(match[2]) : 1;
    const episodeNumber = match ? Number(match[3]) : 1;
    const season: SpeakingSeriesSeason = group.seasons.find(item => item.number === seasonNumber) ?? { number: seasonNumber, episodes: [] };
    if (!group.seasons.includes(season)) group.seasons.push(season);
    season.episodes.push({ material, season: seasonNumber, number: episodeNumber });
    group.episodeCount += 1;
    groups.set(id, group);
  }
  const keyword = query.trim().toLowerCase();
  return [...groups.values()].filter(group => {
    group.seasons.sort((a, b) => a.number - b.number);
    for (const season of group.seasons) season.episodes.sort((a, b) => a.number - b.number || a.material.id.localeCompare(b.material.id));
    return `${group.title} ${group.englishTitle} 美剧/英剧`.toLowerCase().includes(keyword)
      || group.seasons.some(season => season.episodes.some(({ material }) => `${material.id} ${material.title} ${material.subtitle}`.toLowerCase().includes(keyword)));
  });
}

export function speakingSeriesCountLabel(group: SpeakingSeries): string {
  const firstSeason = group.seasons[0];
  const season = group.seasons.length === 1 && firstSeason ? `第${firstSeason.number}季` : `${group.seasons.length}季`;
  return `${season} · ${group.episodeCount}集`;
}
