import { Image } from 'expo-image';
import React, { useState } from 'react';
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
};

export function EditorialImage({ uri, style, children }: Props) {
  const { theme } = useAppTheme();
  const [failed, setFailed] = useState(false);
  return (
    <View style={[styles.frame, { backgroundColor: theme.surfaceAlt }, style]}>
      {!failed ? (
        <Image
          testID="editorial-image"
          source={typeof uri === 'string' ? { uri } : uri}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={150}
          onError={() => setFailed(true)}
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
