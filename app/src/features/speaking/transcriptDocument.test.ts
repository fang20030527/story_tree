/** @jest-environment jsdom */
import { strFromU8, unzipSync } from 'fflate';
import type { SpeakingMaterial } from './model';
import { buildTranscriptDocx, buildTranscriptHtml, buildTranscriptMarkdown, transcriptFilename } from './transcriptDocument';

const material: SpeakingMaterial = {
  id: 'transcript-test', title: '中文 & English <台词>', subtitle: '英式英语', category: '演讲',
  origin: 'platform', mediaType: 'video', duration: 3720,
  cues: [
    { id: 'one', start: 0, end: 3, en: 'Say "hello" & stay <curious>.\nKeep going!', zh: '说「你好」并保持好奇。\n继续前进！' },
    { id: 'two', start: 3601, end: 3605, en: 'Only English here.', zh: '' },
  ],
};
const notes = { one: '<script>alert("note")</script>\n连读 & 重音\u0000', orphan: '已删除台词的笔记' };

it('renders all bilingual cues, hours, multiline notes and safe HTML without empty translations', () => {
  const html = buildTranscriptHtml(material, notes);
  const document = new DOMParser().parseFromString(html, 'text/html');
  expect(document.title).toBe(`${material.title} 台词本`);
  expect(document.querySelectorAll('.cue')).toHaveLength(2);
  expect(document.querySelectorAll('.zh')).toHaveLength(1);
  expect(document.querySelector('.en')?.textContent).toBe(material.cues[0].en);
  expect(document.querySelector('.zh')?.textContent).toBe(material.cues[0].zh);
  expect(document.querySelector('.note')?.textContent).toBe('笔记：<script>alert("note")</script>\n连读 & 重音');
  expect(document.body.textContent).toContain('2  01:00:01 - 01:00:05');
  expect(document.body.textContent).not.toContain(notes.orphan);
  expect(document.querySelector('script')).toBeNull();
  expect(document.querySelector('img')).toBeNull();
  expect(html).not.toContain('\u0000');
});

it('generates a real DOCX with well-formed XML, editable dialogue, valid relationships and pagination', () => {
  const bytes = buildTranscriptDocx(material, notes);
  expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
  const parts = unzipSync(bytes);
  const parsed = Object.fromEntries(Object.entries(parts).map(([name, bytes]) => {
    const text = strFromU8(bytes);
    const document = new DOMParser().parseFromString(text, 'application/xml');
    expect(document.querySelector('parsererror')).toBeNull();
    expect(text).not.toContain('\u0000');
    return [name, document];
  }));
  const document = parsed['word/document.xml'];
  const paragraphs = Array.from(document.getElementsByTagName('w:p')).map(p =>
    Array.from(p.getElementsByTagName('w:t')).map(t => t.textContent).join(''));
  expect(paragraphs[0]).toBe(`${material.title} 台词本`);
  expect(paragraphs).toContain('Say "hello" & stay <curious>.Keep going!');
  expect(paragraphs).toContain('说「你好」并保持好奇。继续前进！');
  expect(paragraphs).toContain('笔记：<script>alert("note")</script>连读 & 重音');
  expect(paragraphs).toContain('2  01:00:01 - 01:00:05');
  expect(paragraphs).not.toContain(notes.orphan);
  expect(document.getElementsByTagName('w:br')).toHaveLength(3);
  expect(document.getElementsByTagName('w:pStyle')[0].getAttribute('w:val')).toBe('Title');
  expect(document.getElementsByTagName('w:pgSz')[0].getAttribute('w:w')).toBe('11906');
  expect(parsed['word/footer1.xml'].getElementsByTagName('w:fldSimple')[0].getAttribute('w:instr')).toBe('PAGE');
  for (const relation of Array.from(parsed['word/_rels/document.xml.rels'].getElementsByTagName('Relationship'))) {
    expect(parts[`word/${relation.getAttribute('Target')}`]).toBeDefined();
  }
});

it('生成包含全部双语台词、小时级时间戳和多行笔记的 Markdown', () => {
  const markdown = buildTranscriptMarkdown(material, notes);
  expect(markdown).toContain('# 中文 &amp; English \\<台词\\> 台词本\n\n');
  expect(markdown).toContain('演讲 · 英式英语 · 01:02:00 · 2 句');
  expect(markdown.match(/^## /gm)).toHaveLength(2);
  expect(markdown).toContain('## 1  00:00 - 00:03\n\nSay "hello" &amp; stay \\<curious\\>\\.  \nKeep going\\!');
  expect(markdown).toContain('说「你好」并保持好奇。  \n继续前进！');
  expect(markdown).toContain('> **笔记：** \\<script\\>alert\\("note"\\)\\</script\\>  \n> 连读 &amp; 重音');
  expect(markdown).toContain('## 2  01:00:01 - 01:00:05\n\nOnly English here\\.\n');
  expect(markdown).not.toContain(notes.orphan);
  expect(markdown).not.toContain('\u0000');
});

it('保留 Markdown 特殊字符并规范化标题、字幕和笔记中的换行', () => {
  const markdown = buildTranscriptMarkdown({
    ...material, title: '# 标题\n<script> &amp;', subtitle: '英式英语\n> 引用',
    cues: [{ ...material.cues[0], en: '**English**\r\n[link](url)\n# heading\n`code`\n===', zh: '译文 _内容_' }],
  }, { one: '第一行\r\n\r\n- 第二行', two: '无关笔记' });
  expect(markdown).toContain('# \\# 标题 \\<script\\> &amp;amp; 台词本\n\n');
  expect(markdown).toContain('演讲 · 英式英语 \\> 引用');
  expect(markdown).toContain('\\*\\*English\\*\\*  \n\\[link\\]\\(url\\)  \n\\# heading  \n\\`code\\`  \n\\=\\=\\=');
  expect(markdown).toContain('译文 \\_内容\\_');
  expect(markdown).toContain('> **笔记：** 第一行  \n>   \n> \\- 第二行');
  expect(markdown).not.toContain('\r');
  expect(markdown).not.toContain('无关笔记');
});

it.each([buildTranscriptHtml, buildTranscriptDocx, buildTranscriptMarkdown])('rejects absent or partially loaded subtitles', build => {
  expect(() => build({ ...material, cues: [] })).toThrow('还没有台词');
  expect(() => build({ ...material, summary: true, cueCount: 500 })).toThrow('字幕尚未加载完成');
});

it('creates portable filenames without paths and retains Chinese titles and safe emoji', () => {
  expect(transcriptFilename('../你好:世界?\\test', 'word')).toBe('_你好_世界__test 台词本.docx');
  expect(transcriptFilename('  ... ', 'pdf')).toBe('跟读素材 台词本.pdf');
  expect(transcriptFilename('长'.repeat(200), 'word')).toBe(`${'长'.repeat(50)} 台词本.docx`);
  expect(transcriptFilename('🎬'.repeat(100), 'pdf')).toBe(`${'🎬'.repeat(50)} 台词本.pdf`);
  expect(transcriptFilename('../你好:世界?\\test', 'markdown')).toBe('_你好_世界__test 台词本.md');
});
