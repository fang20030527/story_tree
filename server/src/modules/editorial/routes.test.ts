import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import Fastify from 'fastify';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { editorialImageRoutes } from './routes';

let directory: string;
let app: ReturnType<typeof Fastify>;
const id = '0123456789abcdef01234567.webp';
const bytes = Buffer.from('RIFF-test-WEBP');

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'editorial-image-test-'));
  await writeFile(join(directory, id), bytes);
  app = Fastify();
  await app.register(editorialImageRoutes, { assetDirectory: directory });
});

afterEach(async () => {
  await app.close();
  if (!resolve(directory).startsWith(resolve(tmpdir()) + '\\editorial-image-test-')
    && !resolve(directory).startsWith(resolve(tmpdir()) + '/editorial-image-test-')) {
    throw new Error('测试清理路径不安全');
  }
  await rm(directory, { recursive: true });
});

it('streams public images and honors cache validators', async () => {
  const response = await app.inject({ url: `/v1/editorial/images/${id}` });
  expect(response.statusCode).toBe(200);
  expect(response.rawPayload).toEqual(bytes);
  expect(response.headers['content-type']).toBe('image/webp');
  expect(response.headers['cache-control']).toContain('immutable');
  const cached = await app.inject({ url: `/v1/editorial/images/${id}`, headers: { 'if-none-match': `"${id}"` } });
  expect(cached.statusCode).toBe(304);
  expect(cached.body).toBe('');
  const head = await app.inject({ method: 'HEAD', url: `/v1/editorial/images/${id}` });
  expect(head.statusCode).toBe(200);
  expect(head.body).toBe('');
});

it('rejects arbitrary paths and does not expose filesystem details for missing images', async () => {
  for (const invalid of ['secret.env', '..%2Fsecret.webp', 'https%3A%2F%2Fexample.com']) {
    const response = await app.inject({ url: `/v1/editorial/images/${invalid}` });
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain(directory);
  }
  const missing = await app.inject({ url: '/v1/editorial/images/aaaaaaaaaaaaaaaaaaaaaaaa.webp' });
  expect(missing.statusCode).toBe(404);
  expect(missing.body).not.toContain(directory);
});
