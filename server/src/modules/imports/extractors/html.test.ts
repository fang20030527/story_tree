import { describe, expect, it } from 'vitest';

import { extractReadableHtml } from './html';

describe('static readable HTML extraction', () => {
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
    expect(extracted.text).toContain('Careful readers compare evidence');
    expect(extracted.text).toContain('revise conclusions');
    expect(extracted.text).not.toContain('Private navigation');
    expect(extracted.text).not.toContain('sidebar promotion');
    expect(extracted.text).not.toContain('__unsafeImportScript');
    expect((globalThis as { __unsafeImportScript?: boolean }).__unsafeImportScript)
      .toBeUndefined();
  });
});
