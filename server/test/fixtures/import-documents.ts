import { strToU8, zipSync } from 'fflate';
import { PDFDocument, StandardFonts } from 'pdf-lib';

export const SYNTHETIC_IMPORT_PARAGRAPHS = [
  'Careful readers compare evidence before they accept a broad public claim.',
  'They preserve context, inspect uncertainty, and revise conclusions when reliable facts change.',
] as const;

export function createDocxFixture(paragraphs: readonly string[]): Buffer {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>${paragraphs
        .map(
          (paragraph) =>
            `<w:p><w:r><w:t xml:space="preserve">${escapeXml(paragraph)}</w:t></w:r></w:p>`,
        )
        .join('')}</w:body>
    </w:document>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
    </Types>`;
  const relationships = `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
    </Relationships>`;
  return Buffer.from(
    zipSync({
      '[Content_Types].xml': strToU8(contentTypes),
      '_rels/.rels': strToU8(relationships),
      'word/document.xml': strToU8(documentXml),
    }),
  );
}

export async function createTextPdfFixture(
  paragraphs: readonly string[],
): Promise<Buffer> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const paragraph of paragraphs) {
    const page = document.addPage([612, 792]);
    page.drawText(paragraph, {
      x: 48,
      y: 720,
      size: 12,
      font,
      maxWidth: 516,
      lineHeight: 18,
    });
  }
  return Buffer.from(await document.save());
}

export async function createEmptyPdfFixture(): Promise<Buffer> {
  const document = await PDFDocument.create();
  document.addPage([612, 792]);
  return Buffer.from(await document.save());
}

function escapeXml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&apos;');
}
