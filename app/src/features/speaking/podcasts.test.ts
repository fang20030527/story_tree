import type { SpeakingMaterial } from './model';
import { speakingPodcastGroups } from './podcasts';
import { speakingSections } from './catalog';

function episode(id: string, title: string): SpeakingMaterial {
  return { id, title, subtitle: '', category: '播客', origin: 'platform', mediaType: 'video', duration: 7_200, cues: [] };
}

const materials = [episode('joe-rogan-experience-2219', '乔·罗根访谈 · #2219 特朗普'),
  episode('joe-rogan-experience-2404', '乔·罗根访谈 · #2404 马斯克'),
  episode('the-diary-of-a-ceo-rick-rubin', 'CEO 日记 · 里克·鲁宾'),
  episode('the-iced-coffee-hour-jordan-peterson', '冰咖啡时刻 · 乔丹·彼得森')];

it('将各期素材归入节目，使用节目总名并保留目录顺序', () => {
  const groups = speakingPodcastGroups(materials);
  expect(groups.map(group => [group.id, group.title, group.englishTitle, group.episodeCount])).toEqual([
    ['joe-rogan-experience', '乔·罗根访谈', 'Joe Rogan Experience', 2],
    ['the-diary-of-a-ceo', 'CEO 日记', 'The Diary of a CEO', 1],
    ['the-iced-coffee-hour', '冰咖啡时刻', 'The Iced Coffee Hour', 1],
  ]);
  expect(groups[0]?.episodes).toEqual(materials.slice(0, 2));
});

it('节目名、嘉宾和期号搜索仍返回完整节目，不缩减选集和期数', () => {
  for (const query of ['乔·罗根访谈', 'joe ROGAN', '特朗普', '#2219']) {
    const groups = speakingPodcastGroups(materials, query);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.episodes).toEqual(materials.slice(0, 2));
    expect(groups[0]?.episodeCount).toBe(2);
  }
  // 单集没有英文介绍时，首页搜索也能找到对应节目。
  expect(speakingSections(materials, 'The Diary of a CEO')[0]?.materials).toEqual([materials[2]]);
  expect(speakingPodcastGroups(materials, '不存在')).toEqual([]);
});

it('排除个人文件、其他栏目和重复缓存，未知节目仍可进入选集', () => {
  const first = materials[0]!;
  const unknown = episode('another-podcast-1', '另一个节目');
  const groups = speakingPodcastGroups([first, first, { ...materials[1]!, origin: 'file' },
    { ...materials[2]!, category: '访谈对话' }, unknown]);
  expect(groups).toHaveLength(2);
  expect(groups[0]?.episodeCount).toBe(1);
  expect(groups[1]).toMatchObject({ id: unknown.id, title: unknown.title, episodes: [unknown], episodeCount: 1 });
  expect(speakingPodcastGroups([])).toEqual([]);
});
