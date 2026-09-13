export type EditorialSection = 'today' | 'featured' | 'daily' | 'kids';

export interface EditorialArticle {
  id: string;
  titleZh: string;
  titleEn: string;
  summaryZh: string;
  keyPointsZh: readonly string[];
  source: string;
  category: string;
  wordCount: number;
  minutes: number;
  level: string;
  image: string;
  section: EditorialSection;
  publishedAt: string;
  paragraphs: readonly string[];
}

const image = (id: string) =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=900&q=70`;

export const editorialArticles = [
  {
    id: 'hero',
    titleZh: '年度最治愈直播：看瑞典北部驼鹿迁徙',
    titleEn: 'Why Millions Watch Sweden’s Slow Moose Migration',
    summaryZh: '一场几乎没有剧情的迁徙直播，让观众重新适应自然缓慢而不可控的节奏。',
    keyPointsZh: ['慢电视为何让人着迷', '野生动物直播如何制作', '缓慢观看怎样缓解焦虑'],
    source: 'The Guardian',
    category: '自然',
    wordCount: 1240,
    minutes: 8,
    level: '雅思 6.5',
    section: 'today',
    image: image('1484406566174-9da000fda645'),
    publishedAt: '2026-09-12',
    paragraphs: [
      'Every spring, cameras beside a northern river wait for moose to begin a journey that cannot be scheduled for television.',
      'The quiet broadcast asks viewers to notice weather, distance, and animal behavior instead of waiting for a dramatic plot.',
    ],
  },
  {
    id: 'a1',
    titleZh: 'AI 正在如何改变语言学习的底层逻辑',
    titleEn: 'How AI Is Changing the Foundations of Language Learning',
    summaryZh: '语言工具开始从记忆单词转向理解具体语境中的意义。',
    keyPointsZh: ['语境模型的变化', '学习者如何保持主动判断'],
    source: 'MIT Technology Review',
    category: '科技',
    wordCount: 980,
    minutes: 6,
    level: '六级',
    section: 'featured',
    image: image('1518770660439-4636190af475'),
    publishedAt: '2026-09-11',
    paragraphs: [
      'New language tools can compare a learner’s chosen meaning with the sentence in which a word first appeared.',
      'Teachers still matter because useful practice requires judgment about goals, difficulty, and reliable feedback.',
    ],
  },
  {
    id: 'a2',
    titleZh: '夜班工作者如何守护自己的睡眠节律',
    titleEn: 'How Night Workers Protect Their Sleep Rhythm',
    summaryZh: '稳定的小习惯能够减轻昼夜颠倒对休息质量的影响。',
    keyPointsZh: ['光线如何影响睡眠', '可持续的下班仪式'],
    source: 'The Atlantic',
    category: '生活',
    wordCount: 1120,
    minutes: 7,
    level: '四级',
    section: 'featured',
    image: image('1441974231531-c6227db76b6e'),
    publishedAt: '2026-09-10',
    paragraphs: [
      'For night workers, the trip home happens while the city is becoming brighter and louder.',
      'A repeatable routine of dim light, a small meal, and a cool room can make daytime rest more dependable.',
    ],
  },
  {
    id: 'a3',
    titleZh: '全球经济放缓下的青年就业新选择',
    titleEn: 'New Career Choices as Global Hiring Slows',
    summaryZh: '年轻求职者正在重新衡量第一份工作的稳定性、成长空间与生活成本。',
    keyPointsZh: ['毕业生如何调整预期', '技能迁移为何更重要'],
    source: 'The Economist',
    category: '经济',
    wordCount: 1350,
    minutes: 9,
    level: '考研',
    section: 'featured',
    image: image('1521737604893-d14cc237f11d'),
    publishedAt: '2026-09-09',
    paragraphs: [
      'Slower hiring has encouraged graduates to look beyond familiar job titles and compare the skills each role can build.',
      'Short contracts can offer experience, but workers also need clear limits so uncertainty does not become permanent.',
    ],
  },
  {
    id: 'a4',
    titleZh: '一只金毛犬的治疗师生涯',
    titleEn: 'A Golden Retriever’s Career as a Hospital Helper',
    summaryZh: '固定到访的治疗犬用可预期的陪伴帮助儿童缓解住院焦虑。',
    keyPointsZh: ['动物陪伴如何降低压力', '医院怎样设计安全互动'],
    source: 'NPR',
    category: '动物',
    wordCount: 860,
    minutes: 5,
    level: '高考',
    section: 'featured',
    image: image('1543466835-00a7907e9de1'),
    publishedAt: '2026-09-08',
    paragraphs: [
      'On Tuesday mornings, a trained golden retriever follows the same quiet route through a children’s hospital.',
      'The visits are brief and carefully supervised, yet the familiar routine gives young patients something pleasant to expect.',
    ],
  },
  {
    id: 'n1',
    titleZh: '加拿大就业市场在八月出现回落',
    titleEn: 'Canada’s Job Market Softened in August',
    summaryZh: '最新就业数据展示了行业之间不均衡的变化。',
    keyPointsZh: ['总量数据如何解读', '行业差异为何重要'],
    source: 'Global National',
    category: '快讯',
    wordCount: 720,
    minutes: 4,
    level: '四级',
    section: 'daily',
    image: image('1521791136064-7986c2920216'),
    publishedAt: '2026-09-07',
    paragraphs: [
      'A monthly employment report showed weaker hiring, although the changes were not shared equally across industries.',
      'Economists warned that one month of data should be compared with longer trends before drawing broad conclusions.',
    ],
  },
  {
    id: 'n2',
    titleZh: '城市更新中的社区声音',
    titleEn: 'Community Voices in Urban Renewal',
    summaryZh: '规划者尝试在更新基础设施时保留居民真正依赖的公共空间。',
    keyPointsZh: ['居民参与如何发生', '更新与保留怎样平衡'],
    source: 'Meet the Press',
    category: '快讯',
    wordCount: 760,
    minutes: 4,
    level: '六级',
    section: 'daily',
    image: image('1504711434969-e33886168f5c'),
    publishedAt: '2026-09-06',
    paragraphs: [
      'Residents often notice small details that are absent from an architect’s first map of a neighborhood.',
      'Successful renewal combines safer infrastructure with repeated public meetings and transparent trade-offs.',
    ],
  },
  {
    id: 'k1',
    titleZh: '蘑菇其实是森林的“快递网络”',
    titleEn: 'How Fungi Carry Messages Through a Forest',
    summaryZh: '地下真菌网络帮助植物交换养分，也让森林形成复杂联系。',
    keyPointsZh: ['菌丝网络是什么', '植物如何交换资源'],
    source: 'Kid News',
    category: '少儿',
    wordCount: 540,
    minutes: 3,
    level: '中考',
    section: 'kids',
    image: image('1504674900247-0877df9cc836'),
    publishedAt: '2026-09-05',
    paragraphs: [
      'Beneath the leaves, thin fungal threads connect with the roots of many plants.',
      'The partnership moves nutrients through the soil, but scientists caution against describing it as a human-style internet.',
    ],
  },
  {
    id: 'k2',
    titleZh: '巴黎为什么有这么多鸽子',
    titleEn: 'Why Paris Has So Many Pigeons',
    summaryZh: '城市建筑、食物和漫长驯养历史共同塑造了鸽子的数量。',
    keyPointsZh: ['建筑为何适合筑巢', '人与鸽子的历史关系'],
    source: 'Kid News',
    category: '少儿',
    wordCount: 510,
    minutes: 3,
    level: '中考',
    section: 'kids',
    image: image('1502602898657-3e91760cbb34'),
    publishedAt: '2026-09-04',
    paragraphs: [
      'Stone ledges resemble the cliffs where the ancestors of city pigeons once nested.',
      'Food and shelter explain their success, while humane city programs focus on cleaner shared spaces.',
    ],
  },
] as const satisfies readonly EditorialArticle[];

export function getEditorialArticle(id: string): EditorialArticle | undefined {
  return editorialArticles.find((article) => article.id === id);
}

export function getEditorialSection(section: EditorialSection): EditorialArticle[] {
  return editorialArticles.filter((article) => article.section === section);
}

export function searchEditorialArticles(query: string): EditorialArticle[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [...editorialArticles];
  return editorialArticles.filter((article) =>
    [article.titleZh, article.titleEn, article.source, article.category].some(
      (value) => value.toLocaleLowerCase().includes(normalized),
    ),
  );
}
