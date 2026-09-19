import type { EditorialAudioCue } from './editorialAudioSync';
import { aiArmsRaceAudioCues } from './audio/aiArmsRaceAudioCues';

export type EditorialSection = 'today' | 'featured' | 'daily' | 'kids';

export interface EditorialArticle {
  id: string;
  titleZh: string;
  titleEn: string;
  summaryZh: string;
  keyPointsZh: readonly string[];
  source: string;
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

const image = (id: string) =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=900&q=70`;

export const editorialArticles = [
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
    "hasAudio": true,
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
  {
    id: "n1",
    titleZh: "通胀在全球回归，抗通胀之战也随之回来",
    titleEn: "Inflation Is Back Around the World—as Is the Fight Against It",
    summaryZh: "通胀压力在多个经济体重新抬头，各国央行被迫重新考虑加息与紧缩节奏。",
    keyPointsZh: ["通胀回归的共同驱动", "央行为何重新转鹰", "价格稳定与增长之间的取舍"],
    source: "黑洞英语编辑部",
    category: "快讯",
    wordCount: 266,
    minutes: 3,
    level: "六级",
    section: "daily",
    image: image("1457369804613-52c61a468e7d"),
    publishedAt: "2026-09-06",
    hasAudio: true,
    paragraphs: [
      "Inflation that seemed to be retreating has regained force in several economies. Food, energy, and services prices again test household budgets. Central banks that hoped to declare victory are revisiting rate paths and communication strategies.",
      "Common drivers include lingering supply constraints, wage pressures in tight labor markets, and geopolitical shocks to commodities. Expectations matter: if firms and workers believe price rises will persist, they set wages and prices accordingly, making inflation stickier.",
      "Tighter policy can cool demand, but it also risks slowing growth and raising unemployment. Officials must weigh credibility against pain. Acting too slowly may force sharper hikes later; acting too bluntly may crush investment that economies need.",
      "Households experience inflation unevenly. Renters and low-income families often feel food and housing costs first. Aggregate indexes can understate that lived experience, which is why public trust erodes quickly when leaders sound complacent.",
      "The renewed fight against inflation is therefore political as well as technical. Governments may add targeted relief while banks raise rates, creating mixed signals. Clear explanation of trade-offs helps more than optimistic slogans.",
      "Inflation's return does not mean history is repeating exactly. It does mean price stability cannot be taken for granted, and the tools of restraint are back on the table.",
      "Currency markets react within minutes to inflation prints, while wage contracts move slowly. That mismatch can amplify volatility when surprises land.",
      "Historians note that inflation fights leave political scars: parties associated with high prices can lose trust for years after indexes cool.",
      "Readers can practice chart literacy by separating headline inflation from core measures that exclude food and energy swings.",
    ],
  },
  {
    id: "n2",
    titleZh: "就业末日被推迟了，AI 就业热潮正在到来",
    titleEn: "The Jobs Apocalypse Is Postponed. An AI Jobs Boom Is Here",
    summaryZh: "测算显示 AI 相关建设与工程岗位增长显著，但客服与行政岗位仍承压。",
    keyPointsZh: ["AI 岗位创造来自哪里", "裁员与新增为何同时发生", "数据中心建设对劳动力市场的影响"],
    source: "黑洞英语编辑部",
    category: "快讯",
    wordCount: 287,
    minutes: 3,
    level: "考研",
    section: "daily",
    image: image("1518709268805-4e9042af9f23"),
    publishedAt: "2026-09-04",
    hasAudio: true,
    paragraphs: [
      "Predictions that artificial intelligence would instantly erase white-collar work have not matched recent labor data. In some measures, AI-related construction, electrical work, and engineering have added large numbers of jobs, even as certain support roles shrink.",
      "Data-center building booms create demand for trades as well as software talent. Chip fabs, power upgrades, and cooling systems need people who do not write models. At the same time, customer-service and routine administrative tasks face automation pressure. Aggregate employment can rise while specific occupations fall.",
      "This coexistence explains why headlines conflict. One story celebrates an AI jobs boom; another mourns layoffs blamed on chatbots. Both can be true in different segments. Workers displaced from one role may not automatically qualify for the new openings without training.",
      "Policy responses include apprenticeships for electrification and computing infrastructure, portable benefits for contractors, and clearer disclosure when AI is used in hiring or firing. Education systems that only train prompt-writing will miss the physical layer of the boom.",
      "Companies also bear responsibility. Using AI to cut costs without investing in reskilling shifts the burden onto communities. Measuring net job creation should include job quality, not only headcount.",
      "The jobs apocalypse may be postponed, but transition pain is real. An AI boom that ignores the losers will invite backlash that slows the very technologies firms want to deploy.",
      "Regional differences are stark: areas hosting new data centers see construction hiring, while call-center towns see attrition. National averages hide both stories.",
      "Immigration rules for specialized trades can bottleneck the physical AI buildout even when software talent is abundant.",
      "Career counselors increasingly map 'AI-adjacent' paths that are neither pure coding nor pure manual labor—a useful middle for many students.",
    ],
  },
  {
    id: "n3",
    titleZh: "我在街区寻找监控摄像头，发现的比想象多得多",
    titleEn: "I Found Far More Surveillance Cameras Than I Expected",
    summaryZh: "记者随监督组织在街区清点摄像头，介绍公共与私人监控叠加，以及公众可用的监控地图工具。",
    keyPointsZh: ["公共与私人监控如何叠加", "监控平台的争议", "居民怎样自查周边摄像头"],
    source: "黑洞英语编辑部",
    category: "快讯",
    wordCount: 278,
    minutes: 3,
    level: "六级",
    section: "daily",
    image: image("1497366216548-37526070297c"),
    publishedAt: "2026-09-02",
    hasAudio: true,
    paragraphs: [
      "A journalist walking one neighborhood with a civil-liberties group counted cameras on doorbells, storefronts, poles, and building corners. The total far exceeded casual expectation. Many lenses were private; some fed networks that police can query.",
      "Public and private surveillance now overlap. A resident may accept a doorbell camera for package theft, then discover footage can be shared widely. Mapping projects try to make the density visible so communities can ask who watches, how long files are kept, and whether oversight exists.",
      "Technology firms market automatic license-plate readers and cloud storage as safety tools. Critics argue that always-on collection chills ordinary life and risks misuse. Courts and city councils are still catching up with rules designed for a less sensor-saturated world.",
      "Practical steps for residents include checking local ordinances, using public maps where available, and questioning landlords about camera policies. Security and privacy need not be absolute opposites, but silence favors the cameras.",
      "The emotional effect of the count matters too. Feeling watched changes how people gather, protest, or simply walk home. Democracy depends on spaces that are not permanently recorded.",
      "Finding more cameras than expected is not paranoia; it is an invitation to set limits before the next layer of sensors arrives.",
      "School board meetings about cameras on campuses replay the same trade-off: deterrence versus constant recording of children. Policies written for adults transfer poorly to playgrounds.",
      "Encryption and on-device storage can shrink the blast radius of a breach, but only if vendors enable them by default.",
      "A neighborhood audit can start with a walk and a notebook; technology is optional for the first map of how watched a block already feels.",
    ],
  },
  {
    id: "n4",
    titleZh: "火箭部件撞上月球，仪器看到了什么",
    titleEn: "What Instruments Saw When a Rocket Part Hit the Moon",
    summaryZh: "上面级按预测撞击月球后，轨道器拍下撞击前后对比，望远镜在尘埃羽流中检测到化学信号。",
    keyPointsZh: ["月球撞击如何被确认", "尘埃羽流中的化学指纹", "太空垃圾责任问题"],
    source: "黑洞英语编辑部",
    category: "快讯",
    wordCount: 266,
    minutes: 3,
    level: "六级",
    section: "daily",
    image: image("1446776811953-b23d57bd42aa"),
    publishedAt: "2026-08-07",
    hasAudio: true,
    paragraphs: [
      "A spent rocket stage struck the Moon roughly where models predicted. Orbiters compared before-and-after images and identified a fresh crater. Telescopes watching the impact plume reported chemical fingerprints such as sodium and lithium mixed into the dust.",
      "Uncontrolled impacts are becoming more common as launch rates rise. Each strike is a scientific opportunity and a governance problem. Who is responsible for debris that alters another world's surface? Guidelines exist, but enforcement across commercial and national actors is uneven.",
      "Scientists value the data: crater size tests regolith models, and plume chemistry hints at surface composition. Yet relying on accidental crashes is a poor substitute for designed experiments. Better tracking of upper stages can reduce surprises.",
      "Public audiences often treat lunar impacts as spectacle. The quieter issue is cumulative damage to scientifically precious sites and to future landing safety. A crater field is not endless free real estate.",
      "International discussion now links planetary protection with orbital debris rules. Transparent reporting of predicted impact times and locations is a minimum courtesy. Designing stages to miss the Moon or burn safely is better.",
      "What instruments saw when the rocket part hit was both a physics lesson and a warning: human hardware already writes on other worlds, whether we plan the handwriting or not.",
      "Amateur astronomers sometimes catch impact flashes, contributing timestamps that professionals refine. Citizen timing still helps when official sensors look elsewhere.",
      "Legal scholars debate whether celestial bodies should host 'keep-out' scientific reserves similar to Antarctic special zones.",
      "The chemical signals in a plume are fleeting; preparedness to observe matters as much as the crash itself.",
    ],
  },
  {
    id: "n5",
    titleZh: "计划中的卫星发射可能毁掉哈勃图像",
    titleEn: "Planned Satellite Launches Could Ruin Hubble Space Telescope Images",
    summaryZh: "模拟显示，大规模卫星星座可能显著影响天基望远镜的观测质量。",
    keyPointsZh: ["卫星轨迹如何进入图像", "天文观测的时间窗口", "商业星座与公共科学的冲突"],
    source: "黑洞英语编辑部",
    category: "快讯",
    wordCount: 252,
    minutes: 3,
    level: "六级",
    section: "daily",
    image: image("1451187580459-43490279c0fa"),
    publishedAt: "2025-12-03",
    hasAudio: true,
    paragraphs: [
      "Simulations of planned satellite megaconstellations suggest that hundreds of thousands of objects could cross the fields of view of space telescopes. Hubble and other observatories already deal with streaks; larger fleets would multiply interruptions.",
      "The damage is not only aesthetic. Clean observing time is scarce. A streak through a long exposure can ruin a dataset that took years to schedule. Filtering helps, but it cannot recover photons that never arrived unspoiled.",
      "Commercial connectivity and Earth observation bring real benefits. The conflict is about coordination: brightness limits, orbital shells, and shutters timed to avoid critical observations. Without standards, science becomes collateral damage.",
      "Astronomers propose darker satellites, fewer reflective surfaces, and shared calendars. Operators worry about cost and coverage. Regulators sit between innovation rhetoric and treaty-era space law that never imagined mega-fleets.",
      "Public support for astronomy depends on wonder as well as papers. Images laced with satellite trails teach a different lesson about the night sky—one of congestion. That cultural loss is harder to price than a single failed exposure.",
      "Planned launches could degrade Hubble-class imaging unless mitigation keeps pace with deployment. The sky is a shared laboratory, and laboratories need rules.",
      "Radio astronomy faces related interference from downlink chatter, showing that spectrum and orbital space are twin commons.",
      "Some operators already darken satellites after public pressure; voluntary steps can move faster than treaties, yet they remain uneven.",
      "Students can compare night-sky photos from a decade apart to see congestion enter the frame—an accessible intro to space policy.",
    ],
  },
  {
    id: "n6",
    titleZh: "月球形成可能需要早期地球遭遇三次大撞击",
    titleEn: "Forming Moon May Have Taken Three Big Impacts Early in Earth’s History",
    summaryZh: "新模型挑战“一次大撞击形成月球”的传统图景，认为多次撞击序列或许更符合地球与月球的化学相似性。",
    keyPointsZh: ["大碰撞假说的证据", "三次撞击模型想解释什么", "同位素相似性为何关键"],
    source: "黑洞英语编辑部",
    category: "快讯",
    wordCount: 270,
    minutes: 3,
    level: "六级",
    section: "daily",
    image: image("1447433589675-4aaa566f3f05"),
    publishedAt: "2025-12-03",
    hasAudio: true,
    paragraphs: [
      "The classic story of the Moon's origin is a single giant impact: a Mars-sized body struck early Earth, and debris coalesced into our satellite. The model explains much, yet chemical similarities between Earth and Moon remain awkwardly close for one random collision.",
      "A newer family of models explores multiple large impacts instead of one perfect hit. Three substantial collisions, in sequence, might mix materials more thoroughly and still leave a moon-sized companion. Computer simulations test whether angular momentum and isotopes can fit.",
      "No simulation is destiny. Each assumes starting compositions, timings, and viscosities that are imperfectly known. Sample return missions and refined isotope measurements will accept or reject variants. The scientific virtue is willingness to reopen a settled-sounding story.",
      "For students, the debate models how planetary science works. A compelling narrative survives until anomalies accumulate; then alternatives compete on quantitative grounds. 'Multiple impacts' is not a slogan but a set of testable numbers.",
      "Public communication should avoid false certainty. Saying we 'know' exactly how the Moon formed overstates the case. Saying we have strong, evolving hypotheses is more accurate and more interesting.",
      "Whether one impact or three built the Moon, the larger truth stands: Earth's companion is a product of violence and mixing in the young solar system, and its rocks still argue with our theories.",
      "Isotope ratios of oxygen and titanium are among the fingerprints that single-impact models struggle to match without fine-tuning.",
      "Multiple-impact stories may also explain asymmetries in the lunar interior inferred from quakes and gravity mapping.",
      "Uncertainty here is productive: it keeps sample-return missions scientifically urgent rather than ceremonial.",
    ],
  },
  {
    id: "n7",
    titleZh: "批电影改编后，译者从零重译《奥德赛》",
    titleEn: "A Translator Starts Over on the Odyssey After Harsh Film Criticism",
    summaryZh: "一位广受赞誉的译者宣布将重新翻译这部史诗，风格更接近其《伊利亚特》译本。",
    keyPointsZh: ["重译为何不是小修小补", "史诗翻译中的节奏与称谓", "影视改编与文本距离"],
    source: "黑洞英语编辑部",
    category: "文化",
    wordCount: 266,
    minutes: 3,
    level: "雅思 6.5",
    section: "daily",
    image: image("1481627834876-b7833e8f5570"),
    publishedAt: "2026-08-31",
    hasAudio: true,
    paragraphs: [
      "A celebrated translator of Homer announced she would retranslate the Odyssey from scratch rather than patch famous lines. The decision followed blunt criticism of a blockbuster adaptation, but the deeper motive is artistic: keeping the poem strange, swift, and morally unsettling in English.",
      "Retranslation is not vanity. Each generation hears different registers of power, gender, and violence. Word choices for gods, slaves, and hospitality rituals shape how readers judge characters. A translator who starts over accepts years of labor to make those judgments coherent.",
      "Film adaptations compress and smooth. Epic poetry thrives on repetition, epithets, and sudden shifts of tone. When a movie is called 'abysmal' by a translator, the complaint may be about ethical flattening as much as plot changes. The page and the screen answer different constraints.",
      "Readers benefit from multiple translations side by side. Comparing openings reveals philosophy. One version may prioritize speed; another music; another scholarly precision. No single English Odyssey owns the poem.",
      "The project also models intellectual courage: admitting that even a praised earlier version can be surpassed by a new approach. Craft improves through revisiting, not defending, past choices.",
      "Starting over on the Odyssey after harsh film criticism is finally about responsibility to the text. Adaptation will continue; so must translation that refuses to make Homer merely familiar.",
      "Classroom units that pair a film scene with two translations teach students how medium changes moral emphasis.",
      "Publishers sometimes resist retranslation because catalogs already shelve a 'definitive' version; artistic restlessness pushes back.",
      "Listening to oral performances of epic lines reminds readers that Homer lived in ears before books—and may again.",
    ],
  },
  {
    id: "k1",
    titleZh: "这只孤儿小象如何逆转发运",
    titleEn: "How This Orphaned Elephant Defied the Odds",
    summaryZh: "国家公园救助了孤儿非洲森林象幼崽；当地森林象数量稀少，长期目标是断奶后放归野外。",
    keyPointsZh: ["孤儿象救助为何困难", "森林象与草原象的区别", "放归野外前要满足什么条件"],
    source: "黑洞英语编辑部",
    category: "少儿",
    wordCount: 290,
    minutes: 3,
    level: "中考",
    section: "kids",
    image: image("1557050543-4d5f4e07ef46"),
    publishedAt: "2026-09-03",
    hasAudio: true,
    paragraphs: [
      "In a national park in Nigeria, rangers are raising an orphaned forest elephant calf. His name means 'survivor' in the Ijaw language. Forest elephants are smaller and rarer than savanna elephants, and only a few hundred may remain in that region.",
      "Orphan care is hard. Calves need special milk, constant company, and protection from stress. Without a herd, they miss lessons about where to find food and how to behave around other elephants. Keepers try to replace some of that teaching while planning for a wild future.",
      "The long-term hope is to return him after weaning if the habitat is safe enough. That decision depends on health, poaching risk, and whether he can join other elephants. Release is a goal, not a promise written on day one.",
      "Visitors who hear the story can help by supporting parks and refusing illegal ivory. Watching from a distance matters too; stress from crowds can harm young animals. Conservation succeeds when people treat wildlife as neighbors with needs, not toys.",
      "Forest elephants shape forests by opening paths and spreading seeds. Saving even one calf is small against habitat loss, yet it keeps genetic and cultural knowledge alive in the herd that may form around him.",
      "How this orphaned elephant defied the odds is still an unfinished story. Each healthy month is a quiet victory built by rangers who show up every day.",
      "Keepers record weight, playfulness, and how he responds to other elephant sounds played from speakers. Those notes guide whether socialization is progressing.",
      "Local students who visit on field trips learn that forests need elephants as gardeners, not only as icons on posters.",
      "Protecting corridors between forest patches may matter more than any single rescue, yet the calf makes the stakes visible.",
    ],
  },
  {
    id: "k2",
    titleZh: "看百万条鲻鱼在大西洋里成群移动",
    titleEn: "Witness Millions of Mullet Swarming in the Atlantic",
    summaryZh: "每年秋冬，大量条纹鲻鱼沿海岸迁徙；禁用缠绕网具后种群恢复，使这场迁徙成为壮观的海洋鱼类移动。",
    keyPointsZh: ["鲻鱼为什么成群迁徙", "渔具禁令如何帮助恢复", "观看野生动物时要保持距离"],
    source: "黑洞英语编辑部",
    category: "少儿",
    wordCount: 239,
    minutes: 3,
    level: "中考",
    section: "kids",
    image: image("1535591273668-578e31182c4f"),
    publishedAt: "2026-09-09",
    hasAudio: true,
    paragraphs: [
      "Each autumn and winter, striped mullet gather in huge schools along the Florida coast. From boats or beaches, the water can seem packed with silver bodies moving together. The migration is one of North America's great fish spectacles.",
      "Mullet move for spawning and feeding. Predators follow, and so do careful fishers. Decades ago, certain entangling nets hurt populations badly. After Florida restricted those gears, numbers rebounded enough for the swarms to impress visitors again.",
      "Watching wildlife still requires manners. Boats that chase schools can exhaust fish. People who cast nets illegally undo recovery. The best view is often the one that leaves animals free to pass.",
      "Scientists track timing and size of runs to understand ocean conditions. Warming water and coastal building can shift routes. A spectacular year does not guarantee the next, which is why monitoring continues.",
      "For young readers, the lesson is hopeful: rules can heal. A ban that seemed narrow changed what millions of fish—and thousands of people—experience in the Atlantic.",
      "Witness millions of mullet if you can, then leave them the space their recovery earned.",
      "Birds, dolphins, and sharks may appear near the schools, creating a food web students can sketch from observation.",
      "Climate shifts could move the timing of runs earlier or later, so 'every autumn' is a pattern under watch, not a guarantee.",
      "Photographers who stay on piers instead of chasing by boat still bring home dramatic images—and calmer fish.",
    ],
  },
  {
    id: "k3",
    titleZh: "这颗小行星其实是两块粘在一起的太空岩石",
    titleEn: "This Asteroid Is Actually Two Conjoined Space Rocks",
    summaryZh: "探测器飞掠小行星时拍到特写：它像花生一样由两块岩石相接，属于“相接双星”，数据将帮助行星防御研究。",
    keyPointsZh: ["相接双星是什么", "近距离拍照能测到什么", "小行星形状为何影响防御"],
    source: "黑洞英语编辑部",
    category: "少儿",
    wordCount: 251,
    minutes: 3,
    level: "中考",
    section: "kids",
    image: image("1462331940025-496dfbfc7564"),
    publishedAt: "2026-07-08",
    hasAudio: true,
    paragraphs: [
      "Close-up photos from a spacecraft flyby show that asteroid Torifune looks like a peanut. Two rocky lobes are stuck together. Scientists call this shape a contact binary: two bodies that gently joined and stayed connected.",
      "Shape matters for planetary defense. A solid sphere responds differently to a push than a rubble pile or a peanut made of two parts. If we ever need to nudge an asteroid away from Earth, models must match reality.",
      "Flyby cameras also measure brightness and surface texture. Those clues hint at composition and history. Contact binaries may form when two objects spiral together after a breakup or gentle collision.",
      "Students can picture gravity as a weak glue in small worlds. On asteroids, you would not stand as you do on Earth; a hop might send you into space. That fragility is why shapes tell stories of soft crashes in the past.",
      "Future missions may visit similar objects to test sampling and anchoring. What we learn from Torifune feeds both curiosity and safety planning.",
      "Two conjoined space rocks are a reminder that the solar system builds strange sculptures—and that knowing their forms could one day protect our own planet.",
      "Models show that a weak connection between lobes could break under a hard shove, creating two smaller hazards instead of one.",
      "Art classes sometimes sculpt contact binaries from clay to help younger students feel why shape changes motion.",
      "Space agencies publish flyby timelines so Earth telescopes can watch too, turning one mission into a global classroom.",
    ],
  },
  {
    id: "k4",
    titleZh: "养狗可能通过微生物组让我们更友善",
    titleEn: "Dogs May Make Us More Caring by Changing Our Microbiome",
    summaryZh: "新研究提示，养狗似乎会以可能提升幸福感的方式改变人体微生物生态，但因果关系仍需更多证据。",
    keyPointsZh: ["微生物组是什么", "宠物如何改变家庭环境", "相关性与因果性的差别"],
    source: "黑洞英语编辑部",
    category: "少儿",
    wordCount: 266,
    minutes: 3,
    level: "中考",
    section: "kids",
    image: image("1583511655857-d19b40a7a54e"),
    publishedAt: "2025-12-03",
    hasAudio: true,
    paragraphs: [
      "Dogs share our sofas, sidewalks, and sometimes our beds. Along the way they share microbes from fur, paws, and saliva. A new study suggests those microbial exchanges might relate to human social traits and well-being, though proof of cause is still missing.",
      "The microbiome is the community of tiny organisms living on and in us. It helps digest food and train immune systems. Pets change the household ecosystem by bringing outdoor microbes inside and by altering how families spend time.",
      "Researchers must separate correlation from causation. Families who choose dogs may already differ in income, exercise, or sociability. A study can find links without proving that dogs make people kinder. Good science states that limit clearly.",
      "Even with uncertainty, many benefits of dogs are obvious: companionship, routines for walks, and comfort for some children and elders. Hygiene still matters; washing hands after play remains wise.",
      "If future experiments confirm microbial pathways to mood, veterinarians and doctors might collaborate on advice for pet-friendly homes. Until then, enjoy dogs for the friends they are, not as living probiotic pills.",
      "Dogs may make us more caring in ways we feel every day. Whether microbes are part of that story is a question scientists are only beginning to answer carefully.",
      "Allergy-prone households should ask clinicians before adopting pets; microbial stories do not erase individual medical advice.",
      "Shelter dogs need homes regardless of microbiome headlines. The science, if confirmed, would be a bonus—not the reason to care.",
      "Families can keep simple experiments: note sleep and mood for a month after adopting, while remembering anecdotes are not proof.",
    ],
  },
] as const satisfies readonly EditorialArticle[];

export function getEditorialArticle(id: string): EditorialArticle | undefined {
  return editorialArticles.find((article) => article.id === id);
}

export function getEditorialSection(section: EditorialSection): EditorialArticle[] {
  return editorialArticles.filter((article) => article.section === section);
}

export function searchEditorialArticles(query: string): EditorialArticle[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [...editorialArticles];
  return editorialArticles.filter((article) =>
    [article.titleZh, article.titleEn, article.source, article.category].some(
      (value) => value.toLocaleLowerCase().includes(normalized),
    ),
  );
}

export function editorialCanListen(article: EditorialArticle): boolean {
  return Boolean(article.audioAsset || article.audioUrl) || article.hasAudio;
}
