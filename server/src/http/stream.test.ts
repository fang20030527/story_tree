import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { AppError } from '../core/errors';
import { readBoundedMultipartStream, readBoundedStream } from './stream';

describe('readBoundedStream', () => {
  it('reads an exact multi-chunk body and computes its digest', async () => {
    const chunks = [Buffer.from('careful '), Buffer.from('reading '), Buffer.from('wins')];
    const content = Buffer.concat(chunks);

    const result = await readBoundedStream(Readable.from(chunks), {
      contentLength: content.byteLength,
      maxBytes: content.byteLength,
    });

    expect(result).toEqual({
      content,
      byteSize: content.byteLength,
      sha256: createHash('sha256').update(content).digest('hex'),
    });
  });

  it.each([
    {
      name: 'declared length over limit',
      stream: () => Readable.from([Buffer.from('private-body')]),
      contentLength: 12,
      maxBytes: 4,
    },
    {
      name: 'body overflow',
      stream: () => Readable.from([Buffer.from('private-body')]),
      contentLength: 4,
      maxBytes: 20,
    },
    {
      name: 'short body',
      stream: () => Readable.from([Buffer.from('tiny')]),
      contentLength: 10,
      maxBytes: 20,
    },
  ])('rejects $name without reflecting body content', async (testCase) => {
    const error = await readBoundedStream(testCase.stream(), {
      contentLength: testCase.contentLength,
      maxBytes: testCase.maxBytes,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect(String((error as Error).message)).not.toContain('private-body');
  });

  it('preserves an abort signal', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      readBoundedStream(Readable.from([Buffer.from('private-body')]), {
        contentLength: 12,
        maxBytes: 20,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('readBoundedMultipartStream', () => {
  it('reads an unknown-length multi-chunk body and computes its digest', async () => {
    const chunks = [Buffer.from('careful '), Buffer.from('reading wins')];
    const content = Buffer.concat(chunks);
    const result = await readBoundedMultipartStream(Readable.from(chunks), {
      maxBytes: content.byteLength,
    });
    expect(result).toEqual({
      content,
      byteSize: content.byteLength,
      sha256: createHash('sha256').update(content).digest('hex'),
    });
  });

  it('rejects overflow without reflecting body content', async () => {
    const error = await readBoundedMultipartStream(
      Readable.from([Buffer.from('private-body')]),
      { maxBytes: 4 },
    ).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'IMPORT_TOO_LARGE' });
    expect(String((error as Error).message)).not.toContain('private-body');
  });

  it('rejects an empty body', async () => {
    await expect(
      readBoundedMultipartStream(Readable.from([]), { maxBytes: 100 }),
    ).rejects.toMatchObject({ code: 'IMPORT_CONTENT_INVALID' });
  });

  it('preserves an abort signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      readBoundedMultipartStream(Readable.from([Buffer.from('private-body')]), {
        maxBytes: 100,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
