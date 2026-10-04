/** @jest-environment node */
import path from 'node:path';
import { getPrebuildConfigAsync } from '@expo/prebuild-config';
import { compileModsAsync } from 'expo/config-plugins';
import appJson from '../../../app.json';

const projectRoot = path.resolve(__dirname, '../../..');

// iOS 在 Info.plist 缺少 NSMicrophoneUsageDescription 时，会在 requestRecordPermission 的瞬间终止进程，
// JS 无法捕获，表现为“点录音就闪退”。曾经 expo-image-picker 的 `microphonePermission: false`
// 会删掉 expo-audio 写入的这个键，所以这里按 `expo config --type introspect` 的方式
// 运行全部配置插件，检查最终生成的 Info.plist，而不是只看 app.json。
it('keeps the expo-audio microphone usage description in the generated iOS Info.plist', async () => {
  const plugins: unknown[] = appJson.expo.plugins;
  const audio = plugins.find(plugin => Array.isArray(plugin) && plugin[0] === 'expo-audio') as [string, { microphonePermission: string }] | undefined;
  if (!audio) throw new Error('app.json 没有配置 expo-audio 插件');
  expect(audio[1].microphonePermission).toMatch(/\S/);
  // expo-sharing 在没有显式 appGroupId 时会 console.warn，与本测试无关。
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    const config = await getPrebuildConfigAsync(projectRoot, { platforms: ['ios'] });
    await compileModsAsync(config.exp, { projectRoot, introspect: true, platforms: ['ios'], assertMissingModProviders: false });
    expect(config.exp.ios?.infoPlist?.NSMicrophoneUsageDescription).toBe(audio[1].microphonePermission);
  } finally { warn.mockRestore(); }
});
