import { describe, expect, it } from 'vitest';

import {
  createDocxFixture,
  createEmptyPdfFixture,
  createTextPdfFixture,
  SYNTHETIC_IMPORT_PARAGRAPHS,
} from '../../../../test/fixtures/import-documents';
import { detectImportFile, extractDocumentAsset } from './document';

describe('signature-first import document extraction', () => {
  it('decodes plain text, Markdown, and static HTML as fatal UTF-8', async () => {
    await expect(
      extractDocumentAsset({
        position: 0,
        mediaType: 'text/plain',
        content: Buffer.from(
          `\ufeff${SYNTHETIC_IMPORT_PARAGRAPHS.join('\n\n')}`,
          'utf8',
        ),
      }),
    ).resolves.toMatchObject({
      title: null,
      text: SYNTHETIC_IMPORT_PARAGRAPHS.join('\n\n'),
    });
    await expect(
      extractDocumentAsset({
        position: 0,
        mediaType: 'text/markdown',
        content: Buffer.from(
          `# Original heading\n\n${SYNTHETIC_IMPORT_PARAGRAPHS.join('\n\n')}`,
        ),
      }),
    ).resolves.toMatchObject({ title: null });
    await expect(
      extractDocumentAsset({
        position: 0,
        mediaType: 'text/html',
        content: Buffer.from(
          `<html><head><title>Original study</title></head><body><article><p>${SYNTHETIC_IMPORT_PARAGRAPHS[0]}</p><p>${SYNTHETIC_IMPORT_PARAGRAPHS[1]}</p></article></body></html>`,
        ),
      }),
    ).resolves.toMatchObject({ title: 'Original study' });
    await expect(
      extractDocumentAsset({
        position: 0,
        mediaType: 'text/plain',
        content: Buffer.from([0xc3, 0x28]),
      }),
    ).rejects.toMatchObject({ code: 'IMPORT_PARSE_FAILED' });
  });

  it('preserves DOCX paragraph and text-PDF page order', async () => {
    const docx = createDocxFixture(SYNTHETIC_IMPORT_PARAGRAPHS);
    const pdf = await createTextPdfFixture(SYNTHETIC_IMPORT_PARAGRAPHS);
    await expect(
      extractDocumentAsset({
        position: 0,
        mediaType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        content: docx,
      }),
    ).resolves.toMatchObject({
      text: expect.stringMatching(
        new RegExp(
          `${SYNTHETIC_IMPORT_PARAGRAPHS[0]}[\\s\\S]+${SYNTHETIC_IMPORT_PARAGRAPHS[1]}`,
          'u',
        ),
      ),
    });
    await expect(
      extractDocumentAsset({
        position: 0,
        mediaType: 'application/pdf',
        content: pdf,
      }),
    ).resolves.toMatchObject({
      text: expect.stringMatching(/Careful readers[\s\S]+They preserve context/u),
    });
  });

  it('guides empty/scanned PDF users and sanitizes corrupt parsers', async () => {
    await expect(
      extractDocumentAsset({
        position: 0,
        mediaType: 'application/pdf',
        content: await createEmptyPdfFixture(),
      }),
    ).rejects.toMatchObject({ code: 'IMPORT_PARSE_FAILED' });
    await expect(
      extractDocumentAsset({
        position: 0,
        mediaType: 'application/pdf',
        content: Buffer.from('%PDF-1.7\ncorrupt data'),
      }),
    ).rejects.toMatchObject({ code: 'IMPORT_PARSE_FAILED' });
  });

  it('lets magic bytes win over names and declarations', async () => {
    const pdf = await createTextPdfFixture(SYNTHETIC_IMPORT_PARAGRAPHS);
    await expect(
      detectImportFile(pdf, 'application/octet-stream'),
    ).resolves.toEqual({ kind: 'pdf', mediaType: 'application/pdf' });
    await expect(detectImportFile(pdf, 'image/jpeg')).rejects.toMatchObject({
      code: 'IMPORT_UNSUPPORTED_TYPE',
    });
    await expect(
      extractDocumentAsset({
        position: 0,
        mediaType: 'image/jpeg',
        content: pdf,
      }),
    ).rejects.toMatchObject({ code: 'IMPORT_UNSUPPORTED_TYPE' });

    await expect(
      detectImportFile(
        Buffer.from(`<article>${SYNTHETIC_IMPORT_PARAGRAPHS.join(' ')}</article>`),
        'application/octet-stream',
      ),
    ).resolves.toEqual({ kind: 'html', mediaType: 'text/html' });
    await expect(
      detectImportFile(
        Buffer.from(SYNTHETIC_IMPORT_PARAGRAPHS.join('\n\n')),
        'application/octet-stream',
      ),
    ).resolves.toEqual({ kind: 'text', mediaType: 'text/plain' });
  });
});
