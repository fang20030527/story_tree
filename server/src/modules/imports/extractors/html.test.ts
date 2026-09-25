import { describe, expect, it } from 'vitest';

import { extractReadableHtml } from './html';

describe('static readable HTML extraction', () => {
  it.each([
    'https://dict.eudic.net/courses/detail/eeff71eb-a9df-4c18-869c-bebdab02f85a?pids=',
    'https://cn.eudic.net/account/login?returnurl=%2Fting',
  ])('identifies unavailable Eudic article bodies at %s', (url) => {
    expect(() => extractReadableHtml('<html><body>立即报名</body></html>', url))
      .toThrow(expect.objectContaining({ code: 'IMPORT_SOURCE_REQUIRES_ACCESS', retryable: false }));
  });

  it('still extracts publicly available Eudic articles', () => {
    const result = extractReadableHtml(
      '<html><head><title>Public story</title></head><body><article><p>Careful readers compare evidence before accepting broad public claims. They preserve context and revise conclusions when reliable facts change.</p></article></body></html>',
      'https://dict.eudic.net/webting/play?id=public-story',
    );
    expect(result.text).toContain('Careful readers compare evidence');
  });

  it('returns the main article without scripts, navigation, or sidebars', () => {
    const extracted = extractReadableHtml(
      `<!doctype html>
      <html><head><title>A measured public study</title>
      <style>.hidden { display: none }</style>
      <script>globalThis.__unsafeImportScript = true</script></head>
      <body><nav>Private navigation words should disappear.</nav>
      <!-- an inert comment -->
      <main><article>
      <h1>A measured public study</h1>
      <p>Careful readers compare evidence before accepting broad public claims.</p>
      <p>They preserve context, inspect uncertainty, and revise conclusions when reliable facts change.</p>
      </article></main>
      <aside>Unrelated sidebar promotion should disappear completely.</aside>
      </body></html>`,
      'https://example.com/original-study',
    );

    expect(extracted.title).toMatch(/measured public study/iu);
    expect(extracted.text).toBe(
      [
        'Careful readers compare evidence before accepting broad public claims.',
        'They preserve context, inspect uncertainty, and revise conclusions when reliable facts change.',
      ].join('\n\n'),
    );
    expect(extracted.text).not.toContain('Private navigation');
    expect(extracted.text).not.toContain('sidebar promotion');
    expect(extracted.text).not.toContain('__unsafeImportScript');
    expect((globalThis as { __unsafeImportScript?: boolean }).__unsafeImportScript)
      .toBeUndefined();
  });

  it('keeps headings, quotes, and list items as ordered text blocks', () => {
    const extracted = extractReadableHtml(
      `<!doctype html>
      <html><head><title>Field report</title></head><body><article>
      <h1>Field report</h1>
      <p>Opening evidence gives readers enough context to understand the measured public report.</p>
      <h2>What changed</h2>
      <blockquote><p>Quoted witnesses described the change carefully and avoided unsupported conclusions.</p></blockquote>
      <ul>
        <li>First verified observation from the field team.</li>
        <li>Second verified observation from the field team.</li>
      </ul>
      <p>The closing paragraph explains why these details matter for future reporting.</p>
      </article></body></html>`,
      'https://example.com/field-report',
    );

    expect(extracted.text.split('\n\n')).toEqual([
      'Opening evidence gives readers enough context to understand the measured public report.',
      'What changed',
      'Quoted witnesses described the change carefully and avoided unsupported conclusions.',
      'First verified observation from the field team.',
      'Second verified observation from the field team.',
      'The closing paragraph explains why these details matter for future reporting.',
    ]);
  });

  it('keeps a video before the opening paragraph and an image between paragraphs', () => {
    const extracted = extractReadableHtml(`<!doctype html><html><head>
      <title>Field report</title><meta property="og:image" content="https://images.example.com/poster.jpg">
      </head><body><article>
      <h1>Field report</h1>
      <div data-component="video-block"><figure><figcaption>Watch the field report</figcaption></figure></div>
      <p>Opening evidence gives readers enough context to understand the measured public report.</p>
      <figure><img src="https://images.example.com/photo.jpg" alt="A field photo" width="800" height="450">
      <figcaption>The team at work</figcaption></figure>
      <p>The closing paragraph explains why these details matter for future reporting.</p>
      </article></body></html>`, 'https://example.com/field-report');

    expect(extracted.text.split('\n\n')).toEqual([
      'Watch the field report',
      'Opening evidence gives readers enough context to understand the measured public report.',
      'The team at work',
      'The closing paragraph explains why these details matter for future reporting.',
    ]);
    expect(extracted.media).toEqual([
      { type: 'video', afterParagraph: -1, url: 'https://example.com/field-report',
        posterUrl: 'https://images.example.com/poster.jpg', caption: 'Watch the field report',
        captionParagraphPositions: [0], direct: false },
      { type: 'image', afterParagraph: 1, url: 'https://images.example.com/photo.jpg',
        caption: 'The team at work', alt: 'A field photo', credit: null,
        captionParagraphPositions: [2], width: 800, height: 450 },
    ]);
  });

  it('ignores local and non-HTTPS media references', () => {
    const extracted = extractReadableHtml(`<!doctype html><html><body><article>
      <p>Careful readers compare evidence before accepting broad public claims.</p>
      <figure><img src="https://127.0.0.1/private.jpg"></figure>
      <figure><img src="http://example.com/insecure.jpg"></figure>
      <p>They preserve context and revise conclusions when reliable facts change.</p>
      </article></body></html>`, 'https://example.com/report');
    expect(extracted.media).toEqual([]);
  });

  it('marks a direct HTML video for playback in the reader', () => {
    const extracted = extractReadableHtml(`<!doctype html><html><body><article>
      <p>Careful readers compare evidence before accepting broad public claims.</p>
      <figure><video poster="https://media.example.com/clip.jpg">
        <source src="https://media.example.com/clip.mp4" type="video/mp4">
      </video><figcaption>Original footage</figcaption></figure>
      <p>They preserve context and revise conclusions when reliable facts change.</p>
      </article></body></html>`, 'https://example.com/report');
    expect(extracted.media).toContainEqual({
      type: 'video', afterParagraph: 0,
      url: 'https://media.example.com/clip.mp4',
      posterUrl: 'https://media.example.com/clip.jpg',
      caption: 'Original footage', captionParagraphPositions: [1], direct: true,
    });
  });
});
