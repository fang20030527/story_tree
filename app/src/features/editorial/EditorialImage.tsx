import { Image } from 'expo-image';
import React, { useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useAppTheme } from '@/context/ThemeContext';

type Props = {
  uri: string | number;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  priority?: 'low' | 'normal' | 'high';
  contentFit?: 'cover' | 'contain';
  accessibilityLabel?: string;
};

// An idle API host can need longer than the first few retries to become ready.
const RETRY_DELAYS_MS = [2_000, 6_000, 15_000, 30_000, 45_000];

export function EditorialImage({ uri, style, children, priority = 'normal', contentFit = 'cover', accessibilityLabel }: Props) {
  return <EditorialImageContent key={String(uri)} uri={uri} style={style} priority={priority}
    contentFit={contentFit} accessibilityLabel={accessibilityLabel}>{children}</EditorialImageContent>;
}

function EditorialImageContent({ uri, style, children, priority, contentFit, accessibilityLabel }: Props) {
  const { theme } = useAppTheme();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = null;
    };
  }, []);

  const onError = () => {
    // The image host can still be waking when an issue is first opened.
    // Keep the article usable and retry remote images without requiring navigation.
    if (typeof uri !== 'string' || !uri || attempt >= RETRY_DELAYS_MS.length) {
      setFailed(true);
      return;
    }
    if (retryTimer.current) return;
    retryTimer.current = setTimeout(() => {
      retryTimer.current = null;
      setAttempt((current) => current + 1);
    }, RETRY_DELAYS_MS[attempt]);
  };

  return (
    <View style={[styles.frame, { backgroundColor: theme.surfaceAlt }, style]}>
      {!failed && uri ? (
        <Image
          key={`${uri}:${attempt}`}
          testID="editorial-image"
          source={typeof uri === 'string' ? { uri } : uri}
          style={StyleSheet.absoluteFill}
          contentFit={contentFit}
          cachePolicy="memory-disk"
          priority={priority}
          transition={150}
          onError={onError}
          accessibilityLabel={accessibilityLabel}
          accessibilityIgnoresInvertColors
        />
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden' },
});
