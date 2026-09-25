import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import Fastify from 'fastify';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { createPublishedEditorialStore } from './published-content';
import { publishedEditorialRoutes } from './published-routes';

let directory: string;
let app: ReturnType<typeof Fastify>;
const imageName = 'daily-cover.webp';
const imageBytes = Buffer.from('RIFF-test-WEBP');

function article(id: string, publishedAt: string, status: 'draft' | 'published' = 'published') {
  return {
    id,
    status,
    titleZh: '今日文章',
    titleEn: 'A daily article',
    summaryZh: '一篇新文章。',
    keyPointsZh: ['阅读要点'],
    source: 'Daily Journal',
    category: '科学',
    level: '雅思 6.5',
    image: `/v1/editorial/assets/${imageName}`,
    publishedAt,
    paragraphs: ['A new article is available without an app update.'],
  };
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'published-editorial-test-'));
  await mkdir(join(directory, 'articles'));
  await mkdir(join(directory, 'assets'));
  await writeFile(join(directory, 'assets', imageName), imageBytes);
  for (const item of [
    article('remote-2026-09-24-new', '2026-09-24'),
    article('remote-2026-09-23-old', '2026-09-23'),
    article('remote-2026-09-25-draft', '2026-09-25', 'draft'),
  ]) {
    await writeFile(join(directory, 'articles', `${item.id}.json`), JSON.stringify(item));
  }
  app = Fastify();
  await app.register(publishedEditorialRoutes, { contentDirectory: directory });
});

afterEach(async () => {
  await app.close();
  const root = resolve(tmpdir());
  const target = resolve(directory);
  if (!target.startsWith(`${root}\\published-editorial-test-`)
    && !target.startsWith(`${root}/published-editorial-test-`)) {
    throw new Error('测试清理路径不安全');
  }
  await rm(target, { recursive: true });
});

it('publishes summaries and full articles while keeping drafts private', async () => {
  const list = await app.inject({ url: '/v1/editorial/articles' });
  expect(list.statusCode).toBe(200);
  expect(list.headers['cache-control']).toBe('no-store');
  expect(list.json().articles).toEqual([
    expect.objectContaining({ id: 'remote-2026-09-24-new', section: 'today', wordCount: 9, minutes: 1, hasAudio: false }),
    expect.objectContaining({ id: 'remote-2026-09-23-old', section: 'featured' }),
  ]);
  expect(list.json().articles[0]).not.toHaveProperty('paragraphs');

  const detail = await app.inject({ url: '/v1/editorial/articles/remote-2026-09-24-new' });
  expect(detail.statusCode).toBe(200);
  expect(detail.json().paragraphs).toEqual(['A new article is available without an app update.']);
  expect(detail.json().hasAudio).toBe(false);

  const draft = await app.inject({ url: '/v1/editorial/articles/remote-2026-09-25-draft' });
  expect(draft.statusCode).toBe(404);
});

it('serves referenced assets and byte ranges, and blocks unknown files', async () => {
  const full = await app.inject({ url: `/v1/editorial/assets/${imageName}` });
  expect(full.statusCode).toBe(200);
  expect(full.rawPayload).toEqual(imageBytes);
  expect(full.headers['content-type']).toBe('image/webp');

  const range = await app.inject({
    url: `/v1/editorial/assets/${imageName}`,
    headers: { range: 'bytes=5-8' },
  });
  expect(range.statusCode).toBe(206);
  expect(range.rawPayload).toEqual(imageBytes.subarray(5, 9));
  expect(range.headers['content-range']).toBe(`bytes 5-8/${imageBytes.length}`);

  const invalidRange = await app.inject({
    url: `/v1/editorial/assets/${imageName}`,
    headers: { range: 'bytes=999-' },
  });
  expect(invalidRange.statusCode).toBe(416);
  expect((await app.inject({ url: '/v1/editorial/assets/private.webp' })).statusCode).toBe(404);
  expect((await app.inject({ url: '/v1/editorial/assets/..%2Fsecret.webp' })).statusCode).toBe(400);
});

it('rejects malformed article bodies before deployment', async () => {
  const broken = article('remote-2026-09-26-broken', '2026-09-26');
  await writeFile(join(directory, 'articles', `${broken.id}.json`), JSON.stringify({
    ...broken,
    bodyBlocks: [{ type: 'text', text: 'Different text' }],
  }));
  await expect(createPublishedEditorialStore(directory).validate()).rejects.toThrow('外刊内容文件无效');
});

it('rejects references to missing published assets before deployment', async () => {
  const broken = article('remote-2026-09-26-missing', '2026-09-26');
  await writeFile(join(directory, 'articles', `${broken.id}.json`), JSON.stringify({
    ...broken,
    image: '/v1/editorial/assets/missing-cover.webp',
  }));
  await expect(createPublishedEditorialStore(directory).validate()).rejects.toThrow('外刊内容文件无效');
});
