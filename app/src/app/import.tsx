import { Ionicons } from '@expo/vector-icons';
import { SharedArticleUrlSchema } from '@context-reader/contracts';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { registerAnonymous } from '@/api/practices';
import {
  createArticleImport,
  putPastedSource,
  startArticleImport,
  uploadImportAsset,
} from '@/api/imports';
import { createIdempotencyKey } from '@/api/installation';
import { importSources } from '@/data/mock';
import { useAppTheme } from '@/context/ThemeContext';
import {
  loadOrCreateImportOperationKey,
  loadActiveImportId,
  saveActiveImportId,
} from '@/features/imports/importStorage';
import { hasConfirmedAge, saveAgeConfirmation } from '@/features/practice/practiceStorage';
import { weight } from '@/constants/theme';
import type { ImportAssetDescriptor } from '@context-reader/contracts';

type SourceId = (typeof importSources)[number]['id'];
type SelectedAsset = {
  uri: string;
  name: string;
  mediaType: string;
  byteSize: number;
};

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 30 * 1024 * 1024;
const ACCEPTED_DOCUMENT_TYPES = [
  'text/plain',
  'text/markdown',
  'text/html',
  'application/xhtml+xml',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'application/octet-stream',
];

const MIME_BY_EXTENSION: Record<string, string> = {
  txt: 'text/plain',
  text: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  html: 'text/html',
  htm: 'text/html',
  xhtml: 'application/xhtml+xml',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
};

const SERVER_IMPORT_KIND: Record<Exclude<SourceId, 'computer'>, 'url' | 'paste' | 'album' | 'local_file'> = {
  link: 'url',
  paste: 'paste',
  album: 'album',
  local: 'local_file',
};

function displayBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function displayName(name: string): string {
  if (name.length <= 42) return name;
  const extensionIndex = name.lastIndexOf('.');
  const extension = extensionIndex > 0 ? name.slice(extensionIndex) : '';
  return `${name.slice(0, Math.max(8, 42 - extension.length - 1))}…${extension}`;
}

function mediaTypeFor(name: string, declared?: string | null): string {
  const normalized = declared?.split(';', 1)[0]?.trim().toLowerCase();
  const extension = name.split('.').pop()?.toLowerCase();
  const extensionType = extension ? MIME_BY_EXTENSION[extension] : undefined;
  // Some document providers report every file as text/plain. Prefer a known
  // extension in that case so HTML, Markdown, PDFs, and images reach the
  // server with the declaration its magic-byte checks expect.
  if (
    extensionType &&
    (!normalized || normalized === 'text/plain' || normalized === 'application/octet-stream')
  ) return extensionType;
  if (
    normalized &&
    normalized !== 'application/octet-stream' &&
    ACCEPTED_DOCUMENT_TYPES.includes(normalized)
  ) return normalized;
  return extensionType ?? 'application/octet-stream';
}

function publicErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return '导入暂时无法完成，请稍后重试';
}

async function assetFromFile(
  input: { uri: string; name: string; mediaType?: string | null; byteSize?: number },
): Promise<SelectedAsset> {
  const mediaType = mediaTypeFor(input.name, input.mediaType);
  const byteSize = input.byteSize ?? new File(input.uri).size;
  if (!Number.isSafeInteger(byteSize) || byteSize < 1) {
    throw new Error('无法读取所选文件大小');
  }
  if (byteSize > MAX_FILE_BYTES) {
    throw new Error(`单个文件不能超过 ${displayBytes(MAX_FILE_BYTES)}`);
  }
  return {
    uri: input.uri,
    name: input.name || '未命名文件',
    mediaType,
    byteSize,
  };
}

export default function ImportScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ source?: string | string[] }>();
  const sourceParam = Array.isArray(params.source) ? params.source[0] : params.source;
  const source = useMemo(() => {
    if (!sourceParam || sourceParam === 'select') return null;
    return importSources.find((item) => item.id === sourceParam) ?? importSources[0];
  }, [sourceParam]);

  const [ageConfirmed, setAgeConfirmed] = useState<boolean | null>(null);
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [images, setImages] = useState<SelectedAsset[]>([]);
  const [localFile, setLocalFile] = useState<SelectedAsset | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingPosition, setUploadingPosition] = useState<number | null>(null);
  const [activeImportId, setActiveImportId] = useState<string | null>(null);

  const createKeyRef = useRef<string | null>(null);
  const createRequestRef = useRef<string | null>(null);
  const importIdRef = useRef<string | null>(null);

  React.useEffect(() => {
    let mounted = true;
    hasConfirmedAge()
      .then((confirmed) => {
        if (mounted) setAgeConfirmed(confirmed);
      })
      .catch(() => {
        if (mounted) setAgeConfirmed(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  React.useEffect(() => {
    if (!ageConfirmed || source !== null) return;
    let mounted = true;
    loadActiveImportId()
      .then((id) => {
        if (mounted) setActiveImportId(id);
      })
      .catch(() => {
        if (mounted) setActiveImportId(null);
      });
    return () => {
      mounted = false;
    };
  }, [ageConfirmed, source]);

  const confirmAge = async () => {
    setMessage(null);
    try {
      await saveAgeConfirmation();
      setAgeConfirmed(true);
    } catch {
      setMessage('暂时无法保存年龄确认，请重试');
    }
  };

  const selectSource = (nextSource: SourceId) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (nextSource === 'computer') {
      router.replace('/import-computer');
      return;
    }
    router.replace({ pathname: '/import', params: { source: nextSource } });
  };

  const pickAlbum = async () => {
    setMessage(null);
    if (Platform.OS === 'web') {
      setMessage('相册导入请在 iOS 或 Android 客户端使用');
      return;
    }
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setMessage('需要照片权限才能导入图片，请在系统设置中允许访问照片');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: 10,
        quality: 1,
        exif: false,
      });
      if (result.canceled) return;
      const next = await Promise.all(
        result.assets.map((asset, index) =>
          assetFromFile({
            uri: asset.uri,
            name: asset.fileName ?? `图片 ${index + 1}.jpg`,
            mediaType: asset.mimeType,
            byteSize: asset.fileSize,
          }),
        ),
      );
      const total = next.reduce((sum, asset) => sum + asset.byteSize, 0);
      if (total > MAX_TOTAL_BYTES) {
        setMessage(`图片总大小不能超过 ${displayBytes(MAX_TOTAL_BYTES)}`);
        return;
      }
      setImages(next);
    } catch (error) {
      setMessage(publicErrorMessage(error));
    }
  };

  const pickLocalFile = async () => {
    setMessage(null);
    if (Platform.OS === 'web') {
      setMessage('本地文件导入请在 iOS 或 Android 客户端使用');
      return;
    }
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ACCEPTED_DOCUMENT_TYPES,
        copyToCacheDirectory: true,
        multiple: false,
        base64: false,
      });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      setLocalFile(
        await assetFromFile({
          uri: asset.uri,
          name: asset.name,
          mediaType: asset.mimeType,
          byteSize: asset.size,
        }),
      );
    } catch (error) {
      setMessage(publicErrorMessage(error));
    }
  };

  const pasteClipboard = async () => {
    setMessage(null);
    try {
      const clipboardText = await Clipboard.getStringAsync();
      if (!clipboardText.trim()) {
        setMessage('剪贴板里没有可导入的正文');
        return;
      }
      setText(clipboardText);
    } catch {
      setMessage('暂时无法读取剪贴板，请手动粘贴正文');
    }
  };

  const ensureCreated = async (request: Parameters<typeof createArticleImport>[0]) => {
    const serialized = JSON.stringify(request);
    if (importIdRef.current && createRequestRef.current === serialized) {
      return importIdRef.current;
    }
    if (createRequestRef.current !== serialized) {
      createKeyRef.current = null;
      importIdRef.current = null;
      createRequestRef.current = serialized;
    }
    const idempotencyKey = createKeyRef.current ?? (createKeyRef.current = await createIdempotencyKey());
    await registerAnonymous(true);
    const created = await createArticleImport(request, idempotencyKey);
    importIdRef.current = created.id;
    await saveActiveImportId(created.id);
    return created.id;
  };

  const goToProcessing = async (importId: string) => {
    await saveActiveImportId(importId);
    router.replace({ pathname: '/import-processing', params: { id: importId } });
  };

  const submit = async () => {
    if (!source || submitting) return;
    setMessage(null);
    if (source.id === 'computer') {
      router.replace('/import-computer');
      return;
    }
    if (Platform.OS === 'web') {
      setMessage('完整导入流程请在 iOS 或 Android 客户端使用');
      return;
    }
    if (source.id === 'link' && !url.trim()) {
      setMessage('请输入网页链接');
      return;
    }
    if (source.id === 'paste' && !text.trim()) {
      setMessage('请粘贴或输入英文正文');
      return;
    }
    if (source.id === 'album' && images.length === 0) {
      setMessage('请先选择至少一张图片');
      return;
    }
    if (source.id === 'local' && !localFile) {
      setMessage('请先选择一个文件');
      return;
    }

    setSubmitting(true);
    try {
      const sourceKind = SERVER_IMPORT_KIND[source.id as Exclude<SourceId, 'computer'>];
      if (sourceKind === 'url') {
        const parsedUrl = SharedArticleUrlSchema.safeParse(url);
        if (!parsedUrl.success) {
          setMessage(parsedUrl.error.issues[0]?.message ?? '请粘贴一条完整的文章链接');
          return;
        }
        const importId = await ensureCreated({ sourceKind, url: parsedUrl.data });
        await goToProcessing(importId);
        return;
      }
      if (sourceKind === 'paste') {
        const importId = await ensureCreated({ sourceKind });
        const key = await loadOrCreateImportOperationKey(importId, 'source-text');
        const updated = await putPastedSource(importId, text, key);
        await goToProcessing(updated.id);
        return;
      }

      const selectedAssets = sourceKind === 'album' ? images : localFile ? [localFile] : [];
      const totalBytes = selectedAssets.reduce((sum, asset) => sum + asset.byteSize, 0);
      if (totalBytes > MAX_TOTAL_BYTES) {
        setMessage(`文件总大小不能超过 ${displayBytes(MAX_TOTAL_BYTES)}`);
        return;
      }
      const importId = await ensureCreated({
        sourceKind,
        assets: selectedAssets.map((asset, position) => ({
          position,
          mediaType: asset.mediaType as ImportAssetDescriptor['mediaType'],
          byteSize: asset.byteSize,
        })),
      });
      for (const [position, asset] of selectedAssets.entries()) {
        setUploadingPosition(position);
        await uploadImportAsset(
          importId,
          position,
          asset.uri,
          asset.mediaType,
          asset.byteSize,
        );
      }
      setUploadingPosition(null);
      const processKey = await loadOrCreateImportOperationKey(importId, 'process');
      await startArticleImport(importId, processKey);
      await goToProcessing(importId);
    } catch (error) {
      setMessage(publicErrorMessage(error));
    } finally {
      setUploadingPosition(null);
      setSubmitting(false);
    }
  };

  if (ageConfirmed === null) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.bg }]}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  const title = source ? `导入 · ${source.label}` : '导入外部资源';

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.screen, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          style={styles.headerButton}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="返回"
          onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>{title}</Text>
        <View style={styles.headerButton} />
      </View>

      {!ageConfirmed ? (
        <AgeGate theme={theme} message={message} onConfirm={() => void confirmAge()} />
      ) : source === null ? (
        <SourceChooser
          theme={theme}
          activeImportId={activeImportId}
          onSelect={selectSource}
          onResume={() => {
            if (!activeImportId) return;
            router.push({ pathname: '/import-processing', params: { id: activeImportId } });
          }}
        />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={[styles.sourceIntro, { backgroundColor: theme.accentSoft }]}>
            <View style={[styles.sourceIntroIcon, { backgroundColor: theme.surface }]}>
              <Ionicons
                name={source.icon as keyof typeof Ionicons.glyphMap}
                size={28}
                color={theme.accent}
              />
            </View>
            <View style={styles.sourceIntroCopy}>
              <Text style={[styles.sourceIntroTitle, { color: theme.text }]}>{source.label}导入</Text>
              <Text style={[styles.sourceIntroText, { color: theme.textSecondary }]}>内容会自动解析并保存到你的私人文章库，完成后直接打开阅读。</Text>
            </View>
          </View>

          {source.id === 'link' ? (
            <View style={styles.formBlock}>
              <Text style={[styles.label, { color: theme.text }]}>网页地址</Text>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                onChangeText={setUrl}
                placeholder="粘贴文章链接或 App 分享内容"
                placeholderTextColor={theme.textMuted}
                style={[styles.input, { backgroundColor: theme.surface, borderColor: theme.border, color: theme.text }]}
                value={url}
              />
              <Text style={[styles.helper, { color: theme.textMuted }]}>可直接粘贴含标题的分享内容。需要登录或购买的文章，请在原 App 中复制英文正文或截图导入。</Text>
            </View>
          ) : null}

          {source.id === 'paste' ? (
            <View style={styles.formBlock}>
              <View style={styles.labelRow}>
                <Text style={[styles.label, { color: theme.text }]}>英文正文</Text>
                <TouchableOpacity onPress={() => void pasteClipboard()} hitSlop={8} style={styles.clipboardButton}>
                  <Ionicons name="clipboard-outline" size={15} color={theme.blue} />
                  <Text style={[styles.clipboardText, { color: theme.blue }]}>读取剪贴板</Text>
                </TouchableOpacity>
              </View>
              <TextInput
                autoCapitalize="sentences"
                multiline
                onChangeText={setText}
                placeholder="把文章正文粘贴到这里…"
                placeholderTextColor={theme.textMuted}
                scrollEnabled={false}
                style={[styles.textArea, { backgroundColor: theme.surface, borderColor: theme.border, color: theme.text }]}
                textAlignVertical="top"
                value={text}
              />
              <Text style={[styles.helper, { color: theme.textMuted }]}>建议保留完整段落，服务器会校验英文词数和正文质量。</Text>
            </View>
          ) : null}

          {source.id === 'album' ? (
          <AlbumPicker theme={theme} assets={images} uploadingPosition={uploadingPosition} onPick={() => void pickAlbum()} onRemove={(index) => setImages((current) => current.filter((_, itemIndex) => itemIndex !== index))} onMove={(index, direction) => setImages((current) => moveAsset(current, index, direction))} />
          ) : null}

          {source.id === 'local' ? (
            <LocalPicker theme={theme} asset={localFile} onPick={() => void pickLocalFile()} onClear={() => setLocalFile(null)} />
          ) : null}

          {message ? <Text style={[styles.message, { color: theme.danger }]}>{message}</Text> : null}

          <TouchableOpacity
            accessibilityRole="button"
            disabled={submitting}
            onPress={() => void submit()}
            style={[styles.primaryButton, { backgroundColor: theme.accent, opacity: submitting ? 0.65 : 1 }]}
            activeOpacity={0.85}>
            {submitting ? (
              <ActivityIndicator color={theme.accentText} />
            ) : (
              <>
                <Text style={[styles.primaryButtonText, { color: theme.accentText }]}>开始导入</Text>
                <Ionicons name="arrow-forward" size={18} color={theme.accentText} />
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}

function AgeGate({
  theme,
  message,
  onConfirm,
}: {
  theme: ReturnType<typeof useAppTheme>['theme'];
  message: string | null;
  onConfirm: () => void;
}) {
  return (
    <View style={styles.ageContent}>
      <View style={[styles.ageCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <View style={[styles.ageIcon, { backgroundColor: theme.accentSoft }]}>
          <Ionicons name="shield-checkmark" size={34} color={theme.accent} />
        </View>
        <Text style={[styles.ageTitle, { color: theme.text }]}>使用前请确认年龄</Text>
        <Text style={[styles.ageBody, { color: theme.textSecondary }]}>AI 导入与文章服务仅面向年满 14 周岁的用户。</Text>
        <TouchableOpacity onPress={onConfirm} style={[styles.primaryButton, { backgroundColor: theme.accent }]} activeOpacity={0.85}>
          <Text style={[styles.primaryButtonText, { color: theme.accentText }]}>我已年满 14 周岁</Text>
        </TouchableOpacity>
        {message ? <Text style={[styles.message, { color: theme.danger }]}>{message}</Text> : null}
      </View>
    </View>
  );
}

function SourceChooser({
  theme,
  activeImportId,
  onSelect,
  onResume,
}: {
  theme: ReturnType<typeof useAppTheme>['theme'];
  activeImportId: string | null;
  onSelect: (source: SourceId) => void;
  onResume: () => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.chooserContent} showsVerticalScrollIndicator={false}>
      <Text style={[styles.chooserTitle, { color: theme.text }]}>选择导入方式</Text>
      <Text style={[styles.chooserSubtitle, { color: theme.textSecondary }]}>支持网页、正文、图片、文件和电脑传输，导入完成后会自动加入书架并打开阅读。</Text>
      <View style={styles.sourceGrid}>
        {importSources.map((item) => (
          <TouchableOpacity
            key={item.id}
            onPress={() => onSelect(item.id)}
            style={[styles.sourceCard, { backgroundColor: theme.surface, borderColor: theme.border }]}
            activeOpacity={0.8}>
            <View style={[styles.sourceIcon, { backgroundColor: theme.accentSoft }]}>
              <Ionicons name={item.icon as keyof typeof Ionicons.glyphMap} size={25} color={theme.accent} />
            </View>
            <Text style={[styles.sourceLabel, { color: theme.text }]}>{item.label}</Text>
            <Ionicons name="chevron-forward" size={15} color={theme.textMuted} />
          </TouchableOpacity>
        ))}
      </View>
      {activeImportId ? (
        <TouchableOpacity
          onPress={onResume}
          style={[styles.resumeCard, { backgroundColor: theme.surface, borderColor: theme.accent }]}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="继续上次导入">
          <View style={[styles.resumeIcon, { backgroundColor: theme.accentSoft }]}>
            <Ionicons name="sync-outline" size={20} color={theme.accent} />
          </View>
          <View style={styles.resumeCopy}>
            <Text style={[styles.resumeTitle, { color: theme.text }]}>继续上次导入</Text>
            <Text style={[styles.resumeSubtitle, { color: theme.textSecondary }]}>恢复同一个导入任务，完成后自动打开文章</Text>
          </View>
          <Ionicons name="chevron-forward" size={17} color={theme.accent} />
        </TouchableOpacity>
      ) : null}
      <View style={[styles.limitNote, { backgroundColor: theme.surfaceAlt }]}>
        <Ionicons name="lock-closed-outline" size={16} color={theme.textMuted} />
        <Text style={[styles.limitText, { color: theme.textSecondary }]}>导入内容只属于你本人；原始文件解析完成后会被清理。</Text>
      </View>
    </ScrollView>
  );
}

function AlbumPicker({
  theme,
  assets,
  uploadingPosition,
  onPick,
  onRemove,
  onMove,
}: {
  theme: ReturnType<typeof useAppTheme>['theme'];
  assets: SelectedAsset[];
  uploadingPosition: number | null;
  onPick: () => void;
  onRemove: (index: number) => void;
  onMove: (index: number, direction: -1 | 1) => void;
}) {
  const total = assets.reduce((sum, asset) => sum + asset.byteSize, 0);
  return (
    <View style={styles.formBlock}>
      <View style={styles.labelRow}>
        <View>
          <Text style={[styles.label, { color: theme.text }]}>照片（最多 10 张）</Text>
          <Text style={[styles.helper, { color: theme.textMuted }]}>单张 ≤ 10 MB · 总计 ≤ 30 MB</Text>
        </View>
        {assets.length ? <Text style={[styles.totalSize, { color: theme.textSecondary }]}>{displayBytes(total)}</Text> : null}
      </View>
      {assets.length ? (
        <View style={styles.thumbnailGrid}>
          {assets.map((asset, index) => (
            <View key={`${asset.uri}-${index}`} style={styles.thumbnailWrap}>
              <Image source={{ uri: asset.uri }} style={styles.thumbnail} />
              <View style={[styles.orderBadge, { backgroundColor: theme.accent }]}><Text style={[styles.orderText, { color: theme.accentText }]}>{index + 1}</Text></View>
              <TouchableOpacity onPress={() => onRemove(index)} style={styles.removeBadge} hitSlop={6}>
                <Ionicons name="close" size={14} color="#fff" />
              </TouchableOpacity>
              <View style={styles.reorderActions}>
                <TouchableOpacity disabled={index === 0} onPress={() => onMove(index, -1)} style={styles.reorderButton} hitSlop={4}><Ionicons name="chevron-back" size={13} color="#fff" /></TouchableOpacity>
                <TouchableOpacity disabled={index === assets.length - 1} onPress={() => onMove(index, 1)} style={styles.reorderButton} hitSlop={4}><Ionicons name="chevron-forward" size={13} color="#fff" /></TouchableOpacity>
              </View>
              {uploadingPosition === index ? <View style={styles.uploadOverlay}><ActivityIndicator color="#fff" size="small" /></View> : null}
            </View>
          ))}
        </View>
      ) : (
        <View style={[styles.emptyPicker, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Ionicons name="images-outline" size={30} color={theme.textMuted} />
          <Text style={[styles.emptyPickerText, { color: theme.textSecondary }]}>按页面顺序选择文章截图</Text>
        </View>
      )}
      <TouchableOpacity onPress={onPick} style={[styles.secondaryButton, { borderColor: theme.border }]} activeOpacity={0.8}>
        <Ionicons name="add" size={18} color={theme.blue} />
        <Text style={[styles.secondaryButtonText, { color: theme.blue }]}>{assets.length ? '重新选择照片' : '选择照片'}</Text>
      </TouchableOpacity>
    </View>
  );
}

function moveAsset(
  assets: SelectedAsset[],
  index: number,
  direction: -1 | 1,
): SelectedAsset[] {
  const target = index + direction;
  if (index < 0 || index >= assets.length || target < 0 || target >= assets.length) return assets;
  const next = [...assets];
  const [moved] = next.splice(index, 1);
  if (!moved) return assets;
  next.splice(target, 0, moved);
  return next;
}

function LocalPicker({
  theme,
  asset,
  onPick,
  onClear,
}: {
  theme: ReturnType<typeof useAppTheme>['theme'];
  asset: SelectedAsset | null;
  onPick: () => void;
  onClear: () => void;
}) {
  return (
    <View style={styles.formBlock}>
      <Text style={[styles.label, { color: theme.text }]}>选择文件</Text>
      <Text style={[styles.helper, { color: theme.textMuted }]}>支持 PDF、DOCX、TXT、HTML 和常见图片格式，单个文件 ≤ 10 MB。</Text>
      {asset ? (
        <View style={[styles.fileCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={[styles.fileIcon, { backgroundColor: theme.accentSoft }]}><Ionicons name="document-text-outline" size={24} color={theme.accent} /></View>
          <View style={styles.fileCopy}><Text style={[styles.fileName, { color: theme.text }]} numberOfLines={1}>{displayName(asset.name)}</Text><Text style={[styles.fileMeta, { color: theme.textMuted }]}>{asset.mediaType} · {displayBytes(asset.byteSize)}</Text></View>
          <TouchableOpacity onPress={onClear} hitSlop={8}><Ionicons name="close-circle" size={21} color={theme.textMuted} /></TouchableOpacity>
        </View>
      ) : (
        <View style={[styles.emptyPicker, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Ionicons name="folder-open-outline" size={30} color={theme.textMuted} />
          <Text style={[styles.emptyPickerText, { color: theme.textSecondary }]}>从设备文件中选择文章</Text>
        </View>
      )}
      <TouchableOpacity onPress={onPick} style={[styles.secondaryButton, { borderColor: theme.border }]} activeOpacity={0.8}>
        <Ionicons name="folder-open-outline" size={17} color={theme.blue} />
        <Text style={[styles.secondaryButtonText, { color: theme.blue }]}>{asset ? '更换文件' : '打开文件选择器'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 12, paddingHorizontal: 12 },
  headerButton: { alignItems: 'center', height: 40, justifyContent: 'center', width: 40 },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: weight('semibold'), textAlign: 'center' },
  content: { paddingHorizontal: 16, paddingTop: 8 },
  chooserContent: { paddingBottom: 36, paddingHorizontal: 16, paddingTop: 24 },
  chooserTitle: { fontSize: 25, fontWeight: weight('bold') },
  chooserSubtitle: { fontSize: 14, lineHeight: 22, marginTop: 8 },
  sourceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 24 },
  sourceCard: { alignItems: 'center', borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, flexBasis: '31%', flexGrow: 1, minHeight: 122, paddingHorizontal: 8, paddingVertical: 16 },
  sourceIcon: { alignItems: 'center', borderRadius: 16, height: 50, justifyContent: 'center', width: 50 },
  sourceLabel: { fontSize: 13, fontWeight: weight('medium'), marginTop: 9 },
  limitNote: { alignItems: 'center', borderRadius: 10, flexDirection: 'row', gap: 8, marginTop: 22, paddingHorizontal: 12, paddingVertical: 12 },
  limitText: { flex: 1, fontSize: 12, lineHeight: 18 },
  resumeCard: { alignItems: 'center', borderRadius: 13, borderWidth: 1, flexDirection: 'row', marginTop: 16, padding: 12 },
  resumeIcon: { alignItems: 'center', borderRadius: 11, height: 40, justifyContent: 'center', width: 40 },
  resumeCopy: { flex: 1, marginHorizontal: 10 },
  resumeTitle: { fontSize: 14, fontWeight: weight('semibold') },
  resumeSubtitle: { fontSize: 11, marginTop: 4 },
  sourceIntro: { alignItems: 'center', borderRadius: 14, flexDirection: 'row', gap: 12, marginBottom: 22, padding: 14 },
  sourceIntroIcon: { alignItems: 'center', borderRadius: 15, height: 54, justifyContent: 'center', width: 54 },
  sourceIntroCopy: { flex: 1 },
  sourceIntroTitle: { fontSize: 16, fontWeight: weight('semibold') },
  sourceIntroText: { fontSize: 12, lineHeight: 18, marginTop: 4 },
  formBlock: { marginBottom: 18 },
  labelRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  label: { fontSize: 15, fontWeight: weight('semibold') },
  helper: { fontSize: 12, lineHeight: 18, marginTop: 6 },
  input: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, fontSize: 15, marginTop: 10, minHeight: 50, paddingHorizontal: 14 },
  textArea: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, fontSize: 15, lineHeight: 22, marginTop: 10, minHeight: 230, padding: 14 },
  clipboardButton: { alignItems: 'center', flexDirection: 'row', gap: 5 },
  clipboardText: { fontSize: 12, fontWeight: weight('medium') },
  message: { fontSize: 13, lineHeight: 20, marginBottom: 4, marginTop: 8, textAlign: 'center' },
  primaryButton: { alignItems: 'center', borderRadius: 12, flexDirection: 'row', gap: 8, justifyContent: 'center', minHeight: 52, paddingHorizontal: 18 },
  primaryButtonText: { fontSize: 16, fontWeight: weight('bold') },
  secondaryButton: { alignItems: 'center', borderRadius: 11, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 7, justifyContent: 'center', marginTop: 12, minHeight: 46 },
  secondaryButtonText: { fontSize: 14, fontWeight: weight('semibold') },
  emptyPicker: { alignItems: 'center', borderRadius: 12, borderStyle: 'dashed', borderWidth: 1, justifyContent: 'center', minHeight: 130, marginTop: 12, padding: 18 },
  emptyPickerText: { fontSize: 13, marginTop: 8 },
  thumbnailGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  thumbnailWrap: { borderRadius: 10, height: 104, overflow: 'hidden', position: 'relative', width: 104 },
  thumbnail: { height: '100%', width: '100%' },
  orderBadge: { alignItems: 'center', borderRadius: 10, height: 22, justifyContent: 'center', left: 6, position: 'absolute', top: 6, width: 22 },
  orderText: { fontSize: 11, fontWeight: weight('bold') },
  removeBadge: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 12, height: 22, justifyContent: 'center', position: 'absolute', right: 6, top: 6, width: 22 },
  reorderActions: { bottom: 5, flexDirection: 'row', gap: 3, position: 'absolute', right: 5 },
  reorderButton: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 9, height: 18, justifyContent: 'center', width: 18 },
  uploadOverlay: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.4)', bottom: 0, justifyContent: 'center', left: 0, position: 'absolute', right: 0, top: 0 },
  totalSize: { fontSize: 12, marginTop: 4 },
  fileCard: { alignItems: 'center', borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', marginTop: 12, padding: 12 },
  fileIcon: { alignItems: 'center', borderRadius: 10, height: 42, justifyContent: 'center', width: 42 },
  fileCopy: { flex: 1, marginHorizontal: 10 },
  fileName: { fontSize: 14, fontWeight: weight('semibold') },
  fileMeta: { fontSize: 11, marginTop: 4 },
  ageContent: { flex: 1, justifyContent: 'center', padding: 24 },
  ageCard: { alignItems: 'center', borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 24 },
  ageIcon: { alignItems: 'center', borderRadius: 32, height: 64, justifyContent: 'center', width: 64 },
  ageTitle: { fontSize: 20, fontWeight: weight('bold'), marginTop: 18 },
  ageBody: { fontSize: 14, lineHeight: 22, marginTop: 10, textAlign: 'center' },
});
