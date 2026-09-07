import { Ionicons } from '@expo/vector-icons';
import { ImageBackground } from 'expo-image';
import React from 'react';
import {
  ImageSourcePropType,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { Theme, weight } from '@/constants/theme';

interface SectionHeaderProps {
  title: string;
  theme: Theme;
  moreLabel?: string;
  onMore?: () => void;
}

/** Section title with the red accent bar, used across 阅读/外刊/词库 pages. */
export function SectionHeader({ title, theme, moreLabel, onMore }: SectionHeaderProps) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionTitleRow}>
        <View style={[styles.sectionBar, { backgroundColor: theme.red }]} />
        <Text style={[styles.sectionTitle, { color: theme.text }]}>{title}</Text>
      </View>
      {moreLabel ? (
        <TouchableOpacity onPress={onMore} hitSlop={8} style={styles.moreRow}>
          <Text style={{ color: theme.blue, fontSize: 14 }}>{moreLabel}</Text>
          <Ionicons name="chevron-forward" size={14} color={theme.blue} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

interface CardProps {
  theme: Theme;
  children: React.ReactNode;
  style?: object;
}

export function Card({ theme, children, style }: CardProps) {
  return (
    <View
      style={[
        {
          backgroundColor: theme.surface,
          borderRadius: 8,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.border,
        },
        style,
      ]}>
      {children}
    </View>
  );
}

interface ChipProps {
  label: string;
  color: string;
  bg: string;
}

export function Chip({ label, color, bg }: ChipProps) {
  return (
    <View style={[styles.chip, { backgroundColor: bg }]}>
      <Text style={{ color, fontSize: 11, fontWeight: weight('medium') }}>{label}</Text>
    </View>
  );
}

interface RemoteImageProps {
  uri: string;
  style?: object;
  children?: React.ReactNode;
}

export function RemoteImage({ uri, style, children }: RemoteImageProps) {
  const source: ImageSourcePropType = { uri };
  return (
    <ImageBackground source={source} style={style} imageStyle={{ borderRadius: 8 }}>
      {children}
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center' },
  sectionBar: { width: 4, height: 16, borderRadius: 2, marginRight: 8 },
  sectionTitle: { fontSize: 19, fontWeight: weight('bold') },
  moreRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  chip: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
    alignSelf: 'flex-start',
  },
});
