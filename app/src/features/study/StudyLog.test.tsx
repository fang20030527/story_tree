import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { StudyLog, studyWeeks } from './StudyLog';
import { localDateKey } from './studyStorage';
jest.mock('@/context/ThemeContext', () => ({ useAppTheme: () => ({ theme: jest.requireActual('@/constants/theme').themes.light }) }));

it('uses 91 distinct local calendar days through the new year', () => {
  const days = studyWeeks(new Date(2027, 0, 2)).flat().map(localDateKey);
  expect(days).toHaveLength(91);
  expect(new Set(days).size).toBe(91);
  expect(days[0]).toBe('2026-10-04');
  expect(days[90]).toBe('2027-01-02');
});
it('shows actual minutes and rejects future or unavailable days', async () => {
  const view = await render(<StudyLog now={new Date(2026, 8, 30)} totals={{ '2026-09-29': 660_000 }} error={false} />);
  await fireEvent.press(view.getByLabelText('2026-09-29 已打卡，学习 11 分钟'));
  expect(view.getByText('2026-09-29 · 学习 11 分钟 · 已完成每日目标')).toBeTruthy();
  expect(view.getByLabelText('2026-10-01，学习 0 分钟').props.accessibilityState.disabled).toBe(true);
  await view.rerender(<StudyLog now={new Date(2026, 8, 30)} totals={{}} error />);
  expect(view.getByText('学习时长读取失败，请重新打开本页重试')).toBeTruthy();
  expect(view.getByLabelText('2026-09-30 今日，学习 0 分钟').props.accessibilityState.disabled).toBe(true);
});
