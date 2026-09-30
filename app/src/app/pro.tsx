import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandLogo } from '@/components/brand';
import { fonts } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';

const FEATURES = [
  ['智能陪练', '在新的语境中，掌握自己的积累。'],
  ['语境查词', '结合上下文，理解单词的具体含义。'],
  ['长难句分析', '理清句子结构，读懂复杂表达。'],
  ['专业语音朗读', '让每篇文章，都可以听着学。'],
];
const PLANS = [{ name: '月度会员', price: 19, days: '30 天' }, { name: '年度会员', price: 128, days: '365 天' }, { name: '永久会员', price: 198, days: '长期有效' }];

export default function ProScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [plan, setPlan] = useState(1);
  const [invite, setInvite] = useState(false);
  const goBack = () => { if (router.canGoBack()) router.back(); else router.replace('/(tabs)/profile'); };
  return <View style={[styles.screen, { backgroundColor: theme.bg }]}>
    <View style={[styles.header, { paddingTop: insets.top + 4 }]}><TouchableOpacity accessibilityRole="button" accessibilityLabel="返回" onPress={goBack} style={styles.back}><Ionicons name="arrow-back" size={25} color={theme.text} /></TouchableOpacity><Text style={{ color: theme.text, fontSize: 16 }}>开通 VIP</Text><View style={styles.back} /></View>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={[styles.hero, { backgroundColor: theme.vip }]}>
        <View style={styles.heroTop}><BrandLogo width={42} /><Text style={[styles.vip, { color: theme.pink }]}>VIP</Text></View>
        <Text style={[styles.heroTitle, { color: theme.onVip }]}>阅读的可能，{'\n'}再多一点。</Text>
        <Text style={[styles.heroSubtitle, { color: theme.onVip }]}>解锁全部阅读特权，畅享英语外刊精读。</Text>
      </View>
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: theme.text }]}>为更深入的阅读而准备</Text>
      {FEATURES.map(([title, description], i) => <View key={title} style={[styles.feature, { borderBottomColor: theme.border }]}><Text style={[styles.number, { color: theme.accent }]}>{String(i + 1).padStart(2, '0')}</Text><View style={{ flex: 1 }}><Text style={[styles.featureTitle, { color: theme.text }]}>{title}</Text><Text style={[styles.hint, { color: theme.textMuted }]}>{description}</Text></View></View>)}
      <View style={styles.planHeading}><Text style={[styles.sectionTitle, { color: theme.text }]}>选择你的阅读计划</Text><Text style={[styles.hint, { color: theme.textMuted }]}>方案预览</Text></View>
      <View style={styles.plans}>{PLANS.map((item, i) => <TouchableOpacity key={item.name} accessibilityRole="button" accessibilityState={{ selected: plan === i }} onPress={() => setPlan(i)} style={[styles.plan, { borderColor: plan === i ? theme.accent : theme.border, backgroundColor: plan === i ? theme.accentSoft : theme.surface }]}><Text style={[styles.planName, { color: theme.text }]}>{item.name}</Text><Text style={[styles.price, { color: plan === i ? theme.accent : theme.text }]}>¥{item.price}</Text><Text style={[styles.hint, { color: theme.textMuted }]}>{item.days}</Text></TouchableOpacity>)}</View>
      <Text style={[styles.notice, { color: theme.textSecondary }]}>VIP 暂未开放购买 · 当前不会扣费。以上为拟定方案，正式价格、权益与使用额度以上线说明为准。</Text>
      <TouchableOpacity accessibilityRole="button" onPress={() => router.push('/feature-guide')} style={styles.guide}><Text style={{ color: theme.accent }}>查看当前功能与使用方法</Text><Ionicons name="arrow-forward" color={theme.accent} size={18} /></TouchableOpacity>
      <View style={[styles.invite, { borderTopColor: theme.border }]}><TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: invite }} onPress={() => setInvite(!invite)} style={styles.inviteHeading}><View><Text style={[styles.featureTitle, { color: theme.text }]}>邀请码兑换</Text><Text style={[styles.hint, { color: theme.textMuted }]}>已有邀请码？在这里兑换阅读权益。</Text></View><Ionicons name={invite ? 'chevron-up' : 'chevron-forward'} size={19} color={theme.textMuted} /></TouchableOpacity>{invite ? <View style={{ gap: 10 }}><TextInput accessibilityLabel="邀请码" editable={false} placeholder="兑换服务尚未开放" placeholderTextColor={theme.textMuted} style={[styles.input, { borderColor: theme.border, color: theme.text }]} /><Text style={[styles.hint, { color: theme.textMuted }]}>兑换服务上线后即可使用，当前不会验证或保存邀请码。</Text></View> : null}</View>
    </ScrollView>
    <View style={[styles.footer, { borderTopColor: theme.border, paddingBottom: Math.max(insets.bottom, 12), backgroundColor: theme.bg }]}><View style={styles.footerInner}><Text style={[styles.hint, { color: theme.textMuted, textAlign: 'center' }]}>购买与兑换服务正在准备中</Text><TouchableOpacity disabled accessibilityRole="button" accessibilityState={{ disabled: true }} style={[styles.primary, { backgroundColor: theme.surfaceAlt }]}><Text style={{ color: theme.textMuted, fontSize: 16 }}>暂未开放开通</Text></TouchableOpacity><TouchableOpacity onPress={goBack} style={styles.continue}><Text style={{ color: theme.accent }}>继续学习</Text></TouchableOpacity></View></View>
  </View>;
}
const styles = StyleSheet.create({
  screen: { flex: 1 }, header: { paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 24, paddingTop: 20, paddingBottom: 30, width: '100%', maxWidth: 720, alignSelf: 'center' },
  hero: { padding: 24, borderRadius: 3, marginBottom: 30 }, heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  vip: { fontFamily: fonts.display, fontSize: 40 }, heroTitle: { fontSize: 32, lineHeight: 44, marginTop: 20 }, heroSubtitle: { fontSize: 12, lineHeight: 22, marginTop: 12 },
  sectionTitle: { fontSize: 19, lineHeight: 28 }, feature: { flexDirection: 'row', gap: 18, paddingVertical: 18, borderBottomWidth: StyleSheet.hairlineWidth },
  number: { fontFamily: fonts.display, fontSize: 26, width: 30 }, featureTitle: { fontSize: 15, lineHeight: 23 }, hint: { fontSize: 11, lineHeight: 18, marginTop: 4 },
  planHeading: { marginTop: 28, marginBottom: 18 }, plans: { flexDirection: 'row', gap: 8 },
  plan: { flex: 1, minWidth: 0, borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 18, alignItems: 'center' },
  planName: { fontSize: 12 }, price: { fontFamily: fonts.display, fontSize: 38, lineHeight: 45, marginTop: 12 },
  notice: { fontSize: 11, lineHeight: 20, marginTop: 14 }, guide: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  invite: { marginTop: 22, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12 }, inviteHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 },
  input: { borderWidth: 1, borderRadius: 4, minHeight: 48, paddingHorizontal: 14 },
  footer: { paddingHorizontal: 24, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth }, footerInner: { width: '100%', maxWidth: 672, alignSelf: 'center' },
  primary: { minHeight: 50, borderRadius: 3, alignItems: 'center', justifyContent: 'center', marginTop: 8 }, continue: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
