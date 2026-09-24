import type {
  WordTranslationResult,
  PracticeTopic,
} from '@context-reader/contracts';

import type { GeneratedPractice, Verification } from './generated-schemas';

export interface GeneratePracticeInput {
  examPath: 'ielts';
  topic?: PracticeTopic;
  revision?: { generated: GeneratedPractice; issues: string[] };
  targets: Array<{
    alias: string;
    term: string;
    meaningZh: string;
    sourceSentence?: string;
  }>;
}

export interface VerifyPracticeInput extends GeneratePracticeInput {
  generated: GeneratedPractice;
}

export interface OcrImage {
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  base64: string;
  position: number;
}

export interface OcrArticleText {
  title: string | null;
  text: string;
}

export interface AiProvider {
  generatePractice(
    input: GeneratePracticeInput,
    signal: AbortSignal,
  ): Promise<GeneratedPractice>;
  verifyPractice(
    input: VerifyPracticeInput,
    signal: AbortSignal,
  ): Promise<Verification>;
  translate(text: string, signal: AbortSignal): Promise<string>;
  /** Return a concise contextual part of speech and Chinese meaning. */
  lookupWord(
    term: string,
    context: string | undefined,
    signal: AbortSignal,
  ): Promise<string | WordTranslationResult>;
  extractArticleText(
    images: readonly OcrImage[],
    signal: AbortSignal,
  ): Promise<OcrArticleText>;
}
