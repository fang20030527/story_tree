export const logo = '/app/assets/images/black-hole-english-logo.svg';
export const imageRoot = '/app/assets/images/editorial/';
export const publications = [
  { id:'economist', name:'经济学人', title:'The Economist', sources:['The Economist'] },
  { id:'bbc', name:'BBC', title:'BBC', sources:['BBC Future'] },
  { id:'national-geographic', name:'国家地理', title:'National Geographic', sources:['National Geographic'] },
];
// 仅用于订阅页原型的套餐示例，价格参考用户提供的竞品截图。
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
  return studyDays.find(day=>day.date===date&&!day.future)||studyDays.find(day=>day.today);
}
export function getStudySummary(){
  const days=studyDays.filter(day=>!day.future);
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
  profile:'学习记录下方用近 13 周的学习热力图记录每日学习量，点选日期查看阅读、复习与学习时长。当前日志为本地示例。',
  login:'延续品牌图形与留白。表单只演示交互，不会发送或保存你的密码。',
  vip:'四项阅读权益、三档套餐与开通确认。价格和权益参考竞品做原型展示，等待产品定价确认；未接入支付，不会扣款。',
};
export const state = { route:'home', articleId:'cat', topic:0, category:'全部', publication:'all', shelfFilter:'全部', wordFilter:'全部', query:'', saved:new Set(['ai','viking']), added:new Set(['resilient','migration']), mastered:new Set(['frugal']), target:2, smartTarget:2, selectionMode:'smart', selected:new Set(), selectionDraft:new Set(), practiceWords:[], answers:[], quizIndex:0, choice:null, revealed:false, translated:false, fontSize:17, playing:false, loggedIn:false, recent:true, imported:false, importTitle:'The quiet art of paying attention', importText:'', importSource:'粘贴正文', theme:'light', generationFailed:false, importFailed:false, empty:false, vipPlan:'monthly', vipInviteRedeemed:false, studySelectedDate:null };

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
