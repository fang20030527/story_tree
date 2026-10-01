import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card } from '@/components/ui';
import { weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';

type GuideItem = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  desc: string;
};

type GuideSection = {
  heading: string;
  items: GuideItem[];
};

const SECTIONS: GuideSection[] = [
  {
    heading: '阅读与口语',
    items: [
      { icon: 'swap-horizontal-outline', title: '切换学习模式', desc: '点击「我的」标题旁的模式按钮，切换阅读或口语。口语导航为素材、文件、我的。' },
      { icon: 'mic-outline', title: '影子跟读', desc: '同步字幕、变速、逐句与 AB 复读，录下自己的声音并回放。当前不提供 AI 发音评分。' },
      { icon: 'search-outline', title: '字幕查词与积累', desc: '点按英文单词查询离线词典；收藏句子、写台词笔记。云素材的练习位置和记录同步到账号。' },
    ],
  },
  {
    heading: '口语文件与服务状态',
    items: [
      { icon: 'videocam-outline', title: '导入自己的音视频', desc: '登录后可上传最多 3 GB 的音视频；未登录可使用最多 100 MB 的本地文件。支持 SRT／VTT 双语字幕，保存后可以校正文本和时间轴。' },
      { icon: 'text-outline', title: '没有字幕怎么办', desc: '当前可手动添加字幕。自动语音识别和 AI 台词讲解需要接入服务后开放。' },
      { icon: 'diamond-outline', title: 'VIP 方案', desc: '阅读与口语同享。当前可查看套餐和权益，购买、支付与邀请码兑换尚未开放。' },
    ],
  },
  {
    heading: '导入文章',
    items: [
      {
        icon: 'link-outline',
        title: '网页链接',
        desc: '粘贴外刊或博客文章链接，自动抓取正文内容。',
      },
      {
        icon: 'document-text-outline',
        title: '粘贴正文',
        desc: '直接粘贴一段英文正文，马上开始精读。',
      },
      {
        icon: 'images-outline',
        title: '相册导入',
        desc: '从相册选择文章截图，识别图中文字生成文章。',
      },
      {
        icon: 'folder-open-outline',
        title: '本地文件',
        desc: '导入手机里的文本文件（如 .txt / .md）。',
      },
      {
        icon: 'desktop-outline',
        title: '电脑上传',
        desc: '手机和电脑连同一 Wi-Fi，在电脑浏览器里上传文章。',
      },
    ],
  },
  {
    heading: '精读工具',
    items: [
      {
        icon: 'language-outline',
        title: '全文翻译',
        desc: '阅读页可一键翻译全文，对照原文逐段阅读。',
      },
      {
        icon: 'text-outline',
        title: '段落翻译',
        desc: '点击任意段落，只看该段的翻译，不打断阅读节奏。',
      },
    ],
  },
  {
    heading: '记录与复习',
    items: [
      {
        icon: 'time-outline',
        title: '最近观看',
        desc: '打开过的文章会自动记录，随时回到上次的内容。',
      },
      {
        icon: 'book-outline',
        title: '我的书架',
        desc: '平台外刊可主动加入书架，导入文章后会自动出现。',
      },
      {
        icon: 'school-outline',
        title: '词库练习',
        desc: '在底部「词库」页对学过的词汇进行巩固练习。',
      },
    ],
  },
];

export default function FeatureGuideScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.headerSide}>
          <Ionicons name="chevron-back" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>功能概览</Text>
        <View style={styles.headerSide} />
      </View>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}>
        {SECTIONS.map((section) => (
          <View key={section.heading} style={{ marginBottom: 18 }}>
            <Text style={[styles.sectionHeading, { color: theme.textSecondary }]}>
              {section.heading}
            </Text>
            <Card theme={theme} style={styles.sectionCard}>
              {section.items.map((item, i) => (
                <View
                  key={item.title}
                  style={[
                    styles.itemRow,
                    i > 0 && {
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderTopColor: theme.border,
                    },
                  ]}>
                  <View style={[styles.itemIcon, { backgroundColor: theme.accentSoft }]}>
                    <Ionicons name={item.icon} size={18} color={theme.accent} />
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={[styles.itemTitle, { color: theme.text }]}>
                      {item.title}
                    </Text>
                    <Text style={[styles.itemDesc, { color: theme.textSecondary }]}>
                      {item.desc}
                    </Text>
                  </View>
                </View>
              ))}
            </Card>
          </View>
        ))}
      </ScrollView>
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
  headerSide: { width: 32 },
  headerTitle: { fontSize: 17, fontWeight: weight('semibold') },
  sectionHeading: { fontSize: 13, fontWeight: weight('semibold'), marginBottom: 8, marginLeft: 4 },
  sectionCard: { paddingHorizontal: 14, paddingVertical: 4 },
  itemRow: { alignItems: 'center', flexDirection: 'row', paddingVertical: 12 },
  itemIcon: {
    alignItems: 'center',
    borderRadius: 8,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  itemTitle: { fontSize: 15, fontWeight: weight('semibold') },
  itemDesc: { fontSize: 12, lineHeight: 17, marginTop: 2 },
});
