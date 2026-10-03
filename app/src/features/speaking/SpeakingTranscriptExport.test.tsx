import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { SpeakingTranscriptExport } from './SpeakingTranscriptExport';
import type { SpeakingMaterial } from './model';
import { TranscriptExportError } from './transcriptDocument';
import { exportSpeakingTranscript } from './transcriptExport';

jest.mock('./transcriptExport', () => ({ exportSpeakingTranscript: jest.fn() }));
jest.mock('@/context/ThemeContext', () => ({ useAppTheme: () => ({ theme: jest.requireActual('@/constants/theme').themes.light }) }));
const material: SpeakingMaterial = { id: 'test', title: '测试素材', subtitle: '', category: '文件',
  origin: 'file', mediaType: 'audio', duration: 5, cues: [{ id: 'one', start: 0, end: 5, en: 'Hello!', zh: '你好！' }] };
beforeEach(() => { jest.clearAllMocks(); jest.mocked(exportSpeakingTranscript).mockResolvedValue(undefined); });

it('exports the current edited subtitles and saved notes in all three formats', async () => {
  const notes = { one: '注意连读' };
  const view = await render(<SpeakingTranscriptExport material={material} notes={notes} />);
  await fireEvent.press(view.getByLabelText('导出 PDF 台词本'));
  expect(exportSpeakingTranscript).toHaveBeenLastCalledWith(material, notes, 'pdf');
  const edited = { ...material, cues: [{ ...material.cues[0], en: 'Edited hello!' }] };
  await view.rerender(<SpeakingTranscriptExport material={edited} notes={{ one: '新笔记' }} />);
  await fireEvent.press(view.getByLabelText('导出 Word 台词本'));
  expect(exportSpeakingTranscript).toHaveBeenLastCalledWith(edited, { one: '新笔记' }, 'word');
  await fireEvent.press(view.getByLabelText('导出 Markdown 台词本'));
  expect(exportSpeakingTranscript).toHaveBeenLastCalledWith(edited, { one: '新笔记' }, 'markdown');
});

it('prevents duplicate requests while an export is pending and restores all buttons afterward', async () => {
  let done!: () => void;
  jest.mocked(exportSpeakingTranscript).mockImplementation(() => new Promise<void>(resolve => { done = resolve; }));
  const view = await render(<SpeakingTranscriptExport material={material} />);
  await fireEvent.press(view.getByLabelText('导出 Markdown 台词本'));
  expect(view.getByLabelText('导出 Markdown 台词本').props.accessibilityState).toMatchObject({ disabled: true, busy: true });
  await fireEvent.press(view.getByLabelText('导出 PDF 台词本'));
  await fireEvent.press(view.getByLabelText('导出 Word 台词本'));
  expect(exportSpeakingTranscript).toHaveBeenCalledTimes(1);
  await act(async () => { done(); });
  expect(view.getByLabelText('导出 Word 台词本').props.accessibilityState.disabled).toBe(false);
  expect(view.getByLabelText('导出 Markdown 台词本').props.accessibilityState).toMatchObject({ disabled: false, busy: false });
});

it.each([['word', 'Word'], ['markdown', 'Markdown']] as const)('shows actionable errors, permits retries and hides internal file paths (%s)', async (format, label) => {
  jest.mocked(exportSpeakingTranscript).mockRejectedValueOnce(new TranscriptExportError('请允许弹出窗口后重试'))
    .mockRejectedValueOnce(new Error('private://cache/account-id/transcript'));
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  const view = await render(<SpeakingTranscriptExport material={material} />);
  await fireEvent.press(view.getByLabelText('导出 PDF 台词本'));
  await waitFor(() => expect(view.getByRole('alert').props.children).toBe('请允许弹出窗口后重试'));
  await fireEvent.press(view.getByLabelText(`导出 ${label} 台词本`));
  await waitFor(() => expect(view.getByRole('alert').props.children).toBe(`${label} 导出失败，请重试`));
  expect(warn).toHaveBeenCalledTimes(1);
  warn.mockRestore();
  await fireEvent.press(view.getByLabelText(`导出 ${label} 台词本`));
  expect(view.queryByRole('alert')).toBeNull();
  expect(exportSpeakingTranscript).toHaveBeenCalledTimes(3);
  expect(exportSpeakingTranscript).toHaveBeenLastCalledWith(material, {}, format);
});

it.each([{ cues: [] }, { summary: true }])('disables exports until complete subtitles exist', async changes => {
  const view = await render(<SpeakingTranscriptExport material={{ ...material, ...changes }} />);
  await fireEvent.press(view.getByLabelText('导出 PDF 台词本'));
  await fireEvent.press(view.getByLabelText('导出 Word 台词本'));
  await fireEvent.press(view.getByLabelText('导出 Markdown 台词本'));
  expect(exportSpeakingTranscript).not.toHaveBeenCalled();
  expect(view.getByLabelText('导出 PDF 台词本').props.accessibilityState.disabled).toBe(true);
  expect(view.getByLabelText('导出 Markdown 台词本').props.accessibilityState.disabled).toBe(true);
});
