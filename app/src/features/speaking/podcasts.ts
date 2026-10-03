import type { SpeakingMaterial } from './model';

/** 节目名与封面属于播客；嘉宾、话题和期号属于各期素材。 */
const podcasts: Readonly<Record<string, { title: string; englishTitle: string }>> = {
  'joe-rogan-experience': { title: '乔·罗根访谈', englishTitle: 'Joe Rogan Experience' },
  'the-diary-of-a-ceo': { title: 'CEO 日记', englishTitle: 'The Diary of a CEO' },
  'the-iced-coffee-hour': { title: '冰咖啡时刻', englishTitle: 'The Iced Coffee Hour' },
};

export function speakingPodcastId(id: string): string | undefined {
  return Object.keys(podcasts).find(podcast => id.startsWith(`${podcast}-`) && id.length > podcast.length + 1);
}

export type SpeakingPodcast = {
  id: string;
  title: string;
  englishTitle: string;
  episodes: SpeakingMaterial[];
  episodeCount: number;
};

export function speakingPodcastSearchText(material: SpeakingMaterial): string {
  const definition = podcasts[speakingPodcastId(material.id) ?? ''];
  return definition ? `${definition.title} ${definition.englishTitle}` : '';
}

/** 搜索筛选节目入口，保留节目完整的选集和期数。 */
export function speakingPodcastGroups(materials: SpeakingMaterial[], query = ''): SpeakingPodcast[] {
  const groups = new Map<string, SpeakingPodcast>();
  const seen = new Set<string>();
  for (const material of materials) {
    if (material.origin !== 'platform' || material.category.trim() !== '播客' || seen.has(material.id)) continue;
    seen.add(material.id);
    const id = speakingPodcastId(material.id) ?? material.id;
    const definition = podcasts[id];
    const group: SpeakingPodcast = groups.get(id) ?? {
      id,
      title: definition?.title ?? material.title,
      englishTitle: definition?.englishTitle ?? '',
      episodes: [],
      episodeCount: 0,
    };
    group.episodes.push(material);
    group.episodeCount += 1;
    groups.set(id, group);
  }
  const keyword = query.trim().toLowerCase();
  return [...groups.values()].filter(group => `${group.title} ${group.englishTitle} 播客`.toLowerCase().includes(keyword)
    || group.episodes.some(material => `${material.id} ${material.title} ${material.subtitle}`.toLowerCase().includes(keyword)));
}
