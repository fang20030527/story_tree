import { useNavigation } from 'expo-router';
import { useIsFocused, usePreventRemove } from 'expo-router/react-navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { saveActivePracticeId } from './practiceStorage';

/** Keep native swipe-back and explicit navigation on the same confirmation path. */
export function usePracticeExitGuard(practiceId: string, enabled = true) {
  const navigation = useNavigation();
  const focused = useIsFocused();
  const prompting = useRef(false);
  const [continuation, setContinuation] = useState<(() => void) | null>(null);

  useEffect(() => {
    if (focused && enabled) void saveActivePracticeId(practiceId).catch(() => undefined);
  }, [enabled, focused, practiceId]);

  usePreventRemove(enabled && focused && !continuation, ({ data }) => {
    if (prompting.current) return;
    prompting.current = true;
    Alert.alert('暂时离开练习？', '已提交的答题记录会保留，可从首页继续练习。', [
      { text: '继续练习', style: 'cancel', onPress: () => { prompting.current = false; } },
      { text: '保存并返回', onPress: () => {
        void saveActivePracticeId(practiceId).then(() => {
          prompting.current = false;
          navigation.dispatch(data.action);
        }).catch(() => {
          prompting.current = false;
          Alert.alert('保存失败', '暂时无法保存练习入口，请重试。');
        });
      } },
    ], { cancelable: false });
  });

  useEffect(() => {
    if (!continuation) return;
    continuation();
  }, [continuation]);

  // Automatic completion/redirects are not attempts to abandon the exercise.
  return useCallback((action: () => void) => setContinuation(() => action), []);
}
