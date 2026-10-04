import { PracticeDtoSchema } from '@context-reader/contracts';
import { describe, expect, it } from 'vitest';

import { countEnglishWords } from '../../infrastructure/ai/article-metrics';
import type { GeneratedPractice } from '../../infrastructure/ai/generated-schemas';
import {
  fixtureArticle as article,
  fixtureFillers as fillers,
  fixtureOverlongArticle,
  fixtureParagraphs as paragraphs,
  fixtureSpecs as specs,
  fixtureTargets as targets,
} from './generation-test-fixtures';
import {
  PracticeValidationError,
  segmentParagraph,
  validateGeneratedPractice,
  type ValidatedGeneratedPractice,
  type ValidationOptions,
} from './generation-validator';

function validate(mutate: (draft: GeneratedPractice) => void = () => undefined, options: ValidationOptions = {}) {
  const draft = article();
  mutate(draft);
  return validateGeneratedPractice(draft, targets, 'short', options);
}

function rejection(mutate: (draft: GeneratedPractice) => void, options: ValidationOptions = {}): PracticeValidationError {
  try {
    validate(mutate, options);
  } catch (error) {
    if (error instanceof PracticeValidationError) return error;
    throw error;
  }
  throw new Error('Expected the draft to be rejected');
}

/**
 * What the read path and the client need from a stored practice, built the way
 * `serializePractice` builds it and parsed with the shared strict contract.
 */
function readBack(validated: ValidatedGeneratedPractice) {
  const ids = new Map(targets.map((target) => [target.alias, crypto.randomUUID()]));
  const dto = {
    id: crypto.randomUUID(), status: 'ready', modelName: 'model', remainingFreePractices: 1, failure: null,
    article: {
      title: validated.title,
      wordCount: validated.wordCount,
      paragraphs: validated.paragraphs.map((paragraph, position) => ({
        id: crypto.randomUUID(),
        position,
        segments: segmentParagraph(paragraph.text, validated.usages
          .filter((usage) => usage.paragraphIndex === position)
          .map((usage) => ({ id: ids.get(usage.targetAlias)!, startOffset: usage.startOffset, endOffset: usage.endOffset }))),
      })),
    },
    questions: validated.questions.map((question) => ({
      id: crypto.randomUUID(),
      targetId: ids.get(question.targetAlias)!,
      term: question.targetAlias,
      prompt: question.prompt,
      options: question.optionsEn.map((label) => ({ id: crypto.randomUUID(), label })),
      submittedAnswer: null,
    })),
  };
  return PracticeDtoSchema.parse(dto);
}

/** The invariants the database rows and the answer flow depend on. */
function expectStorable(validated: ValidatedGeneratedPractice) {
  expect(validated.title.trim()).not.toBe('');
  expect(validated.wordCount).toBeGreaterThan(0);
  expect(new Set(validated.paragraphs.map((paragraph) => paragraph.key)).size).toBe(validated.paragraphs.length);
  expect(validated.usages.map((usage) => usage.targetAlias)).toEqual(targets.map((target) => target.alias));
  for (const usage of validated.usages) {
    const paragraph = validated.paragraphs[usage.paragraphIndex]!;
    expect(paragraph.key).toBe(usage.paragraphKey);
    expect(paragraph.text.slice(usage.startOffset, usage.endOffset)).toBe(usage.surfaceForm);
    expect(usage.surfaceForm).not.toBe('');
  }
  for (const question of validated.questions) {
    expect(question.optionsEn).toHaveLength(4);
    expect(question.optionExplanationsZh).toHaveLength(4);
    expect(question.optionExplanationsEn).toHaveLength(4);
    expect(question.optionsEn.every((label) => label.trim() !== '')).toBe(true);
    expect(Number.isInteger(question.correctOptionIndex) && question.correctOptionIndex >= 0 && question.correctOptionIndex < 4).toBe(true);
    expect(question.prompt.trim()).not.toBe('');
  }
  readBack(validated);
}

describe('a realistic topic article', () => {
  it('passes untouched and can be read back through the client contract', () => {
    const result = validate();
    expect(result.wordCount).toBe(218);
    expect(result.notes).toBeUndefined();
    expect(result.usages.map((usage) => usage.surfaceForm)).toEqual(specs.map((spec) => spec.term));
    expect(result.questions.map((question) => question.correctOptionIndex)).toEqual(specs.map((spec) => spec.correct));
    expectStorable(result);
  });
});

describe('the only rejections: an article that cannot be used', () => {
  it('rejects an empty or nearly empty article and says how many words it had', () => {
    for (const text of ['', '   ', 'Too short to be an article.']) {
      const error = rejection((draft) => { draft.paragraphs = [{ key: 'p1', text }]; });
      expect(error.issueCodes).toEqual(['ARTICLE_EMPTY']);
      expect(error.repairIssue).toMatch(/empty or far too short \(\d+ English words\)/);
    }
    expect(rejection((draft) => { draft.paragraphs = []; }).issueCodes).toEqual(['ARTICLE_EMPTY']);
    expect(rejection((draft) => { draft.paragraphs = paragraphs.map((_, index) => ({ key: `p${index + 1}`, text: ' ' })); }).issueCodes).toEqual(['ARTICLE_EMPTY']);
  });

  it('rejects an article that is mostly Chinese but tolerates a few Chinese glosses', () => {
    const chinese = '气候变化是我们这个时代最紧迫的挑战之一，各国政府都在寻找减轻其最严重影响的办法。尽管科学家几十年来一直警告排放必须下降，许多社区仍然依赖既不清洁也不可持续的能源。';
    const error = rejection((draft) => {
      draft.paragraphs = [{ key: 'p1', text: `${chinese} ${chinese} resilient mitigate sustainable advocate scarce initiative and some English words to count` }];
    });
    expect(error.issueCodes).toEqual(['ARTICLE_LANGUAGE']);
    expect(rejection((draft) => { draft.paragraphs = [{ key: 'p1', text: chinese }]; }).issueCodes).toEqual(['ARTICLE_LANGUAGE']);
    const glossed = validate((draft) => {
      draft.paragraphs[0]!.text = draft.paragraphs[0]!.text.replace('mitigate', 'mitigate（减轻）');
      draft.paragraphs[1]!.text = draft.paragraphs[1]!.text.replace('scarce', 'scarce (稀缺的)');
    });
    expect(glossed.paragraphs[0]!.text).toContain('（减轻）');
    expectStorable(glossed);
  });

  it('rejects a target that is nowhere in the article and names it for the rewrite', () => {
    const error = rejection((draft) => {
      draft.paragraphs[2]!.text = draft.paragraphs[2]!.text.replace('resilient', 'strong');
      draft.paragraphs[1]!.text = draft.paragraphs[1]!.text.replace('initiative', 'plan');
    });
    expect(error.issueCodes).toEqual(['TARGET_MISSING']);
    expect(error.repairIssues).toHaveLength(1);
    expect(error.repairIssue).toContain('t5 ("initiative"), t6 ("resilient")');
    expect(error.repairIssue).not.toContain('t1');
  });

  it('rejects a reply without a single question, and reports it together with a missing target', () => {
    const error = rejection((draft) => { draft.questions = []; });
    expect(error.issueCodes).toEqual(['QUESTIONS_MISSING']);
    expect(error.repairIssue).toContain('no questions');
    const both = rejection((draft) => {
      draft.questions = [];
      draft.paragraphs[2]!.text = draft.paragraphs[2]!.text.replace('resilient', 'strong');
    });
    expect(both.issueCodes).toEqual(['TARGET_MISSING', 'QUESTIONS_MISSING']);
    expect(both.repairIssues).toHaveLength(2);
    // Questions for some targets are enough: the rest are built.
    expect(validate((draft) => { draft.questions = draft.questions.slice(0, 1); }).questions).toHaveLength(6);
  });

  it('does not reject for any other reason, however poor the draft is', () => {
    const poor = validate((draft) => {
      draft.questions.forEach((question) => {
        question.prompt = '选择正确的词。';
        question.optionsEn = ['一', '二'];
        question.correctOptionIndex = 99;
        question.explanationZh = 'This is entirely in English and far too long to be a Chinese summary of anything.';
        question.optionExplanationsZh = [];
        question.optionExplanationsEn = ['x'];
      });
    });
    expectStorable(poor);
  });
});

describe('finishing the final draft instead of rejecting it', () => {
  const withoutTargets = (draft: GeneratedPractice) => {
    draft.paragraphs[2]!.text = draft.paragraphs[2]!.text.replace('resilient', 'strong');
    draft.paragraphs[1]!.text = draft.paragraphs[1]!.text.replace('initiative', 'plan');
  };

  it('adds a sentence with each missing target so the article can still be stored and read', () => {
    const result = validate(withoutTargets, { completeMissing: true });
    expect(result.notes).toEqual(['TARGET_ADDED:t5', 'TARGET_ADDED:t6']);
    const last = result.paragraphs.at(-1)!.text;
    expect(last.endsWith('One expression worth remembering here is "initiative". One expression worth remembering here is "resilient".')).toBe(true);
    expect(result.usages[4]).toMatchObject({ targetAlias: 't5', surfaceForm: 'initiative' });
    expect(result.usages[5]).toMatchObject({ targetAlias: 't6', surfaceForm: 'resilient', paragraphKey: 'p3' });
    expect(result.paragraphs[0]!.text).toBe(paragraphs[0]);
    expectStorable(result);
  });

  it('cannot add a target whose term is unknown, and still rejects an article that is not English', () => {
    const noTerms = targets.map((target) => ({ id: target.id, alias: target.alias, meaningZh: target.meaningZh }));
    const draft = article();
    withoutTargets(draft);
    expect(() => validateGeneratedPractice(draft, noTerms, 'short', { completeMissing: true })).toThrow(PracticeValidationError);
    expect(rejection((broken) => { broken.paragraphs = []; }, { completeMissing: true }).issueCodes).toEqual(['ARTICLE_EMPTY']);
  });

  it('builds every question from the article when the reply had none', () => {
    const result = validate((draft) => { draft.questions = []; }, { completeMissing: true });
    expect(result.questions).toHaveLength(6);
    expect(result.notes).toEqual(specs.map((spec) => `QUESTION_BUILT:${spec.alias}`));
    expectStorable(result);
  });
});

describe('locating targets', () => {
  it('uses the place the model reported, even when the word is repeated', () => {
    const result = validate((draft) => { draft.paragraphs[2]!.text += ' We must remain resilient.'; });
    expect(result.usages[5]!.startOffset).toBe(result.paragraphs[2]!.text.indexOf('resilient'));
    expect(result.notes).toBeUndefined();
  });

  it('finds a target the model pointed at the wrong form or paragraph', () => {
    const result = validate((draft) => {
      draft.usages[0] = { targetAlias: 't1', paragraphKey: 'p1', surfaceForm: 'mitigating' };
      draft.usages[5] = { targetAlias: 't6', paragraphKey: 'p1', surfaceForm: 'resilient' };
      draft.usages.splice(2, 1);
    });
    expect(result.usages[0]!.surfaceForm).toBe('mitigate');
    expect(result.usages[2]).toMatchObject({ targetAlias: 't3', surfaceForm: 'advocate', paragraphKey: 'p1' });
    expect(result.usages[5]).toMatchObject({ paragraphKey: 'p3', surfaceForm: 'resilient' });
    expect(result.notes).toEqual(['USAGE_RELOCATED:t1', 'USAGE_RELOCATED:t3', 'USAGE_RELOCATED:t6']);
    expectStorable(result);
  });

  it('prefers a whole word to a fragment of a longer word, and keeps a fragment only as a last resort', () => {
    const fragment = (draft: GeneratedPractice) => { draft.usages[3]!.surfaceForm = 'scar'; };
    expect(validate(fragment).usages[3]!.surfaceForm).toBe('scarce');
    const withoutTerms = targets.map((target) => ({ id: target.id, alias: target.alias, meaningZh: target.meaningZh }));
    const legacy = article();
    fragment(legacy);
    expect(validateGeneratedPractice(legacy, withoutTerms, 'short').usages[3]!.surfaceForm).toBe('scar');
  });

  it('does not take a target for a longer word that merely contains it', () => {
    const result = validate((draft) => {
      draft.paragraphs[0]!.text = draft.paragraphs[0]!.text.replace('mitigate its worst effects', 'govern the whole planet');
      draft.usages[0]!.surfaceForm = 'govern';
    });
    expect(result.paragraphs[0]!.text.slice(result.usages[0]!.startOffset, result.usages[0]!.endOffset)).toBe('govern');
    expect(result.paragraphs[0]!.text.indexOf('governments')).toBeLessThan(result.usages[0]!.startOffset);
  });

  it('keeps the highlight on the right characters after a letter that grows when lower-cased', () => {
    // "scarcer" is not a spelling of the term, so only the text search can place it.
    const result = validate((draft) => {
      draft.paragraphs[1]!.text = draft.paragraphs[1]!.text.replace('Water, once', 'İstanbul, once').replace('scarce in', 'scarcer in');
      draft.usages[3]!.surfaceForm = 'scarcer';
    });
    expect(result.usages[3]).toMatchObject({ targetAlias: 't4', paragraphKey: 'p2', surfaceForm: 'scarcer' });
    expect(result.notes ?? []).not.toContain('USAGE_RELOCATED:t4');
    expectStorable(result);
  });

  it('gives a target its own word when the model pointed it at a word another target owns', () => {
    const result = validate((draft) => {
      draft.usages[0] = { targetAlias: 't1', paragraphKey: 'p1', surfaceForm: 'advocate' };
    });
    // t1 ("mitigate") was pointed at "advocate", which t3 owns; its own word is found by term.
    expect(result.usages[0]!.surfaceForm).toBe('mitigate');
    expect(result.usages[2]!.surfaceForm).toBe('advocate');
    expectStorable(result);
  });

  it('removes markdown emphasis and punctuation around the reported word, and tidies whitespace', () => {
    const result = validate((draft) => {
      draft.paragraphs[0]!.text = draft.paragraphs[0]!.text.replace('mitigate', '**mitigate**').replace('sustainable', '*sustainable*');
      draft.paragraphs[1]!.text = draft.paragraphs[1]!.text.replace('Farmers who used', 'Farmers\n\nwho   used');
      draft.usages[0]!.surfaceForm = '**mitigate**';
      draft.usages[3]!.surfaceForm = '"scarce".';
    });
    expect(result.paragraphs[0]!.text).not.toContain('*');
    expect(result.paragraphs[1]!.text).toContain('Farmers who used to harvest');
    expect(result.usages[0]!.surfaceForm).toBe('mitigate');
    expect(result.usages[3]!.surfaceForm).toBe('scarce');
    expect(result.wordCount).toBe(218);
  });

  it('keeps paragraph keys unique and drops empty paragraphs so stored rows stay consistent', () => {
    const result = validate((draft) => {
      draft.paragraphs[1]!.key = 'p1';
      draft.paragraphs[2]!.key = ' ';
      draft.paragraphs.push({ key: 'p4', text: '  ' });
    });
    expect(result.paragraphs.map((paragraph) => paragraph.key)).toEqual(['p1', 'p2', 'p3']);
    expectStorable(result);
  });
});

describe('the article itself', () => {
  it('shortens a slightly overlong article by dropping whole filler sentences only', () => {
    const result = validateGeneratedPractice(fixtureOverlongArticle(), targets, 'short');
    expect(result.wordCount).toBe(300);
    expect(result.notes).toEqual(['TRIMMED']);
    const text = result.paragraphs.map((paragraph) => paragraph.text).join(' ');
    expect(fillers.filter((sentence) => text.includes(sentence))).toHaveLength(fillers.length - 1);
    for (const { term } of specs) expect(text).toContain(term);
    expectStorable(result);
  });

  it('still trims when a paragraph it does not touch is short', () => {
    const draft = fixtureOverlongArticle();
    draft.paragraphs.push({ key: 'p4', text: 'Hope matters. So does effort.' });
    const result = validateGeneratedPractice(draft, targets, 'short');
    expect(result.notes).toEqual(['TRIMMED']);
    expect(result.wordCount).toBeLessThanOrEqual(300);
    expect(result.paragraphs[3]!.text).toBe('Hope matters. So does effort.');
    expectStorable(result);
  });

  it('lets an article through that is too short or far too long, and says so in the notes', () => {
    const short = validate((draft) => { draft.paragraphs[1]!.text = 'Water is scarce, so every town needs an initiative to share it fairly with everyone.'; });
    expect(short.notes).toEqual([expect.stringMatching(/^WORD_COUNT_LOW:\d+$/)]);
    expect(short.wordCount).toBeLessThan(200);
    const long = validate((draft) => { draft.paragraphs[1]!.text += ` ${fillers.join(' ')} ${fillers.join(' ')}`; });
    expect(long.notes).toEqual([expect.stringMatching(/^WORD_COUNT_HIGH:\d+$/)]);
    expect(long.wordCount).toBeGreaterThan(300);
    expectStorable(short);
    expectStorable(long);
  });

  it('never trims away a sentence with a target or a long complex sentence', () => {
    const longSentence = `${'The committee continued to discuss several unrelated proposals for many weeks '.repeat(8).trim()}.`;
    const result = validate((draft) => { draft.paragraphs[1]!.text += ` ${longSentence}`; });
    expect(result.paragraphs[1]!.text).toContain(longSentence);
    expect(result.notes).toEqual([expect.stringMatching(/^WORD_COUNT_HIGH:/)]);
  });

  it('cleans a Chinese topic name out of the title, and invents a title when there is none', () => {
    for (const [written, stored] of [
      ['科技: A Measured Study', 'A Measured Study'],
      ['Technology (科技)', 'Technology'],
      ['学习共处 Learning to Live Together', 'Learning to Live Together'],
      ['学习共处', '学习共处'],
      ['Learning to Live Together', 'Learning to Live Together'],
    ] as const) {
      expect(validate((draft) => { draft.title = written; }).title).toBe(stored);
    }
    expect(validate((draft) => { draft.title = '  '; }).title).toBe('Climate change is one of the most pressing');
    expect(validate((draft) => { draft.title = 'T'.repeat(300); }).title).toHaveLength(160);
  });
});

describe('questions are repaired, not judged', () => {
  const question = (index: number, mutate: (item: GeneratedPractice['questions'][number]) => void, options: ValidationOptions = {}) => {
    const result = validate((draft) => mutate(draft.questions[index]!), options);
    return { result, question: result.questions[index]! };
  };

  it('writes the blank as four underscores whatever the model wrote', () => {
    for (const blank of ['__', '______', '________', '**____**']) {
      expect(question(0, (item) => { item.prompt = `Planting trees along the coast can ${blank} the damage caused by storms.`; }).question.prompt)
        .toBe('Planting trees along the coast can ____ the damage caused by storms.');
    }
  });

  it('puts the blank where the sentence spells out the answer, and leaves a prompt it cannot fix alone', () => {
    const added = question(5, (item) => { item.prompt = 'After the flood, the resilient town rebuilt its bridge within a month.'; });
    expect(added.question.prompt).toBe('After the flood, the ____ town rebuilt its bridge within a month.');
    expect(added.result.notes).toEqual(['BLANK_ADDED:t6']);
    expect(question(5, (item) => { item.prompt = 'Which word best completes the sentence?'; }).question.prompt).toBe('Which word best completes the sentence?');
    expect(question(5, (item) => { item.prompt = 'A ____ town stays ____ in a crisis.'; }).question.prompt).toBe('A ____ town stays ____ in a crisis.');
  });

  it('lets wording problems through: leaked answers, copied sentences, mixed languages, duplicate options', () => {
    const leaked = question(3, (item) => { item.prompt = 'Fresh fruit that was scarce ____ in the village during the winter.'; });
    expect(leaked.question.prompt).toContain('scarce ____');
    const copied = question(0, (item) => { item.prompt = 'Climate change is one of the most pressing challenges of our time, and governments around the world are searching for ways to ____ its worst effects.'; });
    expect(copied.question.prompt).toContain('searching for ways to ____');
    const english = question(1, (item) => { item.explanationZh = 'This word is correct for the sentence in every situation.'; });
    expect(english.question.explanationZh).toBe('This word is correct for the sentence in every situation.');
    const chinese = question(2, (item) => { item.optionsEn = ['反对', '忘记', '提倡', '道歉']; item.correctOptionIndex = 2; item.prompt = '许多医生____每天散步。'; });
    expect(chinese.question.optionsEn).toContain('提倡');
    const duplicate = question(2, (item) => { item.optionsEn[1] = item.optionsEn[0]!; });
    expect(duplicate.question.optionsEn.slice(0, 2)).toEqual(['object', 'object']);
    expect(duplicate.result.notes).toBeUndefined();
  });

  it('takes the answer from the target word, whatever index the model gave', () => {
    for (const reported of [-1, 0, 3, 4, 99, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const { question: repaired } = question(2, (item) => { item.correctOptionIndex = reported; });
      expect(repaired.optionsEn[repaired.correctOptionIndex]).toBe('advocate');
    }
    expect(question(2, (item) => { item.correctOptionIndex = 0; }).result.notes).toEqual(['ANSWER_FROM_TARGET:t3']);
    expect(question(2, (item) => { item.optionsEn[2] = 'Advocates.'; item.correctOptionIndex = 0; }).question.optionsEn[2]).toBe('Advocates.');
  });

  it('keeps the model index when no option is the target, and adds the target when there is no index', () => {
    const keeps = question(2, (item) => { item.optionsEn = ['object', 'forget', 'support', 'apologize']; item.correctOptionIndex = 2; });
    expect(keeps.question.optionsEn[keeps.question.correctOptionIndex]).toBe('support');
    const adds = question(2, (item) => { item.optionsEn = ['object', 'forget', 'support', 'apologize']; item.correctOptionIndex = 9; });
    expect(adds.question.optionsEn).toHaveLength(4);
    expect(adds.question.optionsEn[adds.question.correctOptionIndex]).toBe('advocate');
    expect(adds.result.notes).toEqual(['ANSWER_ADDED:t3', 'OPTIONS_TRIMMED:t3']);
  });

  it('always ends with exactly four options, keeping the answer and the matching explanations', () => {
    const many = question(2, (item) => {
      item.optionsEn = ['object', 'forget', 'ignore', 'advocate', 'apologize', 'hide'];
      item.optionExplanationsZh = ['一', '二', '三', '四', '五', '六'];
      item.optionExplanationsEn = ['one', 'two', 'three', 'four', 'five', 'six'];
      item.correctOptionIndex = 3;
    });
    expect(many.question.optionsEn).toEqual(['object', 'forget', 'ignore', 'advocate']);
    expect(many.question.optionExplanationsZh).toEqual(['一', '二', '三', '四']);
    expect(many.result.notes).toEqual(['OPTIONS_TRIMMED:t3']);
    const answerLate = question(2, (item) => {
      item.optionsEn = ['object', 'forget', 'ignore', 'hide', 'apologize', 'advocate'];
      item.optionExplanationsEn = ['one', 'two', 'three', 'four', 'five', 'six'];
    });
    expect(answerLate.question.optionsEn).toEqual(['object', 'forget', 'ignore', 'advocate']);
    expect(answerLate.question.optionExplanationsEn).toEqual(['one', 'two', 'three', 'six']);

    const few = question(2, (item) => {
      item.optionsEn = ['advocate', 'object'];
      item.optionExplanationsZh = ['对', '错'];
      item.optionExplanationsEn = ['right', 'wrong'];
      item.correctOptionIndex = 0;
    });
    expect(few.question.optionsEn.slice(0, 2)).toEqual(['advocate', 'object']);
    expect(new Set(few.question.optionsEn.map((label) => label.toLowerCase())).size).toBe(4);
    // Other targets of the article are the first distractors.
    expect(few.question.optionsEn[2]).toBe('mitigate');
    expect(few.question.optionExplanationsZh.slice(0, 2)).toEqual(['对', '错']);
    expect(few.result.notes).toEqual(['OPTIONS_PADDED:t3']);
  });

  it('fills missing explanations and drops empty options without shifting the explanations', () => {
    const filled = question(2, (item) => {
      item.meaningEn = '';
      item.explanationZh = '';
      item.optionExplanationsZh = ['', '错'];
      item.optionExplanationsEn = [];
    });
    expect(filled.question.meaningEn).toBe('The word "advocate" as used in the article.');
    expect(filled.question.explanationZh).toBe('“advocate”在文中的意思是：提倡；拥护。');
    expect(filled.question.optionExplanationsZh).toEqual(['这个词放进句子后意思不通。', '错', '正确答案：advocate（提倡；拥护）', '这个词放进句子后意思不通。']);
    expect(filled.question.optionExplanationsEn[2]).toBe('This is the target word, and it fits the sentence.');

    const gaps = question(2, (item) => {
      item.optionsEn = ['object', '', 'advocate', 'apologize', 'forget'];
      item.optionExplanationsZh = ['一', '二', '三', '四', '五'];
      item.optionExplanationsEn = ['one', 'two', 'three', 'four', 'five'];
    });
    expect(gaps.question.optionsEn).toEqual(['object', 'advocate', 'apologize', 'forget']);
    expect(gaps.question.optionExplanationsZh).toEqual(['一', '三', '四', '五']);
  });

  it('builds a question from the sentence of the target when the model gave none, varying the answer position', () => {
    const missing = validate((draft) => { draft.questions = draft.questions.slice(0, 0); }, { completeMissing: true });
    expect(missing.questions).toHaveLength(6);
    expect(missing.notes).toEqual(specs.map((spec) => `QUESTION_BUILT:${spec.alias}`));
    const [first] = missing.questions;
    expect(first!.prompt).toBe('Climate change is one of the most pressing challenges of our time, and governments around the world are searching for ways to ____ its worst effects.');
    expect(missing.questions.map((item) => item.correctOptionIndex)).toEqual([0, 1, 2, 3, 0, 1]);
    for (const [index, item] of missing.questions.entries()) {
      expect(item.optionsEn[item.correctOptionIndex]).toBe(specs[index]!.term);
      expect(new Set(item.optionsEn).size).toBe(4);
    }
    expectStorable(missing);
    // An empty prompt is rebuilt the same way while the model's own options are kept.
    const rebuilt = validate((draft) => { draft.questions[3]!.prompt = ''; });
    expect(rebuilt.questions[3]!.prompt).toBe('Water, once taken for granted, has become increasingly ____ in regions where rainfall patterns have shifted dramatically.');
    expect(rebuilt.questions[3]!.optionsEn).toEqual(['scarce', 'plentiful', 'cheap', 'sweet']);
  });

  it('takes the first entry when an alias repeats and ignores aliases that were never supplied', () => {
    const result = validate((draft) => {
      draft.usages.push({ targetAlias: 't1', paragraphKey: 'p3', surfaceForm: 'resilient' }, { targetAlias: 't99', paragraphKey: 'p1', surfaceForm: 'whatever' });
      draft.questions.unshift({ ...draft.questions[0]!, targetAlias: 't99', prompt: 'Ignored ____.' });
      draft.questions.push({ ...draft.questions[0]!, prompt: 'A later duplicate ____.' });
    });
    expect(result.usages[0]).toMatchObject({ targetAlias: 't1', paragraphKey: 'p1', surfaceForm: 'mitigate' });
    expect(result.questions[0]!.prompt).toBe('Planting trees along the coast can ____ the damage caused by storms.');
    expect(result.questions).toHaveLength(6);
  });
});

// A seeded stand-in for every way a model reply can be wrong. Whatever it does, the result
// is either one of the four rejections or a practice the read path and the client accept.
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function breakDraft(draft: GeneratedPractice, random: () => number): void {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const junk = [-3, -1, 0, 1, 2, 3, 4, 9, 1.5, Number.NaN, Number.POSITIVE_INFINITY];
  const some = <T>(items: T[]): T | undefined => (items.length > 0 ? pick(items) : undefined);
  const mutations: Array<() => void> = [
    () => draft.usages.splice(Math.floor(random() * draft.usages.length), 1),
    () => draft.questions.splice(Math.floor(random() * draft.questions.length), 1),
    () => { const usage = some(draft.usages); if (usage) draft.usages.push({ ...usage, targetAlias: pick(specs).alias }); },
    () => { const usage = some(draft.usages); if (usage) usage.surfaceForm = pick(['', ' ', '**x**', 'zzz', pick(specs).term, 'the', '."']); },
    () => { const usage = some(draft.usages); if (usage) usage.paragraphKey = pick(['', 'p9', 'P2', '3', 'paragraph 1', 'nonsense']); },
    () => { const usage = some(draft.usages); if (usage) usage.targetAlias = pick(['T1', ' t2 ', 't77', '']); },
    () => { const item = some(draft.questions); if (item) item.targetAlias = pick(['T3', 't55', '', 't1']); },
    () => { const item = some(draft.questions); if (item) item.optionsEn = pick([[], ['a'], ['a', 'b'], ['a', 'b', 'c'], ['a', '', 'c', 'd', 'e', 'f', 'g'], ['x', 'x', 'x', 'x']]); },
    () => { some(draft.questions)?.optionsEn.reverse(); },
    () => { const item = some(draft.questions); if (item) item.correctOptionIndex = pick(junk); },
    () => { const item = some(draft.questions); if (item) item.prompt = pick(['', ' ', '____', 'No blank at all.', 'Two ____ and ____ blanks.', '**____**', '_']); },
    () => { const item = some(draft.questions); if (item) item.explanationZh = pick(['', 'English only.', '好']); },
    () => { const item = some(draft.questions); if (item) item.optionExplanationsZh = pick([[], ['一'], ['一', '二', '三', '四', '五', '六']]); },
    () => { const item = some(draft.questions); if (item) item.optionExplanationsEn = pick([[], ['one'], ['', '', '', '']]); },
    () => { const item = some(draft.questions); if (item) item.meaningEn = ''; },
    () => { if (draft.paragraphs.length > 1) draft.paragraphs[1]!.key = draft.paragraphs[0]!.key; },
    () => { const paragraph = some(draft.paragraphs); if (paragraph) paragraph.key = ''; },
    () => { const paragraph = some(draft.paragraphs); if (paragraph) paragraph.text = pick(['', '   ', '**bold** and *italic*', `${paragraph.text}\n\n  extra`]); },
    () => { draft.paragraphs.splice(Math.floor(random() * draft.paragraphs.length), 1); },
    () => { draft.title = pick(['', '科技', 'Title (科技)']); },
    () => draft.paragraphs.push({ key: pick(['p4', 'p1', '']), text: pick(['More text here.', '', fillers.join(' ')]) }),
  ];
  for (let count = Math.floor(random() * 5); count >= 0; count -= 1) pick(mutations)();
}

describe('whatever the model returns', () => {
  it('is either rejected for one of the four reasons or stored in a form the client accepts', () => {
    const random = mulberry32(2026);
    let stored = 0;
    let rejected = 0;
    for (let round = 0; round < 3000; round += 1) {
      const draft = article();
      breakDraft(draft, random);
      const completeMissing = random() < 0.5;
      try {
        expectStorable(validateGeneratedPractice(draft, targets, 'short', { completeMissing }));
        stored += 1;
      } catch (error) {
        if (!(error instanceof PracticeValidationError)) throw error;
        rejected += 1;
        const allowed = completeMissing ? ['ARTICLE_EMPTY', 'ARTICLE_LANGUAGE'] : ['ARTICLE_EMPTY', 'ARTICLE_LANGUAGE', 'TARGET_MISSING', 'QUESTIONS_MISSING'];
        expect(error.issueCodes.every((code) => allowed.includes(code))).toBe(true);
        expect(error.repairIssues.length).toBeGreaterThan(0);
      }
    }
    // The simulation exercises both outcomes and is dominated by practices that are stored.
    expect(stored).toBeGreaterThan(rejected);
    expect(rejected).toBeGreaterThan(0);
  });

  it('stores every damaged draft on the final try as long as it is an English article with its terms known', () => {
    const random = mulberry32(7);
    let checked = 0;
    for (let round = 0; round < 3000; round += 1) {
      const draft = article();
      breakDraft(draft, random);
      const text = draft.paragraphs.map((paragraph) => paragraph.text).join(' ');
      if (countEnglishWords(text) < 20 || /\p{Script=Han}/u.test(text)) continue;
      expectStorable(validateGeneratedPractice(draft, targets, 'short', { completeMissing: true }));
      checked += 1;
    }
    expect(checked).toBeGreaterThan(2000);
  });
});
