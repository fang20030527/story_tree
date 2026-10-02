import { speakingId, type SpeakingMaterial } from './model';
import { assertTranscriptAvailable, buildTranscriptDocx, buildTranscriptHtml, transcriptDocxMimeType, TranscriptExportError, transcriptFilename, type TranscriptExportFormat, type TranscriptNotes } from './transcriptDocument';

export async function exportSpeakingTranscript(material: SpeakingMaterial, notes: TranscriptNotes, format: TranscriptExportFormat): Promise<void> {
  assertTranscriptAvailable(material);
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Load native modules only when exporting, including on older installed builds.
  const sharing = require('expo-sharing') as typeof import('expo-sharing');
  if (!await sharing.isAvailableAsync()) throw new TranscriptExportError('当前设备无法保存或分享文件，请更换设备后重试');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Initialize the native filesystem only for file exports.
  const { Directory, File, Paths } = require('expo-file-system') as typeof import('expo-file-system');
  const directory = new Directory(Paths.cache, 'speaking-exports', speakingId());
  let printedFile: InstanceType<typeof File> | undefined;
  try {
    directory.create({ intermediates: true });
    const file = new File(directory, transcriptFilename(material.title, format));
    if (format === 'pdf') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Word exports do not need the native PDF renderer.
      const { printToFileAsync } = require('expo-print') as typeof import('expo-print');
      const printed = await printToFileAsync({ html: buildTranscriptHtml(material, notes), width: 595.28, height: 841.89 });
      printedFile = new File(printed.uri);
      printedFile.copy(file);
    } else {
      file.create();
      file.write(buildTranscriptDocx(material, notes));
    }
    await sharing.shareAsync(file.uri, {
      mimeType: format === 'pdf' ? 'application/pdf' : transcriptDocxMimeType,
      UTI: format === 'pdf' ? 'com.adobe.pdf' : 'org.openxmlformats.wordprocessingml.document',
      dialogTitle: `${material.title} 台词本`,
    });
  } finally {
    // A cleanup failure must not turn a completed share into a failed export.
    try { if (printedFile?.exists) printedFile.delete(); } catch { /* Cache is cleared by the system. */ }
    try { if (directory.exists) directory.delete(); } catch { /* Cache is cleared by the system. */ }
  }
}
