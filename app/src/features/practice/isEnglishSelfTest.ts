import type { PublicQuestion } from '@context-reader/contracts';

// Historical meaning questions remain readable without rewriting saved answers.
export function isEnglishSelfTest(question: PublicQuestion): boolean {
  return question.prompt.includes('____')
    && !/\p{Script=Han}/u.test(question.prompt)
    && question.options.every((option) => !/\p{Script=Han}/u.test(option.label));
}
