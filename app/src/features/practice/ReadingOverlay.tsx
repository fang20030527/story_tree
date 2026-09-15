import {
  createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

export interface WordAnchor { x: number; y: number }

interface OverlayContent { owner: string; anchor: WordAnchor; children: ReactNode }
interface OverlayActions {
  activeId: string | null;
  select: (id: string | null) => void;
  publish: (content: OverlayContent) => void;
  remove: (owner: string) => void;
}
const OverlayContext = createContext<OverlayActions | null>(null);

export function ReadingOverlayProvider({ children }: { children: ReactNode }) {
  const [activeId, select] = useState<string | null>(null);
  const [content, publish] = useState<OverlayContent | null>(null);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const host = useRef<View>(null);
  const window = useWindowDimensions();
  const [bounds, setBounds] = useState<{ width: number; height: number } | null>(null);
  const width = bounds?.width ?? window.width;
  const height = bounds?.height ?? window.height;
  const remove = useCallback((owner: string) => {
    publish((current) => current?.owner === owner ? null : current);
  }, []);
  const value = useMemo(() => ({ activeId, select, publish, remove }), [activeId, remove]);
  const visible = content?.owner === activeId ? content : null;
  const bubbleWidth = Math.min(340, width - 24);
  const x = visible ? visible.anchor.x - origin.x : 0;
  const y = visible ? visible.anchor.y - origin.y : 0;
  const availableBelow = height - y - 32;
  const above = availableBelow < 180;
  const maxHeight = Math.max(100, Math.min(360, above ? y - 32 : availableBelow));
  const left = Math.max(12, Math.min(x - bubbleWidth / 2, width - bubbleWidth - 12));

  return (
    <OverlayContext.Provider value={value}>
      <View ref={host} style={styles.host} onLayout={({ nativeEvent }) => {
        setBounds({ width: nativeEvent.layout.width, height: nativeEvent.layout.height });
        select(null);
        host.current?.measureInWindow((hostX, hostY) => setOrigin({ x: hostX, y: hostY }));
      }}>
        {children}
        {visible ? (
          <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
            <View
              testID="word-floating-bubble"
              style={[styles.bubble, {
                left, width: bubbleWidth, maxHeight,
                ...(above ? { bottom: height - y + 18 } : { top: y + 18 }),
              }]}>
              <ScrollView style={styles.bubbleContent} bounces={false} keyboardShouldPersistTaps="handled">
                {visible.children}
              </ScrollView>
            </View>
          </View>
        ) : null}
      </View>
    </OverlayContext.Provider>
  );
}

export function useReadingOverlay() {
  return useContext(OverlayContext);
}

/** Portal content is rendered outside the article's scrolling/layout tree. */
export function ReadingOverlay({ owner, anchor, children }: OverlayContent) {
  const overlay = useReadingOverlay();
  const publish = overlay?.publish;
  const remove = overlay?.remove;
  useLayoutEffect(() => {
    publish?.({ owner, anchor, children });
    return () => remove?.(owner);
  }, [publish, remove, owner, anchor, children]);
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
