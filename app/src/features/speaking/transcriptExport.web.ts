import type { SpeakingMaterial } from './model';
import { assertTranscriptAvailable, buildTranscriptDocx, buildTranscriptHtml, buildTranscriptMarkdown, transcriptDocxMimeType, transcriptMarkdownMimeType, TranscriptExportError, transcriptExportFailure, transcriptFilename, type TranscriptExportFormat, type TranscriptNotes } from './transcriptDocument';

export async function exportSpeakingTranscript(material: SpeakingMaterial, notes: TranscriptNotes, format: TranscriptExportFormat): Promise<void> {
  assertTranscriptAvailable(material);
  if (format !== 'pdf') {
    const blob = format === 'markdown'
      ? new Blob([buildTranscriptMarkdown(material, notes)], { type: `${transcriptMarkdownMimeType};charset=utf-8` })
      : new Blob([new Uint8Array(buildTranscriptDocx(material, notes)).buffer], { type: transcriptDocxMimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = transcriptFilename(material.title, format);
    document.body.appendChild(link);
    try { link.click(); }
    finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000); }
    return;
  }
  // Open synchronously from the button press so popup blockers do not reject the print window.
  const preview = window.open('', '_blank');
  if (!preview) throw new TranscriptExportError('浏览器阻止了台词本窗口，请允许弹出窗口后重试');
  try {
    preview.opener = null;
    preview.document.open();
    preview.document.write(buildTranscriptHtml(material, notes));
    preview.document.close();
    await preview.document.fonts?.ready;
    preview.focus();
    preview.print();
  } catch (error) {
    preview.close();
    throw transcriptExportFailure('PDF 导出失败，请重试，或换一个支持打印的浏览器', error);
  }
}
