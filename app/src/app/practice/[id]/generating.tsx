import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OrbitLoader } from '@/components/brand';
import { PrimaryAction, SecondaryAction } from '@/components/subpage';
import { fonts, weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';
import {
  clearCreatePracticeOperation,
  clearReadyPracticeCreation,
} from '@/features/practice/practiceStorage';
import { usePracticePolling } from '@/features/practice/usePracticePolling';

const statusText = {
  queued: '正在排队',
  generating: '正在生成',
  validating: '正在检查',
} as const;

function GeneratingPractice({
  practiceId,
  vocabularyOrigin,
}: {
  practiceId: string;
  vocabularyOrigin: boolean;
}) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { practice, error, retry } = usePracticePolling(practiceId);
  const [storageError, setStorageError] = useState<string | null>(null);
  const groupId = practice?.group?.id;
  const finishingReady = useRef(false);
  const clearingFailure = useRef(false);

  const openNextStep = useCallback(async () => {
    if (finishingReady.current) return;
    finishingReady.current = true;
    try {
      await clearReadyPracticeCreation();
      router.replace({
        pathname: groupId ? '/practice/[id]/topics' : '/practice/[id]/read',
        params: groupId
          ? { id: groupId, origin: vocabularyOrigin ? 'vocabulary' : undefined }
          : { id: practiceId },
      });
    } catch {
      finishingReady.current = false;
      setStorageError(groupId ? '暂时无法打开主题选择，请重试' : '练习已生成，但本地状态清理失败，请重试');
    }
  }, [practiceId, groupId, vocabularyOrigin]);

  useEffect(() => {
    if (
      practice?.group || practice?.status === 'ready'
      || practice?.status === 'in_progress'
      || practice?.status === 'completed'
    ) {
      const openTimer = setTimeout(() => void openNextStep(), 0);
      return () => clearTimeout(openTimer);
    }
    return undefined;
  }, [openNextStep, practice?.status, practice?.group]);

  useEffect(() => {
    if (practice?.group || practice?.status !== 'failed' || clearingFailure.current) return;
    clearingFailure.current = true;
    clearCreatePracticeOperation().catch(() => {
      clearingFailure.current = false;
      setStorageError('无法清理失败的创建记录，请重试返回');
    });
  }, [practice?.status, practice?.group]);

  const returnToForm = async () => {
    setStorageError(null);
    try {
      await clearCreatePracticeOperation();
      router.replace(
        vocabularyOrigin ? '/practice/from-vocabulary' : '/practice/new',
      );
    } catch {
      setStorageError('无法清理失败的创建记录，请重试');
    }
  };

  const failed = !practice?.group && practice?.status === 'failed';
  const currentStatus = practice?.status;
  const safeStatus = currentStatus === 'generating'
    || currentStatus === 'validating'
    || currentStatus === 'queued'
    ? statusText[currentStatus]
    : statusText.queued;

  return (
    <View
      style={[
        styles.screen,
        {
          backgroundColor: theme.bg,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        },
      ]}>
      <View style={styles.content}>
        {failed ? (
          <>
            <Text style={[styles.eyebrow, { color: theme.danger }]}>GENERATION STOPPED</Text>
            <Text style={[styles.title, { color: theme.text }]}>生成未完成</Text>
            <Text style={[styles.detail, { color: theme.textSecondary }]}>
              {practice.failure?.message ?? '文章暂时无法生成'}
            </Text>
            <PrimaryAction label={vocabularyOrigin ? '返回调整数量' : '返回修改词义'} onPress={() => void returnToForm()} style={styles.primaryButton} />
          </>
        ) : (
          <>
            <OrbitLoader label={safeStatus} />
            <Text style={[styles.title, { color: theme.text }]}>{safeStatus}</Text>
            <Text style={[styles.detail, { color: theme.textSecondary }]}>通常需要半分钟到一分钟，可以离开本页，稍后在首页继续。</Text>
          </>
        )}

        {error ? (
          <View style={styles.errorArea}>
            <Text style={[styles.detail, { color: theme.danger }]}>
              {error.message}
            </Text>
            <SecondaryAction label="重试" onPress={retry} style={styles.secondaryButton} />
          </View>
        ) : null}

        {storageError ? (
          <View style={styles.errorArea}>
            <Text style={[styles.detail, { color: theme.danger }]}>
              {storageError}
            </Text>
            {practice?.group || practice?.status === 'ready' || practice?.status === 'in_progress' || practice?.status === 'completed' ? (
              <SecondaryAction label="重试" onPress={() => void openNextStep()} style={styles.secondaryButton} />
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

export default function GeneratingPracticeScreen() {
  const { theme } = useAppTheme();
  const { id, origin } = useLocalSearchParams<{
    id?: string | string[];
    origin?: string | string[];
  }>();
  const practiceId = typeof id === 'string' ? id : null;
  const vocabularyOrigin = origin === 'vocabulary';

  if (!practiceId) {
    return (
      <View style={[styles.content, { backgroundColor: theme.bg }]}>
        <Text style={[styles.title, { color: theme.text }]}>练习地址无效</Text>
        <SecondaryAction label={vocabularyOrigin ? '返回设置' : '返回录入'} onPress={() => router.replace(vocabularyOrigin ? '/practice/from-vocabulary' : '/practice/new')} style={styles.secondaryButton} />
      </View>
    );
  }

  return (
    <GeneratingPractice
      practiceId={practiceId}
      vocabularyOrigin={vocabularyOrigin}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { width: '100%', maxWidth: 760, alignSelf: 'center',
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 28,
   },
  eyebrow: { fontFamily: fonts.label, fontSize: 11, letterSpacing: 1.6 },
  title: { fontSize: 22, fontWeight: weight('bold'), marginTop: 18, textAlign: 'center' },
  detail: { fontSize: 14, lineHeight: 22, marginTop: 10, textAlign: 'center', maxWidth: 320 },
  errorArea: { alignItems: 'center', marginTop: 20, width: '100%' },
  primaryButton: { marginTop: 24, alignSelf: 'center' },
  secondaryButton: { marginTop: 14 },
});
