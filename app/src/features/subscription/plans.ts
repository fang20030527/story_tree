import type { Ionicons } from '@expo/vector-icons';

export type VipPricingChannel = 'web' | 'apple';

const vipPlanDefinitions = [
  { id: 'monthly', name: '月度会员', original: 30, days: 30 },
  { id: 'annual', name: '年度会员', original: 199, days: 365 },
  { id: 'lifetime', name: '永久会员', original: 399, days: null },
] as const;

const vipPrices = {
  web: { monthly: 19, annual: 128, lifetime: 198 },
  apple: { monthly: 22, annual: 148, lifetime: 228 },
} as const;

export function getVipPlans(channel: VipPricingChannel) {
  return vipPlanDefinitions.map(plan => ({ ...plan, price: vipPrices[channel][plan.id] }));
}

export type VipBenefit = { title: string; description: string; icon: keyof typeof Ionicons.glyphMap; group?: 'resources' };
export const readingBenefits: VipBenefit[] = [
  { title: '智能阅读陪练', description: '在新的语境中，掌握自己的积累。', icon: 'book-outline' },
  { title: 'AI 语境查词', description: '结合上下文，理解单词的具体含义。', icon: 'search-outline' },
  { title: '长难句拆解', description: '理清句子结构，读懂复杂表达。', icon: 'git-branch-outline' },
  { title: '专业语音朗读', description: '让每篇文章，都可以听着学。', icon: 'headset-outline' },
];
export const speakingBenefits: VipBenefit[] = [
  { title: '台词 AI 讲解', description: '读懂句意、表达和停顿，再把原句说自然。', icon: 'help-circle-outline' },
  { title: '录音跟读', description: '录下自己的声音，回放对照原音。', icon: 'mic-outline' },
  { title: '无级变速播放', description: '放慢练清楚，加速练流畅，找到自己的节奏。', icon: 'time-outline' },
  { title: '字幕自由切换', description: '双语、英文、中文或隐藏字幕，循序渐进。', icon: 'text-outline' },
  { title: '台词笔记与句子收藏', description: '留下好句和自己的笔记，随时回来再练。', icon: 'bookmark-outline' },
  { title: '字幕内词典查词', description: '遇到生词直接查询，练习不中断。', icon: 'search-outline' },
  { title: '单句循环播放', description: '一句一句反复练，把难句说得更顺。', icon: 'repeat-outline' },
  { title: '视频离线下载', description: '提前保存素材，通勤和旅途也能练。', icon: 'download-outline', group: 'resources' },
  { title: '导出 PDF 台词本', description: '把双语字幕整理成台词本，随时复习。', icon: 'document-outline', group: 'resources' },
  { title: 'App 内播放 YouTube 视频', description: '在同一个学习空间，观看视频并练习表达。', icon: 'laptop-outline', group: 'resources' },
  { title: 'TED 演讲变速播放', description: '按自己的速度学习演讲，积累更丰富的表达。', icon: 'headset-outline', group: 'resources' },
];
