import React, { useEffect, useId, useRef, useState } from 'react';
import { Animated, Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, ClipPath, Defs, Ellipse, G, Line, Path, Rect } from 'react-native-svg';

import { motionAllowedNow, useReducedMotion } from '@/components/motion';
import { motion, type GraphicPalette } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';

/**
 * 黑洞英语的太空图形资产。规则与提案原型一致：
 * 所有轨道倾斜 20°（logo 椭圆角度）；只在不同物体重叠处留一道底色缝（seam）；
 * 光晕与过渡用分层色带表现；线段一律圆头。seam 传入图形所在位置的底色。
 */
const TILT = 20;
const NATIVE = Platform.OS !== 'web';
/** 测试环境里图形保持静止：不跑帧循环和环境循环，补间直接到终值，避免无意义的计时器与 act 警告。 */
export const AMBIENT_MOTION = process.env.NODE_ENV !== 'test';
const r2 = (n: number) => Math.round(n * 100) / 100;
const TAU = Math.PI * 2;

function useSvgId(prefix: string) {
  return prefix + useId().replace(/[^a-zA-Z0-9]/g, '');
}

/** requestAnimationFrame 循环，只在 active 时运行；回调拿到距上一帧的毫秒数。 */
export function useFrameLoop(active: boolean, onFrame: (dt: number, now: number) => void) {
  const callback = useRef(onFrame);
  useEffect(() => { callback.current = onFrame; });
  useEffect(() => {
    if (!active || !AMBIENT_MOTION) return;
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      const dt = last ? Math.min(64, now - last) : 16;
      last = now;
      callback.current(dt, now);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);
}

/** 拉马努金近似：用于把虚线图案按实际周长换算，不依赖 pathLength。 */
function ellipseLength(rx: number, ry: number) {
  return Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
}
/** 顺时针整圈椭圆：dashoffset 减小时，后半向右、前半向左。 */
function loopPath(cx: number, cy: number, rx: number, ry: number) {
  return `M${r2(cx - rx)} ${r2(cy)}A${r2(rx)} ${r2(ry)} 0 1 1 ${r2(cx + rx)} ${r2(cy)}A${r2(rx)} ${r2(ry)} 0 1 1 ${r2(cx - rx)} ${r2(cy)}`;
}
/** 椭圆环带（外椭圆减内椭圆，配合 evenodd）。 */
function ringPath(cx: number, cy: number, rx1: number, ry1: number, rx2: number, ry2: number) {
  const e = (rx: number, ry: number) => `M${r2(cx - rx)} ${cy}a${r2(rx)} ${r2(ry)} 0 1 0 ${r2(rx * 2)} 0a${r2(rx)} ${r2(ry)} 0 1 0 ${r2(-rx * 2)} 0Z`;
  return e(rx1, ry1) + e(rx2, ry2);
}
const FLOW_DASH = [0.5, 8, 2.4, 11, 1, 9, 3, 15.1];
const dashFor = (length: number) => FLOW_DASH.map((v) => r2((v * length) / 100)).join(' ');

function sparklePath(x: number, y: number, s: number) {
  const k = s * 0.16;
  return `M${r2(x)} ${r2(y - s)}C${r2(x + k)} ${r2(y - k)} ${r2(x + k)} ${r2(y - k)} ${r2(x + s)} ${r2(y)}C${r2(x + k)} ${r2(y + k)} ${r2(x + k)} ${r2(y + k)} ${r2(x)} ${r2(y + s)}C${r2(x - k)} ${r2(y + k)} ${r2(x - k)} ${r2(y + k)} ${r2(x - s)} ${r2(y)}C${r2(x - k)} ${r2(y - k)} ${r2(x - k)} ${r2(y - k)} ${r2(x)} ${r2(y - s)}Z`;
}

type Common = { palette?: GraphicPalette; seam?: string };
function useGraphic({ palette, seam }: Common) {
  const { theme } = useAppTheme();
  return { g: palette ?? theme.graphic, bg: seam ?? theme.bg };
}

/* ------------------------------------------------------------------ */
/* 黑洞：后半盘与透镜光环同色相融 → 视界（紧贴暖白光子环）→ 前半盘（相交处留缝） */
/* ------------------------------------------------------------------ */
const BH = { cx: 120, cy: 86, hole: 34, k: 0.22, ri: 47, rm: 76, ro: 104, haloR: 46, haloOff: 4.2, rimR: 37.6, rimOff: 1 };
const BH_FLOW = {
  inner: { d: loopPath(120, 86, 61, 61 * 0.22), len: ellipseLength(61, 61 * 0.22) },
  outer: { d: loopPath(120, 86, 90, 90 * 0.22), len: ellipseLength(90, 90 * 0.22) },
  halo: { d: loopPath(120, 86 - 2.6, 41.6, 41.6), len: TAU * 41.6 },
};
const BH_PARTICLE = { r: 68, start: Math.PI - 0.5 };

export type BlackHoleFlow = 'none' | 'idle' | 'loading';

export function BlackHole({ size = 240, quiet = false, flow = 'none', pulseKey, palette, seam, style }: Common & {
  size?: number;
  quiet?: boolean;
  /** idle 慢速流动；loading 加快，并有一颗粒子绕盘运行。 */
  flow?: BlackHoleFlow;
  /** 变化时让吸积盘流动约 1.3 秒再停下（模式卡片被选中时）。 */
  pulseKey?: string | number;
  style?: StyleProp<ViewStyle>;
}) {
  const { g, bg } = useGraphic({ palette, seam });
  const reduced = useReducedMotion();
  const id = useSvgId('bh');
  const { cx, cy, hole, k, ri, rm, ro } = BH;
  // pulseKey 变化时排一次 1.3 秒的流动；在渲染时比较上一次的值，不在 effect 里改状态。
  const [lastPulseKey, setLastPulseKey] = useState(pulseKey);
  const [pulseRun, setPulseRun] = useState(0);
  if (pulseKey !== lastPulseKey) {
    setLastPulseKey(pulseKey);
    if (pulseKey !== undefined && !reduced && !quiet) setPulseRun((run) => run + 1);
  }
  const loading = flow === 'loading';
  const continuous = !reduced && !quiet && flow !== 'none';
  const [f, setF] = useState({ a: 0, b: 0, c: 0, th: BH_PARTICLE.start, rate: 0, pulseRun: 0, pulseStart: 0 });
  useFrameLoop(continuous || f.rate > 0.02 || f.pulseRun !== pulseRun, (dt, now) => setF((s) => {
    const startPulse = s.pulseRun !== pulseRun;
    const pulseStart = startPulse ? now : s.pulseStart;
    const pulsing = pulseRun > 0 && now - pulseStart < 1300;
    const target = continuous || pulsing ? 1 : 0;
    const rate = s.rate + (target - s.rate) * Math.min(1, dt / 180);
    const speed = loading ? 1 : 0.4;
    return {
      a: s.a - (dt * rate * speed * BH_FLOW.inner.len) / 3600,
      b: s.b - (dt * rate * speed * BH_FLOW.outer.len) / 7200,
      c: s.c - (dt * rate * speed * BH_FLOW.halo.len) / 4800,
      th: s.th + (dt * rate * TAU) / 2400,
      rate: rate < 0.02 && target === 0 ? 0 : rate,
      pulseRun,
      pulseStart,
    };
  }));
  const C = quiet
    ? { inner: g.quiet2, outer: g.quiet1, halo: g.quiet2, rim: g.quiet1 }
    : { inner: g.vermilion, outer: g.pink, halo: g.vermilion, rim: g.hot };
  const ring = (a: number, b: number, fill: string) => <Path d={ringPath(cx, cy, b, b * k, a, a * k)} fill={fill} fillRule="evenodd" />;
  const crescent = (rx: number, ry1: number, ry2: number) => `M${cx - rx} ${cy}A${rx} ${r2(ry1)} 0 0 0 ${cx + rx} ${cy}A${rx} ${r2(ry2)} 0 0 1 ${cx - rx} ${cy}Z`;
  const flowOn = f.rate > 0.01;
  const flowPaths = flowOn ? <>
    <Path d={BH_FLOW.inner.d} fill="none" stroke={g.flowIn} strokeWidth={1.6} strokeLinecap="round" strokeDasharray={dashFor(BH_FLOW.inner.len)} strokeDashoffset={f.a} opacity={f.rate} />
    <Path d={BH_FLOW.outer.d} fill="none" stroke={g.flowOut} strokeWidth={1.6} strokeLinecap="round" strokeDasharray={dashFor(BH_FLOW.outer.len)} strokeDashoffset={f.b} opacity={f.rate} />
  </> : null;
  const px = cx + BH_PARTICLE.r * Math.cos(f.th), py = cy + BH_PARTICLE.r * k * Math.sin(f.th);
  const particle = loading && !quiet ? <Circle cx={r2(px)} cy={r2(py)} r={3.4} fill={g.hot} stroke={bg} strokeWidth={1.4} /> : null;
  const rotate = `rotate(${TILT} ${cx} ${cy})`;
  return <View style={style} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <Svg width={size} height={r2((size * 172) / 240)} viewBox="0 0 240 172">
      <Defs>
        <ClipPath id={`${id}b`}><Rect x={-120} y={-80} width={480} height={cy + 81} /></ClipPath>
        <ClipPath id={`${id}f`}><Rect x={-120} y={cy} width={480} height={200} /></ClipPath>
      </Defs>
      <G transform={rotate}>
        <G clipPath={`url(#${id}b)`}>{ring(rm, ro, C.outer)}{ring(ri, rm, C.inner)}{flowPaths}{particle}</G>
        <Circle cx={cx} cy={r2(cy - BH.haloOff)} r={BH.haloR} fill={C.halo} />
        {flowOn ? <Path d={BH_FLOW.halo.d} fill="none" stroke={g.flowIn} strokeWidth={1.5} strokeLinecap="round" strokeDasharray={dashFor(BH_FLOW.halo.len)} strokeDashoffset={f.c} opacity={f.rate} /> : null}
        <Circle cx={cx} cy={r2(cy - BH.rimOff)} r={BH.rimR} fill={C.rim} />
      </G>
      <Circle cx={cx} cy={cy} r={hole} fill={g.hole} />
      <G transform={rotate}>
        <G clipPath={`url(#${id}f)`}>
          <Path d={crescent(ro, ro * k, ro * k + 2.6)} fill={bg} />
          <Path d={crescent(ri, ri * k, ri * k - 2.6)} fill={bg} />
          {ring(rm, ro, C.outer)}{ring(ri, rm, C.inner)}{flowPaths}{particle}
        </G>
      </G>
    </Svg>
  </View>;
}

/** 加载：黑洞吸积盘循环流动，一颗粒子绕盘运行；减少动态效果时静止，靠文字说明进度。 */
export function BlackHoleLoader({ size = 150, label, seam, color }: { size?: number; label?: string; seam?: string; color?: string }) {
  const { theme } = useAppTheme();
  return <View accessibilityRole="progressbar" accessibilityLabel={label ?? '正在加载'} style={styles.loader}>
    <BlackHole size={size} flow="loading" seam={seam} />
    {label ? <Text style={[styles.loaderLabel, { color: color ?? theme.textSecondary }]}>{label}</Text> : null}
  </View>;
}

/* ------------------------------------------------------------------ */
/* 声环星：发声的行星，星环由高低不一的声波刻度组成。                      */
/* ------------------------------------------------------------------ */
const VP = { cx: 120, cy: 86, rx: 86, ry: 23, r: 30, ticks: 40 };
export function voiceAmplitude(a: number, level = 1, t = 0) {
  const env = Math.sin(a) > 0 ? 0.35 + 0.65 * Math.sin(a) : 0.25;
  const n = Math.abs(Math.sin(a * 7 + 1.1 + t * 1.9) * 0.7 + Math.sin(a * 13 - t * 2.6) * 0.3);
  return 2.4 + 10.4 * level * env * n;
}

export function VoicePlanet({ size = 240, quiet = false, exciteKey, palette, seam, style }: Common & {
  size?: number;
  quiet?: boolean;
  /** 变化时刻度从低处涨起再落定（模式卡片被选中时）。 */
  exciteKey?: string | number;
  style?: StyleProp<ViewStyle>;
}) {
  const { g, bg } = useGraphic({ palette, seam });
  const reduced = useReducedMotion();
  const id = useSvgId('vp');
  const [anim, setAnim] = useState({ level: quiet ? 0 : 1, t: 0, active: false });
  const [lastExciteKey, setLastExciteKey] = useState(exciteKey);
  if (exciteKey !== lastExciteKey) {
    setLastExciteKey(exciteKey);
    if (exciteKey !== undefined && !reduced && !quiet && AMBIENT_MOTION) setAnim((s) => ({ level: 0.15, t: s.t + 1.4, active: true }));
  }
  useFrameLoop(anim.active, (dt) => setAnim((s) => {
    const level = s.level + (1 - s.level) * Math.min(1, (dt / 1000) * 6);
    return Math.abs(1 - level) < 0.01 ? { level: 1, t: s.t, active: false } : { level, t: s.t, active: true };
  }));
  const { cx, cy, rx, ry, r, ticks } = VP;
  const back: React.ReactNode[] = [];
  const front: React.ReactNode[] = [];
  for (let i = 0; i < ticks; i++) {
    const a = (i / ticks) * TAU + 0.04;
    const x = r2(cx + rx * Math.cos(a)), y = cy + ry * Math.sin(a);
    const amp = quiet || anim.level < 0.002 ? 2.4 : voiceAmplitude(a, anim.level, anim.t);
    const y1 = r2(y - amp), y2 = r2(y + amp);
    back.push(<Line key={`b${i}`} x1={x} y1={y1} x2={x} y2={y2} stroke={g.pink} strokeWidth={3.4} strokeLinecap="round" opacity={0.7} />);
    front.push(<Line key={`s${i}`} x1={x} y1={y1} x2={x} y2={y2} stroke={bg} strokeWidth={7.4} strokeLinecap="round" />);
    front.push(<Line key={`f${i}`} x1={x} y1={y1} x2={x} y2={y2} stroke={quiet ? g.pink : g.rose} strokeWidth={3.4} strokeLinecap="round" />);
  }
  const rotate = `rotate(${TILT} ${cx} ${cy})`;
  return <View style={style} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <Svg width={size} height={r2((size * 172) / 240)} viewBox="0 0 240 172">
      <Defs>
        <ClipPath id={`${id}b`}><Rect x={-120} y={-80} width={480} height={cy + 80} /></ClipPath>
        <ClipPath id={`${id}f`}><Rect x={-120} y={cy} width={480} height={200} /></ClipPath>
        <ClipPath id={`${id}p`}><Circle cx={cx} cy={cy} r={r} /></ClipPath>
      </Defs>
      <G transform={rotate}><G clipPath={`url(#${id}b)`}>{back}</G></G>
      <Circle cx={cx} cy={cy} r={r} fill={g.roseShade} />
      <G clipPath={`url(#${id}p)`}>
        <Circle cx={cx - 6} cy={cy - 7} r={r} fill={g.pink} />
        <Circle cx={cx - 12} cy={cy - 13} r={6} fill={g.cream} opacity={0.5} />
      </G>
      <G transform={rotate}><G clipPath={`url(#${id}f)`}>{front}</G></G>
    </Svg>
  </View>;
}

/* ------------------------------------------------------------------ */
/* 小尺寸模式标识：28×20，比插画少细节。                                    */
/* ------------------------------------------------------------------ */
export function GlyphRead({ size = 28, color, palette, seam }: Common & { size?: number; color?: string }) {
  const { g, bg } = useGraphic({ palette, seam });
  const c = color ?? g.vermilion;
  const cx = 14, cy = 10;
  const back = `M${cx - 12} ${cy}A12 3.5 0 0 1 ${cx + 12} ${cy}`;
  const front = `M${cx - 12} ${cy}A12 3.5 0 0 0 ${cx + 12} ${cy}`;
  const rotate = `rotate(${TILT} ${cx} ${cy})`;
  return <Svg width={size} height={r2((size * 20) / 28)} viewBox="0 0 28 20">
    <G transform={rotate}>
      <Path d={back} fill="none" stroke={c} strokeWidth={2} strokeLinecap="round" />
      <Circle cx={cx} cy={cy - 0.9} r={6.4} fill={c} />
    </G>
    <Circle cx={cx} cy={cy} r={4.3} fill={g.hole} />
    <G transform={rotate}>
      <Path d={front} fill="none" stroke={bg} strokeWidth={4.2} strokeLinecap="round" />
      <Path d={front} fill="none" stroke={c} strokeWidth={2} strokeLinecap="round" />
    </G>
  </Svg>;
}

const GLYPH_BARS: [number, number][] = [[7.4, 2.1], [10.2, 3.3], [13, 1.7]];
export function GlyphSpeak({ size = 28, color, palette, playing = false }: Common & { size?: number; color?: string; playing?: boolean }) {
  const { g } = useGraphic({ palette });
  const reduced = useReducedMotion();
  const c = color ?? g.rose;
  const cx = 14, cy = 10;
  const [t, setT] = useState(0);
  useFrameLoop(playing && !reduced, (dt) => setT((v) => v + dt / 1000));
  const bars: React.ReactNode[] = [];
  GLYPH_BARS.forEach(([d, a], index) => {
    [-1, 1].forEach((side) => {
      const s = playing && !reduced ? 0.45 + 0.75 * Math.abs(Math.sin(t * 5.2 + index * 1.3 + (side > 0 ? 0.7 : 0))) : 1;
      const h = a * s;
      bars.push(<Line key={`${index}${side}`} x1={r2(cx + side * d)} y1={r2(cy - h)} x2={r2(cx + side * d)} y2={r2(cy + h)} stroke={c} strokeWidth={1.8} strokeLinecap="round" />);
    });
  });
  return <Svg width={size} height={r2((size * 20) / 28)} viewBox="0 0 28 20">
    <G transform={`rotate(${TILT} ${cx} ${cy})`}>{bars}</G>
    <Circle cx={cx} cy={cy} r={4.7} fill={g.roseShade} />
    <Circle cx={cx - 0.8} cy={cy - 1} r={4.1} fill={g.pink} />
  </Svg>;
}

/* ------------------------------------------------------------------ */
/* 彗星：每日精选的标记。                                                  */
/* ------------------------------------------------------------------ */
export function Comet({ size = 30, palette }: Common & { size?: number }) {
  const { g } = useGraphic({ palette });
  return <Svg width={size} height={size / 2} viewBox="0 0 64 32">
    <G transform={`rotate(-${TILT} 46 14)`}>
      <Path d="M46 9.5 C30 10.5 14 12 2 14 C14 16 30 17.5 46 18.5Z" fill={g.pink} opacity={0.75} />
      <Path d="M46 10.8 C34 11.6 24 12.8 14 14 C24 15.2 34 16.4 46 17.2Z" fill={g.hot} />
      <Circle cx={46} cy={14} r={5.4} fill={g.vermilion} />
      <Circle cx={47.2} cy={12.9} r={2} fill={g.cream} />
    </G>
  </Svg>;
}

/* ------------------------------------------------------------------ */
/* 轨道进度：倾斜椭圆轨道上的行星走到当前值。                              */
/* ------------------------------------------------------------------ */
const ORBIT = (() => {
  const cx = 70, cy = 40, rx = 62, ry = 22, n = 360;
  const pts: [number, number][] = [];
  const lens: number[] = [0];
  let total = 0;
  let prev: [number, number] = [cx - rx, cy];
  pts.push(prev);
  for (let i = 1; i <= n; i++) {
    const th = Math.PI + (i / n) * TAU;
    const p: [number, number] = [cx + rx * Math.cos(th), cy + ry * Math.sin(th)];
    total += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    lens.push(total);
    pts.push(p);
    prev = p;
  }
  return { cx, cy, rx, ry, pts, lens, total, d: `M${cx - rx} ${cy}A${rx} ${ry} 0 1 1 ${cx + rx} ${cy}A${rx} ${ry} 0 1 1 ${cx - rx} ${cy}` };
})();
function orbitPoint(v: number) {
  const target = Math.max(0, Math.min(1, v)) * ORBIT.total;
  let i = 0;
  while (i < ORBIT.lens.length - 1 && (ORBIT.lens[i] ?? 0) < target) i++;
  return ORBIT.pts[i] ?? ORBIT.pts[0]!;
}

/** 在 from→to 之间补间一个数值：挂载时可选从 0 画到当前值，之后每次变化都补间；减少动态效果时直接跳到目标。 */
function useTweenedNumber(target: number, duration: number, ease: (t: number) => number, drawIn: boolean) {
  const reduced = useReducedMotion();
  const [tween, setTween] = useState(() => {
    const animateIn = drawIn && AMBIENT_MOTION && motionAllowedNow() && target !== 0;
    return { shown: animateIn ? 0 : target, from: animateIn ? 0 : target, to: target, start: -1, active: animateIn };
  });
  const [lastTarget, setLastTarget] = useState(target);
  if (target !== lastTarget) {
    setLastTarget(target);
    setTween((t) => reduced || !AMBIENT_MOTION
      ? { shown: target, from: target, to: target, start: -1, active: false }
      : { shown: t.shown, from: t.shown, to: target, start: -1, active: true });
  }
  useFrameLoop(tween.active, (_dt, now) => setTween((t) => {
    const start = t.start < 0 ? now : t.start;
    const p = Math.min(1, (now - start) / duration);
    return p >= 1 ? { ...t, shown: t.to, start, active: false } : { ...t, shown: t.from + (t.to - t.from) * ease(p), start };
  }));
  return tween.shown;
}

export function OrbitProgress({ value, size = 128, color, palette, seam }: Common & { value: number; size?: number; color?: string }) {
  const { g, bg } = useGraphic({ palette, seam });
  const shown = useTweenedNumber(Math.max(0, Math.min(1, value)), motion.draw, motion.easeOut, true);
  const c = color ?? g.vermilion;
  const [dx, dy] = orbitPoint(shown);
  const L = ORBIT.total;
  return <Svg width={size} height={r2((size * 80) / 140)} viewBox="0 0 140 80">
    <G transform={`rotate(${TILT} ${ORBIT.cx} ${ORBIT.cy})`}>
      <Path d={ORBIT.d} fill="none" stroke={g.track} strokeWidth={2} strokeDasharray="1 5" strokeLinecap="round" />
      {shown > 0.002 ? <Path d={ORBIT.d} fill="none" stroke={c} strokeWidth={3} strokeLinecap="round" strokeDasharray={`${r2(L)} ${r2(L)}`} strokeDashoffset={r2(L * (1 - shown))} /> : null}
      <Circle cx={r2(dx)} cy={r2(dy)} r={6} fill={c} stroke={bg} strokeWidth={3} />
    </G>
  </Svg>;
}

/* ------------------------------------------------------------------ */
/* 月相：单词掌握程度（新词 → 学习中 → 复习中 → 快掌握 → 已掌握）。        */
/* ------------------------------------------------------------------ */
export function moonPath(phase: number) {
  const r = 8, c = 9;
  const p = Math.max(0, Math.min(1, phase));
  if (p <= 0.001) return '';
  if (p >= 0.999) return `M${c} ${c - r}A${r} ${r} 0 1 1 ${c} ${c + r}A${r} ${r} 0 1 1 ${c} ${c - r}Z`;
  const kk = Math.cos(p * Math.PI);
  const tx = r2(Math.abs(kk) * r);
  const sweep = kk > 0 ? 0 : 1;
  return `M${c} ${c - r}A${r} ${r} 0 0 1 ${c} ${c + r}A${tx} ${r} 0 0 ${sweep} ${c} ${c - r}Z`;
}

export function Moon({ phase, size = 14, lit, dark, palette }: Common & { phase: number; size?: number; lit?: string; dark?: string }) {
  const { g } = useGraphic({ palette });
  const shown = useTweenedNumber(phase, 420, motion.easeInOut, false);
  return <Svg width={size} height={size} viewBox="0 0 18 18">
    <Circle cx={9} cy={9} r={8} fill={dark ?? g.track} />
    {shown > 0.001 ? <Path d={moonPath(shown)} fill={lit ?? g.vermilion} /> : null}
  </Svg>;
}

/* ------------------------------------------------------------------ */
/* 星座：认识的词点亮成星，相关的词连成星座。                              */
/* ------------------------------------------------------------------ */
const STARS = [[22, 96], [58, 70], [92, 84], [120, 46], [158, 58], [186, 30], [204, 78], [150, 104], [96, 128], [40, 136]] as const;
const LINKS = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [4, 6], [2, 7], [7, 8], [8, 9]] as const;
export function Constellation({ lit, size = 200, color, palette, seam }: Common & { lit: number; size?: number; color?: string }) {
  const { g, bg } = useGraphic({ palette, seam });
  const c = color ?? g.vermilion;
  return <Svg width={size} height={r2((size * 160) / 226)} viewBox="0 0 226 160">
    {LINKS.map(([a, b]) => {
      const on = a < lit && b < lit;
      return <Line key={`${a}-${b}`} x1={STARS[a][0]} y1={STARS[a][1]} x2={STARS[b][0]} y2={STARS[b][1]} stroke={on ? c : g.track} strokeWidth={1.4} strokeLinecap="round" strokeDasharray={on ? undefined : '2 4'} opacity={on ? 0.55 : 1} />;
    })}
    {STARS.map(([x, y], i) => i < lit
      ? i === 3 || i === 5 ? <Path key={i} d={sparklePath(x, y, 9)} fill={c} /> : <Circle key={i} cx={x} cy={y} r={4.2} fill={c} stroke={bg} strokeWidth={2.5} />
      : <Circle key={i} cx={x} cy={y} r={3.4} fill={g.track} />)}
  </Svg>;
}

/* ------------------------------------------------------------------ */
/* 星际漂流瓶、迷航行星、观测窗、吸入（书架空状态）、环星头像。            */
/* ------------------------------------------------------------------ */
export function Bottle({ size = 200, palette, seam }: Common & { size?: number }) {
  const { g, bg } = useGraphic({ palette, seam });
  return <Svg width={size} height={size * 0.75} viewBox="0 0 200 150">
    <G transform={`rotate(${TILT} 100 78)`}><Ellipse cx={100} cy={78} rx={90} ry={25} fill="none" stroke={g.track} strokeWidth={2} strokeDasharray="1 6" strokeLinecap="round" /></G>
    <G transform="rotate(-24 104 78)">
      <Rect x={58} y={57} width={70} height={42} rx={19} fill={g.glass} stroke={bg} strokeWidth={3} />
      <Rect x={124} y={68} width={20} height={20} rx={6} fill={g.glass} stroke={bg} strokeWidth={3} />
      <Rect x={141} y={66.5} width={12} height={23} rx={4.5} fill={g.vermilion} stroke={bg} strokeWidth={3} />
      <Rect x={72} y={68} width={42} height={20} rx={10} fill={g.creamStrong} />
      <Line x1={82} y1={75} x2={104} y2={75} stroke={g.vermilion} strokeWidth={2.4} strokeLinecap="round" />
      <Line x1={82} y1={81} x2={96} y2={81} stroke={g.rose} strokeWidth={2.4} strokeLinecap="round" />
      <Path d="M66 70 Q67 63 74 61.5" fill="none" stroke={g.creamStrong} strokeWidth={3} strokeLinecap="round" opacity={0.9} />
    </G>
    <Path d={sparklePath(38, 36, 7)} fill={g.vermilion} />
    <Path d={sparklePath(166, 118, 5)} fill={g.pink} />
    <Circle cx={158} cy={30} r={2} fill={g.pink} />
    <Circle cx={34} cy={112} r={1.8} fill={g.vermilion} opacity={0.6} />
  </Svg>;
}

export function LostPlanet({ size = 200, palette }: Common & { size?: number }) {
  const { g } = useGraphic({ palette });
  const cx = 92, cy = 82;
  return <Svg width={size} height={size * 0.75} viewBox="0 0 200 150">
    <G transform={`rotate(${TILT} ${cx} ${cy})`}><Path d={`M${cx - 78} ${cy} A78 26 0 1 1 ${cx + 60} ${cy + 16}`} fill="none" stroke={g.track} strokeWidth={2} strokeDasharray="1 6" strokeLinecap="round" /></G>
    <Circle cx={cx} cy={cy} r={19} fill={g.hot} />
    <Circle cx={cx} cy={cy} r={16} fill={g.hole} />
    <Line x1={134} y1={128} x2={146} y2={122} stroke={g.pink} strokeWidth={2.4} strokeLinecap="round" />
    <Line x1={140} y1={136} x2={150} y2={131} stroke={g.pink} strokeWidth={2.4} strokeLinecap="round" opacity={0.6} />
    <Circle cx={162} cy={116} r={12} fill={g.shade} />
    <Circle cx={159} cy={113} r={12} fill={g.pink} />
    <Path d={sparklePath(40, 30, 6)} fill={g.pink} />
    <Path d={sparklePath(170, 40, 4)} fill={g.vermilion} />
  </Svg>;
}

export function ObservationWindow({ size = 200, palette, windowColor }: Common & { size?: number; windowColor?: string }) {
  const { g } = useGraphic({ palette });
  const { theme } = useAppTheme();
  return <Svg width={size} height={size * 0.75} viewBox="0 0 200 150">
    <Circle cx={100} cy={75} r={56} fill={windowColor ?? theme.surfaceAlt} />
    <G stroke={g.track} strokeWidth={2} strokeLinecap="round">
      <Line x1={100} y1={24} x2={100} y2={34} /><Line x1={100} y1={116} x2={100} y2={126} />
      <Line x1={49} y1={75} x2={59} y2={75} /><Line x1={141} y1={75} x2={151} y2={75} />
    </G>
    <Path d={sparklePath(118, 62, 7)} fill={g.pink} />
    <Circle cx={80} cy={92} r={1.8} fill={g.vermilion} opacity={0.7} />
    <Circle cx={90} cy={54} r={1.4} fill={g.pink} />
  </Svg>;
}

/** 书架空状态：一页纸沿轨道飘向安静的黑洞，读进来的东西会收在这里。 */
export function AbsorbIllustration({ size = 200, palette, seam }: Common & { size?: number }) {
  const { g, bg } = useGraphic({ palette, seam });
  return <View style={{ width: size, height: size * 0.75 }} pointerEvents="none">
    <BlackHole size={size * 0.75} quiet seam={bg} palette={g} style={{ position: 'absolute', left: size * 0.03, top: size * 0.15 }} />
    <Svg width={size} height={size * 0.75} viewBox="0 0 200 150" style={StyleSheet.absoluteFill}>
      <G transform="rotate(-16 160 40)">
        <Rect x={146} y={22} width={28} height={34} rx={5} fill={g.creamStrong} stroke={g.track} strokeWidth={1.6} />
        <Line x1={152} y1={31} x2={168} y2={31} stroke={g.vermilion} strokeWidth={2.2} strokeLinecap="round" />
        <Line x1={152} y1={37} x2={166} y2={37} stroke={g.track} strokeWidth={2.2} strokeLinecap="round" />
        <Line x1={152} y1={43} x2={162} y2={43} stroke={g.track} strokeWidth={2.2} strokeLinecap="round" />
      </G>
      <Circle cx={138} cy={64} r={2} fill={g.pink} />
      <Circle cx={128} cy={72} r={1.6} fill={g.pink} opacity={0.7} />
      <Circle cx={119} cy={79} r={1.2} fill={g.pink} opacity={0.45} />
      <Path d={sparklePath(30, 26, 6)} fill={g.pink} />
    </Svg>
  </View>;
}

export function RingedPlanet({ size = 50, palette, seam }: Common & { size?: number }) {
  const { g, bg } = useGraphic({ palette, seam });
  const id = useSvgId('rp');
  const cx = 60, cy = 52, r = 20;
  const arc = (sweep: 0 | 1) => `M${cx - 41} ${cy} A41 10.5 0 0 ${sweep} ${cx + 41} ${cy}`;
  const rotate = `rotate(${TILT} ${cx} ${cy})`;
  return <Svg width={size} height={(size * 100) / 120} viewBox="0 0 120 100">
    <Defs><ClipPath id={id}><Circle cx={cx} cy={cy} r={r} /></ClipPath></Defs>
    <G transform={rotate}><Path d={arc(1)} fill="none" stroke={g.pink} strokeWidth={5} strokeLinecap="round" /></G>
    <Circle cx={cx} cy={cy} r={r} fill={g.shade} />
    <G clipPath={`url(#${id})`}><Circle cx={cx - 5} cy={cy - 6} r={r} fill={g.vermilion} /></G>
    <G transform={rotate}>
      <Path d={arc(0)} fill="none" stroke={bg} strokeWidth={10} strokeLinecap="round" />
      <Path d={arc(0)} fill="none" stroke={g.pink} strokeWidth={5} strokeLinecap="round" />
    </G>
  </Svg>;
}

/* ------------------------------------------------------------------ */
/* 深空：星点、轻闪的星芒、行星地平线（VIP 卡背景）。                       */
/* ------------------------------------------------------------------ */
function seeded(seed: number) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

/** 静态星点（不含会闪的大星芒）。坐标按 viewBox 比例生成。 */
export function StarDust({ width, height, count = 20, seed = 5, color, x0 = 0, x1 = 1 }: { width: number; height: number; count?: number; seed?: number; color: string; x0?: number; x1?: number }) {
  const rnd = seeded(seed);
  return <>{Array.from({ length: count }, (_, i) => {
    const x = (x0 + rnd() * (x1 - x0)) * width, y = rnd() * height, r = 0.8 + rnd() * 1.3, o = 0.35 + rnd() * 0.5;
    return <Circle key={i} cx={r2(x)} cy={r2(y)} r={r2(r)} fill={color} opacity={r2(o)} />;
  })}</>;
}

/** 深空卡片上的大星芒：3.2 秒明暗一次，彼此错开；减少动态效果时静止。 */
export function Twinkle({ left, top, size = 12, delay = 0, color }: { left: number | `${number}%`; top: number | `${number}%`; size?: number; delay?: number; color: string }) {
  const reduced = useReducedMotion();
  const [value] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (reduced || !AMBIENT_MOTION) { value.setValue(1); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.delay(delay),
      Animated.timing(value, { toValue: 0, duration: 1600, easing: motion.easeInOut, useNativeDriver: NATIVE }),
      Animated.timing(value, { toValue: 1, duration: 1600, easing: motion.easeInOut, useNativeDriver: NATIVE }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [reduced, delay, value]);
  return <Animated.View pointerEvents="none" style={{ position: 'absolute', left, top, width: size * 2, height: size * 2, marginLeft: -size, marginTop: -size,
    opacity: value.interpolate({ inputRange: [0, 1], outputRange: [0.38, 1] }),
    transform: [{ scale: value.interpolate({ inputRange: [0, 1], outputRange: [0.78, 1] }) }] }}>
    <Svg width={size * 2} height={size * 2} viewBox={`0 0 ${size * 2} ${size * 2}`}><Path d={sparklePath(size, size, size * 0.9)} fill={color} /></Svg>
  </Animated.View>;
}

/** 行星地平线：深空底，朱橙行星从右下角升起，大气是三层豆沙粉光晕，左上方一弯小月。文字放左侧。 */
export function PlanetHorizon({ width = 360, height = 150, seed = 5, twinkle = true }: { width?: number; height?: number; seed?: number; twinkle?: boolean }) {
  const { theme } = useAppTheme();
  const g = { ...theme.graphic, vermilion: '#E8583A' };
  const id = useSvgId('hz');
  const w = width, h = height, px = w * 0.9, py = h * 1.55, pr = h * 1.02;
  return <View style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <Svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid slice">
      <Defs><ClipPath id={`${id}p`}><Circle cx={px} cy={py} r={pr} /></ClipPath></Defs>
      <Rect width={w} height={h} fill={theme.space} />
      <StarDust width={w} height={h * 0.92} count={14} seed={seed} color={g.star} x0={0.4} x1={0.8} />
      <Circle cx={px} cy={py} r={pr + 34} fill={g.pink} opacity={0.12} />
      <Circle cx={px} cy={py} r={pr + 18} fill={g.pink} opacity={0.2} />
      <Circle cx={px} cy={py} r={pr + 7} fill={g.pink} opacity={0.55} />
      <Circle cx={px} cy={py} r={pr} fill={g.vermilion} />
      <G clipPath={`url(#${id}p)`}>
        <Circle cx={px + 26} cy={py + 22} r={pr} fill="#9E2E17" opacity={0.5} />
        <G transform={`rotate(${TILT} ${px} ${py})`} opacity={0.35}>
          <Ellipse cx={px} cy={py - pr * 0.62} rx={pr * 1.2} ry={5} fill={g.hot} />
          <Ellipse cx={px} cy={py - pr * 0.45} rx={pr * 1.2} ry={3} fill={g.hot} />
        </G>
      </G>
      <Circle cx={w * 0.6} cy={h * 0.24} r={9} fill={g.pink} />
      <Circle cx={w * 0.6 - 3} cy={h * 0.24 - 2.5} r={9} fill={theme.space} />
    </Svg>
    {twinkle ? <>
      <Twinkle left="47%" top="18%" size={7} color={g.star} />
      <Twinkle left="71%" top="62%" size={5} delay={1100} color={g.star} />
    </> : null}
  </View>;
}

/** 声纹条：口语素材的进度预览，已练部分用模式色；进入时由低到高长出一次。 */
export function Voiceprint({ played = 0, bars = 56, height = 26, color, track }: { played?: number; bars?: number; height?: number; color: string; track?: string }) {
  const { theme } = useAppTheme();
  const [animate] = useState(motionAllowedNow);
  const [grow] = useState(() => new Animated.Value(animate ? 0 : 1));
  useEffect(() => {
    if (!animate) return;
    const animation = Animated.timing(grow, { toValue: 1, duration: 520, delay: 140, easing: motion.easeOut, useNativeDriver: NATIVE });
    animation.start();
    return () => animation.stop();
  }, [animate, grow]);
  const w = 300, step = w / bars;
  const lines = Array.from({ length: bars }, (_, i) => {
    const t = i / bars;
    const env = 0.35 + 0.65 * Math.abs(Math.sin(t * 9.4 + 1)) * (0.55 + 0.45 * Math.abs(Math.cos(t * 23)));
    const half = Math.max(2, env * (height - 4)) / 2;
    const x = r2(i * step + step / 2);
    return <Line key={i} x1={x} y1={r2(height / 2 - half)} x2={x} y2={r2(height / 2 + half)} stroke={t < played ? color : track ?? theme.graphic.track} strokeWidth={r2(Math.min(3, step * 0.55))} strokeLinecap="round" />;
  });
  return <Animated.View pointerEvents="none" style={{ height, opacity: grow.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }), transform: [{ scaleY: grow.interpolate({ inputRange: [0, 1], outputRange: [0.15, 1] }) }] }}>
    <Svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none">{lines}</Svg>
  </Animated.View>;
}

/** 录音键外圈：22 根刻度跟随麦克风音量（0–1）起伏；停止后 240ms 内收回。减少动态效果时仍跟随音量，只是不做平滑之外的动画。 */
export function RecordRing({ level, active, size = 72, color }: { level: number; active: boolean; size?: number; color: string }) {
  const n = 22;
  const [shown, setShown] = useState<number[]>(() => new Array(n).fill(0));
  const targetLevel = useRef(level);
  useEffect(() => { targetLevel.current = level; }, [level]);
  const moving = active || shown.some((v) => v > 0.02);
  useFrameLoop(moving, (dt, now) => setShown((current) => current.map((value, i) => {
    const wave = 0.55 + 0.45 * Math.sin(i * 1.7 + now / 260);
    const target = active ? Math.max(0, Math.min(1, targetLevel.current * wave)) : 0;
    const next = value + (target - value) * Math.min(1, dt / 90);
    return next < 0.005 && !active ? 0 : next;
  })));
  const r1 = 27;
  return <Svg width={size} height={size} viewBox="-36 -36 72 72" pointerEvents="none">
    {shown.map((value, i) => {
      if (value <= 0.01) return null;
      const a = (i / n) * TAU - Math.PI / 2, r2v = r1 + 1 + value * 8;
      return <Line key={i} x1={r2(r1 * Math.cos(a))} y1={r2(r1 * Math.sin(a))} x2={r2(r2v * Math.cos(a))} y2={r2(r2v * Math.sin(a))} stroke={color} strokeWidth={2.2} strokeLinecap="round" />;
    })}
  </Svg>;
}

/** 首次出现时淡入并沿方向位移一次（彗星、空状态插画）；减少动态效果时直接显示。 */
export function EnterOnce({ children, dx = 0, dy = 6, delay = 0, duration = 640, style }: { children: React.ReactNode; dx?: number; dy?: number; delay?: number; duration?: number; style?: StyleProp<ViewStyle> }) {
  const [animate] = useState(motionAllowedNow);
  const [progress] = useState(() => new Animated.Value(animate ? 0 : 1));
  useEffect(() => {
    if (!animate) return;
    const animation = Animated.timing(progress, { toValue: 1, duration, delay, easing: motion.easeOut, useNativeDriver: NATIVE });
    animation.start();
    return () => animation.stop();
  }, [animate, delay, duration, progress]);
  return <Animated.View style={[style, {
    opacity: progress,
    transform: [
      { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [dx, 0] }) },
      { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [dy, 0] }) },
    ],
  }]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  loader: { alignItems: 'center', gap: 6 },
  loaderLabel: { fontSize: 13, lineHeight: 20, textAlign: 'center' },
});
