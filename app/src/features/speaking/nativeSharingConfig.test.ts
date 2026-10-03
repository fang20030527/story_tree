/** @jest-environment node */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import plistTools from '@expo/plist';
import type { ConfigPlugin, ExportedConfig } from 'expo/config-plugins';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const withSpeakingSharing: ConfigPlugin<unknown> = require('../../../plugins/withSpeakingSharing');

it('generates a string share callback while retaining the main app and WeChat schemes', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'speaking-share-config-'));
  const original = {
    name: '黑洞英语', slug: 'speaking-test', scheme: ['app', 'wx-test'],
    ios: { bundleIdentifier: 'com.example.speaking' }, android: { package: 'com.example.speaking' },
    _internal: { projectRoot: path.resolve(__dirname, '../../..') },
  };
  try {
    const config = withSpeakingSharing(original, {
      ios: { enabled: true, appGroupId: 'group.com.example.speaking', activationRule: { supportsFileWithMaxCount: 2 } },
      android: { enabled: true, singleShareMimeTypes: ['audio/*', 'video/*'] },
    }) as ExportedConfig;
    expect(config.scheme).toEqual(['app', 'wx-test']);
    const dangerous = config.mods?.ios?.dangerous;
    const strings = config.mods?.android?.strings;
    if (!dangerous || !strings) throw new Error('没有注册原生分享配置');
    await dangerous({ ...config, modRawConfig: original, modResults: null,
      modRequest: { projectRoot: directory, platformProjectRoot: directory, platform: 'ios', modName: 'dangerous', introspect: false } });
    const plist = plistTools.parse(await readFile(path.join(directory, 'expo-sharing-extension', 'Info.plist'), 'utf8'));
    expect(plist.MainTargetUrlScheme).toBe('app');
    expect(plist.NSExtension).toMatchObject({ NSExtensionAttributes: { NSExtensionActivationRule: { NSExtensionActivationSupportsFileWithMaxCount: 2 } } });
    const android = await strings({ ...config, modRawConfig: original, modResults: { resources: {} },
      modRequest: { projectRoot: directory, platformProjectRoot: directory, platform: 'android', modName: 'strings', introspect: false } });
    expect(android.modResults.resources.string).toEqual([expect.objectContaining({ _: 'app', $: expect.objectContaining({ name: 'share_into_scheme' }) })]);
  } finally {
    if (path.dirname(directory) !== path.resolve(tmpdir()) || !path.basename(directory).startsWith('speaking-share-config-')) {
      throw new Error('临时测试目录校验失败');
    }
    await rm(directory, { recursive: true, force: true });
  }
});
