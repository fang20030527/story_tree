import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import pg from 'pg';
import { replayReviews, REVIEW_MODEL_VERSION } from '../server/src/modules/vocabulary/scheduler.ts';

// 只导出应用表；生产数据保存在被 Git 忽略的 .migration 目录中。
const EXPECTED_TABLES = [
  'answer_attempts',
  'article_imports',
  'article_paragraphs',
  'article_translations',
  'assistance_events',
  'auth_identities',
  'computer_upload_sessions',
  'email_accounts',
  'email_password_resets',
  'idempotency_records',
  'import_assets',
  'imported_articles',
  'installations',
  'jobs',
  'learning_progress',
  'practice_paragraphs',
  'practice_questions',
  'practice_sessions',
  'practice_targets',
  'translations',
  'usage_ledger',
  'users',
  'vocabulary_items',
  'vocabulary_words',
  'word_review_events',
].sort();

const MAX_SQL_BYTES = 512 * 1024;
const MAX_STATEMENT_BYTES = 90_000;
const MAX_STATEMENTS_PER_FILE = 40;
const workspace = fileURLToPath(new URL('../', import.meta.url));
const outputParent = join(workspace, '.migration');

function createImportAssetStore() {
  const required = [
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_IMPORT_BUCKET_NAME',
  ];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) throw new Error(`Missing R2 variables: ${missing.join(', ')}`);
  if (process.env.R2_IMPORT_BUCKET_NAME !== 'waikan-imports-temp') {
    throw new Error('R2 import bucket name does not match the private upload bucket');
  }
  return {
    bucket: process.env.R2_IMPORT_BUCKET_NAME,
    client: new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    }),
  };
}

async function moveImportAsset(row, store) {
  if (!Buffer.isBuffer(row.content)) throw new Error('Import asset lacks bytea content');
  const digest = createHash('sha256').update(row.content).digest('hex');
  if (row.sha256 !== digest || row.byte_size !== row.content.length) {
    throw new Error('Import asset digest or byte size does not match');
  }
  const objectKey = `import-assets/${row.article_import_id}/${row.position}/${digest}`;
  let existing;
  try {
    existing = await store.client.send(new HeadObjectCommand({ Bucket: store.bucket, Key: objectKey }));
  } catch (error) {
    if (error?.$metadata?.httpStatusCode !== 404) throw error;
  }
  if (existing) {
    if (existing.ContentLength !== row.content.length || existing.Metadata?.sha256 !== digest) {
      throw new Error('R2 import asset conflicts with source data');
    }
  } else {
    await store.client.send(new PutObjectCommand({
      Bucket: store.bucket,
      Key: objectKey,
      Body: row.content,
      ContentType: row.media_type,
      Metadata: { sha256: digest },
    }));
  }
  return { ...row, content: null, object_key: objectKey };
}

function quoteIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/u.test(value)) {
    throw new Error('Invalid database identifier');
  }
  return `"${value}"`;
}

function quoteValue(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (value instanceof Date) return quoteText(value.toISOString());
  if (Buffer.isBuffer(value)) return `X'${value.toString('hex')}'`;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Non-finite database number');
    return String(value);
  }
  if (typeof value === 'bigint') return quoteText(value.toString());
  if (typeof value === 'string') return quoteText(value);
  return quoteText(JSON.stringify(value));
}

function canonicalValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString('hex');
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

function quoteText(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function orderTables(tables, foreignKeys) {
  const remaining = new Map(tables.map((name) => [name, new Set()]));
  for (const { child, parent } of foreignKeys) {
    if (child !== parent && remaining.has(child) && remaining.has(parent)) {
      remaining.get(child).add(parent);
    }
  }
  const ordered = [];
  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter(([, parents]) => parents.size === 0)
      .map(([name]) => name)
      .sort();
    if (ready.length === 0) {
      throw new Error('Foreign-key cycle requires a manual import strategy');
    }
    for (const name of ready) {
      ordered.push(name);
      remaining.delete(name);
      for (const parents of remaining.values()) parents.delete(name);
    }
  }
  return ordered;
}

async function loadPrimaryKeyColumns(client, tableName) {
  const result = await client.query(`
    select key_column.column_name
    from information_schema.table_constraints constraint_row
    join information_schema.key_column_usage key_column
      on key_column.constraint_name = constraint_row.constraint_name
      and key_column.table_schema = constraint_row.table_schema
      and key_column.table_name = constraint_row.table_name
    where constraint_row.constraint_type = 'PRIMARY KEY'
      and constraint_row.table_schema = 'public'
      and constraint_row.table_name = $1
    order by key_column.ordinal_position
  `, [tableName]);
  const primary = result.rows.map((row) => row.column_name);
  // word_review_events 的业务唯一键是复习单词与练习 ID，旧库未设主键。
  if (primary.length === 0 && tableName === 'word_review_events') {
    return ['word_id', 'practice_id'];
  }
  return primary;
}

async function exportTable(client, outputDirectory, tableName, ordinal, reviewStateOverrides) {
  const keyColumns = await loadPrimaryKeyColumns(client, tableName);
  if (keyColumns.length === 0) throw new Error('Application table lacks primary key');
  const result = await client.query(
    `select * from ${quoteIdentifier(tableName)} order by ${keyColumns.map(quoteIdentifier).join(', ')}`,
  );
  const columns = result.fields.map((field) => field.name);
  if (tableName === 'import_assets') columns.push('object_key');
  if (columns.length === 0) throw new Error('Application table has no columns');
  const prefix = `insert into ${quoteIdentifier(tableName)} (${columns.map(quoteIdentifier).join(', ')}) values (`;
  const files = [];
  const rowsHash = createHash('sha256');
  let body = '';
  let bodyRows = 0;
  let fileIndex = 0;

  async function flush() {
    if (body.length === 0) return;
    const filename = `${String(ordinal).padStart(2, '0')}-${tableName}-${String(fileIndex).padStart(3, '0')}.sql`;
    const bytes = Buffer.from(body, 'utf8');
    await writeFile(join(outputDirectory, filename), bytes, { flag: 'wx', mode: 0o600 });
    files.push({ name: filename, rows: bodyRows, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    fileIndex += 1;
    body = '';
    bodyRows = 0;
  }

  const assetStore = tableName === 'import_assets' && result.rows.length > 0
    ? createImportAssetStore()
    : null;
  for (const sourceRow of result.rows) {
    const normalizedRow = tableName === 'vocabulary_words' && reviewStateOverrides.has(sourceRow.id)
      ? { ...sourceRow, review_state: reviewStateOverrides.get(sourceRow.id) }
      : sourceRow;
    const row = assetStore ? await moveImportAsset(normalizedRow, assetStore) : normalizedRow;
    rowsHash.update(JSON.stringify(columns.map((name) => canonicalValue(row[name]))));
    rowsHash.update('\n');
    const statement = `${prefix}${columns.map((name) => quoteValue(row[name])).join(', ')});\n`;
    if (Buffer.byteLength(statement, 'utf8') > MAX_STATEMENT_BYTES) {
      throw new Error('A database row exceeds the D1 SQL statement limit');
    }
    if (bodyRows >= MAX_STATEMENTS_PER_FILE || Buffer.byteLength(body + statement, 'utf8') > MAX_SQL_BYTES) await flush();
    body += statement;
    bodyRows += 1;
  }
  await flush();
  return {
    table: tableName,
    rows: result.rowCount ?? result.rows.length,
    columns,
    keyColumns,
    sha256Rows: rowsHash.digest('hex'),
    files,
  };
}

// Source read endpoints fill legacy review state lazily. Export a coherent
// projection without writing to the live Neon database.
async function deriveMissingReviewStates(client) {
  const words = await client.query('select id, created_at, review_state from vocabulary_words');
  const answers = await client.query(`
    select vocabulary.word_id, answer.id as answer_id,
      answer.practice_session_id as practice_id,
      target.vocabulary_item_id,
      answer.submitted_at, answer.is_correct, answer.was_assisted,
      exists (
        select 1 from assistance_events as assistance
        where assistance.user_id = answer.user_id
          and assistance.practice_session_id = answer.practice_session_id
          and assistance.practice_target_id = target.id
          and assistance.kind = 'word_hint'
          and assistance.shown_at <= answer.submitted_at
      ) as word_hint
    from answer_attempts as answer
    join practice_questions as question on question.id = answer.practice_question_id
    join practice_targets as target on target.id = question.practice_target_id
    join vocabulary_items as vocabulary on vocabulary.id = target.vocabulary_item_id
    where vocabulary.user_id = answer.user_id and vocabulary.word_id is not null
  `);
  const byWord = new Map();
  for (const row of answers.rows) {
    const entries = byWord.get(row.word_id) ?? [];
    entries.push({
      answerId: row.answer_id,
      practiceId: row.practice_id,
      vocabularyItemId: row.vocabulary_item_id,
      submittedAt: row.submitted_at,
      isCorrect: row.is_correct,
      wasAssisted: row.was_assisted,
      wordHint: row.word_hint,
    });
    byWord.set(row.word_id, entries);
  }
  const overrides = new Map();
  for (const word of words.rows) {
    const evidence = byWord.get(word.id) ?? [];
    const previous = word.review_state;
    if (!previous || previous.version !== REVIEW_MODEL_VERSION ||
        previous.answerCount !== evidence.length) {
      overrides.set(word.id, replayReviews(evidence, word.created_at));
    }
  }
  console.log(`Review projections rebuilt in snapshot: ${overrides.size}`);
  return overrides;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    statement_timeout: 30_000,
    application_name: 'cloudflare-d1-readonly-export',
  });
  await client.connect();
  try {
    await client.query('begin transaction isolation level repeatable read read only');
    const schema = await client.query('select current_schema() as name');
    if (schema.rows[0]?.name !== 'public') throw new Error('Export requires the public schema');
    const tables = await client.query(`
      select tablename as name from pg_tables where schemaname = 'public' order by tablename
    `);
    const found = tables.rows.map((row) => row.name);
    if (JSON.stringify(found) !== JSON.stringify(EXPECTED_TABLES)) {
      throw new Error('Application table inventory changed');
    }
    const foreignKeys = await client.query(`
      select child.relname as child, parent.relname as parent
      from pg_constraint constraint_row
      join pg_class child on child.oid = constraint_row.conrelid
      join pg_class parent on parent.oid = constraint_row.confrelid
      join pg_namespace namespace on namespace.oid = child.relnamespace
      where constraint_row.contype = 'f' and namespace.nspname = 'public'
    `);
    const order = orderTables(found, foreignKeys.rows);
    const reviewStateOverrides = await deriveMissingReviewStates(client);
    await mkdir(outputParent, { recursive: true });
    const outputDirectory = join(outputParent, `neon-${new Date().toISOString().replaceAll(/[:.]/gu, '-')}-${randomUUID()}`);
    await mkdir(outputDirectory, { mode: 0o700 });
    const exported = [];
    for (const [index, tableName] of order.entries()) {
      const summary = await exportTable(client, outputDirectory, tableName, index, reviewStateOverrides);
      exported.push(summary);
      console.log(`${tableName}: ${summary.rows} rows`);
    }
    const manifest = {
      exportedAt: new Date().toISOString(),
      sourceSchema: 'public',
      tableCount: exported.length,
      tables: exported,
    };
    await writeFile(join(outputDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await client.query('commit');
    console.log(`Export directory: ${outputDirectory}`);
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  // 不打印 SQL、行内容或数据库连接信息。
  console.error(`Export failed: ${error?.code ?? error?.name ?? 'UnknownError'}`);
  process.exitCode = 1;
});
