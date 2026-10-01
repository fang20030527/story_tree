import { describe, expect, it, vi } from 'vitest';
import { mediaRange, SpeakingPlaybackSigner } from './playback';

describe('私有媒体字节范围与票据', () => {
  it.each([
    ['bytes=0-9', { start: 0, end: 9 }],
    ['bytes=9-', { start: 9, end: 99 }],
    ['bytes=-10', { start: 90, end: 99 }],
    ['bytes=-1000', { start: 0, end: 99 }],
    ['bytes=90-150', { start: 90, end: 99 }],
    ['bytes=100-101', false], ['bytes=-0', false], ['bytes=2-1', false],
    ['bytes=0-1,5-6', false], ['bytes=9007199254740992-', false],
    ['items=0-9', false], ['', false], [undefined, null],
  ])('解析范围 %s', (header, expected) => { expect(mediaRange(header, 100)).toEqual(expected); });
  it('验证签名、目标资产和期限，不能用一个资产的票据读取另一个资产', () => {
    const asset = crypto.randomUUID(); const user = crypto.randomUUID();
    const signer = new SpeakingPlaybackSigner('private-local-test-signing-key-long-enough');
    const expiresAt = Date.now() + 1000;
    const ticket = signer.sign(asset, user, expiresAt);
    expect(signer.verify(ticket, asset).userId).toBe(user);
    expect(() => signer.verify(ticket, crypto.randomUUID())).toThrow(expect.objectContaining({ code: 'UNAUTHORIZED' }));
    expect(() => signer.verify(`${ticket.slice(0, -5)}abcde`, asset)).toThrow();
    const now = vi.spyOn(Date, 'now').mockReturnValue(expiresAt);
    try { expect(() => signer.verify(ticket, asset)).toThrow(); } finally { now.mockRestore(); }
  });
});
