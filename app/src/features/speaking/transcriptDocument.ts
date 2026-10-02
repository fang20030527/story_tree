import { strToU8, zipSync } from 'fflate';
import { formatSpeakingTime, type SpeakingMaterial } from './model';

export type TranscriptExportFormat = 'pdf' | 'word';
export type TranscriptNotes = Readonly<Record<string, string>>;

export class TranscriptExportError extends Error {}

export function assertTranscriptAvailable(material: SpeakingMaterial) {
  if (material.summary) throw new TranscriptExportError('字幕尚未加载完成，请重试后再导出');
  if (!material.cues.length) throw new TranscriptExportError('还没有台词，请先添加字幕后再导出');
}

export function transcriptFilename(title: string, format: TranscriptExportFormat) {
  // Keep Chinese titles while removing path separators and unsupported filename characters.
  const safe = title.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').replace(/\s+/g, ' ').replace(/^[. ]+|[. ]+$/g, '');
  const stem = Array.from(safe).slice(0, 50).join('').replace(/[. ]+$/g, '') || '跟读素材';
  return `${stem} 台词本.${format === 'word' ? 'docx' : 'pdf'}`;
}

function escapeText(value: string) {
  // XML 1.0 does not allow these control characters, even inside a text node.
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function metadata(material: SpeakingMaterial) {
  const labels = [...new Set([material.category, material.subtitle].filter(value => value.trim()))];
  return [...labels, `${formatSpeakingTime(material.duration)} · ${material.cues.length} 句`].join(' · ');
}

function cueHeading(index: number, start: number, end: number) {
  return `${index + 1}  ${formatSpeakingTime(start)} - ${formatSpeakingTime(end)}`;
}

export function buildTranscriptHtml(material: SpeakingMaterial, notes: TranscriptNotes = {}) {
  assertTranscriptAvailable(material);
  const lines = material.cues.map((cue, index) => {
    const note = notes[cue.id];
    return `<section class="cue"><p class="time">${cueHeading(index, cue.start, cue.end)}</p>
      <p class="en" lang="en">${escapeText(cue.en)}</p>
      ${cue.zh.trim() ? `<p class="zh">${escapeText(cue.zh)}</p>` : ''}
      ${note?.trim() ? `<p class="note">笔记：${escapeText(note)}</p>` : ''}</section>`;
  }).join('\n');
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeText(material.title)} 台词本</title>
<style>
  @page { size: A4; margin: 18mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #000; font: 11pt/1.55 Arial, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif; overflow-wrap: anywhere; }
  h1 { margin: 0 0 10pt; font-size: 22pt; line-height: 1.3; }
  .meta { margin: 0 0 6pt; color: #555; font-size: 10pt; }
  .intro { margin: 0 0 22pt; color: #555; font-size: 10pt; }
  .cue { margin: 0 0 15pt; break-inside: avoid; page-break-inside: avoid; }
  p { margin: 0 0 5pt; white-space: pre-wrap; orphans: 2; widows: 2; }
  .time { font-size: 9pt; color: #555; break-after: avoid; }
  .en { font-size: 12pt; }
  .zh { color: #333; }
  .note { margin-top: 6pt; padding-left: 10pt; color: #555; font-size: 10pt; }
  @media screen { body { max-width: 174mm; margin: 24px auto; padding: 0 20px; } }
</style></head><body><h1>${escapeText(material.title)} 台词本</h1>
<p class="meta">${escapeText(metadata(material))}</p><p class="intro">黑洞英语 · 中英双语跟读台词</p>
${lines}</body></html>`;
}

const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const relationshipNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function paragraph(text: string, style: string, keepNext = false) {
  const runs = text.replace(/\r\n?/g, '\n').split('\n').map((line, index) =>
    `${index ? '<w:r><w:br/></w:r>' : ''}<w:r><w:t xml:space="preserve">${escapeText(line)}</w:t></w:r>`).join('');
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/>${keepNext ? '<w:keepNext/>' : ''}</w:pPr>${runs}</w:p>`;
}

export function buildTranscriptDocx(material: SpeakingMaterial, notes: TranscriptNotes = {}): Uint8Array {
  assertTranscriptAvailable(material);
  const lines = material.cues.map((cue, index) => {
    const note = notes[cue.id];
    const hasTranslation = Boolean(cue.zh.trim());
    const hasNote = Boolean(note?.trim());
    return paragraph(cueHeading(index, cue.start, cue.end), 'CueTime', true)
      + paragraph(cue.en, 'CueEnglish', hasTranslation || hasNote)
      + (hasTranslation ? paragraph(cue.zh, 'CueChinese', hasNote) : '')
      + (hasNote ? paragraph(`笔记：${note}`, 'CueNote') : '');
  }).join('');
  const styles = `${xml}<w:styles xmlns:w="${wordNamespace}">
    <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Microsoft YaHei" w:cs="Arial"/><w:sz w:val="22"/><w:color w:val="000000"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="320" w:lineRule="auto"/><w:widowControl/></w:pPr></w:pPrDefault></w:docDefaults>
    <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
    <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:after="200"/></w:pPr><w:rPr><w:b/><w:sz w:val="44"/><w:color w:val="000000"/></w:rPr></w:style>
    <w:style w:type="paragraph" w:styleId="Metadata"><w:name w:val="Metadata"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/></w:pPr><w:rPr><w:sz w:val="20"/><w:color w:val="555555"/></w:rPr></w:style>
    <w:style w:type="paragraph" w:styleId="CueTime"><w:name w:val="Cue time"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="220" w:after="60"/></w:pPr><w:rPr><w:sz w:val="18"/><w:color w:val="555555"/></w:rPr></w:style>
    <w:style w:type="paragraph" w:styleId="CueEnglish"><w:name w:val="English dialogue"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="24"/></w:rPr></w:style>
    <w:style w:type="paragraph" w:styleId="CueChinese"><w:name w:val="Chinese translation"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="333333"/></w:rPr></w:style>
    <w:style w:type="paragraph" w:styleId="CueNote"><w:name w:val="Dialogue note"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="200"/><w:spacing w:before="80" w:after="100"/></w:pPr><w:rPr><w:sz w:val="20"/><w:color w:val="555555"/></w:rPr></w:style>
  </w:styles>`;
  const parts: Record<string, string> = {
    '[Content_Types].xml': `${xml}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`,
    '_rels/.rels': `${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${relationshipNamespace}/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/_rels/document.xml.rels': `${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="${relationshipNamespace}/styles" Target="styles.xml"/><Relationship Id="rIdFooter" Type="${relationshipNamespace}/footer" Target="footer1.xml"/></Relationships>`,
    'word/styles.xml': styles,
    'word/document.xml': `${xml}<w:document xmlns:w="${wordNamespace}" xmlns:r="${relationshipNamespace}"><w:body>${paragraph(`${material.title} 台词本`, 'Title')}${paragraph(metadata(material), 'Metadata')}${paragraph('黑洞英语 · 中英双语跟读台词', 'Metadata')}${lines}<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1020" w:right="1020" w:bottom="1020" w:left="1020" w:header="400" w:footer="400" w:gutter="0"/></w:sectPr></w:body></w:document>`,
    'word/footer1.xml': `${xml}<w:ftr xmlns:w="${wordNamespace}"><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t>黑洞英语 · </w:t></w:r><w:fldSimple w:instr="PAGE"><w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>`,
  };
  return zipSync(Object.fromEntries(Object.entries(parts).map(([name, content]) => [name, strToU8(content)])), { level: 6 });
}

export const transcriptDocxMimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
