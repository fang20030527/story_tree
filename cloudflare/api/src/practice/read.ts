import {
  PracticeDtoSchema,
  PracticeGroupSchema,
  UuidSchema,
  type AnswerResult,
  type PracticeDto,
} from '@context-reader/contracts';

import { AppError } from '../../../../server/src/core/errors';
import { segmentParagraph } from '../../../../server/src/modules/practice/generation-validator';
import type { ApiEnv } from '../env';
import { getRemainingQuota } from '../quota/service';

const PRACTICE_PATH = /^\/v1\/practices\/([^/]+)$/u;
const RETRYABLE_GENERATION_CODES = new Set([
  'AI_UNAVAILABLE', 'AI_INVALID_OUTPUT', 'GENERATION_DEADLINE_EXCEEDED',
]);
const SUCCESSFUL_STATUSES = new Set(['ready', 'in_progress', 'completed']);

interface PracticeRow {
  id: string;
  status: string;
  modelName: string | null;
  topicGroupId: string | null;
  articleTitle: string | null;
  articleWordCount: number | null;
  failureCode: string | null;
  failureMessagePublic: string | null;
}

interface GroupRow {
  id: string;
  topic: string | null;
  status: string;
  generationProgress: number;
  title: string | null;
  wordCount: number | null;
  failureCode: string | null;
  failureMessage: string | null;
}

interface ParagraphRow {
  id: string;
  position: number;
  plainText: string;
}

interface TargetRow {
  id: string;
  position: number;
  paragraphId: string | null;
  startOffset: number | null;
  endOffset: number | null;
}

interface QuestionRow {
  id: string;
  targetId: string;
  targetPosition: number;
  term: string;
  prompt: string;
  optionsJson: string;
  correctOptionId: string;
  meaningEn: string;
  explanationZh: string;
  optionExplanationsJson: string;
  answerKind: 'option' | 'dont_know' | null;
  selectedOptionId: string | null;
  isCorrect: number | null;
  wasAssisted: number | null;
}

interface IdRow { id: string }

function unreadablePractice(): AppError {
  return new AppError('INTERNAL_ERROR', '练习内容暂时无法读取', 500, true);
}

function freePracticeLimit(env: ApiEnv): number {
  const raw = (env as ApiEnv & { FREE_PRACTICE_LIMIT?: string | number }).FREE_PRACTICE_LIMIT;
  if (raw === undefined) return 3;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('Invalid FREE_PRACTICE_LIMIT configuration');
  }
  return value;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw unreadablePractice();
  }
}

function booleanAnswer(value: number | null): boolean {
  if (value === 0) return false;
  if (value === 1) return true;
  throw new AppError('INTERNAL_ERROR', '练习答案暂时无法读取', 500, true);
}

function isRetryableFinalFailure(code: string | null): boolean {
  return code === 'AI_UNAVAILABLE' || code === 'AI_INVALID_OUTPUT'
    || code === 'GENERATION_DEADLINE_EXCEEDED' || code === 'INTERNAL_ERROR';
}

function serializeAnswer(question: QuestionRow): AnswerResult | null {
  if (question.answerKind === null) return null;
  const isCorrect = booleanAnswer(question.isCorrect);
  const wasAssisted = booleanAnswer(question.wasAssisted);
  const feedback = {
    isCorrect,
    wasAssisted,
    correctOptionId: question.correctOptionId,
    meaningEn: question.meaningEn,
    explanationZh: question.explanationZh,
    optionExplanations: parseJson(question.optionExplanationsJson),
  };
  if (question.answerKind === 'dont_know') {
    return {
      answerKind: 'dont_know',
      selectedOptionId: null,
      ...feedback,
      isCorrect: false,
    } as AnswerResult;
  }
  if (question.answerKind !== 'option' || question.selectedOptionId === null) {
    throw new AppError('INTERNAL_ERROR', '练习答案暂时无法读取', 500, true);
  }
  return {
    answerKind: 'option',
    selectedOptionId: question.selectedOptionId,
    ...feedback,
  } as AnswerResult;
}

function serializePractice(
  practice: PracticeRow,
  remainingFreePractices: number,
  paragraphs: ParagraphRow[],
  targets: TargetRow[],
  questions: QuestionRow[],
): PracticeDto {
  const base = {
    id: practice.id,
    status: practice.status,
    modelName: practice.modelName,
    remainingFreePractices,
  };

  if (practice.status === 'queued' || practice.status === 'generating' || practice.status === 'validating') {
    return PracticeDtoSchema.parse({
      ...base,
      pollAfterMs: 1_500,
      failure: null,
      article: null,
      questions: [],
    });
  }
  if (practice.status === 'failed') {
    return PracticeDtoSchema.parse({
      ...base,
      failure: {
        code: practice.failureCode ?? 'INTERNAL_ERROR',
        message: practice.failureMessagePublic ?? '练习暂时无法生成，请稍后重试',
        retryable: isRetryableFinalFailure(practice.failureCode),
      },
      article: null,
      questions: [],
    });
  }
  if (practice.articleTitle === null || practice.articleWordCount === null || paragraphs.length === 0) {
    throw unreadablePractice();
  }

  const targetsByParagraph = new Map<string, TargetRow[]>();
  for (const target of targets) {
    if (target.paragraphId === null || target.startOffset === null || target.endOffset === null) {
      throw unreadablePractice();
    }
    const entries = targetsByParagraph.get(target.paragraphId) ?? [];
    entries.push(target);
    targetsByParagraph.set(target.paragraphId, entries);
  }

  return PracticeDtoSchema.parse({
    ...base,
    failure: null,
    article: {
      title: practice.articleTitle,
      wordCount: practice.articleWordCount,
      paragraphs: [...paragraphs].sort((left, right) => left.position - right.position)
        .map((paragraph) => ({
          id: paragraph.id,
          position: paragraph.position,
          segments: segmentParagraph(
            paragraph.plainText,
            (targetsByParagraph.get(paragraph.id) ?? []).map((target) => ({
              id: target.id,
              startOffset: target.startOffset!,
              endOffset: target.endOffset!,
            })),
          ),
        })),
    },
    questions: [...questions].sort((left, right) => left.targetPosition - right.targetPosition)
      .map((question) => ({
        id: question.id,
        targetId: question.targetId,
        term: question.term,
        prompt: question.prompt,
        options: parseJson(question.optionsJson),
        submittedAnswer: serializeAnswer(question),
      })),
  });
}

async function loadGroup(
  env: ApiEnv,
  userId: string,
  topicGroupId: string | null,
): Promise<PracticeDto['group']> {
  if (!topicGroupId) return undefined;
  const rows = await env.DB.prepare(`
    SELECT id, topic, status, generation_progress AS generationProgress,
      article_title AS title, article_word_count AS wordCount,
      failure_code AS failureCode, failure_message_public AS failureMessage
    FROM practice_sessions
    WHERE topic_group_id = ?1 AND user_id = ?2
    ORDER BY topic_position IS NULL, topic_position ASC, id ASC
  `).bind(topicGroupId, userId).all<GroupRow>();
  const retryCandidates = rows.results.some((row) => SUCCESSFUL_STATUSES.has(row.status))
    ? rows.results.filter((row) => row.status === 'failed'
      && RETRYABLE_GENERATION_CODES.has(row.failureCode ?? '')).map((row) => row.id)
    : [];
  let canRetryFailed = false;
  if (retryCandidates.length > 0) {
    const placeholders = retryCandidates.map((_, index) => `?${index + 1}`).join(', ');
    const failedJob = await env.DB.prepare(`
      SELECT id FROM jobs
      WHERE kind = 'practice_generation' AND status = 'failed'
        AND max_attempts = 3 AND resource_id IN (${placeholders})
      LIMIT 1
    `).bind(...retryCandidates).first<IdRow>();
    canRetryFailed = failedJob !== null;
  }
  return PracticeGroupSchema.parse({
    id: topicGroupId,
    canRetryFailed,
    articles: rows.results.map((row) => ({
      id: row.id,
      topic: row.topic,
      status: row.status,
      generationProgress: row.generationProgress,
      title: row.title,
      wordCount: row.wordCount,
      failureMessage: row.failureMessage,
    })),
  });
}

export async function handlePracticeReadRoute(
  request: Request,
  env: ApiEnv,
  userId: string,
): Promise<Response | null> {
  if (request.method !== 'GET') return null;
  const url = new URL(request.url);
  const match = PRACTICE_PATH.exec(url.pathname);
  if (!match) return null;
  let practiceId: string;
  try {
    practiceId = decodeURIComponent(match[1]!);
  } catch {
    throw new AppError('VALIDATION_ERROR', '练习编号格式无效', 400);
  }
  if (!UuidSchema.safeParse(practiceId).success) {
    throw new AppError('VALIDATION_ERROR', '练习编号格式无效', 400);
  }

  const practice = await env.DB.prepare(`
    SELECT id, status, model_name AS modelName, topic_group_id AS topicGroupId,
      article_title AS articleTitle, article_word_count AS articleWordCount,
      failure_code AS failureCode, failure_message_public AS failureMessagePublic
    FROM practice_sessions
    WHERE id = ?1 AND user_id = ?2
    LIMIT 1
  `).bind(practiceId, userId).first<PracticeRow>();
  if (!practice) throw new AppError('NOT_FOUND', '练习不存在', 404);

  const [group, remainingFreePractices] = await Promise.all([
    loadGroup(env, userId, practice.topicGroupId),
    getRemainingQuota(env.DB, userId, freePracticeLimit(env)),
  ]);
  let paragraphs: ParagraphRow[] = [];
  let targets: TargetRow[] = [];
  let questions: QuestionRow[] = [];
  if (!['queued', 'generating', 'validating', 'failed'].includes(practice.status)) {
    const [paragraphResult, targetResult, questionResult] = await Promise.all([
      env.DB.prepare(`
        SELECT id, position, plain_text AS plainText
        FROM practice_paragraphs WHERE practice_session_id = ?1
        ORDER BY position ASC
      `).bind(practiceId).all<ParagraphRow>(),
      env.DB.prepare(`
        SELECT id, position, paragraph_id AS paragraphId,
          start_offset AS startOffset, end_offset AS endOffset
        FROM practice_targets WHERE practice_session_id = ?1
        ORDER BY position ASC
      `).bind(practiceId).all<TargetRow>(),
      env.DB.prepare(`
        SELECT q.id, t.id AS targetId, t.position AS targetPosition,
          v.term, q.prompt, q.options_json AS optionsJson,
          q.correct_option_id AS correctOptionId, q.meaning_en AS meaningEn,
          q.explanation_zh AS explanationZh,
          q.option_explanations_json AS optionExplanationsJson,
          a.answer_kind AS answerKind, a.selected_option_id AS selectedOptionId,
          a.is_correct AS isCorrect, a.was_assisted AS wasAssisted
        FROM practice_questions AS q
        JOIN practice_targets AS t ON t.id = q.practice_target_id
        JOIN vocabulary_items AS v ON v.id = t.vocabulary_item_id AND v.user_id = ?2
        LEFT JOIN answer_attempts AS a
          ON a.practice_question_id = q.id AND a.user_id = ?2
        WHERE t.practice_session_id = ?1
        ORDER BY t.position ASC
      `).bind(practiceId, userId).all<QuestionRow>(),
    ]);
    paragraphs = paragraphResult.results;
    targets = targetResult.results;
    questions = questionResult.results;
  }

  const response = PracticeDtoSchema.parse({
    ...(group ? { group } : {}),
    ...serializePractice(practice, remainingFreePractices, paragraphs, targets, questions),
  });
  const includeProgress = url.searchParams.getAll('includeProgress');
  const body = ((includeProgress.length === 1 && includeProgress[0] === '1') || !response.group)
    ? response
    : {
        ...response,
        group: {
          id: response.group.id,
          articles: response.group.articles.map((article) => ({
            id: article.id,
            topic: article.topic,
            status: article.status,
            title: article.title,
            wordCount: article.wordCount,
            failureMessage: article.failureMessage,
          })),
        },
      };
  return Response.json(body, { status: 200, headers: { 'cache-control': 'no-store' } });
}
