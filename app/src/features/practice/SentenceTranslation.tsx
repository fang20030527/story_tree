import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';

import { ApiError } from '@/api/client';
import { requestSentenceTranslation } from '@/api/sentences';

export function SentenceTranslation({ sentence, cache, color, surfaceColor, borderColor, dangerColor, onClose }: {
  sentence: string;
  cache: Map<string, string>;
  color: string;
  surfaceColor: string;
  borderColor: string;
  dangerColor: string;
  onClose: () => void;
}) {
  const [translation, setTranslation] = useState<string | null>(cache.get(sentence) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    if (cache.has(sentence)) return;
    requestSentenceTranslation(sentence).then((result) => {
      cache.set(sentence, result);
      if (active) setTranslation(result);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof ApiError ? reason.message : '暂时无法翻译这个句子');
    });
    return () => { active = false; };
  }, [sentence, cache, attempt]);

  return (
    <View style={{ padding: 14, borderRadius: 14, borderWidth: 1, borderColor, backgroundColor: surfaceColor }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color, fontWeight: '600' }}>单句翻译</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="关闭单句翻译" hitSlop={8} onPress={onClose}>
          <Text style={{ color, fontSize: 22 }}>×</Text>
        </TouchableOpacity>
      </View>
      <Text selectable style={{ color, fontSize: 14, lineHeight: 22, marginTop: 8 }}>{sentence}</Text>
      {translation ? <Text selectable style={{ color, fontSize: 16, lineHeight: 25, marginTop: 10 }}>{translation}</Text>
        : error ? (
          <TouchableOpacity accessibilityRole="button" onPress={() => { setError(null); setAttempt((value) => value + 1); }}>
            <Text style={{ color: dangerColor, marginTop: 10 }}>{error} · 重试</Text>
          </TouchableOpacity>
        ) : <View accessibilityLabel="句子翻译中" style={{ marginTop: 10 }}><ActivityIndicator color={color} /></View>}
    </View>
  );
}
