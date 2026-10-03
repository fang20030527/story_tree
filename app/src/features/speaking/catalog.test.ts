import { speakingSectionPreview, speakingSections } from './catalog';
import { speakingAccentLabel } from './accents';
import type { SpeakingMaterial } from './model';
import { speakingPodcastId } from './podcasts';

function material(id: string, title: string, category = '美剧/英剧'): SpeakingMaterial {
  return { id, title, category, subtitle: '', origin: 'platform', mediaType: 'video', duration: 1_300, cues: [] };
}

it('美剧/英剧独立成栏，搜索保留季集编号，个人文件不进入共享栏目', () => {
  const friends = material('friends-s01e01', '老友记 · S01E01');
  const materials = [friends, material('rick-and-morty-s08e01', '瑞克和莫蒂 · S08E01'),
    material('forrest-gump-1994', '阿甘正传', '电影对白'),
    { ...material('private-series', '自己的剧集'), origin: 'file' as const }];
  const sections = speakingSections(materials);
  expect(sections.map(section => section.title)).toEqual(['电影', '美剧/英剧']);
  expect(sections[1]?.materials).toHaveLength(2);
  expect(speakingSections(materials, 's01e01')[0]?.materials).toEqual([friends]);
});

it('首页先展示不同剧的入口，栏目完整列表保留所有集数', () => {
  const episodes = [material('friends-s01e01', '老友记 · S01E01'), material('friends-s01e02', '老友记 · S01E02'),
    material('rick-and-morty-s08e01', '瑞克和莫蒂 · S08E01'), material('rick-and-morty-s08e02', '瑞克和莫蒂 · S08E02')];
  expect(speakingSectionPreview(episodes, 3).map(item => item.id)).toEqual(['friends-s01e01', 'rick-and-morty-s08e01']);
  expect(speakingSections(episodes)[0]?.materials).toEqual(episodes);
});

it('剧集沿用实际口音标注，不给同名个人文件或未知素材推断口音', () => {
  expect(speakingAccentLabel(material('friends-s01e05', '老友记'))).toBe('口音：美式');
  expect(speakingAccentLabel(material('rick-and-morty-s08e10', '瑞克和莫蒂'))).toBe('口音：美式');
  expect(speakingAccentLabel({ id: 'friends-s01e01', origin: 'file' })).toBe('口音：待确认');
  expect(speakingAccentLabel({ id: 'friends-personal', origin: 'platform' })).toBe('口音：待确认');
});

it('播客位于美剧/英剧之后，首页展示不同节目，完整列表保留全部单集', () => {
  const episodes = [material('joe-rogan-experience-2219', '乔·罗根访谈 · 特朗普', '播客'),
    material('joe-rogan-experience-2404', '乔·罗根访谈 · 马斯克', '播客'),
    material('joe-rogan-experience-2422', '乔·罗根访谈 · 黄仁勋', '播客'),
    material('the-diary-of-a-ceo-rick-rubin', 'CEO 日记 · 里克·鲁宾', '播客'),
    material('the-iced-coffee-hour-jordan-peterson', '冰咖啡时刻 · 乔丹·彼得森', '播客')];
  const sections = speakingSections([...episodes, material('friends-s01e01', '老友记'),
    material('forrest-gump-1994', '阿甘正传', '电影对白')]);
  expect(sections.map(section => section.title)).toEqual(['电影', '美剧/英剧', '播客']);
  expect(sections[2]?.materials).toEqual(episodes);
  expect(speakingSectionPreview(episodes, 3).map(item => item.id)).toEqual([
    'joe-rogan-experience-2219', 'the-diary-of-a-ceo-rick-rubin', 'the-iced-coffee-hour-jordan-peterson',
  ]);
});

it('播客支持英文节目名、中文嘉宾名和期号搜索，不把个人文件加入共享栏目', () => {
  const podcast = { ...material('joe-rogan-experience-2219', '乔·罗根访谈 · #2219 特朗普', '播客'),
    subtitle: 'Joe Rogan Experience · Donald Trump · 完整访谈' };
  const items = [podcast, { ...podcast, id: 'personal-podcast', origin: 'file' as const }];
  for (const query of ['Joe Rogan', '特朗普', '#2219', '播客']) {
    expect(speakingSections(items, query)).toEqual([{ title: '播客', materials: [podcast] }]);
  }
  expect(speakingSections(items, '不存在')).toEqual([]);
  expect(speakingPodcastId('joe-rogan-experience-')).toBeUndefined();
  expect(speakingPodcastId('unknown-podcast-1')).toBeUndefined();
  const unknown = material('unknown-podcast-1', '另一个播客', '播客');
  expect(speakingSectionPreview([podcast, unknown], 3)).toEqual([podcast, unknown]);
});
