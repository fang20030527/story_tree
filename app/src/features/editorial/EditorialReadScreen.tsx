import { ReadingOverlayProvider, useReadingOverlay } from '@/features/practice/ReadingOverlay';
import { Ionicons } from '@expo/vector-icons';
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
    <ReadingOverlayProvider><EditorialReadContent article={article} /></ReadingOverlayProvider>
  ) : (
    <MissingEditorialArticleState />
  );
}

function EditorialReadContent({ article }: { article: EditorialArticle }) {
  const readingOverlay = useReadingOverlay();
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
      <ScrollView onScrollBeginDrag={() => readingOverlay?.select(null)}
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
          {article.paragraphs.map((paragraph, index) => (
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
              text={paragraph}
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
    '研究者表示，苏拉威西洞穴出土牙齿上的痕迹与化学残留，可能记录了一位生活在 2.5 万年前的狩猎采集者反复使用含兴奋剂植物的行为。',
    '这一发现并不能证明现代意义上的成瘾，但它提示改变神志的植物，可能曾帮助一些早期人类应对疼痛、饥饿或仪式生活。',
  ],
  a1: [
    '在爱尔兰各地，山丘、河流和田野的名称仍然保存着数百年前从景观中消失的鹰、狼和野猪的记忆。',
    '研究者把这些名称当作动物曾经栖息地的证据，同时追问语言记忆今天能否指导洪水规划与再野化争论。',
  ],
  a2: [
    '文章认为，恐惧可以使社会瘫痪，但对核战争的恐惧也曾约束那些明白升级可能迅速失控的领导人。',
    '当这种恐惧消退时，危险不在于自信本身，而在于把核威胁当作普通施压工具的诱惑。',
  ],
  a3: [
    '一个关于青少年的吓人标题背后藏着更难的问题：究竟哪些技能在变化，哪些测试只是反映了新的注意力习惯？',
    '在宣布一代人变得更迟钝之前，读者应区分课程影响、家庭压力、睡眠缺失和测量工具本身的设计。',
  ],
  a4: [
    '在一项芬兰实验中，接触土壤、苔藓和其他富含微生物材料的人，几周内皮肤微生物多样性出现变化。',
    '这并不意味着泥土就是药；它提示与活体环境的日常接触，可能调节现代室内生活很少触达的免疫反应。',
  ],
  a5: [
    '早在卫星导航出现之前，水手就用六分仪测量恒星与地平线之间的角度来确定位置。',
    '航天机构重新考虑这一思路，因为远离地球的宇航员可能失去无线电联系，却仍然需要估算自己身在何处。',
  ],
  a6: [
    '一项配合长寿专题的委托调查询问美国人，在更长寿命和更健康岁月之间如何选择，许多人选择健康而非单纯活得久。',
    '尽管生物技术公司竞相延缓或逆转衰老，只有少数人把衰老本身描述成科学应当治愈的医学问题。',
  ],
  a7: [
    '斑衣蜡蝉已扩散到美国东部大部分地区，促使人们寻找不只是喷洒更多化学药剂的治理方式。',
    '早期测试显示，取食马利筋的个体可能在一天内死亡，这条线索提示本土植物种植既能压制害虫，也能支持帝王蝶。',
  ],
  a8: [
    '一款实验性疫苗通过阻断一种促使免疫系统过度反应的分子，让小鼠一年内免受过敏性休克。',
    '这项工作距离人体治疗还很远，但它指向一种预防思路：让过敏患者不再把普通接触变成紧急情况。',
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
