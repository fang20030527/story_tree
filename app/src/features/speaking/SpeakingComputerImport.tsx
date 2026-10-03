import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { useAppTheme } from '@/context/ThemeContext';
import { SpeakingButton, speakingStyles } from './SpeakingComponents';

export function speakingComputerUploadUrl() {
  const origin = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin
    : process.env.EXPO_PUBLIC_WEB_BASE_URL || 'https://blackholeenglish.com';
  return `${origin.replace(/\/$/u, '')}/speaking/import?source=local`;
}

export function SpeakingComputerImport({ cloud, onRefresh, onPick, loading }: {
  cloud: boolean; onRefresh: () => void; onPick: () => void; loading: boolean;
}) {
  const { theme } = useAppTheme();
  const [message, setMessage] = useState('');
  const address = speakingComputerUploadUrl();
  return <View style={{ gap: 16, paddingVertical: 18 }}>
    <Text style={{ color: theme.text, fontSize: 20, fontWeight: '600' }}>在电脑上传，手机继续练。</Text>
    <Text style={[speakingStyles.hint, { color: theme.textMuted }]}>1. 在电脑浏览器打开下面的地址。{ '\n' }2. 登录与手机相同的邮箱账号，选择音视频和字幕并保存。{ '\n' }3. 回到手机刷新文件库，打开新文件继续跟读。</Text>
    <Text selectable style={{ color: theme.accent, fontSize: 14, lineHeight: 24 }}>{address}</Text>
    <SpeakingButton label="复制电脑上传地址" onPress={() => { void Clipboard.setStringAsync(address)
      .then(() => setMessage('地址已复制，可发送给自己的电脑')).catch(() => setMessage('复制失败，可以长按上方地址复制')); }} />
    {Platform.OS === 'web' ? <SpeakingButton label="在这台电脑选择音视频" onPress={onPick} /> : null}
    {!cloud ? <Pressable accessibilityRole="button" onPress={() => router.push('/login')} style={{ minHeight: 44, justifyContent: 'center' }}>
      <Text style={{ color: theme.accent }}>登录账号并同步电脑文件 →</Text>
    </Pressable> : <SpeakingButton label={loading ? '正在刷新账号文件…' : '刷新账号文件库'} disabled={loading} onPress={onRefresh} />}
    {message ? <Text accessibilityRole="alert" style={[speakingStyles.hint, { color: theme.textMuted }]}>{message}</Text> : null}
    <Text style={[speakingStyles.hint, { color: theme.textMuted }]}>云端文件单个最多 3 GB。电脑上传需要同时提供 SRT／VTT 字幕，或手动添加至少一句字幕。</Text>
  </View>;
}
