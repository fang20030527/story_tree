import { speakingId, type SpeakingMaterial } from './model';
import { assertTranscriptAvailable, buildTranscriptDocx, buildTranscriptHtml, buildTranscriptMarkdown, transcriptDocxMimeType, transcriptMarkdownMimeType, transcriptFormatLabels, TranscriptExportError, transcriptExportFailure, transcriptFilename, type TranscriptExportFormat, type TranscriptNotes } from './transcriptDocument';

async function step<T>(failure: string, run: () => T | Promise<T>): Promise<T> {
  try { return await run(); } catch (error) { throw transcriptExportFailure(failure, error); }
}

export async function exportSpeakingTranscript(material: SpeakingMaterial, notes: TranscriptNotes, format: TranscriptExportFormat): Promise<void> {
  assertTranscriptAvailable(material);
  const sharing = await step('无法打开系统分享，请更新 App 后重试', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Load native modules only when exporting, including on older installed builds.
    const module = require('expo-sharing') as typeof import('expo-sharing');
    return await module.isAvailableAsync() ? module : null;
  });
  if (!sharing) throw new TranscriptExportError('当前设备无法保存或分享文件，请更换设备后重试');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Initialize the native filesystem only for file exports.
  const { Directory, File, Paths } = require('expo-file-system') as typeof import('expo-file-system');
  const directory = new Directory(Paths.cache, 'speaking-exports', speakingId());
  let printedFile: InstanceType<typeof File> | undefined;
  try {
    const file = await step('无法创建导出文件，请检查手机存储空间后重试', () => {
      directory.create({ intermediates: true });
      return new File(directory, transcriptFilename(material.title, format));
    });
    if (format === 'pdf') {
      const printed = await step('PDF 生成失败，请重试', () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- Only PDF exports need the native PDF renderer.
        const { printToFileAsync } = require('expo-print') as typeof import('expo-print');
        return printToFileAsync({ html: buildTranscriptHtml(material, notes), width: 595.28, height: 841.89 });
      });
      printedFile = new File(printed.uri);
      // File#copy is asynchronous since expo-file-system 57; sharing before it finishes fails the readable-file check.
      await step('PDF 保存失败，请检查手机存储空间后重试', () => printedFile!.copy(file));
    } else {
      await step(`${transcriptFormatLabels[format]} 文件写入失败，请检查手机存储空间后重试`, () => {
        file.create();
        file.write(format === 'markdown' ? buildTranscriptMarkdown(material, notes) : buildTranscriptDocx(material, notes));
      });
    }
    const shareType = {
      pdf: { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' },
      word: { mimeType: transcriptDocxMimeType, UTI: 'org.openxmlformats.wordprocessingml.document' },
      markdown: { mimeType: transcriptMarkdownMimeType, UTI: 'public.plain-text' },
    }[format];
    await step('无法打开分享面板，请重试', () => sharing.shareAsync(file.uri, {
      ...shareType,
      dialogTitle: `${material.title} 台词本`,
    }));
  } finally {
    // A cleanup failure must not turn a completed share into a failed export.
    try { if (printedFile?.exists) printedFile.delete(); } catch { /* Cache is cleared by the system. */ }
    try { if (directory.exists) directory.delete(); } catch { /* Cache is cleared by the system. */ }
  }
}
