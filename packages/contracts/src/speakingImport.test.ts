import { describe, expect, it } from 'vitest';
import { SpeakingRemoteMediaRequestSchema } from './index';
describe('口语网页导入契约', () => {
  it('accepts HTTP(S) media and page addresses while rejecting credentials, schemes and extra fields', () => {
    expect(SpeakingRemoteMediaRequestSchema.parse({ url: 'https://example.com/podcast.mp3' })).toEqual({ url: 'https://example.com/podcast.mp3' });
    for (const url of ['file:///video.mp4', 'ftp://example.com/file', 'https://user:password@example.com/audio', 'not a URL', `https://example.com/${'a'.repeat(2048)}`]) {
      expect(SpeakingRemoteMediaRequestSchema.safeParse({ url }).success).toBe(false);
    }
    expect(SpeakingRemoteMediaRequestSchema.safeParse({ url: 'https://example.com/page', headers: {} }).success).toBe(false);
  });
});
