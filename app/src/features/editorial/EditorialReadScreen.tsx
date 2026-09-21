import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { VocabularyInput } from '@context-reader/contracts';

import { createVocabularyItem, requestWordTranslation } from '@/api/practices';
import { weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import {
  getEditorialArticle,
  type EditorialArticle,
} from '@/features/editorial/catalog';
import { recordEditorialRecentView } from '@/features/library/libraryStorage';
import { InteractiveWordParagraph } from '@/features/practice/ArticleParagraph';

type Props = { articleId: string };

export function EditorialReadScreen({ articleId }: Props) {
  const article = getEditorialArticle(articleId);
  return article ? (
    <EditorialReadContent article={article} />
  ) : (
    <MissingEditorialArticleState />
  );
}

function EditorialReadContent({ article }: { article: EditorialArticle }) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [showFullTranslation, setShowFullTranslation] = useState(false);
  const [addedWords, setAddedWords] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const fullTranslation = useMemo(
    () => editorialTranslation(article.id, article.paragraphs),
    [article.id, article.paragraphs],
  );
  const handleWordAdded = useCallback((term: string) => {
    setAddedWords((current) => {
      const next = new Set(current);
      next.add(term.trim().toLocaleLowerCase('en-US'));
      return next;
    });
  }, []);

  useEffect(() => {
    void recordEditorialRecentView(article.id).catch(() => undefined);
  }, [article.id]);

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="返回">
          <Ionicons name="chevron-back" size={26} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>平台外刊</Text>
        <View style={styles.headerSpacer} />
      </View>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 32 },
        ]}>
        <Text style={[styles.kicker, { color: theme.accent }]}>
          {article.source} · {article.category}
        </Text>
        <Text selectable style={[styles.titleEn, { color: theme.text }]}>
          {article.titleEn}
        </Text>
        <Text style={[styles.titleZh, { color: theme.textSecondary }]}>
          {article.titleZh}
        </Text>
        <Text style={[styles.meta, { color: theme.textMuted }]}>
          {article.wordCount} 词 · {article.minutes} 分钟 · {article.level}
        </Text>
        <View
          style={[
            styles.translationBox,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}>
          <View style={styles.translationHeader}>
            <View style={styles.translationHeading}>
              <Ionicons name="language-outline" size={18} color={theme.blue} />
              <Text style={[styles.translationTitle, { color: theme.text }]}>全文翻译</Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityState={{ expanded: showFullTranslation }}
              hitSlop={8}
              onPress={() => setShowFullTranslation((visible) => !visible)}>
              <Text style={[styles.translationAction, { color: theme.blue }]}>
                {showFullTranslation ? '隐藏译文' : '查看译文'}
              </Text>
            </TouchableOpacity>
          </View>
          {showFullTranslation ? (
            <Text style={[styles.translationText, { color: theme.textSecondary }]}>
              {fullTranslation}
            </Text>
          ) : null}
        </View>
        <View style={styles.body}>
          {(article.bodyBlocks ?? article.paragraphs.map((text) => ({ type: 'text' as const, text }))).map((block, index) => block.type === 'image' ? (
            <Image
              key={`${article.id}:${index}`}
              source={block.image}
              contentFit="contain"
              accessibilityLabel={`${article.titleEn}，原刊配图 ${index + 1}`}
              style={{ width: '100%', aspectRatio: block.width / block.height }}
            />
          ) : (
            <InteractiveWordParagraph
              key={`${article.id}:${index}`}
              addedWords={addedWords}
              addedWordColor={theme.accent}
              borderColor={theme.border}
              dangerColor={theme.danger}
              lookupWord={lookupEditorialWord}
              onAddToVocabulary={addEditorialVocabulary}
              onWordAdded={handleWordAdded}
              surfaceColor={theme.surfaceAlt}
              targetColor={theme.accent}
              text={block.text}
              textColor={theme.text}
            />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

async function lookupEditorialWord(term: string, context: string) {
  const response = await requestWordTranslation({ term, context });
  return response;
}

async function addEditorialVocabulary(
  input: VocabularyInput,
  idempotencyKey: string,
): Promise<void> {
  await createVocabularyItem(input, idempotencyKey);
}

const EDITORIAL_TRANSLATIONS: Record<string, readonly string[]> = {
  hero: [
    '每年春天，北方河流旁的摄像机等待驼鹿开始一段无法为电视节目排定时间的旅程。',
    '这场安静的直播邀请观众关注天气、距离和动物行为，而不是等待戏剧性的情节。',
  ],
  a1: [
    '新的语言工具可以把学习者选择的含义，与一个单词第一次出现的句子进行比较。',
    '教师仍然重要，因为有效的练习需要有人判断目标、难度和反馈是否可靠。',
  ],
  a2: [
    '对夜班工作者来说，回家的路途发生在城市变得更明亮、更喧闹的时候。',
    '昏暗的灯光、少量食物和凉爽房间组成的固定习惯，能让白天休息更可靠。',
  ],
  a3: [
    '招聘放缓促使毕业生跳出熟悉的职位名称，比较每份工作能够培养哪些技能。',
    '短期合同可以带来经验，但劳动者也需要明确界限，避免不确定性变成永久状态。',
  ],
  a4: [
    '每周二早晨，一只训练有素的金毛犬沿着儿童医院里同一条安静路线前行。',
    '探访时间很短且受到严格监督，但熟悉的日程给了小患者一件值得期待的愉快事情。',
  ],
  n1: [
    '一份月度就业报告显示招聘走弱，尽管各行业受到的变化并不相同。',
    '经济学家提醒，在得出宽泛结论前，应把一个月的数据与更长期的趋势进行比较。',
  ],
  n2: [
    '居民往往能注意到建筑师绘制社区第一张地图时遗漏的小细节。',
    '成功的更新需要更安全的基础设施、持续的公众会议以及透明的取舍。',
  ],
  k1: [
    '在落叶下面，细细的真菌丝线与许多植物的根部相连。',
    '这种伙伴关系让养分在土壤中移动，但科学家提醒不要把它描述成人类式的互联网。',
  ],
  k2: [
    '石头壁架很像城市鸽子祖先曾经筑巢的悬崖。',
    '食物和庇护所解释了它们的成功，而人道的城市项目则关注更干净的共享空间。',
  ],
};

function editorialTranslation(
  articleId: string,
  paragraphs: readonly string[],
): string {
  const translated = EDITORIAL_TRANSLATIONS[articleId];
  return translated && translated.length === paragraphs.length
    ? translated.join('\n\n')
    : '本篇为英文原刊，暂未提供全文译文。';
}

function MissingEditorialArticleState() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="返回">
          <Ionicons name="chevron-back" size={26} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>平台外刊</Text>
        <View style={styles.headerSpacer} />
      </View>
      <View style={styles.missing}>
        <Text style={[styles.missingTitle, { color: theme.text }]}>文章不存在</Text>
        <TouchableOpacity
          onPress={() => router.replace('/')}
          accessibilityRole="button"
          accessibilityLabel="返回外刊">
          <Text style={{ color: theme.blue }}>返回外刊</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: 16,
  },
  headerTitle: { fontSize: 17, fontWeight: weight('semibold') },
  headerSpacer: { width: 26 },
  content: { paddingHorizontal: 18, paddingTop: 16 },
  kicker: { fontSize: 12, fontWeight: weight('semibold') },
  titleEn: { fontSize: 28, fontWeight: weight('bold'), lineHeight: 36, marginTop: 12 },
  titleZh: { fontSize: 16, lineHeight: 24, marginTop: 10 },
  meta: { fontSize: 12, marginTop: 10 },
  translationBox: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 22,
    padding: 13,
  },
  translationHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  translationHeading: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  translationTitle: { fontSize: 14, fontWeight: weight('semibold') },
  translationAction: { fontSize: 12, fontWeight: weight('semibold') },
  translationText: { fontSize: 14, lineHeight: 23, marginTop: 12 },
  body: { gap: 22, marginTop: 28 },
  paragraph: { fontSize: 17, lineHeight: 30 },
  missing: { alignItems: 'center', flex: 1, gap: 14, justifyContent: 'center' },
  missingTitle: { fontSize: 18, fontWeight: weight('semibold') },
});
