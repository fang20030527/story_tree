import type { GeneratedPractice, Verification } from './generated-schemas';

export interface GeneratePracticeInput {
  examPath: 'ielts';
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

export interface ModerationResult {
  riskLevel: 'low' | 'medium' | 'high';
  flagged: boolean;
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
  moderate(text: string, signal: AbortSignal): Promise<ModerationResult>;
  extractArticleText(
    images: readonly OcrImage[],
    signal: AbortSignal,
  ): Promise<OcrArticleText>;
}
