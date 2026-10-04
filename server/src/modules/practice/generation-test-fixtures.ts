// Test-only fixtures: a realistic three-paragraph topic article (218 words) with six
// targets, shared by the validator, loop and Worker tests. Not imported by production code.
import type { GeneratedPractice } from '../../infrastructure/ai/generated-schemas';
import type { GenerationTarget } from './generation-validator';

export const fixtureParagraphs = [
  'Climate change is one of the most pressing challenges of our time, and governments around the world are searching for ways to mitigate its worst effects. Although scientists have warned for decades that emissions must fall, many communities still depend on energy sources that are neither clean nor sustainable. As a result, ordinary citizens, who often feel powerless in the face of such global problems, are beginning to advocate for local solutions that deliver visible and lasting benefits.',
  'Water, once taken for granted, has become increasingly scarce in regions where rainfall patterns have shifted dramatically. Farmers who used to harvest two crops each year now struggle to produce one, while cities must decide how to share limited supplies between households and industry. Faced with such difficult choices, several towns have launched an initiative to collect rainwater, repair leaking pipes, and teach children to value every drop.',
  'Of course, technology alone cannot solve these problems, because lasting change also requires patience, cooperation, and a willingness to adapt. Communities that remain resilient tend to share three habits: they plan ahead, they listen to people who disagree with them, and they celebrate small victories along the way. If more societies followed this example, the future would look far less frightening, and young people could look forward to it with genuine hope.',
];

export const fixtureSpecs = [
  { alias: 't1', term: 'mitigate', meaningZh: '减轻；缓和', key: 'p1', prompt: 'Planting trees along the coast can ____ the damage caused by storms.', options: ['mitigate', 'celebrate', 'ignore', 'inspire'], correct: 0 },
  { alias: 't2', term: 'sustainable', meaningZh: '可持续的', key: 'p1', prompt: 'A ____ farm uses water carefully so the land stays productive for decades.', options: ['temporary', 'sustainable', 'fragile', 'wasteful'], correct: 1 },
  { alias: 't3', term: 'advocate', meaningZh: '提倡；拥护', key: 'p1', prompt: 'Many doctors ____ for a daily walk because it protects the heart.', options: ['object', 'forget', 'advocate', 'apologize'], correct: 2 },
  { alias: 't4', term: 'scarce', meaningZh: '稀缺的', key: 'p2', prompt: 'Fresh fruit was ____ in the village during the long winter.', options: ['scarce', 'plentiful', 'cheap', 'sweet'], correct: 0 },
  { alias: 't5', term: 'initiative', meaningZh: '倡议；主动性', key: 'p2', prompt: 'The school launched a new ____ to help students learn practical skills.', options: ['accident', 'initiative', 'argument', 'delay'], correct: 1 },
  { alias: 't6', term: 'resilient', meaningZh: '有韧性的', key: 'p3', prompt: 'After the flood, the ____ town rebuilt its bridge within a month.', options: ['fragile', 'distant', 'resilient', 'modern'], correct: 2 },
];

export const fixtureTargets: GenerationTarget[] = fixtureSpecs.map(({ alias, term, meaningZh }) => ({ id: `id-${alias}`, alias, term, meaningZh }));

// Short filler sentences without targets: 15, 15, 16, 19, 17 and 16 English words.
export const fixtureFillers = [
  'Many people feel hopeful when they see their neighbours working together on a shared goal.',
  'Local newspapers often report on these efforts, although national media rarely pay attention to them.',
  'Teachers say that students become more curious when lessons connect with the world outside the classroom.',
  'Small gestures, such as sharing tools or exchanging seeds, can build trust between people who barely know each other.',
  'Researchers have found that regular conversation reduces loneliness and strengthens a sense of belonging in crowded cities.',
  'Whatever the challenge, progress usually begins with a conversation that everyone feels safe enough to join.',
];

export function fixtureArticle(): GeneratedPractice {
  return {
    title: 'Learning to Live Together',
    paragraphs: fixtureParagraphs.map((text, index) => ({ key: `p${index + 1}`, text })),
    usages: fixtureSpecs.map(({ alias, term, key }) => ({ targetAlias: alias, paragraphKey: key, surfaceForm: term })),
    questions: fixtureSpecs.map(({ alias, meaningZh, prompt, options, correct }) => ({
      targetAlias: alias,
      prompt,
      optionsEn: [...options],
      correctOptionIndex: correct,
      meaningEn: 'the meaning that fits this sentence',
      explanationZh: `${meaningZh}这个词义最符合句子的语境，所以应当选择对应的选项。`,
      optionExplanationsZh: options.map((_, index) => (index === correct ? '符合句子的意思。' : '放进句子后意思不通。')),
      optionExplanationsEn: options.map((_, index) => (index === correct ? 'It fits the sentence.' : 'It does not fit the sentence.')),
    })),
  };
}


/**
 * 316 words: the article with all six fillers spread over the gaps that have room for
 * them, so only the length is wrong. Dropping one filler sentence makes it exactly 300.
 */
export function fixtureOverlongArticle(): GeneratedPractice {
  const [first, second, third, fourth, fifth, sixth] = fixtureFillers as [string, string, string, string, string, string];
  const draft = fixtureArticle();
  draft.paragraphs[0]!.text = draft.paragraphs[0]!.text.replace('As a result, ordinary', `${sixth} As a result, ordinary`);
  draft.paragraphs[1]!.text = `${first} ${second} ${third} ${draft.paragraphs[1]!.text}`;
  draft.paragraphs[2]!.text = draft.paragraphs[2]!.text
    .replace('Communities that remain resilient', `${fourth} Communities that remain resilient`)
    .replace('If more societies followed', `${fifth} If more societies followed`);
  return draft;
}
