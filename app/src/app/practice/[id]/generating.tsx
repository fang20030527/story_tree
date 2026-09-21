import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { weight } from '@/constants/theme';
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

function GeneratingPractice({ practiceId }: { practiceId: string }) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { practice, error, retry } = usePracticePolling(practiceId);
  const [storageError, setStorageError] = useState<string | null>(null);
  const finishingReady = useRef(false);
  const clearingFailure = useRef(false);

  const openReader = useCallback(() => {
    if (finishingReady.current) return;
    finishingReady.current = true;
    return clearReadyPracticeCreation()
      .then(() => {
        router.replace({
          pathname: '/practice/[id]/read',
          params: { id: practiceId },
        });
      })
      .catch(() => {
        finishingReady.current = false;
        setStorageError('练习已生成，但本地状态清理失败，请重试');
      });
  }, [practiceId]);

  useEffect(() => {
    if (
      practice?.status === 'ready'
      || practice?.status === 'in_progress'
      || practice?.status === 'completed'
    ) {
      void openReader();
    }
  }, [openReader, practice?.status]);

  useEffect(() => {
    if (practice?.status !== 'failed' || clearingFailure.current) return;
    clearingFailure.current = true;
    clearCreatePracticeOperation().catch(() => {
      clearingFailure.current = false;
      setStorageError('无法清理失败的创建记录，请重试返回');
    });
  }, [practice?.status]);

  const returnToForm = async () => {
    setStorageError(null);
    try {
      await clearCreatePracticeOperation();
      router.replace('/practice/new');
    } catch {
      setStorageError('无法清理失败的创建记录，请重试');
    }
  };

  const failed = practice?.status === 'failed';
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
        <View style={[styles.iconCircle, { backgroundColor: theme.accentSoft }]}>
          <Ionicons
            name={failed ? 'alert-circle-outline' : 'sparkles'}
            size={42}
            color={failed ? theme.danger : theme.accent}
          />
        </View>

        {failed ? (
          <>
            <Text style={[styles.title, { color: theme.text }]}>生成未完成</Text>
            <Text style={[styles.detail, { color: theme.textSecondary }]}>
              {practice.failure?.message ?? '文章暂时无法生成'}
            </Text>
            <TouchableOpacity
              onPress={() => void returnToForm()}
              style={[styles.primaryButton, { backgroundColor: theme.accent }]}>
              <Text style={[styles.primaryText, { color: theme.accentText }]}>
                返回修改词义
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <ActivityIndicator
              color={theme.accent}
              size="small"
              style={styles.spinner}
            />
            <Text style={[styles.title, { color: theme.text }]}>{safeStatus}</Text>
          </>
        )}

        {error ? (
          <View style={styles.errorArea}>
            <Text style={[styles.detail, { color: theme.danger }]}>
              {error.message}
            </Text>
            <TouchableOpacity
              onPress={retry}
              style={[styles.secondaryButton, { borderColor: theme.border }]}>
              <Text style={[styles.secondaryText, { color: theme.text }]}>重试</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {storageError ? (
          <View style={styles.errorArea}>
            <Text style={[styles.detail, { color: theme.danger }]}>
              {storageError}
            </Text>
            {practice?.status === 'ready' ? (
              <TouchableOpacity
                onPress={() => {
                  setStorageError(null);
                  void openReader();
                }}
                style={[styles.secondaryButton, { borderColor: theme.border }]}>
                <Text style={[styles.secondaryText, { color: theme.text }]}>重试</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

export default function GeneratingPracticeScreen() {
  const { theme } = useAppTheme();
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const practiceId = typeof id === 'string' ? id : null;

  if (!practiceId) {
    return (
      <View style={[styles.content, { backgroundColor: theme.bg }]}>
        <Text style={[styles.title, { color: theme.text }]}>练习地址无效</Text>
        <TouchableOpacity
          onPress={() => router.replace('/practice/new')}
          style={[styles.secondaryButton, { borderColor: theme.border }]}>
          <Text style={[styles.secondaryText, { color: theme.text }]}>返回录入</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return <GeneratingPractice practiceId={practiceId} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 28,
  },
  iconCircle: {
    alignItems: 'center',
    borderRadius: 42,
    height: 84,
    justifyContent: 'center',
    width: 84,
  },
  spinner: { marginTop: 24 },
  title: {
    fontSize: 23,
    fontWeight: weight('bold'),
    marginTop: 16,
    textAlign: 'center',
  },
  detail: { fontSize: 14, lineHeight: 22, marginTop: 10, textAlign: 'center' },
  errorArea: { alignItems: 'center', marginTop: 20, width: '100%' },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 12,
    marginTop: 24,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  primaryText: { fontSize: 15, fontWeight: weight('bold') },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: 14,
    minHeight: 44,
    paddingHorizontal: 24,
  },
  secondaryText: { fontSize: 14, fontWeight: weight('semibold') },
});
