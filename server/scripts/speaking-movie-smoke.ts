import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

import {
  PublicErrorSchema,
  SpeakingAssetDtoSchema,
  SpeakingCapabilitiesDtoSchema,
  SpeakingLibraryDtoSchema,
  SpeakingMaterialDtoSchema,
  SpeakingPlaybackDtoSchema,
  SpeakingSessionDtoSchema,
  SpeakingStateDtoSchema,
} from '@context-reader/contracts';

import { buildApp } from '../src/app';
import { loadConfig } from '../src/config/env';
import { FFmpegMediaProcessor } from '../src/infrastructure/media/ffmpeg';
import { createMediaStore, type MediaStore } from '../src/infrastructure/media/store';
import { registerAnonymous } from '../src/modules/auth/service';
import { withTestDatabase } from '../test/database';

interface MovieSummary {
  title: string;
  status: 'passed' | 'skipped';
  reason?: string;
  bytes?: number;
  durationSeconds?: number;
  subtitleCues?: number;
  subtitleEncoding?: 'utf-8' | 'windows-1252';
  overlappingCues?: number;
  rangeReads?: number;
  elapsedMs?: number;
}

interface SmokeReport {
  testedAt: string;
  scope: string;
  database: string;
  storage: string;
  externalAiCalls: number;
  phase: string;
  status: 'running' | 'passed' | 'failed';
  movies: MovieSummary[];
  failure?: string;
}

class SmokeError extends Error {}

const workspace = fileURLToPath(new URL('../../', import.meta.url));
const reportPath = join(workspace, '.local-test-results', 'speaking', 'movie-report.json');
const report: SmokeReport = {
  testedAt: new Date().toISOString(),
  scope: '已有外置字幕的本地电影上传、字幕校正、收藏笔记、练习记录与字节 Range 播放',
  database: '随机 app_test_* 隔离 Schema；结束后清理',
  storage: '本次测试专用本地临时目录；结束后清理',
  externalAiCalls: 0,
  phase: 'initializing', status: 'running', movies: [],
};

async function persistReport(): Promise<void> {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function check(value: unknown, message: string): asserts value {
  if (!value) throw new SmokeError(message);
}

function titleFor(path: string): string {
  if (/forrest[ .]gump/iu.test(path)) return '阿甘正传';
  if (/interstellar/iu.test(path)) return '星际穿越';
  if (/titanic/iu.test(path)) return '泰坦尼克号';
  if (/the[ .]odyssey/iu.test(path)) return 'The Odyssey（本地目录标识）';
  return '其他本地电影';
}

async function collectFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > 5 || files.length > 1_000) throw new SmokeError('电影目录层级或文件数超出本地测试范围');
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path, depth + 1);
      else if (entry.isFile()) files.push(path);
    }
  }
  await visit(root, 0);
  return files;
}

function subtitlesFor(movie: string, files: string[]): string | undefined {
  const base = dirname(movie);
  return files.filter(path => {
    const nested = relative(base, path);
    return !nested.startsWith('..') && !isAbsolute(nested) && extname(path).toLowerCase() === '.srt';
  }).sort((a, b) => {
    const score = (path: string) => basename(path).toLowerCase() === 'english.srt' ? 0 : dirname(path) === base ? 1 : 2;
    return score(a) - score(b);
  })[0];
}

async function removeTestDirectory(path: string): Promise<void> {
  const absolute = resolve(path);
  const nested = relative(resolve(tmpdir()), absolute);
  check(nested && !nested.startsWith('..') && !isAbsolute(nested) && basename(absolute).startsWith('speaking-movie-smoke-'), '测试目录清理范围无效');
  await rm(absolute, { recursive: true, force: true });
}

async function streamUpload(base: string, path: string, input: string, token: string, byteSize: number): Promise<unknown> {
  const endpoint = new URL(path, base);
  let finishResponse!: (result: unknown) => void;
  let failResponse!: (error: Error) => void;
  const response = new Promise<unknown>((done, fail) => { finishResponse = done; failResponse = fail; });
  const upload = httpRequest(endpoint, {
    method: 'PUT', headers: {
      authorization: `Bearer ${token}`, 'content-type': 'video/mp4', 'content-length': String(byteSize),
    },
  }, result => {
    const chunks: Buffer[] = [];
    let responseBytes = 0;
    result.on('data', (value: Buffer) => {
      responseBytes += value.length;
      if (responseBytes > 2 * 1024 * 1024) {
        result.destroy(new SmokeError('媒体上传响应超出预期范围'));
      } else chunks.push(value);
    });
    result.on('error', () => failResponse(new SmokeError('读取媒体上传响应失败')));
    result.on('end', () => {
      if (result.statusCode !== 200) {
        let errorCode = '';
        try {
          const publicError = PublicErrorSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
          if (publicError.success) errorCode = `／${publicError.data.error.code}`;
        } catch { /* 错误摘要只保留 HTTP 状态与稳定错误码。 */ }
        failResponse(new SmokeError(`媒体上传失败（HTTP ${result.statusCode ?? 0}${errorCode}）`));
        return;
      }
      try { finishResponse(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown); }
      catch { failResponse(new SmokeError('媒体上传响应不是有效 JSON')); }
    });
  });
  upload.on('error', () => failResponse(new SmokeError('本地媒体上传连接失败')));
  // 本地磁盘到 HTTP 的流式传输，不将整部电影读入内存。
  const [result] = await Promise.all([response, pipeline(createReadStream(input), upload)]);
  return result;
}

async function sourceRange(path: string, start: number, length: number): Promise<Buffer> {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const read = await handle.read(buffer, 0, length, start);
    check(read.bytesRead === length, '读取本地媒体对照片段失败');
    return buffer;
  } finally {
    await handle.close();
  }
}

async function main(): Promise<void> {
  if (process.env.RUN_SPEAKING_MOVIE_SMOKE !== '1') {
    console.error('电影测试默认关闭；请显式设置 RUN_SPEAKING_MOVIE_SMOKE=1。');
    process.exitCode = 1;
    return;
  }
  const sourceRoot = resolve(process.env.MOVIE_TEST_ROOT ?? 'D:/qBittorrent/下载');
  check((await lstat(sourceRoot)).isDirectory(), '电影测试目录不存在');
  const files = await collectFiles(sourceRoot);
  const movies = files.filter(path => extname(path).toLowerCase() === '.mp4');
  check(movies.length > 0 && movies.length <= 20, '未找到可测试的 MP4 电影，或电影数量超出范围');
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'speaking-movie-smoke-'));
  const store = createMediaStore({ driver: 'local', localRoot: join(temporaryRoot, 'store') });
  const objectKeys = new Set<string>();
  const trackedStore: MediaStore = {
    driver: 'local',
    putFile: async (key, path, contentType, signal) => {
      await store.putFile(key, path, contentType, signal);
      objectKeys.add(key);
    },
    downloadFile: (key, path, signal) => store.downloadFile(key, path, signal),
    stat: key => store.stat(key),
    openRead: (key, range) => store.openRead(key, range),
    delete: key => store.delete(key),
  };
  try {
    report.phase = 'isolated-database';
    await persistReport();
    await withTestDatabase(async ({ db }) => {
      const token = crypto.randomUUID().replaceAll('-', '').repeat(2);
      const foreignToken = crypto.randomUUID().replaceAll('-', '').repeat(2);
      await registerAnonymous(db, token, true);
      await registerAnonymous(db, foreignToken, true);
      const config = loadConfig({
        DATABASE_URL: 'postgresql://example.invalid/movie-test',
        EVOLINK_API_KEY: 'movie-test-no-external-ai',
        PUBLIC_SERVER_ORIGIN: 'http://127.0.0.1:3000',
        SPEAKING_STORAGE_DRIVER: 'local', SPEAKING_MEDIA_ROOT: temporaryRoot,
        SPEAKING_PLAYBACK_SIGNING_KEY: crypto.randomUUID().repeat(2),
        SPEAKING_UPLOAD_TIMEOUT_MS: '1200000',
      });
      const app = buildApp({
        config, db, logger: false,
        speakingMediaStore: trackedStore,
        speakingMediaProcessor: new FFmpegMediaProcessor({
          ...(process.env.FFPROBE_PATH ? { ffprobePath: process.env.FFPROBE_PATH } : {}),
        }),
      });
      try {
        const base = await app.listen({ host: '127.0.0.1', port: 0 });
        async function json(method: string, path: string, input?: unknown, authToken = token, key = crypto.randomUUID()): Promise<unknown> {
          const response = await fetch(new URL(path, base), {
            method, headers: {
              authorization: `Bearer ${authToken}`,
              ...(input === undefined ? {} : { 'content-type': 'application/json', 'idempotency-key': key }),
            }, ...(input === undefined ? {} : { body: JSON.stringify(input) }),
          });
          if (!response.ok) {
            let errorCode = '';
            try {
              const publicError = PublicErrorSchema.safeParse(await response.json());
              if (publicError.success) errorCode = `／${publicError.data.error.code}`;
            } catch { /* 不记录响应正文、字幕或源文件路径。 */ }
            throw new SmokeError(`口语接口请求失败（HTTP ${response.status}${errorCode}）`);
          }
          return response.json();
        }

        const capabilities = SpeakingCapabilitiesDtoSchema.parse(await json('GET', '/v1/speaking/capabilities'));
        check(capabilities.autoSubtitles === false, '本次范围应仅接受已有字幕');
        for (const movie of movies) {
          const title = titleFor(movie);
          const srtPath = subtitlesFor(movie, files);
          if (!srtPath) {
            report.movies.push({ title, status: 'skipped', reason: '未找到外置 SRT；未调用自动字幕或 AI' });
            console.log(`${title}：无外置字幕，已跳过。`);
            continue;
          }
          const started = Date.now();
          report.phase = `${title}:upload`;
          await persistReport();
          const sourceInfo = await lstat(movie);
          const subtitleInfo = await lstat(srtPath);
          check(sourceInfo.size <= capabilities.maxMediaBytes && subtitleInfo.size <= capabilities.maxSubtitleBytes, '本地素材超过服务端文件大小限制');
          const subtitleBytes = await readFile(srtPath);
          let text: string;
          let subtitleEncoding: 'utf-8' | 'windows-1252' = 'utf-8';
          try {
            text = new TextDecoder('utf-8', { fatal: true }).decode(subtitleBytes);
          } catch {
            // 本轮阿甘正传的英文 SRT 含 Windows-1252 标点，明确解码以免丢字。
            text = new TextDecoder('windows-1252', { fatal: true }).decode(subtitleBytes);
            subtitleEncoding = 'windows-1252';
          }
          console.log(`${title}：开始流式上传 ${Math.round(sourceInfo.size / 1024 ** 2)} MiB。`);
          try {
            const asset = SpeakingAssetDtoSchema.parse(await json('POST', '/v1/speaking/assets', {
              contentType: 'video/mp4', byteSize: sourceInfo.size, purpose: 'material',
            }));
            const ready = SpeakingAssetDtoSchema.parse(await streamUpload(base, asset.uploadPath, movie, token, sourceInfo.size));
            check(ready.status === 'ready' && ready.duration > 0, '电影媒体探测未就绪');
            report.phase = `${title}:subtitles`;
            const created = SpeakingMaterialDtoSchema.parse(await json('POST', '/v1/speaking/materials', {
              sourceKind: 'file', assetId: ready.id, title,
              cues: [{ id: 'import-preview', start: 0, end: 1, en: 'Subtitle import preview.', zh: '' }],
            }));
            const imported = SpeakingMaterialDtoSchema.parse(await json('POST', `/v1/speaking/materials/${created.id}/subtitles/import`, {
              revision: created.revision, format: 'srt', text,
            }));
            check(imported.cues.length > 100, '电影字幕数量异常');
            check(imported.cues.every(cue => cue.end <= ready.duration + 1), '字幕时间轴超出电影时长');
            const firstCue = imported.cues[0]!;
            const correctedCues = imported.cues.map((cue, index) => index ? cue : { ...cue, zh: '本地测试校正备注。' });
            const corrected = SpeakingMaterialDtoSchema.parse(await json('PATCH', `/v1/speaking/materials/${created.id}/subtitles`, { revision: imported.revision, cues: correctedCues }));
            check(corrected.revision === imported.revision + 1, '字幕校正版本未递增');

            report.phase = `${title}:practice-state`;
            const statePath = `/v1/speaking/materials/${created.id}/state`;
            const state = SpeakingStateDtoSchema.parse(await json('GET', statePath));
            const updated = SpeakingStateDtoSchema.parse(await json('PATCH', statePath, {
              revision: state.revision, savedCueIds: [firstCue.id],
              notes: { [firstCue.id]: '注意连读与停顿。' }, position: firstCue.start,
            }));
            check(updated.savedCueIds.includes(firstCue.id) && updated.notes[firstCue.id] === '注意连读与停顿。', '字幕收藏或笔记未保存');
            const sessionId = crypto.randomUUID();
            const sessionInput = { materialId: created.id, date: new Date().toISOString(), elapsedMs: 15_000, cueCount: 1, position: firstCue.end };
            await json('PUT', `/v1/speaking/sessions/${sessionId}`, sessionInput);
            const savedAgain = SpeakingSessionDtoSchema.parse(await json('PUT', `/v1/speaking/sessions/${sessionId}`, { ...sessionInput, elapsedMs: 5_000 }));
            check(savedAgain.elapsedMs === 15_000, '重复保存使练习累计时长倒退');
            const library = SpeakingLibraryDtoSchema.parse(await json('GET', '/v1/speaking/library'));
            check(library.sessions.filter(session => session.id === sessionId).length === 1, '重复保存产生重复练习记录');

            report.phase = `${title}:private-range-playback`;
            for (const path of [`/v1/speaking/materials/${created.id}`, `/v1/speaking/assets/${ready.id}/playback`]) {
              const denied = await fetch(new URL(path, base), { headers: { authorization: `Bearer ${foreignToken}` } });
              check(denied.status === 404, '其他账号可访问私有电影');
              await denied.body?.cancel();
            }
            const playback = SpeakingPlaybackDtoSchema.parse(await json('GET', `/v1/speaking/assets/${ready.id}/playback`));
            const signed = new URL(playback.url);
            const playbackPath = `${signed.pathname}${signed.search}`;
            const sampleLength = 64 * 1024;
            for (const start of [0, Math.floor(sourceInfo.size / 2), sourceInfo.size - sampleLength]) {
              const end = start + sampleLength - 1;
              const range = await fetch(new URL(playbackPath, base), { headers: { range: `bytes=${start}-${end}` } });
              check(range.status === 206, '媒体 Range 播放未返回部分内容');
              check(range.headers.get('content-range') === `bytes ${start}-${end}/${sourceInfo.size}`, '媒体 Range 响应区间不正确');
              const actual = Buffer.from(await range.arrayBuffer());
              assert.deepEqual(actual, await sourceRange(movie, start, sampleLength), '媒体播放片段与源文件不一致');
            }
            const unsigned = await fetch(new URL(signed.pathname, base), { headers: { range: 'bytes=0-1023' } });
            check(unsigned.status >= 400, '无签名媒体地址可播放');
            await unsigned.body?.cancel();
            const overlaps = imported.cues.reduce((total, cue, index) => total + (index && cue.start < imported.cues[index - 1]!.end ? 1 : 0), 0);
            report.movies.push({
              title, status: 'passed', bytes: sourceInfo.size, durationSeconds: ready.duration,
              subtitleCues: imported.cues.length, subtitleEncoding, overlappingCues: overlaps, rangeReads: 3,
              elapsedMs: Date.now() - started,
            });
            console.log(`${title}：通过；${imported.cues.length} 条字幕，时长 ${Math.round(ready.duration)} 秒，3 个 Range 片段一致。`);
          } finally {
            // 仅删除本次临时 MediaStore 接收的对象，绝不删除下载目录源文件。
            for (const key of objectKeys) await store.delete(key);
            objectKeys.clear();
          }
          await persistReport();
        }
        check(report.movies.some(movie => movie.status === 'passed'), '没有完成任何带字幕电影测试');
      } finally {
        await app.close();
      }
    });
    report.phase = 'complete';
    report.status = 'passed';
  } finally {
    await removeTestDirectory(temporaryRoot);
    await persistReport();
  }
}

main().catch(async error => {
  report.status = 'failed';
  report.failure = error instanceof SmokeError ? error.message : '本地链路校验失败；未记录输入正文、环境变量或凭证';
  await persistReport();
  console.error(`电影字幕链路测试失败，阶段：${report.phase}。摘要报告：.local-test-results/speaking/movie-report.json`);
  process.exitCode = 1;
});
