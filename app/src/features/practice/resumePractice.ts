import type { PracticeDto } from '@context-reader/contracts';

import { getPractice } from '@/api/practices';

export type PracticeDestination =
  | 'generating'
  | 'read'
  | 'quiz'
  | 'result'
  | 'new';

export function preferredResumePracticeId(
  localPracticeId: string | null,
  dashboardPracticeId: string | null,
): string | null {
  return localPracticeId ?? dashboardPracticeId;
}

export function destinationForPractice(
  practice: PracticeDto,
): PracticeDestination {
  switch (practice.status) {
    case 'queued':
    case 'generating':
    case 'validating':
      return 'generating';
    case 'ready':
    case 'in_progress':
      return practice.questions.some(
        (question) => question.submittedAnswer !== null,
      )
        ? 'quiz'
        : 'read';
    case 'completed':
      return 'result';
    case 'failed':
      return 'new';
  }
}

export async function resolvePracticeResume(practiceId: string): Promise<{
  practice: PracticeDto;
  destination: PracticeDestination;
}> {
  const practice = await getPractice(practiceId);
  return {
    practice,
    destination: destinationForPractice(practice),
  };
}
