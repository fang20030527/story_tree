import { Ionicons } from '@expo/vector-icons';
import { useEvent } from 'expo';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as WebBrowser from 'expo-web-browser';
import type { ImportedArticleMedia } from '@context-reader/contracts';
import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type { Theme } from '@/constants/theme';
import { weight } from '@/constants/theme';

export function ArticleMediaBlock({ media, theme }: {
  media: ImportedArticleMedia;
  theme: Theme;
}) {
  const [aspectRatio, setAspectRatio] = useState(
    media.type === 'image' && media.width && media.height ? media.width / media.height : 16 / 9,
  );
  const [playing, setPlaying] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  const openOriginal = () => { void WebBrowser.openBrowserAsync(media.url); };
  return (
    <View style={styles.block}>
      {media.type === 'image' ? (
        imageFailed ? (
          <TouchableOpacity accessibilityRole="button" onPress={openOriginal} style={[styles.fallback, { backgroundColor: theme.surfaceAlt }]}>
            <Ionicons name="image-outline" size={24} color={theme.textMuted} />
            <Text style={{ color: theme.textSecondary }}>图片暂时无法加载，点按查看原图</Text>
          </TouchableOpacity>
        ) : (
          <Image
            accessibilityLabel={media.alt ?? media.caption ?? '文章图片'}
            contentFit="contain"
            onError={() => setImageFailed(true)}
            onLoad={({ source }) => {
              if (source.width > 0 && source.height > 0) setAspectRatio(source.width / source.height);
            }}
            source={{ uri: media.url }}
            style={[styles.image, { aspectRatio, backgroundColor: theme.surfaceAlt }]}
          />
        )
      ) : media.direct && playing ? (
        <DirectVideo url={media.url} theme={theme} />
      ) : (
        <TouchableOpacity
          accessibilityLabel={media.direct ? '播放视频' : '在原网页播放视频'}
          accessibilityRole="button"
          onPress={() => media.direct ? setPlaying(true) : openOriginal()}
          style={[styles.videoPoster, { backgroundColor: theme.surfaceAlt }]}>
          {media.posterUrl ? (
            <Image contentFit="cover" source={{ uri: media.posterUrl }} style={StyleSheet.absoluteFill} />
          ) : null}
          <View style={styles.playButton}>
            <Ionicons name="play" size={29} color="#202224" style={styles.playIcon} />
          </View>
          <Text style={styles.videoHint}>{media.direct ? '播放视频' : '在原网页播放'}</Text>
        </TouchableOpacity>
      )}
      {media.caption ? (
        <View style={styles.captionArea}>
          {media.type === 'image' && media.credit ? (
            <Text style={[styles.credit, { color: theme.textMuted }]}>{media.credit}</Text>
          ) : null}
          <Text style={[styles.caption, { color: theme.textSecondary }]}>{media.caption}</Text>
        </View>
      ) : media.type === 'image' && media.credit ? (
        <Text style={[styles.credit, styles.captionArea, { color: theme.textMuted }]}>{media.credit}</Text>
      ) : null}
    </View>
  );
}

function DirectVideo({ url, theme }: { url: string; theme: Theme }) {
  const player = useVideoPlayer(url, (created) => created.play());
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  if (status === 'error') {
    return (
      <TouchableOpacity
        accessibilityRole="button"
        onPress={() => { void WebBrowser.openBrowserAsync(url); }}
        style={[styles.fallback, { backgroundColor: theme.surfaceAlt }]}>
        <Text style={{ color: theme.textSecondary }}>视频暂时无法播放，点按打开原视频</Text>
      </TouchableOpacity>
    );
  }
  return <VideoView player={player} nativeControls fullscreenOptions={{ enable: true }} style={styles.videoPoster} />;
}

const styles = StyleSheet.create({
  block: { marginBottom: 26, marginHorizontal: -18 },
  image: { width: '100%' },
  videoPoster: { alignItems: 'center', aspectRatio: 16 / 9, justifyContent: 'center', width: '100%' },
  playButton: { alignItems: 'center', backgroundColor: '#fff', borderRadius: 40, height: 70, justifyContent: 'center', width: 70 },
  playIcon: { marginLeft: 3 },
  videoHint: { backgroundColor: '#202224CC', borderRadius: 4, bottom: 12, color: '#fff', fontSize: 12, fontWeight: weight('semibold'), overflow: 'hidden', paddingHorizontal: 7, paddingVertical: 4, position: 'absolute', right: 12 },
  captionArea: { paddingHorizontal: 18, paddingTop: 8 },
  caption: { fontSize: 13, lineHeight: 20 },
  credit: { fontSize: 11, lineHeight: 17, marginBottom: 2 },
  fallback: { alignItems: 'center', aspectRatio: 16 / 9, gap: 8, justifyContent: 'center', width: '100%' },
});
