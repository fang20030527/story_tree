import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card } from '@/components/ui';
import { weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';

const FEATURES: { icon: keyof typeof Ionicons.glyphMap; title: string; description: string }[] = [
  { icon: 'newspaper-outline', title: '从外刊，读到更大的世界', description: '在真实英文文章中积累表达，让每一次阅读都有收获。' },
  { icon: 'sparkles-outline', title: '让生词回到文章里', description: '围绕待复习单词生成阅读练习，在新的语境中理解和巩固。' },
  { icon: 'language-outline', title: '读懂，也理解得更深', description: '结合段落与全文翻译，读懂句子，理清文章的来龙去脉。' },
  { icon: 'library-outline', title: '把喜欢的内容变成教材', description: '导入自己的英文文章，建立书架，持续积累个人词库。' },
];

const FAQ = [
  { question: '现在可以开通 Pro 吗？', answer: 'Pro 暂未开放购买。正式开放后，本页会展示可购买的方案、价格和具体权益。目前不会产生任何订阅或扣费。' },
  { question: 'Pro 的价格和额度是多少？', answer: '价格、使用额度及会员专属功能尚未公布，请以正式开通时的方案说明为准。上方展示的是黑洞英语的学习体验方向，并不代表这些功能已被设为付费专属。' },
  { question: '现在还能继续使用吗？', answer: '可以。你可以继续使用当前已开放的阅读、词库和复习功能；需要免费额度的操作，以应用实际提示为准。' },
  { question: '我的文章和生词会保留吗？', answer: '打开本页不会更改你的账号、书架、生词或复习进度。你可以随时返回继续学习。' },
];

export default function ProScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [expanded, setExpanded] = useState<number | null>(0);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/profile');
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 4, borderBottomColor: theme.border }]}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="返回" onPress={goBack} style={styles.back}>
          <Ionicons name="chevron-back" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>升级为 Pro 版</Text>
        <View style={styles.back} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <Text style={styles.brand}>黑洞英语</Text>
            <View style={styles.proBadge}><Text style={styles.proBadgeText}>PRO</Text></View>
          </View>
          <Text style={styles.heroTitle}>每一次阅读，{'\n'}都更进一步。</Text>
          <Text style={styles.heroDescription}>从读懂一篇外刊，到真正记住一个词。{'\n'}让英语学习，发生在语境里。</Text>
          <View style={styles.heroFooter}>
            <Ionicons name="planet-outline" size={24} color="#F6D78E" />
            <Text style={styles.heroCaption}>READ MORE. UNDERSTAND MORE.</Text>
          </View>
        </View>

        <View style={styles.sectionHeading}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>为深入学习而设计</Text>
          <Text style={[styles.body, { color: theme.textSecondary }]}>阅读、理解、积累、复习，连成一个习惯。</Text>
        </View>
        <Card theme={theme} style={styles.featureCard}>
          {FEATURES.map((feature, index) => (
            <View key={feature.title} style={[styles.feature, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }]}>
              <View style={[styles.featureIcon, { backgroundColor: theme.accentSoft }]}>
                <Ionicons name={feature.icon} size={23} color={theme.mode === 'light' ? '#8C650B' : theme.accent} />
              </View>
              <View style={styles.featureCopy}>
                <Text style={[styles.featureTitle, { color: theme.text }]}>{feature.title}</Text>
                <Text style={[styles.body, { color: theme.textSecondary }]}>{feature.description}</Text>
              </View>
            </View>
          ))}
        </Card>

        <Card theme={theme} style={styles.availability}>
          <View style={styles.statusRow}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Pro 开通说明</Text>
            <View style={[styles.statusBadge, { backgroundColor: theme.accentSoft }]}>
              <Text style={[styles.statusText, { color: theme.text }]}>筹备中</Text>
            </View>
          </View>
          <Text style={[styles.body, { color: theme.textSecondary }]}>购买暂未开放，价格与专属权益将在正式上线时公布。现在可以继续体验已开放的学习功能。</Text>
          <TouchableOpacity accessibilityRole="button" onPress={() => router.push('/feature-guide')} style={[styles.guideLink, { borderTopColor: theme.border }]}>
            <Text style={[styles.featureTitle, { color: theme.text }]}>查看当前功能与使用方法</Text>
            <Ionicons name="arrow-forward" size={18} color={theme.textSecondary} />
          </TouchableOpacity>
        </Card>

        <Text style={[styles.sectionTitle, styles.faqHeading, { color: theme.text }]}>你可能想了解</Text>
        <Card theme={theme} style={styles.faqCard}>
          {FAQ.map((item, index) => (
            <View key={item.question} style={index > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border } : undefined}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityState={{ expanded: expanded === index }}
                onPress={() => setExpanded(expanded === index ? null : index)}
                style={styles.question}>
                <Text style={[styles.featureTitle, styles.featureCopy, { color: theme.text }]}>{item.question}</Text>
                <Ionicons name={expanded === index ? 'remove' : 'add'} size={19} color={theme.textSecondary} />
              </TouchableOpacity>
              {expanded === index && <Text style={[styles.answer, styles.body, { color: theme.textSecondary }]}>{item.answer}</Text>}
            </View>
          ))}
        </Card>
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: theme.surface, borderTopColor: theme.border, paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={styles.footerContent}>
          <Text style={[styles.footerNote, { color: theme.textSecondary }]}>Pro 暂未开放购买 · 当前不会扣费</Text>
          <TouchableOpacity accessibilityRole="button" onPress={goBack} activeOpacity={0.8} style={[styles.continueButton, { backgroundColor: theme.accent }]}>
            <Text style={[styles.buttonText, { color: theme.accentText }]}>继续学习</Text>
            <Ionicons name="arrow-forward" size={19} color={theme.accentText} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: weight('semibold') },
  content: { padding: 20, gap: 18, width: '100%', maxWidth: 640, alignSelf: 'center', paddingBottom: 28 },
  hero: { backgroundColor: '#25241F', borderRadius: 20, padding: 24, overflow: 'hidden' },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brand: { color: '#F6D78E', fontSize: 15, fontWeight: weight('semibold'), letterSpacing: 2 },
  proBadge: { backgroundColor: '#F6D78E', borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3 },
  proBadgeText: { color: '#25241F', fontSize: 11, fontWeight: weight('bold'), letterSpacing: 1 },
  heroTitle: { color: '#FFF7E6', fontSize: 30, lineHeight: 42, fontWeight: weight('bold'), marginTop: 24 },
  heroDescription: { color: '#D3CDBE', fontSize: 14, lineHeight: 24, marginTop: 12 },
  heroFooter: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 28, paddingTop: 18, borderTopWidth: 1, borderTopColor: '#494334' },
  heroCaption: { flex: 1, color: '#F6D78E', fontSize: 10, letterSpacing: 1.2, lineHeight: 16 },
  sectionHeading: { gap: 6, marginTop: 8 },
  sectionTitle: { fontSize: 18, fontWeight: weight('bold') },
  body: { fontSize: 13, lineHeight: 22 },
  featureCard: { paddingHorizontal: 18, borderRadius: 16 },
  feature: { flexDirection: 'row', gap: 14, paddingVertical: 20, alignItems: 'flex-start' },
  featureIcon: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  featureCopy: { flex: 1, gap: 5 },
  featureTitle: { fontSize: 15, fontWeight: weight('semibold'), lineHeight: 22 },
  availability: { padding: 18, borderRadius: 16, gap: 12 },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  statusText: { fontSize: 11, fontWeight: weight('medium') },
  guideLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, minHeight: 44 },
  faqHeading: { marginTop: 6 },
  faqCard: { paddingHorizontal: 18, borderRadius: 16 },
  question: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 18 },
  answer: { paddingBottom: 18 },
  footer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  footerContent: { width: '100%', maxWidth: 600, alignSelf: 'center', gap: 10 },
  footerNote: { fontSize: 11, lineHeight: 16, textAlign: 'center' },
  continueButton: { minHeight: 50, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 12 },
  buttonText: { fontSize: 16, fontWeight: weight('bold') },
});
