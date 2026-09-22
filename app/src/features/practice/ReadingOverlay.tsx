import {
  createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

export interface WordAnchor { x: number; y: number }

interface OverlayContent { owner: string; anchor: WordAnchor; children: ReactNode; kind?: 'word' | 'sentence' }
interface OverlayActions {
  activeId: string | null;
  select: (id: string | null) => void;
  publish: (content: OverlayContent) => void;
  remove: (owner: string) => void;
  showSentence: (content: OverlayContent) => void;
  moveSentence: (owner: string, anchor: WordAnchor) => void;
  closeSentence: () => void;
  onScroll: (y: number) => void;
}
const OverlayContext = createContext<OverlayActions | null>(null);

export function ReadingOverlayProvider({ children }: { children: ReactNode }) {
  const [activeId, select] = useState<string | null>(null);
  const [content, publish] = useState<OverlayContent | null>(null);
  // 句子翻译由阅读页持有，避免 FlatList 回收段落时丢失弹窗和请求。
  const [sentence, setSentence] = useState<OverlayContent | null>(null);
  const scrollY = useRef(0);
  const showSentence = useCallback((next: OverlayContent) => {
    select(null);
    setSentence({ ...next, kind: 'sentence' });
  }, []);
  const closeSentence = useCallback(() => setSentence(null), []);
  const moveSentence = useCallback((owner: string, anchor: WordAnchor) => {
    setSentence((current) => current?.owner === owner ? { ...current, anchor } : current);
  }, []);
  const onScroll = useCallback((y: number) => {
    const delta = y - scrollY.current;
    scrollY.current = y;
    if (!delta) return;
    setSentence((current) => current ? {
      ...current, anchor: { ...current.anchor, y: current.anchor.y - delta },
    } : current);
  }, []);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const host = useRef<View>(null);
  const window = useWindowDimensions();
  const [bounds, setBounds] = useState<{ width: number; height: number } | null>(null);
  const width = bounds?.width ?? window.width;
  const height = bounds?.height ?? window.height;
  const remove = useCallback((owner: string) => {
    publish((current) => current?.owner === owner ? null : current);
  }, []);
  const value = useMemo(() => ({
    activeId, select, publish, remove, showSentence, moveSentence, closeSentence, onScroll,
  }), [activeId, remove, showSentence, moveSentence, closeSentence, onScroll]);
  const visible = content?.owner === activeId ? content : null;

  return (
    <OverlayContext.Provider value={value}>
      <View ref={host} style={styles.host} onLayout={({ nativeEvent }) => {
        setBounds({ width: nativeEvent.layout.width, height: nativeEvent.layout.height });
        select(null);
        host.current?.measureInWindow((hostX, hostY) => setOrigin({ x: hostX, y: hostY }));
      }}>
        {children}
        {sentence ? <FloatingBubble content={sentence} width={width} height={height} origin={origin} /> : null}
        {visible ? <FloatingBubble content={visible} width={width} height={height} origin={origin} /> : null}
      </View>
    </OverlayContext.Provider>
  );
}

function FloatingBubble({ content, width, height, origin }: {
  content: OverlayContent;
  width: number;
  height: number;
  origin: WordAnchor;
}) {
  const isSentence = content.kind === 'sentence';
  const bubbleWidth = Math.min(340, width - 24);
  const x = content.anchor.x - origin.x;
  const y = content.anchor.y - origin.y;
  // 句子离开可视区时贴边保留，滚回原句后恢复锚点位置。
  const sentenceTop = Math.max(12, Math.min(y + 8, height - 152));
  const availableBelow = height - y - 32;
  const above = !isSentence && availableBelow < 180;
  const maxHeight = isSentence ? Math.min(360, height - sentenceTop - 12)
    : Math.max(100, Math.min(360, above ? y - 32 : availableBelow));
  const left = Math.max(12, Math.min(x - bubbleWidth / 2, width - bubbleWidth - 12));
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <View
        testID={isSentence ? 'sentence-floating-bubble' : 'word-floating-bubble'}
        style={[styles.bubble, {
          left, width: bubbleWidth, maxHeight,
          ...(isSentence ? { top: sentenceTop }
            : above ? { bottom: height - y + 18 } : { top: y + 18 }),
        }]}>
        <ScrollView style={styles.bubbleContent} bounces={false} keyboardShouldPersistTaps="handled">
          {content.children}
        </ScrollView>
      </View>
    </View>
  );
}

export function useReadingOverlay() {
  return useContext(OverlayContext);
}

/** Portal content is rendered outside the article's scrolling/layout tree. */
export function ReadingOverlay({ owner, anchor, children, kind }: OverlayContent) {
  const overlay = useReadingOverlay();
  const publish = overlay?.publish;
  const remove = overlay?.remove;
  useLayoutEffect(() => {
    publish?.({ owner, anchor, children, kind });
    return () => remove?.(owner);
  }, [publish, remove, owner, anchor, children, kind]);
  // Standalone component previews can still show a non-layout card.
  if (!overlay) return <View style={styles.fallback}>{children}</View>;
  return null;
}

const styles = StyleSheet.create({
  host: { flex: 1 },
  bubble: {
    position: 'absolute', borderRadius: 14, backgroundColor: '#fff',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18, shadowRadius: 14, elevation: 12,
  },
  bubbleContent: { borderRadius: 14, overflow: 'hidden' },
  fallback: { position: 'absolute', top: 36, left: 0, right: 0, zIndex: 100 },
});
