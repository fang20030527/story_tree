import { describe, expect, it } from 'vitest';

import {
  browserErrorKinds,
  renderBrowserErrorPage,
  renderCodePage,
  renderDonePage,
  renderUploadPage,
} from './page';

function allPages(): string[] {
  return [
    renderCodePage(),
    renderUploadPage(),
    renderDonePage(),
    ...browserErrorKinds.map((kind) => renderBrowserErrorPage(kind)),
  ];
}

describe('scriptless computer upload pages', () => {
  it('renders complete HTML documents without scripts or external references', () => {
    for (const page of allPages()) {
      expect(page).toMatch(/^<!doctype html>/iu);
      expect(page).toContain('<html lang="zh-CN">');
      expect(page.toLowerCase()).not.toContain('<script');
      expect(page).not.toContain('http://');
      expect(page).not.toContain('https://');
      expect(page).not.toMatch(/src\s*=/iu);
      expect(page).not.toContain('navigator');
      expect(page).not.toContain('fetch(');
    }
  });

  it('only posts to the fixed claim and file endpoints', () => {
    const codePage = renderCodePage();
    const uploadPage = renderUploadPage();
    expect(codePage).toContain('action="/computer-upload/claim"');
    expect(codePage).not.toContain('/computer-upload/file');
    expect(uploadPage).toContain('action="/computer-upload/file"');
    expect(uploadPage).toContain('enctype="multipart/form-data"');
    expect(uploadPage).not.toContain('/computer-upload/claim');
    for (const page of allPages()) {
      const actions = page.match(/action="[^"]*"/gu) ?? [];
      for (const action of actions) {
        expect([
          'action="/computer-upload/claim"',
          'action="/computer-upload/file"',
        ]).toContain(action);
      }
    }
  });

  it('renders errors only from the fixed kind enum without user input', () => {
    for (const kind of browserErrorKinds) {
      const page = renderBrowserErrorPage(kind);
      expect(page).toContain('<html lang="zh-CN">');
      expect(page.toLowerCase()).not.toContain('<script');
    }
    expect(browserErrorKinds.length).toBeGreaterThan(0);
  });
});
