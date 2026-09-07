export interface Article {
  id: string;
  title: string;
  excerpt: string;
  category: string;
  narrator: string;
  source: string;
  wordCount: number;
  level: string;
  minutes: number;
  readers: number;
  image: string;
  dateLabel?: string;
  featured?: boolean;
}

const img = (id: string) =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=900&q=70`;

export const heroArticle: Article = {
  id: 'hero',
  title: '精选外刊｜年度最治愈直播：看瑞典北部驼鹿迁徙',
  excerpt:
    'Every spring, thousands of moose begin a slow journey across northern Sweden, and millions of people around the world tune in to watch them live.',
  category: '自然',
  narrator: 'Jamie 讲解',
  source: 'The Guardian',
  wordCount: 1240,
  level: '雅思 6.5',
  minutes: 8,
  readers: 3082,
  image: img('1484406566174-9da000fda645'),
  featured: true,
};

export const pastArticles: Article[] = [
  {
    id: 'a1',
    title: 'AI 正在如何改变语言学习的底层逻辑',
    excerpt:
      'A quiet shift in how machines understand meaning is changing the way students build vocabulary.',
    category: '科技',
    narrator: 'Dora 讲解',
    source: 'MIT Technology Review',
    wordCount: 980,
    level: '六级',
    minutes: 6,
    readers: 2140,
    image: img('1518770660439-4636190af475'),
    dateLabel: 'Yesterday',
  },
  {
    id: 'a2',
    title: '夜班工作者如何守护自己的睡眠节律',
    excerpt:
      'For millions of night-shift workers, daylight is the enemy of rest. Small rituals can help reclaim it.',
    category: '生活',
    narrator: 'Kevin 讲解',
    source: 'The Atlantic',
    wordCount: 1120,
    level: '四级',
    minutes: 7,
    readers: 1876,
    image: img('1441974231531-c6227db76b6e'),
    dateLabel: 'Yesterday',
  },
  {
    id: 'a3',
    title: '全球经济放缓下的青年就业新选择',
    excerpt:
      'As hiring slows, a generation of graduates is rethinking what a first job should look like.',
    category: '经济',
    narrator: 'Lynn 讲解',
    source: 'The Economist',
    wordCount: 1350,
    level: '考研',
    minutes: 9,
    readers: 1523,
    image: img('1521737604893-d14cc237f11d'),
    dateLabel: 'Sep.03',
  },
  {
    id: 'a4',
    title: '一只金毛犬的治疗师生涯',
    excerpt:
      'In a children’s hospital, a golden retriever named Buddy does rounds every Tuesday, and patients wait for him by name.',
    category: '动物',
    narrator: 'Jamie 讲解',
    source: 'NPR',
    wordCount: 860,
    level: '高考',
    minutes: 5,
    readers: 2460,
    image: img('1543466835-00a7907e9de1'),
    dateLabel: 'Sep.03',
  },
];

export const newsItems = [
  {
    id: 'n1',
    tag: '免费',
    logo: 'Global National',
    title: '环球资讯 2026.09.05 – 加拿大 8 月流失 4.2 万岗位',
    langs: ['英语', '中文'],
    image: img('1521791136064-7986c2920216'),
  },
  {
    id: 'n2',
    tag: '免费',
    logo: 'MEET THE PRESS',
    title: '环球资讯 2026.09.04 – 专访：城市更新中的社区声音',
    langs: ['英语', '中文'],
    image: img('1504711434969-e33886168f5c'),
  },
];

export const kidNewsItems = [
  {
    id: 'k1',
    tag: '免费',
    title: 'Kid News：蘑菇其实是森林的“快递网络”',
    image: img('1504674900247-0877df9cc836'),
  },
  {
    id: 'k2',
    tag: '免费',
    title: 'Kid News：巴黎为什么有这么多鸽子',
    image: img('1502602898657-3e91760cbb34'),
  },
];

export interface WordItem {
  word: string;
  meaning: string;
  context: string;
  status: '待复习' | '复习中' | '已掌握';
  due: string;
  source: string;
}

export const words: WordItem[] = [
  {
    word: 'migration',
    meaning: 'n. 迁徙；移居',
    context: 'The annual migration of moose draws viewers from around the world.',
    status: '复习中',
    due: '今天到期',
    source: 'The Guardian',
  },
  {
    word: 'resilient',
    meaning: 'adj. 有韧性的；能复原的',
    context: 'Communities here have proven remarkably resilient through hard winters.',
    status: '复习中',
    due: '今天到期',
    source: 'The Atlantic',
  },
  {
    word: 'ambiguous',
    meaning: 'adj. 模棱两可的；不明确的',
    context: 'The contract language was ambiguous, leaving both sides uncertain.',
    status: '待复习',
    due: '明天到期',
    source: 'The Economist',
  },
  {
    word: 'meticulous',
    meaning: 'adj. 一丝不苟的；细致的',
    context: 'She kept meticulous notes on every patient the dog visited.',
    status: '复习中',
    due: '已逾期 1 天',
    source: 'NPR',
  },
  {
    word: 'momentum',
    meaning: 'n. 势头；动力',
    context: 'The livestream gained momentum as more viewers shared it.',
    status: '已掌握',
    due: '30 天后抽测',
    source: 'The Guardian',
  },
  {
    word: 'frugal',
    meaning: 'adj. 节俭的；简朴的',
    context: 'His frugal habits left room in the budget for travel.',
    status: '待复习',
    due: '9月7日到期',
    source: 'The Economist',
  },
];

export const importSources = [
  { id: 'link', label: '网页链接', icon: 'link' },
  { id: 'paste', label: '粘贴正文', icon: 'clipboard' },
  { id: 'album', label: '相册', icon: 'image' },
  { id: 'local', label: '本地', icon: 'folder' },
  { id: 'computer', label: '电脑', icon: 'desktop-outline' },
] as const;

export const communityPosts = [
  {
    id: 'p1',
    user: '小鱼爱吃猫',
    date: '2026/6/4',
    text: '导出台词本的功能太好用啦啦 😄 把复习文章导出打印出来贴在书桌前，每天抬头就能复习。',
    replies: 3,
    likes: 46,
    image: img('1499750310107-5fef28a66643'),
  },
  {
    id: 'p2',
    user: 'Clara',
    date: '2026/3/12',
    text: '老用户报到。新版的文章复习节奏很舒服，句子停顿设置也上线了，自动识别生词特别好用。期待增加更多德语资源。',
    replies: 12,
    likes: 89,
    image: img('1522202176988-66273c2fd55f'),
  },
];
