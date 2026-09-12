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
  { id: 'computer', label: '电脑', icon: 'laptop-outline' },
] as const;

export interface ReadingBook {
  id: string;
  title: string;
  author: string;
  cover: string;
  /** 0-1 progress through the book. */
  progress: number;
  currentChapter: string;
}

export const readingBooks: ReadingBook[] = [
  {
    id: 'b1',
    title: "Charlotte's Web",
    author: 'E.B. White',
    cover: img('1544947950-fa07c98d237f'),
    progress: 0.64,
    currentChapter: 'Chapter 14 · The Egg Sac',
  },
  {
    id: 'b2',
    title: 'The Little Prince',
    author: 'Antoine de Saint-Exupéry',
    cover: img('1512820790803-83ca734da794'),
    progress: 0.31,
    currentChapter: 'Chapter 7 · The Flower',
  },
];

export interface RecommendedBook {
  id: string;
  title: string;
  author: string;
  category: string;
  level: string;
  chapters: number;
  wordCount: number;
  readers: number;
  cover: string;
}

export const recommendedBooks: RecommendedBook[] = [
  {
    id: 'r1',
    title: 'Wonder',
    author: 'R.J. Palacio',
    category: '小说',
    level: '四级',
    chapters: 32,
    wordCount: 73000,
    readers: 5210,
    cover: img('1481627834876-b7833e8f5570'),
  },
  {
    id: 'r2',
    title: 'Flipped',
    author: 'Wendelin Van Draanen',
    category: '成长',
    level: '六级',
    chapters: 14,
    wordCount: 54000,
    readers: 3120,
    cover: img('1476275466078-4007374efbbe'),
  },
  {
    id: 'r3',
    title: 'Animal Farm',
    author: 'George Orwell',
    category: '经典',
    level: '考研',
    chapters: 10,
    wordCount: 30000,
    readers: 4480,
    cover: img('1516979187457-637abb4f9353'),
  },
  {
    id: 'r4',
    title: 'The Old Man and the Sea',
    author: 'Ernest Hemingway',
    category: '经典',
    level: '雅思 6.5',
    chapters: 6,
    wordCount: 27000,
    readers: 2870,
    cover: img('1509266272358-7701da638078'),
  },
  {
    id: 'r5',
    title: 'Educated',
    author: 'Tara Westover',
    category: '传记',
    level: '托福',
    chapters: 40,
    wordCount: 105000,
    readers: 1960,
    cover: img('1524578271613-d550eacf6090'),
  },
];

export interface ReadingEvent {
  id: string;
  title: string;
  description: string;
  dateLabel: string;
  format: '线上' | '线下';
  location: string;
  participants: number;
  quota: number;
  status: '报名中' | '进行中' | '已结束';
  image: string;
  hot?: boolean;
}

export const events: ReadingEvent[] = [
  {
    id: 'e1',
    title: '21 天精读挑战 · 经济学人专栏',
    description: '每天一篇专栏精读，配套讲义与打卡社群，结营直播答疑。',
    dateLabel: '9月15日 – 10月5日',
    format: '线上',
    location: '微信群 + 直播',
    participants: 486,
    quota: 500,
    status: '报名中',
    image: img('1457369804613-52c61a468e7d'),
    hot: true,
  },
  {
    id: 'e2',
    title: '周六晨读会：短篇小说共读',
    description: '本周共读 Flipped 第 3 章，主持人带读，轮流分享段落理解。',
    dateLabel: '本周六 08:00 – 09:30',
    format: '线上',
    location: '腾讯会议',
    participants: 128,
    quota: 200,
    status: '进行中',
    image: img('1456513080510-7bf3a84b82f8'),
  },
  {
    id: 'e3',
    title: '上海线下英语角 · 外刊主题夜',
    description: '围绕本周精选外刊自由讨论，母语者现场带话题，提供饮品。',
    dateLabel: '9月20日 19:00',
    format: '线下',
    location: '静安寺 · 共享空间',
    participants: 36,
    quota: 50,
    status: '报名中',
    image: img('1529156069898-49953e39b3ac'),
  },
  {
    id: 'e4',
    title: '《Harry Potter》全书共读 · 第一期',
    description: '第一季共读已完结，可回看全部讲义与讨论记录。',
    dateLabel: '已结束 · 可回看',
    format: '线上',
    location: '站内回放',
    participants: 1024,
    quota: 1024,
    status: '已结束',
    image: img('1519682337058-a94d519337bc'),
  },
];

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
