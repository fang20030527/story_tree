import type { SpeakingMaterial } from './model';
import { speakingSeriesAccent, speakingSeriesCountLabel, speakingSeriesGroups } from './series';

function episode(id: string, title = '老友记'): SpeakingMaterial {
  return { id, title, subtitle: '', category: '美剧/英剧', origin: 'platform', mediaType: 'video', duration: 1_300, cues: [] };
}

it('把同一部剧的全部集数合并，按季、集的数字顺序排列', () => {
  const materials = [episode('friends-s02e10'), episode('friends-s01e24'), episode('friends-s02e02'),
    episode('rick-and-morty-s08e10', '瑞克和莫蒂 · S08E10'), episode('friends-s01e01')];
  const groups = speakingSeriesGroups(materials);
  expect(groups.map(group => group.title)).toEqual(['老友记', '瑞克和莫蒂']);
  expect(groups[0]?.seasons.map(season => [season.number, season.episodes.map(item => item.number)])).toEqual([[1, [1, 24]], [2, [2, 10]]]);
  expect(groups[0]?.episodeCount).toBe(4);
  expect(speakingSeriesCountLabel(groups[0]!)).toBe('2季 · 4集');
  expect(speakingSeriesCountLabel(groups[1]!)).toBe('第8季 · 1集');
});

it('支持剧名、英文剧名和季集编号搜索，并保留整部剧的选集和数量', () => {
  const materials = [episode('friends-s01e24', '老友记 · S01E24'), episode('friends-s01e01', '老友记 · S01E01'),
    episode('rick-and-morty-s08e01', '瑞克和莫蒂 · S08E01')];
  for (const query of ['老友记', 'Friends', 's01e24']) {
    const groups = speakingSeriesGroups(materials, query);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.episodeCount).toBe(2);
    expect(groups[0]?.seasons[0]?.episodes.map(item => item.material.id)).toEqual(['friends-s01e01', 'friends-s01e24']);
  }
  expect(speakingSeriesGroups(materials, '不存在')).toEqual([]);
});

it('不把个人文件、其他栏目或重复缓存算进电视剧集数', () => {
  const first = episode('friends-s01e01');
  const groups = speakingSeriesGroups([first, first, { ...episode('friends-s01e02'), origin: 'file' },
    { ...episode('friends-s01e03'), category: '电影' }, { ...episode('friends-s01e04'), category: '播客' }]);
  expect(groups).toHaveLength(1);
  expect(groups[0]?.episodeCount).toBe(1);
  expect(speakingSeriesGroups([])).toEqual([]);
});

it('新剧沿用标题和季集编号生成入口，不凭编号猜测口音', () => {
  const groups = speakingSeriesGroups([episode('the-office-s02e02', '办公室 · S02E02'), episode('the-office-s01e01', '办公室 · S01E01')]);
  expect(groups[0]).toMatchObject({ id: 'the-office', title: '办公室', englishTitle: '', episodeCount: 2 });
  expect(groups[0]?.seasons.map(season => season.number)).toEqual([1, 2]);
  expect(speakingSeriesAccent('the-office-s01e01')).toBeUndefined();
});
