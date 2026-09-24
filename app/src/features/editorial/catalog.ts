import { importedEditorialArticles } from './importedArticles';
import { economistSeptember19 } from './issues/economist-2026-09-19';
import { epubArticles, getEditorialAudioUrl } from './epubCatalog';
import type { EditorialAudioCue } from './editorialAudioSync';
import { aiArmsRaceAudioCues } from './audio/aiArmsRaceAudioCues';
import duplicateArticles from './duplicateArticles.json';
import type { PublishedEditorialArticle, PublishedEditorialSummary } from '@context-reader/contracts';
import { resolvePublishedEditorialMedia } from '@/api/editorial';
import {
  getRemoteEditorialDetail,
  getRemoteFeaturedArticleId,
  getRemoteEditorialSummaries,
} from './remoteCatalog';

const aiArmsRaceAudioUrl = getEditorialAudioUrl('ai-arms-race');

export type EditorialSection = 'today' | 'featured';

export type EditorialBodyBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; image: string | number; width: number; height: number };

export interface EditorialArticle {
  id: string;
  titleZh: string;
  titleEn: string;
  summaryZh: string;
  keyPointsZh: readonly string[];
  source: string;
  sourceUrl?: string;
  issueDate?: string;
  bodyBlocks?: readonly EditorialBodyBlock[];
  category: string;
  wordCount: number;
  minutes: number;
  level: string;
  image: string | number;
  figures?: readonly { afterParagraph: number; image: string | number; caption: string }[];
  section: EditorialSection;
  publishedAt: string;
  paragraphs: readonly string[];
  sectionHeadings?: readonly string[];
  /** In-app TTS or remote audio available for full-article listening. */
  hasAudio: boolean;
  /** Optional licensed remote audio URL; when absent, clients may use speech synthesis. */
  audioUrl?: string;
  /** Bundled original article recording. */
  audioAsset?: number;
  audioCues?: readonly EditorialAudioCue[];
}

const allEditorialArticles: readonly EditorialArticle[] = [
  {
    "id": "hero",
    sectionHeadings: [
      "Why do scarlet macaws neglect their youngest chicks?",
      "How wild foster parents help",
      "The flaws in fostering",
      "Flying forward",
    ],
    "titleZh": "拯救绯红金刚鹦鹉：为被忽视的雏鸟寻找养父母",
    "titleEn": "To save scarlet macaws, scientists are rescuing chicks from their lethal parents",
    "summaryZh": "绯红金刚鹦鹉常常放弃喂养最晚孵化的雏鸟。科学家尝试为这些幼鸟寻找野生养父母，让它们学会在雨林中生存，也为种群保护探索新的方法。",
    "keyPointsZh": [
      "亲鸟为什么会忽视最小的雏鸟",
      "野生养父母如何帮助幼鸟存活",
      "寄养救助的成本、局限与改进"
    ],
    "source": "BBC Future",
    "category": "自然",
    "wordCount": 1184,
    "minutes": 8,
    "level": "雅思 6.5",
    "section": "today",
    "image": require('../../../assets/images/editorial/scarlet-macaw-2.jpg') as number,
    "publishedAt": "2026-09-15",
    "hasAudio": true,
    "paragraphs": [
      "Scarlet macaws are an iconic but declining tropical bird. To change the species' fate, scientists are working to counter a lethal parenting method that dooms many chicks to death.",
      "Parker hadn't even opened his eyes when a hand snatched him from his nest.",
      "It was a Monday morning in November 2018 in the Tambopata National Reserve, deep in the Peruvian Amazon, and the featherless chick was frail and underweight, barely longer than a middle finger. He was the youngest of his four scarlet macaw siblings, and that meant he was almost certainly doomed to starve.",
      "Standing at the base of the tree was Gabriela Vigo-Trauco, the Peruvian scientist who orchestrated this abduction.",
      "By studying these birds for over two decades, Vigo-Trauco had discovered that scarlet macaws intentionally starve their youngest chicks. The scientist from Texas A&M University found that almost all third and fourth chicks in multi-egg nests don't make it, and around 25% of second-born chicks meet the same fate.",
      "This brutal parenting approach was once a survival strategy. Now, it is a formidable constraint on recovery for this declining species – with poaching and logging already having driven one sub-species to near extinction across Mexico and Central America.",
      "In 2017, Vigo-Trauco launched a rarely attempted form of rescue-mission, which led her to the chick she named Parker. Her goal was to recruit wild scarlet macaw couples to become foster parents for the doomed chicks. By persuading wild birds to take on the task, she hoped to test out a new lifeline for Peru's neglected offspring – and for the wider species.",
      "Why do scarlet macaws neglect their youngest chicks?",
      "Scarlet macaws are impossible to miss. Their crimson plumage stands out against the forest green, and you can hear their screeches long before you see them.",
      "Each female can lay up to four eggs per season, but usually only one or two fly from the nest.",
      "\"The parents, particularly the mother, pushed [the youngest] away,\" says Vigo-Trauco, who is co-director of The Macaw Society, a Peruvian conservation organisation that first revealed this behaviour, after installing nest-cameras in 2007.",
      "\"The chick is cold and screaming, and when the father comes, he feeds the mother, the [first and second] chicks, and leaves the third one yelling away.\"",
      "There was no sibling bullying, and no link to food availability. So why do the parents neglect their younger chicks?",
      "Vigo-Trauco believes parents can't cope well with chicks at different development stages. Even four or five days between hatching can make a huge difference, with the resulting chicks requiring vastly different feeding regimes and even nest temperatures.",
      "The parents are forced to choose, she says. If they stretch too much to feed them all, there's a risk none will make it.",
      "How wild foster parents help",
      "For the relatively healthy scarlet macaw populations of the Peruvian Amazon, the loss of younger chicks is less consequential. But in countries where conservationists fight poachers and loggers for every bird's survival, Vigo-Trauco says that the death of even a handful of chicks is a disaster.",
      "Raising rejected chicks by hand is one potential solution. But it can take between 1.5 to three months for them to fly away. Plus, parrots raised in captivity have notoriously low survival rates: they struggle to feed in the wild, identify predators and form flocks.",
      "So Vigo-Trauco's team turned to the idea of wild foster parents.",
      "After they seized Parker in 2018, Vigo-Trauco's team hand-fed him in their field station for three weeks, following a relentless two-hour schedule.",
      "They also screened the forest's nests to find the chick a suitable foster family, who would teach him how to live as a wild bird.",
      "The technique had been tested by aviculturists raising macaws in captivity in the past few decades, where conditions are controlled and swapping nests means walking across the hall with a chick. It also builds on experiments involving other wild birds, such as yellow-shouldered parrots in Venezuela in the 1990s.",
      "Parker was finally placed in a new nest on 22 December, and his adoptive mother, Tambo, started preening him straight away.",
      "A few months later, he managed to fledge. He was the only fourth chick to do so in decades of observations of wild nests in Tambopata.",
      "The team found similar success with 25 other chicks they've rescued between 2017 and 2019. A further three were successfully adopted but failed to fly the nest (as they were killed by lighting, a predator and disease).",
      "By 2019, Vigo-Trauco was feeling more confident: \"I felt like playing chess – moving here and there to see what was possible.\"",
      "The flaws in fostering",
      "But while some moves forward can be made with wild foster-parenting, it is also beset by challenges.",
      "It is expensive work. In her three-year experiment in Tambopata, Vigo-Trauco had enough funding to pay salaries, lodging and equipment for a 20-person team. Yet such ambition \"can't be easily replicated\", she says.",
      "It is also hard to pull off.",
      "Rony García-Anleu is director of biological research at the Wildlife Conservation Society in Guatemala. He pioneered the adoption method in the last remaining scarlet macaw populations in Guatemala, and co-authored Vigo-Trauco's paper on fostering.",
      "But the last time García-Anleu's team introduced a bird to a foster nest in Guatemala was in 2019.",
      "Wild fostering requires perfect timing, he says. You need to trek miles into the jungle to locate a nest with a chick in danger. Then quickly find a couple with a suitable nest that is either empty or with one chick of a similar age.",
      "Instead, his team teach the macaws how to fly, feed and bond in a massive cage, then release them when they're ready.",
      "In 1994 in Costa Rica, macaws had also been decimated by deforestation and poaching. But a team led by conservationist Christopher Vaugh began guarding active nests, introducing education sessions in schools and installing artificial nests to improve the supply of suitable nesting sites.",
      "Their effort stabilised and recovered the population – and demonstrated, according to Vaugh, that one must address the root causes of the species' vulnerability: forest loss and poaching.",
      "Flying forward",
      "Despite its flaws, however, the wild fostering technique is now informing work with other species of parrots, from Argentina to Central America, says Vigo-Trauco.",
      "Plus, since 2020 she has been testing a refinement: skipping the hand-rearing phase altogether and moving chicks from one nest to another as soon as they are born.",
      "This new approach requires more monitoring, but less intensive care for newborns – making it cheaper to run. And, in the project's second year, it has already had success: two nests, each with two chicks with large age gaps, were successfully switched up so the parents could raise two similarly aged chicks.",
      "Vigo-Trauco believes this may open the door for fostering in places with fewer resources.",
      "\"It's nice to see that our relatively healthier population allowed us to become a source of knowledge for others,\" says Vigo-Trauco.",
      "As for Parker, he managed to leave the nest and spread his wings. Vigo-Trauco's team saw him once again in September of 2019, now a young and confident macaw flying alongside his adoptive parents and his sibling.",
      "\"It was 'normal' family,\" she says, \"with two fledglings.\""
    ],
    "figures": [
      {
        "afterParagraph": 16,
        "image": require('../../../assets/images/editorial/scarlet-macaw-1.jpg') as number,
        "caption": "Parker was snatched from his nest before he had even opened his eyes (Credit: Gabriela Vigo-Trauco/ The Macaw Society)"
      },
      {
        "afterParagraph": 33,
        "image": require('../../../assets/images/editorial/scarlet-macaw-2.jpg') as number,
        "caption": "Parker, 75 days old, and ready to fledge (Credit: The Macaw Society)"
      }
    ]
  },
  {
    "id": "ai-arms-race",
    "titleZh": "人工智能军备竞赛能被叫停吗？",
    "titleEn": "Can the AI arms race be stopped?",
    "summaryZh": "文章讨论人工智能安全与大国竞争之间的矛盾：技术风险催生暂停研发的呼声，地缘政治竞争却让全面放缓难以实现。作者提出，以安全事件透明披露、网络安全和共享安全研究作为合作起点。",
    "keyPointsZh": [
      "为何人工智能安全与国家竞争难以兼顾",
      "暂停研发协议面临怎样的核查难题",
      "哪些安全合作仍然可能推进"
    ],
    "source": "The Economist",
    "category": "科技",
    "wordCount": 966,
    "minutes": 7,
    "level": "雅思 7.0",
    "image": require('../../../assets/images/editorial/ai-arms-race.jpg') as number,
    "section": "featured",
    "publishedAt": "2026-09-17",
    "issueDate": "2026-09-19",
    "hasAudio": true,
    ...(aiArmsRaceAudioUrl ? { audioUrl: aiArmsRaceAudioUrl } : {}),
    "audioAsset": require('../../../assets/audio/editorial/ai-arms-race.mp3') as number,
    audioCues: aiArmsRaceAudioCues,
    "paragraphs": [
      "TWO THINGS should make you consider what artificial intelligence could mean for humanity. One is that those working with the technology are warning about it leading to a catastrophe—human extinction, even. The other is how technological innovation is aggravating the destruction of Ukraine. These things offer conflicting lessons for whether AI’s rapid progress can or should be slowed down.",
      "For years, leading AI bosses have signalled that their technology could become lethal. Bots may become brainy enough to outwit their creators before they are “aligned” with humanity’s goals and ethics. Bad people could use AI to wreak havoc. These warnings have become more credible as AI agents have escaped their sandboxes during testing, co-ordinated with one another and hacked organisations, including an AI lab itself. Anthropic, one model-maker, has caught people using its models for malign ends, from Mali’s intelligence services getting a mass-surveillance system built, to Houthi rebels in Yemen thought to be writing software for ballistic missiles.",
      "Following the recent resignation of a researcher at Anthropic, public fear of AI doom has spread. In a post viewed more than 170m times, he said that it and OpenAI were “gambling with our lives”. AI is rapidly growing more potent, for good and ill. In May prediction markets priced a less-than-one-third chance of AI solving any millennium prize maths problem before 2030; on September 8th OpenAI said it had solved one of them, causing angst among mathematicians. On September 12th Sam Altman and Elon Musk, two AI titans, endorsed a call by Dario Amodei, the head of Anthropic, to “pace the frontier”, ie, to slow AI’s progress. Those in favour of a slowdown include Bernie Sanders, a left-wing senator, and Steve Bannon, a right-wing populist.",
      "Those opposed include President Donald Trump, whose administration fears more than anything losing America’s lead in AI to China, its only serious rival. Scott Bessent, America’s treasury secretary, has said that if China gains the advantage: “Nothing else would matter.”",
      "As evidence, Mr Bessent could point to Ukraine, where each step in a technological arms race has a swift effect. As we report, Russia has ruthlessly deployed its latest kamikaze drones to bombard civilian infrastructure. As well as being faster, its drones now use one another as a “mesh” communications network to relay information and commands. Soon, Russia will have its own version of Mr Musk’s Starlink satellite network, making its long-range strikes more accurate.",
      "It is the latest demonstration of how even a small technological edge matters in wartime. Ukraine’s own battlefield-drone innovation helped it repel waves of Russian attacks. Ukraine can strike deep into Russia with long-range drones. Both sides are working on swarming drones that will be able to operate more autonomously as a single adaptive system.",
      "The war shows how technology translates into hard power—and that Russia uses it without regard to the old rules or norms of combat. Even if America did not fear a similar hot war with China, a lead in AI would give its main geopolitical rival dominance in hacking, spying and hybrid warfare. Those are not capabilities which America should cede to an authoritarian state with an interest in stamping out liberal ideas.",
      "A pause could therefore work only if China signed up to it, too. Mr Trump plans to host Xi Jinping, China’s president, at the White House on September 24th. But even were Mr Trump seeking to slow down, it is unlikely that Mr Xi would agree to the plan Mr Amodei envisages, because that would freeze Chinese AI in second place. And neither side could risk the other breaching a pact by racing ahead.",
      "For a deal, each would need to verify compliance, as with arms control during the cold war. America, Britain and the Soviet Union banned atmospheric nuclear tests in 1963 because they could detect them; underground tests went on for three more decades until they, too, could be monitored. Alas, though data centres are visible, no verifiable method exists to see inside them. Infrastructure training a superintelligence could masquerade as chatbots answering everyday queries.",
      "The options for a deal on AI safety are therefore limited; but they do exist. More transparency would help. Both sides should pledge to disclose and investigate safety incidents at their labs, using domestic law. Each could signal that they care about safety to build confidence, paving the way for the other side to take precautions. They should also press each other to improve labs’ cyber-security so that AI agents cannot so easily escape sandboxes—and to ensure that, if one does, its lab is financially liable.",
      "Most important is the challenge of ensuring that AI operates in humans’ interests. America and China have very different values, but both know that being ahead is no good if it wipes out humanity. They should promise to share work on the elements of alignment that do not confer a competitive advantage. Knowledge of the best evaluation methods and containment techniques is a global public good. If one side makes an important safety breakthrough, hoarding it makes no sense.",
      "Effective doomerism",
      "Some dismiss the recent wave of doomerism as a marketing ploy by AI companies, or even an attempt to suppress competition. Yet AI progress is fast enough, the safety incidents hair-raising enough, and the warnings of the companies long-standing enough to be taken seriously. AI does not have to kill off every human to bring about a catastrophe. An OpenAI agent swarm targeted a technology company; what if next time it attacks an electrical grid or a weapons system? It might even be intelligent enough to evade attempts to shut it down.",
      "The world must urgently try to forestall this risk. Yet democracies must also avoid losing control to authoritarians. These are difficult and conflicting tasks. They could ultimately lead to war. The stakes could hardly be higher."
    ]
  },
  ...importedEditorialArticles,
  ...economistSeptember19.map((article) => {
    const audioUrl = getEditorialAudioUrl(article.id);
    return audioUrl ? { ...article, audioUrl, hasAudio: true } : article;
  }),
  ...epubArticles,
];

// 按来源链接、正文及合刊内容核对的重复项；列表去重不触发 EPUB 正文懒加载。
const duplicateIds = new Set(Object.keys(duplicateArticles));
export const editorialArticles: readonly EditorialArticle[] = allEditorialArticles.filter(
  (article) => !duplicateIds.has(article.id),
);
// 已有收藏和阅读记录仍可通过原 ID 打开，避免清理列表后历史入口失效。
const articlesById = new Map(allEditorialArticles.map((article) => [article.id, article]));

function toEditorialArticle(
  summary: PublishedEditorialSummary,
  detail?: PublishedEditorialArticle,
): EditorialArticle {
  const source = detail ?? summary;
  return {
    ...source,
    section: summary.section,
    image: resolvePublishedEditorialMedia(source.image),
    ...(source.audioUrl ? { audioUrl: resolvePublishedEditorialMedia(source.audioUrl) } : {}),
    paragraphs: detail?.paragraphs ?? [],
    ...(detail?.bodyBlocks ? {
      bodyBlocks: detail.bodyBlocks.map((block) => block.type === 'image'
        ? { ...block, image: resolvePublishedEditorialMedia(block.image) }
        : block),
    } : {}),
    ...(detail?.figures ? {
      figures: detail.figures.map((figure) => ({
        ...figure,
        image: resolvePublishedEditorialMedia(figure.image),
      })),
    } : {}),
  };
}

function remoteArticles(): EditorialArticle[] {
  return getRemoteEditorialSummaries().map((summary) =>
    toEditorialArticle(summary, getRemoteEditorialDetail(summary.id)));
}

export function getEditorialArticle(id: string): EditorialArticle | undefined {
  const summary = getRemoteEditorialSummaries().find((article) => article.id === id);
  if (summary) return toEditorialArticle(summary, getRemoteEditorialDetail(id));
  const detail = getRemoteEditorialDetail(id);
  if (detail) return toEditorialArticle(detail, detail);
  return articlesById.get(id);
}

export function getFeaturedEditorialArticle(): EditorialArticle | undefined {
  const id = getRemoteFeaturedArticleId();
  return id ? getEditorialArticle(id) : undefined;
}

export function getEditorialSection(section: EditorialSection): EditorialArticle[] {
  const remote = remoteArticles();
  if (!remote.length) return editorialArticles.filter((article) => article.section === section);
  if (section === 'today') return remote.slice(0, 1);
  return [
    ...remote.slice(1),
    ...editorialArticles.filter((article) => article.section === 'today'),
    ...editorialArticles.filter((article) => article.section === 'featured'),
  ];
}

export function searchEditorialArticles(query: string): EditorialArticle[] {
  const normalized = query.trim().toLocaleLowerCase();
  const articles = [...remoteArticles(), ...editorialArticles];
  if (!normalized) return articles;
  return articles.filter((article) =>
    [article.titleZh, article.titleEn, article.source, article.category, article.issueDate ?? article.publishedAt].some(
      (value) => value.toLocaleLowerCase().includes(normalized),
    ),
  );
}

export function editorialCanListen(article: EditorialArticle): boolean {
  return editorialHasOriginalAudio(article) || article.hasAudio;
}

export function editorialHasOriginalAudio(article: EditorialArticle): boolean {
  return Boolean(article.audioAsset || article.audioUrl);
}
