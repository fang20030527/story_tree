import type { SpeakingPronunciationLocale, SpeakingPronunciationResult } from '@context-reader/contracts';

export interface PronunciationProvider {
  assess(input: {
    audio: Uint8Array;
    contentType: string;
    referenceText: string;
    locale: SpeakingPronunciationLocale;
  }): Promise<SpeakingPronunciationResult>;
}
