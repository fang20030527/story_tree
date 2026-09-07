import type { PracticeDto } from '@context-reader/contracts';

import {
  destinationForPractice,
  preferredResumePracticeId,
} from './resumePractice';

function practice(
  status: PracticeDto['status'],
  hasSubmittedAnswer = false,
): PracticeDto {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    status,
    modelName: null,
    remainingFreePractices: 2,
    failure: status === 'failed'
      ? { code: 'AI_UNAVAILABLE', message: '生成失败', retryable: false }
      : null,
    article: null,
    questions: hasSubmittedAnswer
      ? [{
          id: '22222222-2222-4222-8222-222222222222',
          targetId: '33333333-3333-4333-8333-333333333333',
          term: 'resilient',
          prompt: '含义是什么？',
          options: [
            '44444444-4444-4444-8444-444444444444',
            '55555555-5555-4555-8555-555555555555',
            '66666666-6666-4666-8666-666666666666',
            '77777777-7777-4777-8777-777777777777',
          ].map((id) => ({ id, label: id })),
          submittedAnswer: {
            answerKind: 'dont_know',
            selectedOptionId: null,
            isCorrect: false,
            wasAssisted: false,
            correctOptionId: '44444444-4444-4444-8444-444444444444',
            meaningEn: 'meaning',
            explanationZh: '解释',
            optionExplanations: {},
          },
        }]
      : [],
  };
}

describe('destinationForPractice', () => {
  it('maps every durable state without creating a replacement', () => {
    expect(destinationForPractice(practice('queued'))).toBe('generating');
    expect(destinationForPractice(practice('generating'))).toBe('generating');
    expect(destinationForPractice(practice('validating'))).toBe('generating');
    expect(destinationForPractice(practice('ready'))).toBe('read');
    expect(destinationForPractice(practice('in_progress', true))).toBe('quiz');
    expect(destinationForPractice(practice('completed', true))).toBe('result');
    expect(destinationForPractice(practice('failed'))).toBe('new');
  });

  it('prefers the locally active practice before the dashboard fallback', () => {
    expect(preferredResumePracticeId('local-id', 'dashboard-id')).toBe(
      'local-id',
    );
    expect(preferredResumePracticeId(null, 'dashboard-id')).toBe(
      'dashboard-id',
    );
    expect(preferredResumePracticeId(null, null)).toBeNull();
  });
});
