import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useAppTheme } from '@/context/ThemeContext';
import { SpeakingHeader, speakingStyles } from '@/features/speaking/SpeakingComponents';

export default function SpeakingGuide() {
  const { theme } = useAppTheme();
  const sections = [
    ['先理解，再模仿', '播放原音，理解字幕的意思。用较慢速度听清重音与停顿，再跟着说。'],
    ['一句一句练', '点击字幕定位，打开逐句复读；也可以设置 A、B 起终点练习一段。复读次数和停顿在设置里调整。'],
    ['录下自己的声音', '点击录音时才申请麦克风权限。录音会暂停原音，停止后可以回放比较；当前不提供 AI 发音评分。'],
    ['把字幕藏起来', '切换双语、英文、中文或关闭字幕；打开遮挡板后，点击句子揭开。'],
    ['遇到生词随手查', '点按英文字幕中的单词查询离线词典。也可以在词汇面板输入单词；词典释义需要结合原句理解。'],
    ['练自己的文件', '登录后可上传最多 3 GB 的音视频，导入 SRT／VTT 字幕并校正；未登录可使用最多 100 MB 的本地文件。没有字幕可以手动添加，自动识别尚未开放。'],
    ['留住积累', '云素材的字幕、收藏、笔记、跟读录音和练习记录同步到账号。个人本地文件及原有设备记录继续保留；同步失败时可以重试。'],
  ];
  return <View style={[speakingStyles.page, { backgroundColor: theme.bg }]}><SpeakingHeader title="跟读指南" /><ScrollView contentContainerStyle={speakingStyles.content}>{sections.map(([title, body]) => <View key={title} style={{ marginBottom: 28 }}><Text accessibilityRole="header" style={[speakingStyles.section, { color: theme.text }]}>{title}</Text><Text style={[speakingStyles.hint, { color: theme.textSecondary }]}>{body}</Text></View>)}</ScrollView></View>;
}
