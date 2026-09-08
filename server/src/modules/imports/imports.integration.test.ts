import { eq, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ArticleImportDtoSchema,
  PublicErrorSchema,
} from '@context-reader/contracts';

import { withTestDatabase } from '../../../test/database';
import { buildApp } from '../../app';
import { loadConfig } from '../../config/env';
import {
  articleImports,
  articleParagraphs,
  assistanceEvents,
  importedArticles,
  importAssets,
  jobs,
  practiceSessions,
  practiceTargets,
  usageLedger,
  vocabularyItems,
} from '../../db/schema';
import { registerAnonymous } from '../auth/service';

const config = loadConfig({
  DATABASE_URL: 'postgresql://example.invalid/db',
  EVOLINK_API_KEY: 'test-key',
  PUBLIC_SERVER_ORIGIN: 'http://localhost:3000',
});

const FIRST_PARAGRAPH =
  'Careful readers compare evidence before they accept a broad public claim.';
const SECOND_PARAGRAPH =
  'They preserve context, inspect uncertainty, and revise conclusions when reliable facts change.';
const SYNTHETIC_PROSE = `${FIRST_PARAGRAPH}\n\n${SECOND_PARAGRAPH}`;
const EDITED_PROSE = [
  'Thoughtful readers examine each source before forming a durable conclusion.',
  'They compare context, measure uncertainty, and change their views when stronger evidence appears.',
].join('\n\n');

const apps: Array<ReturnType<typeof buildApp>> = [];

afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

describe('pasted article imports', () => {
  it('delivers an owner-only idempotent paste through preview and confirmation', async () => {
    await withTestDatabase(async ({ db }) => {
      const ownerToken = '51'.repeat(32);
      const owner = await registerAnonymous(db, ownerToken, true);
      const otherToken = '52'.repeat(32);
      await registerAnonymous(db, otherToken, true);
      const app = buildApp({ config, db, logger: false });
      apps.push(app);

      const [created, replayed] = await Promise.all([
        createPaste(app, ownerToken, 'paste-create-000001'),
        createPaste(app, ownerToken, 'paste-create-000001'),
      ]);
      expect(created.statusCode).toBe(201);
      expect(replayed.statusCode).toBe(201);
      const importDto = ArticleImportDtoSchema.parse(created.json());
      expect(ArticleImportDtoSchema.parse(replayed.json()).id).toBe(importDto.id);
      expect(importDto.status).toBe('awaiting_upload');
      expect(await db.select().from(articleImports)).toHaveLength(1);

      const changedReplay = await app.inject({
        method: 'POST',
        url: '/v1/imports',
        headers: authHeaders(ownerToken, 'paste-create-000001'),
        payload: {
          sourceKind: 'url',
          url: 'https://example.com/original-synthetic-story',
        },
      });
      expect(changedReplay.statusCode).toBe(409);
      expect(PublicErrorSchema.parse(changedReplay.json()).error.code).toBe(
        'IDEMPOTENCY_KEY_REUSED',
      );

      const hidden = await app.inject({
        method: 'GET',
        url: `/v1/imports/${importDto.id}`,
        headers: authHeaders(otherToken),
      });
      expect(hidden.statusCode).toBe(404);

      const preview = await putSource(
        app,
        ownerToken,
        importDto.id,
        SYNTHETIC_PROSE,
        'paste-source-000001',
      );
      expect(preview.statusCode).toBe(200);
      const previewDto = ArticleImportDtoSchema.parse(preview.json());
      expect(previewDto).toMatchObject({
        id: importDto.id,
        status: 'preview_ready',
        articleId: null,
      });
      expect(previewDto.pollAfterMs).toBeUndefined();
      expect(await db.select().from(importAssets)).toHaveLength(0);
      expect(await db.select().from(jobs)).toHaveLength(0);

      const invalidEdit = await app.inject({
        method: 'PATCH',
        url: `/v1/imports/${importDto.id}/preview`,
        headers: authHeaders(ownerToken, 'paste-edit-invalid-01'),
        payload: {
          title: 'Edited synthetic article',
          text: EDITED_PROSE,
          wordCount: 25,
        },
      });
      expect(invalidEdit.statusCode).toBe(400);

      const foreignEdit = await app.inject({
        method: 'PATCH',
        url: `/v1/imports/${importDto.id}/preview`,
        headers: authHeaders(otherToken, 'paste-edit-foreign-01'),
        payload: { title: 'Hidden', text: EDITED_PROSE },
      });
      expect(foreignEdit.statusCode).toBe(404);

      const edited = await app.inject({
        method: 'PATCH',
        url: `/v1/imports/${importDto.id}/preview`,
        headers: authHeaders(ownerToken, 'paste-edit-00000001'),
        payload: { title: 'Edited synthetic article', text: EDITED_PROSE },
      });
      expect(edited.statusCode).toBe(200);
      const editedDto = ArticleImportDtoSchema.parse(edited.json());
      expect(editedDto.preview).toMatchObject({
        title: 'Edited synthetic article',
        text: EDITED_PROSE,
        duplicate: { kind: 'none' },
      });

      const foreignConfirm = await app.inject({
        method: 'POST',
        url: `/v1/imports/${importDto.id}/confirm`,
        headers: authHeaders(otherToken, 'paste-confirm-foreign'),
        payload: {},
      });
      expect(foreignConfirm.statusCode).toBe(404);
      const foreignCancel = await app.inject({
        method: 'POST',
        url: `/v1/imports/${importDto.id}/cancel`,
        headers: authHeaders(otherToken, 'paste-cancel-foreign-1'),
        payload: {},
      });
      expect(foreignCancel.statusCode).toBe(404);

      const confirmed = await app.inject({
        method: 'POST',
        url: `/v1/imports/${importDto.id}/confirm`,
        headers: authHeaders(ownerToken, 'paste-confirm-0001'),
        payload: {},
      });
      expect(confirmed.statusCode).toBe(200);
      const confirmedDto = ArticleImportDtoSchema.parse(confirmed.json());
      expect(confirmedDto).toMatchObject({
        id: importDto.id,
        status: 'confirmed',
        preview: null,
      });
      expect(confirmedDto.articleId).not.toBeNull();

      const articles = await db.select().from(importedArticles);
      expect(articles).toHaveLength(1);
      expect(articles[0]).toMatchObject({
        id: confirmedDto.articleId,
        userId: owner.userId,
        title: 'Edited synthetic article',
      });
      const paragraphs = await db.select().from(articleParagraphs);
      expect(paragraphs.map((paragraph) => paragraph.position)).toEqual([0, 1]);
      expect(paragraphs.map((paragraph) => paragraph.plainText)).toEqual(
        EDITED_PROSE.split('\n\n'),
      );
      expect(await db.select().from(practiceSessions)).toHaveLength(0);
      expect(await db.select().from(practiceTargets)).toHaveLength(0);
      expect(await db.select().from(vocabularyItems)).toHaveLength(0);
      expect(await db.select().from(usageLedger)).toHaveLength(0);
      expect(await db.select().from(assistanceEvents)).toHaveLength(0);

      const confirmReplay = await app.inject({
        method: 'POST',
        url: `/v1/imports/${importDto.id}/confirm`,
        headers: authHeaders(ownerToken, 'paste-confirm-0001'),
        payload: {},
      });
      expect(ArticleImportDtoSchema.parse(confirmReplay.json()).articleId).toBe(
        confirmedDto.articleId,
      );
      const cancelConfirmed = await app.inject({
        method: 'POST',
        url: `/v1/imports/${importDto.id}/cancel`,
        headers: authHeaders(ownerToken, 'paste-cancel-confirmed'),
        payload: {},
      });
      expect(cancelConfirmed.statusCode).toBe(409);
    });
  }, 120_000);

  it('rejects invalid source bytes and supports cancellation without articles', async () => {
    await withTestDatabase(async ({ db }) => {
      const token = '53'.repeat(32);
      await registerAnonymous(db, token, true);
      const app = buildApp({ config, db, logger: false });
      apps.push(app);

      const cases: Array<{ name: string; body: Buffer; expected: string }> = [
        {
          name: 'short',
          body: Buffer.from('Only a few English words appear here.'),
          expected: 'IMPORT_CONTENT_INVALID',
        },
        {
          name: 'non-english',
          body: Buffer.from(
            `${'这是用于验证语言边界的原创中文句子。'.repeat(30)} ${'evidence '.repeat(20)}`,
          ),
          expected: 'IMPORT_NOT_ENGLISH',
        },
        {
          name: 'malformed-utf8',
          body: Buffer.from([0xc3, 0x28]),
          expected: 'IMPORT_CONTENT_INVALID',
        },
        {
          name: 'too-large',
          body: Buffer.alloc(131_073, 0x61),
          expected: 'IMPORT_TOO_LARGE',
        },
      ];

      for (const [index, testCase] of cases.entries()) {
        const created = await createPaste(
          app,
          token,
          `paste-invalid-create-${index}`,
        );
        const importId = ArticleImportDtoSchema.parse(created.json()).id;
        const response = await putSourceBuffer(
          app,
          token,
          importId,
          testCase.body,
          `paste-invalid-source-${index}`,
        );
        expect(response.statusCode, testCase.name).toBeGreaterThanOrEqual(400);
        expect(
          PublicErrorSchema.parse(response.json()).error.code,
          testCase.name,
        ).toBe(testCase.expected);
      }

      const cancellable = await createPaste(
        app,
        token,
        'paste-cancel-create-01',
      );
      const cancellableId = ArticleImportDtoSchema.parse(cancellable.json()).id;
      const cancelled = await app.inject({
        method: 'POST',
        url: `/v1/imports/${cancellableId}/cancel`,
        headers: authHeaders(token, 'paste-cancel-0000001'),
        payload: {},
      });
      expect(ArticleImportDtoSchema.parse(cancelled.json()).status).toBe(
        'cancelled',
      );
      expect(await db.select().from(importedArticles)).toHaveLength(0);
    });
  }, 120_000);

  it('handles exact and similar duplicate decisions for only the owner', async () => {
    await withTestDatabase(async ({ db }) => {
      const token = '54'.repeat(32);
      const owner = await registerAnonymous(db, token, true);
      const app = buildApp({ config, db, logger: false });
      apps.push(app);

      const firstId = await createPreview(app, token, SYNTHETIC_PROSE, 'first');
      const firstConfirmed = await confirm(app, token, firstId, 'first', {});
      const firstArticleId = ArticleImportDtoSchema.parse(
        firstConfirmed.json(),
      ).articleId;

      const exactId = await createPreview(app, token, SYNTHETIC_PROSE, 'exact');
      const exactConfirmed = await confirm(app, token, exactId, 'exact', {});
      expect(ArticleImportDtoSchema.parse(exactConfirmed.json()).articleId).toBe(
        firstArticleId,
      );
      expect(await db.select().from(importedArticles)).toHaveLength(1);

      const similarId = await createPreview(app, token, EDITED_PROSE, 'similar');
      const [similarImport] = await db
        .select()
        .from(articleImports)
        .where(eq(articleImports.id, similarId));
      expect(similarImport?.similarityFingerprint).not.toBeNull();
      const seededSimilarId = crypto.randomUUID();
      await db.insert(importedArticles).values({
        id: seededSimilarId,
        userId: owner.userId,
        sourceKind: 'paste',
        sourceUrl: null,
        title: 'Earlier related article',
        wordCount: similarImport!.wordCount!,
        contentHash: '9'.repeat(64),
        similarityFingerprint: similarImport!.similarityFingerprint!,
        importedAt: new Date(),
      });
      await db.insert(articleParagraphs).values({
        articleId: seededSimilarId,
        position: 0,
        plainText: SYNTHETIC_PROSE,
      });

      const needsDecision = await confirm(
        app,
        token,
        similarId,
        'similar-none',
        {},
      );
      expect(needsDecision.statusCode).toBe(409);
      expect(PublicErrorSchema.parse(needsDecision.json()).error.code).toBe(
        'SIMILAR_ARTICLE_REQUIRES_DECISION',
      );
      const opened = await confirm(app, token, similarId, 'similar-open', {
        similarityDecision: 'open_existing',
      });
      expect(ArticleImportDtoSchema.parse(opened.json()).articleId).toBe(
        seededSimilarId,
      );

      const versionId = await createPreview(app, token, EDITED_PROSE, 'version');
      const versioned = await confirm(app, token, versionId, 'version', {
        similarityDecision: 'save_new_version',
      });
      const versionArticleId = ArticleImportDtoSchema.parse(
        versioned.json(),
      ).articleId;
      const [versionArticle] = await db
        .select()
        .from(importedArticles)
        .where(eq(importedArticles.id, versionArticleId!));
      expect(versionArticle?.previousVersionId).toBe(seededSimilarId);
    });
  }, 120_000);

  it('rolls back article creation when paragraph persistence fails', async () => {
    await withTestDatabase(async ({ db }) => {
      const token = '55'.repeat(32);
      await registerAnonymous(db, token, true);
      const app = buildApp({ config, db, logger: false });
      apps.push(app);
      const importId = await createPreview(app, token, SYNTHETIC_PROSE, 'rollback');

      await db.execute(
        sql.raw(
          'alter table article_paragraphs add constraint test_force_rollback check (position < 0)',
        ),
      );
      const response = await confirm(app, token, importId, 'rollback', {});
      expect(response.statusCode).toBe(500);
      expect(await db.select().from(importedArticles)).toHaveLength(0);
      const [preserved] = await db
        .select()
        .from(articleImports)
        .where(eq(articleImports.id, importId));
      expect(preserved?.status).toBe('preview_ready');
    });
  }, 120_000);
});

function authHeaders(token: string, idempotencyKey?: string) {
  return {
    authorization: `Bearer ${token}`,
    ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
  };
}

function createPaste(
  app: ReturnType<typeof buildApp>,
  token: string,
  idempotencyKey: string,
) {
  return app.inject({
    method: 'POST',
    url: '/v1/imports',
    headers: authHeaders(token, idempotencyKey),
    payload: { sourceKind: 'paste' },
  });
}

function putSource(
  app: ReturnType<typeof buildApp>,
  token: string,
  importId: string,
  source: string,
  idempotencyKey: string,
) {
  return putSourceBuffer(
    app,
    token,
    importId,
    Buffer.from(source, 'utf8'),
    idempotencyKey,
  );
}

function putSourceBuffer(
  app: ReturnType<typeof buildApp>,
  token: string,
  importId: string,
  source: Buffer,
  idempotencyKey: string,
) {
  return app.inject({
    method: 'PUT',
    url: `/v1/imports/${importId}/source-text`,
    headers: {
      ...authHeaders(token, idempotencyKey),
      'content-type': 'text/plain; charset=utf-8',
      'content-length': String(source.byteLength),
    },
    payload: source,
  });
}

async function createPreview(
  app: ReturnType<typeof buildApp>,
  token: string,
  prose: string,
  suffix: string,
): Promise<string> {
  const created = await createPaste(app, token, `paste-create-${suffix}-0001`);
  const importId = ArticleImportDtoSchema.parse(created.json()).id;
  const preview = await putSource(
    app,
    token,
    importId,
    prose,
    `paste-source-${suffix}-0001`,
  );
  expect(preview.statusCode).toBe(200);
  return importId;
}

function confirm(
  app: ReturnType<typeof buildApp>,
  token: string,
  importId: string,
  suffix: string,
  payload: { similarityDecision?: 'open_existing' | 'save_new_version' },
) {
  return app.inject({
    method: 'POST',
    url: `/v1/imports/${importId}/confirm`,
    headers: authHeaders(token, `paste-confirm-${suffix}-0001`),
    payload,
  });
}
