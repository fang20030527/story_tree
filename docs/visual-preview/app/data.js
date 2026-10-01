export const logo = '/app/assets/images/black-hole-english-logo.svg';
export const imageRoot = '/app/assets/images/editorial/';
export const publications = [
  { id:'economist', name:'经济学人', title:'The Economist', sources:['The Economist'] },
  { id:'bbc', name:'BBC', title:'BBC', sources:['BBC Future'] },
  { id:'national-geographic', name:'国家地理', title:'National Geographic', sources:['National Geographic'] },
];
// 订阅页沿用此前原型的套餐示例，本次扩充阅读与口语权益展示。
export const vipPlans = [
  { id:'monthly', name:'月度 VIP', price:19, originalPrice:30, days:30, duration:'30 天' },
  { id:'annual', name:'年度 VIP', price:128, originalPrice:199, days:365, duration:'365 天' },
  { id:'lifetime', name:'永久 VIP', price:198, originalPrice:399, days:null, duration:'长期有效' },
];
export const vipBenefits = [
  { icon:'book', title:'智能阅读陪练', description:'把生词放回新文章，在语境中记得更牢。' },
  { icon:'text', title:'AI 语境查词', description:'结合上下文，读懂此处的准确词义。' },
  { icon:'document', title:'长难句拆解', description:'拆解句子结构，理清每一层意思。' },
  { icon:'headphones', title:'专业语音朗读', description:'跟着声音读文章，同时练习听力与发音。' },
];
export const vipSpeakingBenefits = [
  { icon:'help', title:'台词 AI 讲解', description:'读懂句意、表达和停顿，再把原句说自然。', group:'practice' },
  { icon:'mic', title:'录音跟读', description:'录下自己的声音，回放对照原音。', group:'practice' },
  { icon:'time', title:'无级变速播放', description:'放慢练清楚，加速练流畅，找到自己的节奏。', group:'practice' },
  { icon:'text', title:'字幕自由切换', description:'双语、英文、中文或隐藏字幕，循序渐进。', group:'practice' },
  { icon:'bookmark', title:'台词笔记与句子收藏', description:'留下好句和自己的笔记，随时回来再练。', group:'practice' },
  { icon:'search', title:'字幕内词典查词', description:'遇到生词就地查释义，练习不中断。', group:'practice' },
  { icon:'refresh', title:'单句循环播放', description:'一句一句反复练，把难句说得更顺。', group:'practice' },
  { icon:'video', title:'视频离线下载', description:'提前保存素材，通勤和旅途中也能练。', group:'resources', planned:true },
  { icon:'document', title:'导出 PDF 台词本', description:'把双语字幕整理成台词本，随时复习。', group:'resources', planned:true },
  { icon:'laptop', title:'App 内播放 YouTube 视频', description:'在同一个学习空间，观看视频并练习表达。', group:'resources', planned:true },
  { icon:'headphones', title:'TED 演讲变速播放', description:'按自己的速度学习演讲，积累更丰富的表达。', group:'resources', planned:true },
];

// 学习日志为按本地日期生成的示例，不读取真实学习记录。
export const studyWeekCount=13;
const studyToday=new Date();
studyToday.setHours(12,0,0,0);
const studyStart=new Date(studyToday);
studyStart.setDate(studyStart.getDate()-((studyStart.getDay()+6)%7)-(studyWeekCount-1)*7);
const studyDateKey=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export const studyDays=Array.from({length:studyWeekCount*7},(_,index)=>{
  const date=new Date(studyStart);
  date.setDate(date.getDate()+index);
  const week=Math.floor(index/7);
  const seed=Math.imul(date.getFullYear()*372+date.getMonth()*31+date.getDate(),2654435761)>>>0;
  const future=date>studyToday;
  const recent=(studyToday-date)/86400000<3;
  const minutes=future?0:recent?18+(seed%13):seed%100<(week<4?32:week<8?52:72)?5+((seed>>>8)%36):0;
  return {date:studyDateKey(date),label:`${date.getMonth()+1}月${date.getDate()}日`,fullLabel:`${date.getFullYear()}年${date.getMonth()+1}月${date.getDate()}日`,weekday:`周${'日一二三四五六'[date.getDay()]}`,month:date.getMonth()+1,day:date.getDate(),week,future,today:date.getTime()===studyToday.getTime(),minutes,articles:0,reviews:minutes?2+(seed%9):0,level:minutes===0?0:minutes<=10?1:minutes<=20?2:minutes<=30?3:4};
});
studyDays.filter(day=>day.minutes>0).slice(-12).forEach(day=>{day.articles=1;});
export function getStudyDay(date=state.studySelectedDate){
  const days=state.learningMode==='speak'?speakingStudyDays:studyDays;
  return days.find(day=>day.date===date&&!day.future)||days.find(day=>day.today);
}
export function getStudySummary(){
  const days=(state.learningMode==='speak'?speakingStudyDays:studyDays).filter(day=>!day.future);
  let streak=0;
  for(let index=days.length-1;index>=0&&days[index].minutes>0;index--)streak++;
  return {activeDays:days.filter(day=>day.minutes>0).length,streak};
}
export const glyphs = { back:61739, arrow:61751, add:61703, remove:62756, close:62030, check:61991, search:62819, book:61862, newspaper:62579, library:62390, albums:61712, person:62636, volume:62996, play:62678, pause:62615, settings:62828, time:62942, bookmark:61865, document:62132, link:62393, image:62351, laptop:62381, clipboard:62024, moon:62561, sun:62894, chevron:62015, mail:62516, wechat:62500, headphones:62312, refresh:62744, text:62924, trash:62966, help:62334, shield:62841, upload:62048, camera:61916, checkCircle:61983, radio:62721 };
export const articles = [
  { id:'cat', title:'Meet the first new cat species discovered in 100 years', zh:'百年来首次发现的全新猫科物种', source:'National Geographic', category:'自然', words:1494, minutes:10, image:'new-cat-species-002.jpg', summary:'一百年来，科学家首次确认了一种新的猫科动物。走进南美森林，认识这位小型猎手，了解物种发现与保护之间的联系。' },
  { id:'ai', title:'Can the AI arms race be stopped?', zh:'人工智能军备竞赛能被叫停吗？', source:'The Economist', category:'科技', words:966, minutes:7, image:'ai-arms-race.jpg', summary:'技术风险催生暂停研发的呼声，地缘政治竞争却让全面放缓难以实现。一次关于人工智能安全与国家竞争的讨论。' },
  { id:'viking', title:'The Viking word hidden in the Declaration of American Independence', zh:'藏在美国《独立宣言》中的维京词语', source:'BBC Future', category:'文化', words:1808, minutes:13, image:'viking-word-independence-001.webp', summary:'一个熟悉的英语单词，藏着跨越海洋的漫长旅程。从维京人的语言，走到今天的英语。' },
  { id:'agent', title:'The secret agent with the sketchbook', zh:'拿着速写本的秘密特工', source:'National Geographic', category:'历史', words:2443, minutes:17, image:'secret-agent-sketchbook-011.jpg', summary:'画笔记录风景，也隐藏秘密。翻开一本速写本，重新认识历史中不为人知的情报故事。' },
];
export const words = [
  { word:'resilient', phonetic:'/rɪˈzɪliənt/', type:'adj.', meaning:'有韧性的；能迅速恢复的', status:'在学', due:true, context:'Communities here have proven remarkably resilient through hard winters.', translation:'这里的社区在严冬中展现了出色的韧性。' },
  { word:'migration', phonetic:'/maɪˈɡreɪʃən/', type:'n.', meaning:'迁徙；移居', status:'在学', due:true, context:'The annual migration of moose draws viewers from around the world.', translation:'一年一度的驼鹿迁徙吸引了来自世界各地的观众。' },
  { word:'ambiguous', phonetic:'/æmˈbɪɡjuəs/', type:'adj.', meaning:'模棱两可的；含糊的', status:'未学', due:false, context:'The contract language was ambiguous, leaving both sides uncertain.', translation:'合同用语含糊不清，让双方都无法确定。' },
  { word:'meticulous', phonetic:'/məˈtɪkjələs/', type:'adj.', meaning:'一丝不苟的；细致的', status:'在学', due:false, context:'She kept meticulous notes on every patient the dog visited.', translation:'她详细记录了这只狗探访过的每一位病人。' },
  { word:'momentum', phonetic:'/məˈmentəm/', type:'n.', meaning:'势头；动力', status:'未学', due:false, context:'The livestream gained momentum as more viewers shared it.', translation:'随着更多观众分享，这场直播的热度不断上升。' },
  { word:'frugal', phonetic:'/ˈfruːɡəl/', type:'adj.', meaning:'节俭的；朴素的', status:'已掌握', due:false, context:'His frugal habits left room in the budget for travel.', translation:'他节俭的习惯为旅行留出了预算。' },
];
export const topics = [
  { id:0, category:'自然', title:'A forest finds its way back', zh:'一片森林的重新生长', words:238, time:3 },
  { id:1, category:'生活', title:'The quiet art of doing less', zh:'少做一点，也是一门艺术', words:256, time:4 },
  { id:2, category:'科技', title:'Small tools, big changes', zh:'小工具，大改变', words:221, time:3 },
  { id:3, category:'文化', title:'A language on the move', zh:'语言，也在迁徙', words:247, time:4 },
];
export const quiz = [
  { word:'resilient', sentence:'Even after the storm, the forest was resilient and began to grow again.', question:'In this sentence, “resilient” means…', options:['able to recover after difficulty','likely to disappear quickly','difficult to explore'], answer:0 },
  { word:'migration', sentence:'Each spring, the migration brings thousands of birds back to the lake.', question:'What does “migration” describe here?', options:['building a permanent home','moving from one region to another','learning to survive in winter'], answer:1 },
  { word:'momentum', sentence:'The project gained momentum as more neighbours joined in.', question:'What happened to the project?', options:['It lost its original purpose.','It became more expensive.','It developed more energy and support.'], answer:2 },
];
export const groups = [
  { label:'口语模式与影子跟读', pages:[['speak-profile','我的 · 口语模式'],['speak-materials','素材'],['speak-files','文件'],['speak-overview','跟读素材介绍'],['shadowing','影子跟读'],['speak-import','导入跟读文件'],['speak-subtitles','字幕校正'],['speak-history','跟读记录']] },
  { label:'发现与阅读', pages:[['home','外刊'],['overview','文章介绍'],['reader','阅读与查词'],['shelf','书架'],['recent','最近阅读'],['favorites','我的收藏']] },
  { label:'词库与练习', pages:[['words','词库'],['vocabulary','单词列表'],['practice-setup','新建练习'],['add-words','自定义选词'],['generating','生成中'],['topics','主题短文'],['practice-read','练习阅读'],['quiz','语境自测'],['result','练习结果']] },
  { label:'导入文章', pages:[['import','选择导入方式'],['import-link','网页链接'],['import-paste','粘贴正文'],['import-file','本地文件'],['import-album','图片导入'],['import-computer','电脑上传'],['import-processing','识别与处理'],['import-preview','导入预览']] },
  { label:'我的与设置', pages:[['profile','我的'],['settings','设置'],['login','登录'],['reset','重置密码'],['guide','功能指南'],['vip','VIP 版']] },
];
export const pages = groups.flatMap(g=>g.pages);
export const descriptions = {
  home:'顶部每日精选独立展示；下方发现文章提供主题与外刊两项并列筛选，切换条件或搜索只更新文章列表。原有第二版首页保持独立可访问。',
  shelf:'收藏的外刊、导入的文章和练习，在同一处继续阅读。封面与进度让每篇文章容易找回。',
  words:'从待复习的单词出发。把词放回文章，在新的语境中重新认识它。',
  vocabulary:'英文词形清晰排布，中文释义退后一级。点击单词展开例句与学习状态。',
  overview:'先了解文章，再决定读下去。刊物、篇幅与内容简介各有自己的位置。',
  reader:'正文采用适合长时间阅读的衬线字体。点击带下划线的词，试试释义、例句与加入词库。',
  'practice-setup':'智能选词按复习安排自动选词，设置页不展示具体单词。自定义选词由用户勾选，本次练习使用全部已确认的单词。',
  'practice-read':'目标词留在真实句子中，中文翻译按需展开。读完后进入语境自测。',
  quiz:'以英文语境确认词义。选择答案后即时反馈，也可以诚实地选择“不确定”。',
  result:'关注这一次读懂了多少，以及哪些词值得再见一次。',
  import:'从已有内容开始阅读。链接、正文、图片、文件与电脑上传都有独立流程。',
  profile:'在「我的」顶部切换阅读／口语模式，当前页面保持不变，底部导航立即切换。账号共用，阅读与跟读拥有各自的内容和学习记录。',
  'speak-profile':'在顶部选中「口语」后，底部变为素材／文件／我的。再次选中「阅读」即可恢复外刊／书架／词库／我的。',
  'speak-materials':'独立的影子跟读素材库。按主题筛选，查看素材介绍，再进入跟读；这里的文案和音频控件均为原型示例。',
  'speak-files':'个人音视频与字幕文件。按类型筛选，继续上次跟读，或导入新文件并校正字幕。',
  'speak-overview':'介绍素材的主题、口音、时长和句子。跟读从内容详情进入，底部不额外增加练习入口。',
  shadowing:'参考竞品的功能组织，沿用红粉阅读室设计：媒体预览、双语字幕、收藏、查找、编辑、讲解、词汇与固定播放台。时间轴、逐句及 AB 复读为本地示例；不播放真实音视频、不访问麦克风，不包含发音评分或纠错。',
  'speak-import':'音频、视频与字幕分步导入；有字幕时使用已有字幕，没有时自动生成并允许校正。本页演示本地示例文件，不上传内容。',
  'speak-subtitles':'确认句子与时间轴后加入文件。字幕内容可以直接编辑，编辑后的文字会出现在跟读页。',
  'speak-history':'查看独立的跟读记录，完成示例练习后可以从这里重新进入对应素材。',
  login:'延续品牌图形与留白。表单只演示交互，不会发送或保存你的密码。',
  vip:'阅读与口语共用 VIP。套餐选择前置，权益按阅读／口语切换；口语加入竞品的 11 项卖点，离线、PDF、YouTube 与 TED 标为规划中。价格沿用原型示例，未接入支付或真实权益服务。',
};
export const state = { route:'home', articleId:'cat', topic:0, category:'全部', publication:'all', shelfFilter:'全部', wordFilter:'全部', query:'', saved:new Set(['ai','viking']), added:new Set(['resilient','migration']), mastered:new Set(['frugal']), target:2, smartTarget:2, selectionMode:'smart', selected:new Set(), selectionDraft:new Set(), practiceWords:[], answers:[], quizIndex:0, choice:null, revealed:false, translated:false, fontSize:17, playing:false, loggedIn:false, recent:true, imported:false, importTitle:'The quiet art of paying attention', importText:'', importSource:'粘贴正文', theme:'light', generationFailed:false, importFailed:false, empty:false, vipPlan:'monthly', vipInviteRedeemed:false, studySelectedDate:null };

// 跟读为独立原型数据，所有文件、字幕和录音状态仅存在于当前网页会话。
Object.assign(state, {
  vipBenefitsMode:null,
  learningMode:new URLSearchParams(globalThis.location?.search??'').get('mode')==='speak'?'speak':'read', speechCategory:'全部', speechFileFilter:'全部', speechItemId:'curiosity',
  speechLine:0, speechSpeed:1, speechLoop:false, speechPlaying:false, speechRecording:false,
  speechTakeReady:false, speechTakePlaying:false, speechUploadKind:'audio',
  speechFileSelected:false, speechSubtitleSource:'auto', speechEdits:{}, speechProgress:{},
  speechAutoScroll:true, speechAutoSegment:true, speechSkipSilence:false, speechSubtitleMode:'bilingual',
  speechMask:false, speechRevealed:new Set(), speechSaved:new Set(), speechSavedOnly:false,
  speechExpanded:false, speechSeconds:0, speechAB:null, speechRepeatCount:3, speechGap:1,
  speechFontSize:17, speechCycles:0, speechPauseRemaining:0, speechSearch:'', speechCueOverrides:{},
  speechHistory:[
    { itemId:'curiosity', title:'A little more curiosity', label:'今天 · 08:42', minutes:6, repeats:4 },
    { itemId:'file-morning', title:'My morning routine', label:'昨天 · 21:10', minutes:8, repeats:6 },
    { itemId:'conversation', title:'The art of a good conversation', label:'9 月 28 日 · 19:35', minutes:4, repeats:3 },
  ],
});
Object.assign(glyphs,{mic:62558,folder:62249,repeat:62768,video:62993,music:62570,options:62603});

export const speakingMaterials = [
  { id:'curiosity', title:'A little more curiosity', zh:'把好奇心，说出来', category:'日常表达', accent:'美式', duration:'00:39', tag:'从容表达', color:'pink', origin:'platform', mediaType:'video', summary:'从一个小问题开始，练习自然的停顿与表达节奏。用自己的声音，把日常的好奇说出来。' },
  { id:'conversation', title:'The art of a good conversation', zh:'一场好对话，从倾听开始', category:'访谈对话', accent:'美式', duration:'00:28', tag:'对话节奏', color:'sage', origin:'platform', summary:'在自然的对话中，体会短句、停顿和语调。让每一次回应更轻松。' },
  { id:'small-steps', title:'Small steps, lasting change', zh:'小小一步，也能改变日常', category:'演讲片段', accent:'英式', duration:'00:30', tag:'清晰表达', color:'orange', origin:'platform', summary:'练习清晰地表达一个想法，从小步行动说到长期改变。' },
];
export const speakingFiles = [
  { id:'file-morning', title:'My morning routine', zh:'我的晨间日常', filename:'My morning routine.mp3', category:'音频', accent:'美式', duration:'00:29', status:'ready', origin:'file', color:'pink', progress:2 },
  { id:'file-interview', title:'An interview clip', zh:'一段访谈', filename:'An interview clip.mp4', category:'视频', accent:'美式', duration:'00:28', status:'subtitles', origin:'file', color:'sage', progress:0 },
];
export const speakingLines = [
  { en:'There is always something new to notice.', zh:'总有一些新鲜事，值得我们留意。', start:'00:00', end:'00:05' },
  { en:'A small question can open a much bigger conversation.', zh:'一个小小的问题，可以打开一场更大的对话。', start:'00:06', end:'00:12' },
  { en:'We do not need to have all the answers.', zh:'我们不必拥有所有答案。', start:'00:13', end:'00:18' },
  { en:'Sometimes, it is enough to be curious.', zh:'有时候，保持好奇就已经足够。', start:'00:19', end:'00:24' },
  { en:'Take a moment, and look at things a little differently.', zh:'留出一点时间，试着从不同角度看待事物。', start:'00:25', end:'00:31' },
  { en:'The best ideas often begin with a simple question.', zh:'最好的想法，往往始于一个简单的问题。', start:'00:32', end:'00:39' },
];
export const speakingScripts = {
  curiosity:speakingLines,
  conversation:[
    { en:'A good conversation starts with a little attention.', zh:'一场好的对话，从一点专注开始。', start:'00:00', end:'00:07' },
    { en:'Give the other person time to finish their thought.', zh:'给对方时间，让他们说完自己的想法。', start:'00:07', end:'00:14' },
    { en:'Ask a question that invites a story.', zh:'问一个能引出故事的问题。', start:'00:14', end:'00:21' },
    { en:'You might discover something you never expected.', zh:'你可能会发现意料之外的事情。', start:'00:21', end:'00:28' },
  ],
  'small-steps':[
    { en:'Lasting change rarely happens all at once.', zh:'长久的改变，很少在一瞬间发生。', start:'00:00', end:'00:07' },
    { en:'It begins with one small step that you can take today.', zh:'它始于你今天就能迈出的一小步。', start:'00:07', end:'00:15' },
    { en:'Make that step simple enough to repeat.', zh:'让这一步足够简单，能够坚持重复。', start:'00:15', end:'00:22' },
    { en:'Over time, those small steps become a new habit.', zh:'久而久之，这些小小的步伐会成为新的习惯。', start:'00:22', end:'00:30' },
  ],
  'file-morning':[
    { en:'I like to start my morning with a quiet moment.', zh:'我喜欢用片刻宁静开启早晨。', start:'00:00', end:'00:07' },
    { en:'Before I check my phone, I open the window.', zh:'看手机之前，我会先打开窗户。', start:'00:07', end:'00:14' },
    { en:'A cup of tea helps me slow down and think.', zh:'一杯茶，帮助我放慢节奏，静静思考。', start:'00:14', end:'00:21' },
    { en:'Then I decide what matters most for the day ahead.', zh:'然后，我决定今天最重要的事情是什么。', start:'00:21', end:'00:29' },
  ],
};
speakingScripts['file-interview']=speakingScripts.conversation;
export const getSpeakingItem = (id=state.speechItemId) => speakingFiles.find(item=>item.id===id)||speakingMaterials.find(item=>item.id===id)||(state.speechDraft?.id===id?state.speechDraft:null)||speakingMaterials[0];
export const getSpeakingLines = (id=state.speechItemId) => (speakingScripts[id]||speakingLines).map((line,index)=>({...line,...state.speechCueOverrides[id]?.[index],en:state.speechEdits[id]?.[index]??line.en}));
export const parseSpeechTime = value => String(value).split(':').reduce((sum,part)=>sum*60+Number(part),0);
export const formatSpeechTime = seconds => `${String(Math.floor(Math.max(0,seconds)/60)).padStart(2,'0')}:${String(Math.floor(Math.max(0,seconds)%60)).padStart(2,'0')}`;
export const speechCueKey = (index,id=state.speechItemId) => `${id}:${index}`;
export function getSpeechBlocks(){
  const lines=getSpeakingLines(),size=state.speechAutoSegment?1:2,blocks=[];
  for(let index=0;index<lines.length;index+=size){
    const cues=lines.slice(index,index+size);
    blocks.push({index,endIndex:index+cues.length-1,start:cues[0].start,end:cues.at(-1).end,en:cues.map(cue=>cue.en).join(' '),zh:cues.map(cue=>cue.zh).join(' '),saved:cues.some((_,offset)=>state.speechSaved.has(speechCueKey(index+offset)))});
  }
  return state.speechSavedOnly?blocks.filter(block=>block.saved):blocks;
}
const speechVocabulary = [
  { word:'notice',meaning:'注意到；留意',example:'Notice something new on your way home.' },
  { word:'conversation',meaning:'对话；交谈',example:'A question can start a good conversation.' },
  { word:'curious',meaning:'好奇的',example:'Stay curious about the world around you.' },
  { word:'answers',meaning:'答案；回答',example:'We do not need to have all the answers.' },
  { word:'attention',meaning:'注意力；专注',example:'Give the other person your attention.' },
  { word:'thought',meaning:'想法；思考',example:'Give yourself time to finish a thought.' },
  { word:'invites',meaning:'邀请；引出',example:'Ask a question that invites a story.' },
  { word:'discover',meaning:'发现',example:'You might discover a new idea.' },
  { word:'lasting',meaning:'持久的；长久的',example:'Small steps can lead to lasting change.' },
  { word:'repeat',meaning:'重复',example:'Make the step simple enough to repeat.' },
  { word:'habit',meaning:'习惯',example:'Reading can become a daily habit.' },
  { word:'quiet',meaning:'安静的；平静的',example:'Start the morning with a quiet moment.' },
  { word:'moment',meaning:'片刻；一会儿',example:'Take a moment to slow down.' },
  { word:'ahead',meaning:'在前面；即将到来',example:'Think about the day ahead.' },
];
export const getSpeakingVocabulary = () => {
  const text=getSpeakingLines().map(line=>line.en).join(' ').toLowerCase();
  return speechVocabulary.filter(item=>new RegExp(`\\b${item.word}\\b`,'i').test(text));
};
const curiosityNotes=[
  {phrase:'There is … to …',explanation:'There is 表示「有……」。something new 是新鲜事，to notice 补充说明值得去留意的内容。',rhythm:'There is always / something new / to notice.'},
  {phrase:'open a conversation',explanation:'这里的 open 表示开启或引出。a much bigger conversation 中的 much 修饰比较级 bigger，强调对话可以更深入。',rhythm:'A small question / can open / a much bigger conversation.'},
  {phrase:'do not need to',explanation:'do not need to 表示「不必」，后接动词原形。all the answers 指所有问题的答案。',rhythm:'We do not need / to have / all the answers.'},
  {phrase:'It is enough to …',explanation:'it 作形式主语，真正要表达的是 to be curious：保持好奇已经足够。',rhythm:'Sometimes / it is enough / to be curious.'},
  {phrase:'a little differently',explanation:'Take a moment 是留出一点时间。differently 修饰 look，表示换一种方式看待事物。',rhythm:'Take a moment / and look at things / a little differently.'},
  {phrase:'begin with',explanation:'begin with 表示「始于」。often 表示常常，a simple question 是想法的起点。',rhythm:'The best ideas / often begin / with a simple question.'},
];
export function getSpeakingExplanation(){
  const line=getSpeakingLines()[state.speechLine];
  return state.speechItemId==='curiosity'&&line.en===speakingLines[state.speechLine].en?curiosityNotes[state.speechLine]:{phrase:'理解句意，再跟上节奏',explanation:`这句话表达的是：${line.zh||'先确认自己理解了这句英文，再练习自然表达。'}`,rhythm:line.en};
}
export const speakingStudyDays = studyDays.map(day=>{
  const age=(studyToday-new Date(day.date+'T12:00:00'))/86400000;
  const minutes=!day.future&&age<18&&Math.floor(age)%3!==1?4+((day.day*3)%12):0;
  return {...day,minutes,repeats:minutes?2+(day.day%6):0,level:minutes===0?0:minutes<=5?1:minutes<=10?2:minutes<=15?3:4};
});

// 原型用固定到期标记模拟复习安排；正式客户端使用服务端的 FSRS 结果。
export const getDueWords = () => words.filter(word=>word.due&&!state.mastered.has(word.word));
export const getVipPlan = () => vipPlans.find(plan=>plan.id===state.vipPlan)||vipPlans[0];
export const vipPlanSummary = plan => plan.days?`共 ${plan.duration} · 约 ${(plan.price/plan.days).toFixed(2)} 元 / 天`:'一次开通 · 长期享有全部权益';

// BBC Future 归入 BBC；主题、刊物与搜索在同一份文章集合上取交集。
export function getEditorialArticles(filters=state) {
  const publication=publications.find(item=>item.id===filters.publication);
  const query=filters.query.trim().toLowerCase();
  return articles.filter(article=>{
    const publisher=publications.find(item=>item.sources.includes(article.source));
    return (!publication||publication.sources.includes(article.source))
      && (filters.category==='全部'||article.category===filters.category)
      && (!query||`${article.title} ${article.zh} ${article.source} ${article.category} ${publisher?.name||''}`.toLowerCase().includes(query));
  });
}
