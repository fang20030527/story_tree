import { EditorialAudioPlayer, type EditorialPlaybackPosition } from './EditorialAudioPlayer';
import { findAudioCue } from './editorialAudioSync';
import { ReadingOverlayProvider, useReadingOverlay } from '@/features/practice/ReadingOverlay';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { EditorialImage } from './EditorialImage';
import { markEditorialArticleRead } from './editorialReadStorage';
import { saveEditorialReadingProgress } from './editorialReadingProgress';
import { useEditorialReadingProgress } from './useEditorialReadingProgress';

type Props = { articleId: string };

export function EditorialReadScreen({ articleId }: Props) {
  const article = getEditorialArticle(articleId);
  return article ? (
    <ReadingOverlayProvider><EditorialReadContent key={article.id} article={article} /></ReadingOverlayProvider>
  ) : (
    <MissingEditorialArticleState />
  );
}

function EditorialReadContent({ article }: { article: EditorialArticle }) {
  const readingOverlay = useReadingOverlay();
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const {
    addedWords, showFullTranslation, loaded, error: progressError, retry,
    scrollRef, onLayout, onContentSizeChange, onScroll, flush,
    toggleTranslation, wordAdded,
  } = useEditorialReadingProgress(article.id);
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [playback, setPlayback] = useState<EditorialPlaybackPosition>({ currentTime: 0, duration: 0, playing: false });
  const updatePlayback = useCallback((position: EditorialPlaybackPosition) => {
    // 进度条高频刷新，正文只在朗读词或播放状态改变时更新。
    setPlayback((previous) => previous.playing === position.playing
      && findAudioCue(article.audioCues ?? [], previous.currentTime) === findAudioCue(article.audioCues ?? [], position.currentTime)
      ? previous : position);
  }, [article.audioCues]);
  const [following, setFollowing] = useState(true);
  const [bodyY, setBodyY] = useState(0);
  const [paragraphLayouts, setParagraphLayouts] = useState<Record<number, number>>({});
  const [lineLayouts, setLineLayouts] = useState<Record<number, { start: number; end: number; y: number; height: number }[]>>({});
  const viewport = useRef({ y: 0, height: 0 });
  const audioHeight = useRef(170);
  const cue = findAudioCue(article.audioCues ?? [], playback.currentTime);
  const cueParagraph = cue?.[0];
  const cueStart = cue?.[1];
  useEffect(() => {
    if (!following || readingOverlay?.activeId || cueParagraph === undefined || cueStart === undefined) return;
    const paragraphY = paragraphLayouts[cueParagraph];
    const line = lineLayouts[cueParagraph]?.find((item) => cueStart >= item.start && cueStart < item.end);
    if (paragraphY === undefined || !line || !viewport.current.height) return;
    const y = bodyY + paragraphY + line.y;
    const top = viewport.current.y + audioHeight.current + 16;
    const bottom = viewport.current.y + viewport.current.height - 48;
    if (y < top || y + line.height > bottom) {
      scrollRef.current?.scrollTo({ y: Math.max(0, y - audioHeight.current - 28), animated: true });
    }
  }, [following, playback.playing, readingOverlay?.activeId, cueParagraph, cueStart, bodyY, paragraphLayouts, lineLayouts, scrollRef]);
  const completeLearning = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setCompletionError(null);
    readingOverlay?.select(null);
    try {
      await markEditorialArticleRead(article.id);
    } catch {
      savingRef.current = false;
      setSaving(false);
      setCompletionError('已读状态保存失败，请重试');
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };
  const fullTranslation = useMemo(
    () => editorialTranslation(article.id, article.paragraphs),
    [article.id, article.paragraphs],
  );
  const addVocabulary = async (input: VocabularyInput, idempotencyKey: string) => {
    await addEditorialVocabulary(input, idempotencyKey);
    // 请求完成时页面可能已经卸载，仍须保存高亮。
    await saveEditorialReadingProgress(article.id, { addedWords: [input.term] });
  };

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
      {progressError ? (
        <TouchableOpacity accessibilityRole="button" onPress={retry}>
          <Text style={{ color: theme.danger, padding: 16 }}>{progressError}</Text>
        </TouchableOpacity>
      ) : null}
      {!loaded ? <Text style={{ color: theme.textMuted, padding: 16 }}>正在恢复阅读进度…</Text> : (
      <ScrollView
        ref={scrollRef}
        testID="editorial-reading-scroll"
        onLayout={(event) => { viewport.current.height = event.nativeEvent.layout.height; onLayout(event.nativeEvent.layout.height); }}
        onContentSizeChange={(_, height) => onContentSizeChange(height)}
        onScroll={(event) => { viewport.current.y = event.nativeEvent.contentOffset.y; onScroll(event); }}
        stickyHeaderIndices={article.audioAsset || article.audioUrl ? [4] : undefined}
        scrollEventThrottle={100}
        onScrollEndDrag={(event) => { onScroll(event); flush(); }}
        onMomentumScrollEnd={(event) => { onScroll(event); flush(); }}
        onScrollBeginDrag={() => { readingOverlay?.select(null); setFollowing(false); }}
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
        {article.audioAsset || article.audioUrl ? (
          <View onLayout={(event) => { audioHeight.current = event.nativeEvent.layout.height; }} style={{ backgroundColor: theme.bg }}>
            <EditorialAudioPlayer source={article.audioAsset ?? article.audioUrl!} onPositionChange={updatePlayback} />
          </View>
        ) : null}
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
              onPress={toggleTranslation}>
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
        <View testID="editorial-body" style={styles.body} onLayout={(event) => setBodyY(event.nativeEvent.layout.y)}>
          {article.paragraphs.map((paragraph, index) => (
            <View testID={`editorial-paragraph-${index}`} key={`${article.id}:${index}`} onLayout={(event) => {
              const y = event.nativeEvent.layout.y;
              setParagraphLayouts((current) => current[index] === y ? current : { ...current, [index]: y });
            }}>
              <InteractiveWordParagraph
                playbackRange={cueParagraph === index && cue ? { start: cue[1], end: cue[2], color: theme.blue } : undefined}
                onTextLayout={(event) => {
                  let cursor = 0;
                  const lines = event.nativeEvent.lines.map((line) => {
                    const start = paragraph.indexOf(line.text, cursor);
                    const offset = start < 0 ? cursor : start;
                    cursor = offset + line.text.length;
                    return { start: offset, end: cursor, y: line.y, height: line.height };
                  });
                  setLineLayouts((current) => JSON.stringify(current[index]) === JSON.stringify(lines) ? current : { ...current, [index]: lines });
                }}
                isHeading={article.sectionHeadings?.includes(paragraph)}
                addedWords={addedWords}
                addedWordColor={theme.accent}
                borderColor={theme.border}
                dangerColor={theme.danger}
                lookupWord={lookupEditorialWord}
                onAddToVocabulary={addVocabulary}
                onWordAdded={wordAdded}
                surfaceColor={theme.surfaceAlt}
                targetColor={theme.accent}
                text={paragraph}
                textColor={theme.text}
              />
              {article.figures?.filter((figure) => figure.afterParagraph === index).map((figure) => (
                <View key={figure.caption}>
                  <EditorialImage uri={figure.image} style={{ width: '100%', aspectRatio: 976 / 549, borderRadius: 12 }} />
                  <Text style={{ color: theme.textMuted, fontSize: 12, lineHeight: 18, marginTop: 8 }}>{figure.caption}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="完成学习"
          accessibilityState={{ disabled: saving, busy: saving }}
          disabled={saving}
          onPress={() => void completeLearning()}
          style={[styles.completeButton, { backgroundColor: theme.accent, opacity: saving ? 0.6 : 1 }]}>
          <Text style={[styles.completeButtonText, { color: theme.accentText }]}>
            {saving ? '保存中…' : '完成学习'}
          </Text>
        </TouchableOpacity>
        {completionError ? (
          <Text accessibilityLiveRegion="polite" style={{ color: theme.danger, marginTop: 12 }}>
            {completionError}
          </Text>
        ) : null}
      </ScrollView>
      )}
      {!following && playback.playing && article.audioCues?.length ? (
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="恢复跟随朗读"
          onPress={() => setFollowing(true)}
          style={{ position: 'absolute', bottom: insets.bottom + 16, alignSelf: 'center', backgroundColor: theme.surface, borderColor: theme.blue, borderWidth: 1, borderRadius: 22, paddingHorizontal: 18, paddingVertical: 12 }}>
          <Text style={{ color: theme.blue }}>恢复跟随朗读</Text>
        </TouchableOpacity>
      ) : null}
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
    '研究者表示，苏拉威西洞穴出土牙齿上的痕迹与化学残留，可能记录了一位生活在 2.5 万年前的狩猎采集者反复使用含兴奋剂植物的行为。',
    '这一发现并不能证明现代意义上的成瘾，但它提示改变神志的植物，可能曾帮助一些早期人类应对疼痛、饥饿或仪式生活。',
  ],
  n1: [
    '在通胀看似退却一段时间之后，价格压力再次迫使各国央行捍卫自己的信誉。',
    '新一轮抗通胀不只关乎利率，也关乎让家庭和企业相信暂时冲击不会变成永久预期。',
  ],
  n2: [
    '人们预言的白领工作崩溃并未到来；相反，数据中心建设、电气工程和 AI 工程增加了岗位。',
    '这种繁荣可能与客服和行政岗位的真实流失并存，这也是为什么总量数字会掩盖痛苦的转型。',
  ],
  n3: [
    '当你把每个门铃、店面和灯杆都算作可能的传感器时，走过一个街区会变得令人不安。',
    '公民自由组织认为，绘制监控地图只是第一步，接下来要追问谁在观看录像以及录像会保存多久。',
  ],
  n4: [
    '一枚猎鹰 9 号上面级按预测撞上月球，轨道器通过撞击前后图像对比找到了新撞击坑。',
    '观测尘埃羽流的望远镜报告了钠、锂等化学指纹，也重新引发人类留在其他天体上的碎片归谁负责的问题。',
  ],
  n5: [
    '对计划中星座的模拟显示，数十万颗卫星可能穿过太空望远镜的视场。',
    '问题不在于毁掉某一张照片，而在于干净观测时间一旦被打断，就无法重新获得。',
  ],
  n6: [
    '经典说法是，一次巨大撞击把物质抛入轨道，最终形成月球。',
    '三次撞击的替代模型试图解释地球和月球为何化学相似，而不需要一次完美调谐的碰撞。',
  ],
  n7: [
    'Emily Wilson 的《奥德赛》英译广受赞誉，但她表示自己是在重译整首诗，而不是修改几句名句。',
    '这一决定紧随她对一部大片改编的严厉批评，但更深层的问题是译者如何让荷马在英语中保持陌生、迅疾和道德上的不安。',
  ],
  k1: [
    '尼日利亚护林员正在照顾一只孤儿森林象幼崽，它的名字在伊乔语中意为“幸存者”。',
    '长期希望是在断奶后把它放归野外，但这取决于健康、栖息地安全，以及它能否学会与其他大象生活。',
  ],
  k2: [
    '每年秋冬，条纹鲻鱼会聚成巨大鱼群，沿着佛罗里达海岸移动。',
    '这一奇观出现在佛罗里达数十年前禁用某些缠绕网具后的恢复之后，说明一条规则可以改变人们后来在水中看到的景象。',
  ],
  k3: [
    '新的近距离图像显示，小行星 Torifune 呈花生状，因为两块岩石粘在一起。',
    '科学家称之为相接双星；了解形状有助于他们模拟这类天体如何旋转、解体，或如何被推离地球。',
  ],
  k4: [
    '宠物会通过毛发、爪子和唾液把微生物带进家中，狗可能以与社交能力相关的方式改变人体微生物组。',
    '这项研究很有意思，但还不能证明是狗本身让人更友善；选择养狗的家庭可能在许多方面本来就不同。',
  ],
};

function editorialTranslation(
  articleId: string,
  paragraphs: readonly string[],
): string {
  const translated = EDITORIAL_TRANSLATIONS[articleId];
  return (translated && translated.length === paragraphs.length
    ? translated
    : paragraphs.map((paragraph) => `译文：${paragraph}`)
  ).join('\n\n');
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
  titleEn: { fontSize: 32, fontWeight: weight('bold'), lineHeight: 41, marginTop: 12 },
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
  completeButton: { alignItems: 'center', borderRadius: 13, marginTop: 32, paddingVertical: 16 },
  completeButtonText: { fontSize: 16, fontWeight: weight('semibold') },
  paragraph: { fontSize: 17, lineHeight: 30 },
  missing: { alignItems: 'center', flex: 1, gap: 14, justifyContent: 'center' },
  missingTitle: { fontSize: 18, fontWeight: weight('semibold') },
});
