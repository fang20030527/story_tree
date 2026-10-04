// Runs the production topic-essay pipeline (prompts, validator, rewrite loop and the
// dispatcher's three job attempts) for four essays at once against the real model, with no
// database and no deployed API. It prints what the model got wrong and what was repaired or
// let through, so a failing run explains itself.
//
//   RUN_LIVE_SMOKE=1 npm run smoke:generation --workspace=@context-reader/server
//   npm run smoke:generation --workspace=@context-reader/server -- --fake      (no network)
//   ... -- --words=10 --essays=4
//
// Each essay asks for the self-test questions the Worker plans for its word count, so
// `--words=2` or `--words=3` shows how a thin essay with six questions behaves (the report
// prints questions stored / planned and the time per essay).
//
// Reads EVOLINK_API_KEY (and optionally EVOLINK_BASE_URL, EVOLINK_TEXT_MODEL,
// EVOLINK_TIMEOUT_MS) from the environment; the key is never printed.
import { AppError } from '../src/core/errors';
import { planQuestionCounts } from '../src/infrastructure/ai/article-metrics';
import { EvolinkClient } from '../src/infrastructure/ai/evolink-client';
import { EvolinkAiProvider } from '../src/infrastructure/ai/evolink-provider';
import { FakeAiProvider } from '../src/infrastructure/ai/fake-provider';
import type { AiProvider, GeneratePracticeInput } from '../src/infrastructure/ai/types';
import { runPracticeGeneration, type GenerationLogEvent } from '../src/modules/practice/generation-loop';
import { PracticeValidationError, validateGeneratedPractice } from '../src/modules/practice/generation-validator';

const TOPICS = ['社会', '环境', '科技', '政治'] as const;
const WORD_POOL = [
  ['mitigate', '减轻；缓和'], ['sustainable', '可持续的'], ['advocate', '提倡；拥护'], ['scarce', '稀缺的'],
  ['initiative', '倡议；主动性'], ['resilient', '有韧性的'], ['allocate', '分配；拨出'], ['curb', '抑制；控制'],
  ['tangible', '切实的；有形的'], ['inevitable', '不可避免的'], ['reluctant', '不情愿的'], ['coherent', '连贯的；一致的'],
  ['prevalent', '普遍的；盛行的'], ['subsidy', '补贴；津贴'], ['regulate', '监管；调节'], ['contemplate', '考虑；沉思'],
  ['stimulate', '刺激；促进'], ['deteriorate', '恶化；变坏'], ['comprehensive', '全面的'], ['controversial', '有争议的'],
  ['enforce', '实施；强制执行'], ['intervene', '干预；介入'], ['legitimate', '合法的；正当的'], ['ambiguous', '模棱两可的'],
  ['consensus', '共识；一致意见'], ['scrutiny', '仔细审查'], ['accountable', '负有责任的'], ['inclusive', '包容的'],
  ['viable', '可行的'], ['disrupt', '扰乱；使中断'], ['indigenous', '本土的；原住的'], ['threshold', '门槛；临界点'],
] as const;
const JOB_ATTEMPTS = 3;
const GROUP_DEADLINE_MS = 480_000;

function option(name: string, fallback: number): number {
  const raw = process.argv.find((argument) => argument.startsWith(`--${name}=`))?.split('=')[1];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`--${name} must be a positive integer`);
  return value;
}

function createProvider(fake: boolean): Pick<AiProvider, 'generatePractice'> {
  if (fake) return new FakeAiProvider();
  const apiKey = process.env.EVOLINK_API_KEY;
  if (!apiKey) throw new Error('EVOLINK_API_KEY is not set');
  const timeoutMs = Number(process.env.EVOLINK_TIMEOUT_MS ?? 60_000);
  return new EvolinkAiProvider(
    new EvolinkClient({
      apiKey,
      baseUrl: process.env.EVOLINK_BASE_URL ?? 'https://direct.evolink.ai/v1',
      textModel: process.env.EVOLINK_TEXT_MODEL ?? 'gpt-6-luna',
      timeoutMs,
    }),
    { visionModel: 'unused', visionTimeoutMs: 1, generationTimeoutMs: Math.max(timeoutMs, 90_000) },
  );
}

interface Report {
  topic: string;
  ok: boolean;
  attempts: number;
  elapsedMs: number;
  words?: number;
  /** Questions planned for the essay, and how many the stored essay has. */
  plannedQuestions: number;
  questions?: number;
  repairs: string[];
  failure?: string;
  notes: string[];
}

async function runEssay(
  provider: Pick<AiProvider, 'generatePractice'>,
  topic: (typeof TOPICS)[number],
  index: number,
  wordsPerEssay: number,
  deadlineAt: Date,
): Promise<Report> {
  const pool = WORD_POOL.slice(index * wordsPerEssay, (index + 1) * wordsPerEssay);
  const entries = (pool.length > 0 ? pool : WORD_POOL.slice(0, wordsPerEssay));
  // The same question plan the Worker makes: a thin essay asks some words again.
  const questionCounts = planQuestionCounts(entries.length);
  const input: GeneratePracticeInput = {
    examPath: 'ielts',
    topic,
    targets: entries.map(([term, meaningZh], position) => ({
      alias: `t${position + 1}`,
      term,
      meaningZh,
      ...((questionCounts[position] ?? 1) > 1 ? { questionCount: questionCounts[position]! } : {}),
    })),
  };
  const targets = input.targets.map((target, position) => ({
    id: target.alias, alias: target.alias, meaningZh: target.meaningZh, term: target.term,
    questionCount: questionCounts[position] ?? 1,
  }));
  const report: Report = {
    topic, ok: false, attempts: 0, elapsedMs: 0, repairs: [], notes: [],
    plannedQuestions: questionCounts.reduce((sum, count) => sum + count, 0),
  };
  const startedAt = Date.now();

  for (let attempt = 1; attempt <= JOB_ATTEMPTS; attempt += 1) {
    report.attempts = attempt;
    let draft = 0;
    const log = (event: GenerationLogEvent) => {
      if (typeof event.draft === 'number') draft = event.draft;
      if (event.stage !== 'done' && event.outcome !== 'ok') {
        report.notes.push(`attempt ${attempt} draft ${draft + 1} ${String(event.stage)}: ${String(event.outcome)}${event.ms === undefined ? '' : ` (${event.ms} ms)`}`);
      }
    };
    try {
      const validated = await runPracticeGeneration({
        provider: { generatePractice: (request, signal) => provider.generatePractice(request, signal) },
        input,
        validate: async (generated, options) => {
          try {
            return validateGeneratedPractice(generated, targets, 'short', options);
          } catch (error) {
            if (error instanceof PracticeValidationError) {
              report.notes.push(`attempt ${attempt} draft ${draft + 1} unusable: ${error.repairIssues.join(' | ')}`);
            }
            throw error;
          }
        },
        signal: AbortSignal.timeout(Math.max(1, deadlineAt.getTime() - Date.now())),
        deadlineAt,
        hooks: {
          onDraft: async () => undefined,
          onValidated: async () => true,
        },
        log,
      });
      report.ok = validated !== null;
      if (validated) {
        report.words = validated.wordCount;
        report.questions = validated.questions.length;
        report.repairs = validated.notes ?? [];
      }
      break;
    } catch (error) {
      report.failure = error instanceof AppError ? `${error.code}: ${error.message}` : String(error);
      // The dispatcher starts a fresh attempt after a retryable failure.
      if (!(error instanceof AppError) || !error.retryable) break;
    }
  }
  report.elapsedMs = Date.now() - startedAt;
  return report;
}

async function main(): Promise<void> {
  const fake = process.argv.includes('--fake');
  if (!fake && process.env.RUN_LIVE_SMOKE !== '1') {
    throw new Error('Live check disabled; set RUN_LIVE_SMOKE=1 (calls the real model) or pass --fake');
  }
  const essays = Math.min(option('essays', 4), TOPICS.length);
  const wordsPerEssay = Math.min(option('words', 8), Math.floor(WORD_POOL.length / essays));
  const provider = createProvider(fake);
  const deadlineAt = new Date(Date.now() + GROUP_DEADLINE_MS);

  console.log(`${fake ? 'FAKE provider' : 'real model'}: ${essays} essays at once, ${wordsPerEssay} target words each, ${JOB_ATTEMPTS} job attempts, ${GROUP_DEADLINE_MS / 1000}s group deadline`);
  const reports = await Promise.all(TOPICS.slice(0, essays).map((topic, index) => runEssay(provider, topic, index, wordsPerEssay, deadlineAt)));

  for (const report of reports) {
    const status = report.ok ? 'OK    ' : 'FAILED';
    console.log(`\n${status} ${report.topic}  attempts=${report.attempts}  ${(report.elapsedMs / 1000).toFixed(1)}s${report.words === undefined ? '' : `  ${report.words} words`}${report.questions === undefined ? '' : `  ${report.questions}/${report.plannedQuestions} questions`}`);
    if (report.repairs.length > 0) console.log(`  repaired or let through: ${report.repairs.join(', ')}`);
    for (const note of report.notes) console.log(`  - ${note}`);
    if (!report.ok) console.log(`  final: ${report.failure ?? 'unknown'}`);
  }
  const failed = reports.filter((report) => !report.ok).length;
  console.log(`\n${reports.length - failed}/${reports.length} essays succeeded`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
