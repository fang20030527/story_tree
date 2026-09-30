import { articles, publications, words, topics, quiz, state, logo, imageRoot, getDueWords, getEditorialArticles, vipPlans, vipBenefits, getVipPlan, vipPlanSummary, studyDays, studyWeekCount, getStudyDay, getStudySummary } from './data.js';
import { esc, icon, go, action, head, brandHead, title, section, primary, bottom, footer, row, tabs, articleRow, empty, field, note, savedButton } from './ui.js';

const article = () => articles.find(a=>a.id===state.articleId) || articles[0];
const topic = () => topics[state.topic] || topics[0];
const result = (header,content,foot='',className='') => ({header,content,footer:foot,className});
const standard = (name,content,foot='',back='home') => result(head(name,back),content,foot);
const endMark = `<div class="end-mark"><img src="${logo}" alt=""><span>读懂一点，积累一点。</span></div>`;
const wordsMarkup = (list,select=false) => list.map(w=>`<button type="button" class="word-row" data-${select?'select-word':'word'}="${w.word}" ${select?`aria-pressed="${state.selectionDraft.has(w.word)}"`:''}><span><strong>${w.word}</strong><small>${w.type} ${w.meaning}</small></span>${select?`<i class="selection-box ${state.selectionDraft.has(w.word)?'checked':''}">${state.selectionDraft.has(w.word)?icon('check'):''}</i>`:`<span class="word-status ${w.due?'due':''}">${state.mastered.has(w.word)?'已掌握':w.due?'待复习':w.status}</span>`}</button>`).join('');

function publicationPicker() {
  return `<div class="editorial-filter-row" role="group" aria-label="选择外刊"><span class="editorial-filter-label">外刊</span><div class="editorial-filter-options publication-options">${[{id:'all',name:'全部外刊'},...publications].map(publication=>action('filter',publication.name,'',`data-key="publication" data-value="${publication.id}" aria-pressed="${state.publication===publication.id}"`)).join('')}</div></div>`;
}

function editorialCover(a) {
  const destination='overview/'+a.id;
  return `<section class="cover-story" data-go="${destination}" aria-label="每日精选"><div class="cover-heading"><span>每日精选</span>${action('save',icon(state.saved.has(a.id)?'check':'bookmark'),'icon-button',`data-id="${a.id}" aria-label="${state.saved.has(a.id)?'取消收藏':'收藏'}：${esc(a.zh)}"`)}</div>${go(destination,`<h3>${a.title}</h3>`,'cover-title')}<div class="cover-image-wrap">${go(destination,`<img src="${imageRoot+a.image}" alt="${esc(a.zh)}">`,'cover-image-button')}${go(destination,icon('arrow'),'read-circle')}</div><div class="cover-caption"><span class="publication">${a.source}</span><span>${a.minutes} 分钟</span></div>${go(destination,a.zh,'cover-title-zh')}<div class="cover-foot"><span>${a.category}</span><span>${a.words.toLocaleString()} 词</span></div></section>`;
}

export function renderEditorialDiscovery() {
  const publication=publications.find(item=>item.id===state.publication);
  const filtered=getEditorialArticles();
  // 每日精选仍可被搜索到，但在文章列表中排后，默认先发现其他文章。
  const list=[...filtered.filter(a=>a.id!=='cat'),...filtered.filter(a=>a.id==='cat')];
  const context=[publication?.name||'全部外刊',state.category==='全部'?'全部主题':state.category].join(' · ');
  const noResults=`<div class="editorial-empty"><span class="editorial-empty-mark">—</span><h3>暂时没有匹配的文章</h3><p>${esc(context)}${state.query?` · “${esc(state.query)}”`:''}</p>${action('reset-editorial-scope',publication?`查看${publication.name}全部文章`:'查看全部主题','secondary full')}${publication?action('reset-editorial','浏览全部外刊','text-button'):''}</div>`;
  const topics=`<div class="editorial-filter-row" role="group" aria-label="文章主题"><span class="editorial-filter-label">主题</span><div class="editorial-filter-options topic-options">${['全部','科技','文化','自然','历史'].map(category=>action('filter',category,'',`data-key="category" data-value="${category}" aria-pressed="${state.category===category}"`)).join('')}</div></div>`;
  return `${section('发现文章',`<span>${list.length} 篇</span>`)}<div class="editorial-filters">${topics}${publicationPicker()}</div>${state.query?`<div class="editorial-search-label"><span>搜索 “${esc(state.query)}”</span>${action('clear-search','清除','text-button')}</div>`:''}<span class="visually-hidden" role="status">${esc(context)}，找到 ${list.length} 篇文章</span><div class="editorial-results">${list.length?list.map(a=>`<div class="article-row">${articleRow(a)}</div>`).join(''):noResults}</div>`;
}

function home() {
  const daily=articles.find(a=>a.id==='cat');
  return result(brandHead(action('search',icon('search'),'icon-button','aria-label="搜索文章"')),`${title('外刊','读英语，也读世界。')}${editorialCover(daily)}<section id="editorial-discovery" class="editorial-discovery" tabindex="-1" aria-label="发现文章">${renderEditorialDiscovery()}</section>${endMark}`,bottom('home'),'editorial-screen');
}

function shelf() {
  const saved=articles.filter(a=>state.saved.has(a.id));
  const showSaved=['全部','外刊'].includes(state.shelfFilter);
  return result(brandHead(go('import','导入','text-button header-text-action')),`${title('书架','把喜欢的，慢慢读完。')}${tabs(['全部','外刊','导入','练习'],state.shelfFilter,'shelfFilter')}${state.empty?empty('书架，还在等第一本','留下一篇想读的文章，随时回来继续。','home','去发现文章'):`
    ${state.shelfFilter==='全部'?`<div class="continue-card"><div class="continue-meta"><span>上次读到这里</span><span>32%</span></div><h3>Can the AI arms<br>race be stopped?</h3><div class="progress-line"><span style="width:32%"></span></div>${go('reader/ai','继续阅读'+icon('arrow'),'continue-link')}</div>`:''}
    ${showSaved?`<div class="books-grid">${saved.map(a=>go('overview/'+a.id,`<div class="book-cover ${a.id==='ai'?'contain':''}"><img src="${imageRoot+a.image}" alt=""><span>${a.source}</span></div><h3>${a.zh}</h3><small>${a.minutes} 分钟 · ${a.id==='ai'?'读到 32%':'未开始'}</small>`,'book-item')).join('')}</div>${!saved.length?empty('还没有收藏的外刊','看到感兴趣的文章，加入书架留着读。','home','去读外刊'):''}`:''}
    ${['全部','导入'].includes(state.shelfFilter)?`<section class="shelf-section">${section('我的导入',go('import','导入文章 +','text-button'))}${go('reader/imported',`<div class="paper-spine">A</div><div><small>个人阅读</small><h3>${esc(state.imported?state.importTitle:'The quiet art of paying attention')}</h3><p>文字导入 · 刚刚</p></div>${icon('chevron')}`,'imported-row')}</section>`:''}
    ${['全部','练习'].includes(state.shelfFilter)?`<section class="shelf-section">${section('阅读练习',go('practice-setup','新建 +','text-button'))}${go('topics',`<span class="practice-symbol">Aa</span><span><strong>一片森林的重新生长</strong><small>4 篇主题短文 · 6 个目标词</small></span>${icon('chevron')}`,'practice-row')}</section>`:''}`}${action('empty-toggle',state.empty?'恢复示例书架':'查看空书架状态','sample-state')}`,bottom('shelf'));
}

function overview() {
  const a=article();
  return result(head('文章介绍','home',action('save',icon(state.saved.has(a.id)?'check':'bookmark'),'icon-button',`data-id="${a.id}" aria-label="收藏文章"`)),`<div class="article-intro"><div class="intro-source">${a.source}<span>${a.category}</span></div><h1>${a.title}</h1><img class="intro-image ${a.id==='ai'?'contain':''}" src="${imageRoot+a.image}" alt="${a.zh}"><h2>${a.zh}</h2><div class="intro-meta"><span>${a.words.toLocaleString()}<small>英文词</small></span><span>${a.minutes}<small>分钟阅读</small></span><span>中阶<small>阅读难度</small></span></div><p class="intro-summary">${a.summary}</p>${section('这一篇，读什么')}<p class="body-small">在文章语境里理解表达。遇到不熟悉的单词，轻点即可查看释义，再把它放进你的词库。</p></div>`,footer(primary('reader/'+a.id,'开始阅读')));
}

function reader(practice=false) {
  const a=article(); const t=topic(); const imported=state.articleId==='imported';
  const heading=practice?t.title:imported?state.importTitle:a.title;
  const fragments=practice?[
    `After a long winter, the forest began to change. Young trees reached for the light, and new leaves appeared on branches that had seemed lifeless. The landscape was more <button class="inline-word" data-word="resilient">resilient</button> than anyone had expected.`,
    `A group of neighbours started to document its return. Every week, they made <button class="inline-word" data-word="meticulous">meticulous</button> notes about the birds, plants and insects they could see. The spring <button class="inline-word" data-word="migration">migration</button> brought familiar sounds back to the valley.`,
    `At first, only a few people joined the walks. But the project gained <button class="inline-word" data-word="momentum">momentum</button> as their photographs reached others. Families came with notebooks instead of phones, ready to look a little closer.`,
    `The changes were small, but they were real. Learning to notice them gave the community a new reason to care for a place they had almost forgotten.`,
  ]:[
    `There is still so much we do not know about the world around us. Sometimes, a discovery begins with a familiar place — and a person willing to look at it differently.`,
    `For the researchers, the work required patience. They kept <button class="inline-word" data-word="meticulous">meticulous</button> records, compared small differences and returned to the same questions again and again. What first seemed <button class="inline-word" data-word="ambiguous">ambiguous</button> slowly became clearer.`,
    `The project gained <button class="inline-word" data-word="momentum">momentum</button> when people from different fields began sharing what they had found. Each observation added another piece to a much larger picture.`,
    `Understanding a living world takes time. It also changes the way we see our place within it: as part of a system that is both remarkably <button class="inline-word" data-word="resilient">resilient</button> and in need of care.`,
  ];
  const translations=practice?['漫长的冬季过后，森林开始改变。幼树向着阳光生长，看似没有生命的枝条上长出了新叶。这片土地比所有人想象的都更有韧性。','一群邻居开始记录它的复苏。他们每周都认真记下看到的鸟类、植物与昆虫。春季迁徙让熟悉的声音回到了山谷。','最初只有几个人加入散步。但随着照片被更多人看到，这个项目逐渐发展起来。人们带着笔记本而不是手机，愿意再仔细看一眼。','变化虽小，却真实存在。学会留意这些变化，让社区重新开始珍惜一个几乎被遗忘的地方。']:['对于身边的世界，我们依然有许多未知。有时，一个发现始于熟悉的地方，以及一个愿意换个角度观察的人。','对研究者而言，这项工作需要耐心。他们认真记录，比较细微差别，反复思考相同的问题。最初模糊的线索逐渐变得清晰。','当不同领域的人开始分享发现，项目渐渐有了动力。每一次观察，都让更大的图景多出一块拼图。','理解生命的世界需要时间，也改变了我们看待自身位置的方式：我们身处的系统韧性出众，也需要细心呵护。'];
  return result(head(practice?'阅读练习':imported?'我的文章':a.source,practice?'topics':imported?'shelf':'overview/'+a.id,action('reader-options',icon('text'),'icon-button','aria-label="阅读设置"')),`<article class="reader" style="--reading-size:${state.fontSize}px"><div class="reader-kicker">${practice?`${t.category} · 主题 ${state.topic+1} / 4`:'英文阅读'}<span>${practice?'约 3':'约 10'} 分钟</span></div><h1>${esc(heading)}</h1><p class="reader-subtitle">${practice?t.zh:imported?'练习把注意力，交还给日常':a.zh}</p><div class="reading-tools">${action('translate',icon('text')+(state.translated?'收起译文':'展开译文'),'tool-button',`aria-pressed="${state.translated}"`)}${action('audio',icon(state.playing?'pause':'play')+(state.playing?'暂停示意':'朗读示意'),'tool-button')}</div>${state.playing?'<div class="audio-strip"><span class="audio-bars"><i></i><i></i><i></i></span><span>朗读控件预览</span><small>不播放真实音频</small></div>':''}<p class="reader-demo">排版示例正文，非刊物原文 · 点击下划线单词查词</p>${fragments.map((p,i)=>`<p class="reading-paragraph ${i===0?'drop-cap':''}">${p}</p>${state.translated?`<p class="translation">${translations[i]}</p>`:''}`).join('')}<div class="article-end">${icon('checkCircle')}<span>你已读完本篇示例</span></div>${endMark}</article>`,footer(practice?primary('quiz','读完了，开始自测'):action('finish-reading','完成阅读'+icon('check'),'primary')),'reader-screen');
}

function wordHome() {
  const due=words.filter(w=>w.due&&!state.mastered.has(w.word));
  const learning=words.filter(w=>w.status==='在学'&&!state.mastered.has(w.word));
  return result(brandHead(),`${title('词库','每个词，都有下次见面。')}<section class="vocabulary-hero"><div class="eyebrow">今天，和这些词再见一面</div><div class="due-number">${due.length}<span>词待复习</span></div><p>在一篇新文章里，把它们读懂。</p>${go('practice-setup','开始今天的练习'+icon('arrow'),'vocab-start')}</section><div class="word-stats">${go('vocabulary','<strong>6</strong><span>全部单词</span>')}${go('vocabulary/在学',`<strong>${learning.length}</strong><span>正在学习</span>`)}${go('vocabulary/已掌握',`<strong>${state.mastered.size}</strong><span>已经掌握</span>`)}</div><section class="shelf-section">${section('我的生词本',go('vocabulary','查看全部','text-button'))}${go('vocabulary',`<div class="word-book"><span>Words<br>in context.</span><img src="${logo}" alt=""></div><div class="word-book-copy"><h3>阅读中遇见的词</h3><p>6 个单词 · 今天新增 2 个</p><span>打开生词本 ${icon('arrow')}</span></div>`,'word-book-row')}</section><section class="shelf-section">${section('待复习')}${wordsMarkup(due)||'<p class="quiet-note">今天的复习已完成，去读一篇新文章吧。</p>'}</section>`,bottom('words'));
}

function vocabulary(select=false) {
  const filtered=words.filter(w=>(state.wordFilter==='全部'||state.wordFilter==='今日新增'&&['resilient','migration'].includes(w.word)||state.wordFilter==='已掌握'&&state.mastered.has(w.word)||state.wordFilter===w.status&&!state.mastered.has(w.word))&&(!state.query||`${w.word}${w.meaning}`.includes(state.query)));
  return result(head(select?'自定义选词':'阅读中遇见的词',select?'practice-setup':'words',select?'':action('search-words',icon('search'),'icon-button','aria-label="搜索单词"')),`${select?`<div class="page-lead compact"><h1>这一次，<br><em>想练哪些词？</em></h1><p>从词库中勾选本次要练习的单词。</p></div><div class="selection-list-heading"><span>已选 ${state.selectionDraft.size} / ${words.length} 词</span>${action('select-all-words',state.selectionDraft.size===words.length?'清空选择':'全部选择','text-button')}</div>`:`<div class="vocabulary-count"><strong>6</strong><span>个单词，在阅读中相遇。</span></div>${tabs(['全部','今日新增','在学','未学','已掌握'],state.wordFilter,'wordFilter')}`}${state.query?`<p class="quiet-note">搜索：${esc(state.query)} ${action('clear-search','清除','text-button')}</p>`:''}<div class="word-list">${wordsMarkup(select?words:filtered,select)}</div>${!select&&!filtered.length?empty('没有匹配的单词','试着搜索其他词形或中文释义。','vocabulary','查看全部单词'):''}${select?note('本次练习将使用全部已确认的单词。'):note('复习安排按单词管理，同词的不同释义共享进度。')}`,footer(select?action('confirm-words',`确认选择（${state.selectionDraft.size} 词）`+icon('arrow'),'primary',state.selectionDraft.size===0?'disabled':''):primary('practice-setup','在文章里复习')));
}

function setup() {
  const smart=state.selectionMode==='smart';
  const dueCount=getDueWords().length;
  const smartCount=Math.min(state.smartTarget,dueCount);
  const canGenerate=smart?dueCount>0:state.selected.size>0;
  const modes=`<section class="selection-modes" aria-labelledby="selection-mode-label"><h2 id="selection-mode-label">选词方式</h2><div class="selection-mode-switch" role="group" aria-label="选词方式">${action('selection-mode','智能选词','',`data-mode="smart" aria-pressed="${smart}"`)}${action('selection-mode','自定义选词','',`data-mode="custom" aria-pressed="${!smart}"`)}</div><p class="selection-mode-description">${smart?'根据记忆曲线，自动选择到期需要复习的单词。':'从词库中勾选，这次想练习的单词由你决定。'}</p></section>`;
  const smartPanel=dueCount?`<div class="target-control"><label for="target-input">这次想复习多少词？</label><div>${action('target-less',icon('remove'),'icon-button',`aria-label="减少词数" ${smartCount<=1?'disabled':''}`)}<input id="target-input" type="number" min="1" max="${dueCount}" value="${smartCount}" aria-label="目标词数">${action('target-more',icon('add'),'icon-button',`aria-label="增加词数" ${smartCount>=dueCount?'disabled':''}`)}</div><span>词</span></div><div class="automatic-selection-note">${icon('time')}<span>当前有 ${dueCount} 个词待复习，系统自动安排。</span></div>`:`<div class="selection-empty"><strong>今天没有待复习的单词</strong><p>可以稍后回来，也可以切换到自定义选词。</p></div>`;
  const customPanel=`${go('add-words',`<span><strong>${state.selected.size?`已选 ${state.selected.size} 个单词`:'选择练习单词'}</strong><small>${state.selected.size?'本次使用全部已选单词':'从你的词库中选择'}</small></span><span>${state.selected.size?'编辑选择':'去选词'} ${icon('chevron')}</span>`,'custom-selection-entry')}${state.selected.size?`<div class="target-words custom-word-preview">${[...state.selected].map(w=>`<span>${esc(w)}</span>`).join('')}</div>`:''}`;
  return standard('新建阅读练习',`<div class="page-lead"><p class="accent-label">WORDS INTO STORIES</p><h1>把单词，<br>放回<em>文章里。</em></h1><p>换一个语境，让记忆多一个落点。</p></div>${modes}${smart?smartPanel:customPanel}<div class="practice-promise"><div><strong>4</strong><span>不同主题</span></div><div><strong>200–300</strong><span>每篇英文词数</span></div></div>`,footer(action('start-generation',(!canGenerate?(smart?'暂无待复习单词':'请先选择单词'):'生成阅读练习')+icon('arrow'),'primary',canGenerate?'':'disabled')),'words');
}

function generating() {
  return standard('准备阅读练习',`<div class="process-page"><div class="process-wordmark">Words<br><span>become stories.</span></div><h1>${state.generationFailed?'暂时没能生成':'故事正在准备中'}</h1><p>${state.generationFailed?'本次未消耗练习次数。稍后再试，单词还在等你。':'你的单词，将出现在四个不同的世界里。'}</p><ol class="process-steps"><li class="complete">${icon('check')}<span>选好这一轮的 ${state.target} 个单词</span></li><li class="${state.generationFailed?'failed':'active'}">${icon(state.generationFailed?'close':'radio')}<span>${state.generationFailed?'生成暂时中断':'正在编写不同主题的短文'}</span></li><li>${icon('radio')}<span>检查词义与阅读题目</span></li></ol>${state.generationFailed?action('retry-generation','重新生成'+icon('refresh'),'primary'):primary('topics','查看生成完成效果')}${action('generation-failure',state.generationFailed?'查看生成中状态':'查看生成失败状态','sample-state')}</div>`,'','practice-setup');
}

function topicList() {
  return standard('本轮阅读练习',`<div class="page-lead"><p class="accent-label">A DIFFERENT CONTEXT</p><h1>四个故事，<br><em>再次遇见。</em></h1><p>${state.target} 个目标词 · 选择感兴趣的主题开始</p></div><div class="topic-list">${topics.map((t,i)=>go('practice-read/'+i,`<span class="topic-category">${t.category}</span><h3>${t.title}</h3><div class="topic-bottom"><span>${t.zh}<small>${t.words} 词 · ${t.time} 分钟</small></span>${icon('arrow')}</div>`,'topic-card topic-'+i)).join('')}</div>`,'','shelf');
}

function quizScreen() {
  const q=quiz[state.quizIndex]; const correct=state.choice===q.answer;
  return standard('语境自测',`<div class="quiz-progress"><span>读懂这个词</span><span>${state.quizIndex+1} / ${quiz.length}</span></div><div class="quiz-bars">${quiz.map((_,i)=>`<span class="${i<=state.quizIndex?'done':''}"></span>`).join('')}</div><div class="quiz-word">${q.word}</div><blockquote class="quiz-context">${q.sentence.replace(q.word,`<em>${q.word}</em>`)}</blockquote><p class="quiz-question">${q.question}</p><div class="quiz-options">${q.options.map((o,i)=>action('answer',`<span>${String.fromCharCode(65+i)}</span><span>${o}</span>${state.revealed&&i===q.answer?icon('check'):''}`,`quiz-option ${state.choice===i?'selected':''} ${state.revealed&&i===q.answer?'correct':''} ${state.revealed&&state.choice===i&&!correct?'wrong':''}`,`data-choice="${i}" ${state.revealed?'disabled':''}`)).join('')}</div>${state.revealed?`<div class="answer-feedback ${correct?'positive':''}"><strong>${correct?'读懂了，就是这个意思。':'再看一次，让词义更清晰。'}</strong><p>${words.find(w=>w.word===q.word).meaning}。回到原句，留意它前后的线索。</p></div>`:action('unsure','不确定，看看释义','unsure')}`,footer(state.revealed?action('next-question',state.quizIndex===quiz.length-1?'查看本轮结果'+icon('arrow'):'下一题'+icon('arrow'),'primary'):action('reveal-answer','确认答案'+icon('arrow'),'primary',state.choice===null?'disabled':'')),'practice-read/'+state.topic);
}

function results() {
  const correct=state.answers.length?state.answers.filter(a=>a.correct).length:2;
  const all=state.answers.length?state.answers.length:3;
  return standard('练习结果',`<section class="result-hero"><p>读完一篇，也前进一步。</p><h1>A little more<br><em>understood.</em></h1><div class="result-number">${correct}<span>/ ${all}</span></div><span>个单词，已在语境中读懂</span></section><div class="result-summary"><span>${icon('checkCircle')}完成阅读</span><span>${all-correct} 词借助提示</span></div><section class="shelf-section">${section('把这些词，带去下一次')}${quiz.map((q,i)=>`<div class="result-word"><strong>${q.word}</strong><span>${state.answers.length?(state.answers[i]?.correct?'独立答对':'需要再练'):(i===2?'需要再练':'独立答对')}</span></div>`).join('')}</section>${note('结果与复习安排为原型演示，不会写入真实词库。')}`,footer(primary('topics','再读一个主题')+go('words','回到词库','footer-secondary')),'topics');
}

function imports() {
  return standard('导入文章',`<div class="page-lead"><p class="accent-label">YOUR NEXT READ</p><h1>想读的，<br><em>都带进来。</em></h1><p>把遇见的好文章，变成自己的阅读材料。</p></div><div class="import-options">${row('link','网页链接','import-link','复制网址，让文章回到阅读本身')}${row('clipboard','粘贴正文','import-paste','一段文字，就是一篇新阅读')}${row('image','相册图片','import-album','从截图或照片中提取文字')}${row('document','本地文件','import-file','导入文档，继续在这里读')}${row('laptop','从电脑上传','import-computer','大文件，交给电脑来传')}</div>${note('内容仅用于演示导入流程，不会上传或解析真实文件。')}`,'','shelf');
}

function importForm(mode) {
  const isLink=mode==='link';
  return standard(isLink?'从链接导入':'粘贴文章',`<div class="page-lead compact"><h1>${isLink?'一条链接，<br><em>一篇新阅读。</em>':'留下一段，<br><em>想读的文字。</em>'}</h1></div><form id="import-form">${isLink?field('文章链接','url','https://example.com/article','url'):field('文章标题','title','为文章起个名字','text',state.importText?state.importTitle:'')} ${!isLink?`<label class="field"><span>英文正文 <small>20–5,000 词</small></span><textarea name="body" placeholder="把想读的英文正文粘贴在这里…">${esc(state.importText)}</textarea></label><div class="input-meta"><span id="word-count">${state.importText.trim()?state.importText.trim().split(/\s+/).length:0} 词</span>${action('fill-sample','填入示例','text-button')}</div>`:note('预览仅校验链接格式，不会请求网址。提交后展示同一篇示例文章。')}${isLink?action('fill-link','填入示例链接','text-button'):''}<p id="form-error" role="alert" class="form-error"></p></form>`,footer(action('submit-import','预览导入效果'+icon('arrow'),'primary',`data-mode="${mode}"`)),'import');
}

function importAsset(mode) {
  const file=mode==='file';
  return standard(file?'本地文件':'图片导入',`<div class="page-lead compact"><h1>${file?'从文档，<br><em>走进文章。</em>':'拍下的文字，<br><em>也可以精读。</em>'}</h1><p>${file?'选择一个文档，提取其中的英文内容。':'让一张截图，变成可以查词的文章。'}</p></div><div class="asset-drop">${icon(file?'document':'image')}<strong>${file?'导入示例文档':'添加示例图片'}</strong><p>${file?'A quiet morning.pdf · 268 KB':'reading-note.jpg · 1 张'}</p>${action('sample-asset',file?'选择示例 PDF':'选择示例图片','secondary',`data-mode="${mode}"`)}</div><div class="instruction-list"><p>${file?'支持文字型 PDF 和文本类文档。':'多张图片会按添加顺序合并识别。'}</p><p>单个文件不超过 10 MB，单批不超过 30 MB。</p><p>${file?'扫描件可通过图片导入。':'尽量保证文字清晰，避免阴影与倾斜。'}</p></div>${note('此按钮使用内置示例演示流程，不读取你的本地文件。')}`,'','import');
}

function importComputer() {
  return standard('从电脑上传',`<div class="page-lead compact"><h1>大屏上传，<br><em>随身阅读。</em></h1><p>在电脑端打开上传页面，输入手机上显示的上传码。</p></div><div class="computer-code"><span>示例上传码</span><strong>DEMO 4X7Q2M</strong><p>演示码不可用于实际上传</p></div><ol class="numbered-instructions"><li><span>1</span><div>在电脑打开上传页<small>正式上传入口将在连接服务后提供</small></div></li><li><span>2</span><div>输入上传码，选择文件<small>上传码有效期为 10 分钟</small></div></li><li><span>3</span><div>回到手机，确认导入<small>在这里预览并保存文章</small></div></li></ol>`,footer(action('computer-uploaded','模拟电脑已上传'+icon('arrow'),'primary')),'import');
}

function importProcessing() {
  return standard('处理文章',`<div class="process-page"><div class="process-wordmark">Make room<br><span>for a good read.</span></div><h1>${state.importFailed?'这次提取没有完成':'让文章，准备好被阅读。'}</h1><p>${state.importFailed?'可能是来源内容暂时无法读取。可以重试，或换一种导入方式。':'正在提取正文、整理段落，并识别文章标题。'}</p><ol class="process-steps"><li class="complete">${icon('check')}<span>已接收${esc(state.importSource)}</span></li><li class="${state.importFailed?'failed':'active'}">${icon(state.importFailed?'close':'radio')}<span>提取与整理英文正文</span></li><li>${icon('radio')}<span>生成阅读预览</span></li></ol>${state.importFailed?action('retry-import','重新处理'+icon('refresh'),'primary'):primary('import-preview','查看处理完成效果')}${action('import-failure',state.importFailed?'查看处理状态':'查看失败状态','sample-state')}</div>`,'','import');
}

function importPreview() {
  return standard('确认导入',`<div class="import-preview-label">${icon('checkCircle')}<span>文章已准备好</span></div><div class="import-preview-title"><span>文章标题</span><input id="import-title" aria-label="编辑导入标题" value="${esc(state.importTitle)}"><span>可以修改后再加入书架</span></div><div class="import-metadata"><span>268 词</span><span>约 3 分钟</span><span>${esc(state.importSource)}</span></div><div class="preview-excerpt"><p>The quiet art of paying attention begins with something simple: noticing what is already there.</p><p>On a morning walk, the familiar street can become a different place. A tree has new leaves. A window reflects the sky. Someone pauses to say hello.</p><p>We do not always need a new destination. Sometimes, we only need to look again.</p></div>${note('以上为固定示例内容，仅展示处理完成后的版式。')}`,footer(action('confirm-import','确认，加入书架'+icon('arrow'),'primary')),'import');
}

export function renderStudyDayDetail(){
  const day=getStudyDay();
  return `<span class="study-detail-date">${day.label} ${day.weekday}${day.today?' · 今天':''}</span><span class="study-detail-activity">${day.minutes?`阅读 ${day.articles} 篇 · 复习 ${day.reviews} 词 · ${day.minutes} 分钟`:'这天还没有学习记录'}</span>`;
}

function studyLog(){
  const selected=getStudyDay(),summary=getStudySummary();
  const months=[...new Map(studyDays.filter((day,index)=>!day.future&&(index===0||day.day===1)).map(day=>[day.week,day])).values()];
  return `<section class="study-log" id="study-log" aria-labelledby="study-log-title"><div class="study-log-heading"><h2 id="study-log-title">学习日志</h2><span>近 ${studyWeekCount} 周</span></div><div class="study-calendar"><div class="study-months" aria-hidden="true">${months.map(day=>`<span style="grid-column:${day.week+1}">${day.month}月</span>`).join('')}</div><div class="study-weekdays" aria-hidden="true">${['一','','三','','五','','日'].map(label=>`<span>${label}</span>`).join('')}</div><div class="study-grid" role="group" aria-label="每日学习情况" aria-describedby="study-log-keyboard">${studyDays.map(day=>day.future?'<span class="study-day is-future" aria-hidden="true"></span>':action('study-day','',`study-day level-${day.level}${day.today?' is-today':''}`,`data-date="${day.date}" aria-label="${day.fullLabel} ${day.weekday}${day.today?' 今天':''}，${day.minutes?`学习 ${day.minutes} 分钟，阅读 ${day.articles} 篇，复习 ${day.reviews} 词`:'没有学习记录'}" aria-pressed="${day.date===selected.date}" tabindex="${day.date===selected.date?0:-1}"`)).join('')}</div></div><div class="study-log-footer"><span>已学习 ${summary.activeDays} 天 · 连续 ${summary.streak} 天</span><span class="study-legend" aria-label="颜色越深，学习时间越长"><span>少</span>${[0,1,2,3,4].map(level=>`<i class="level-${level}" aria-hidden="true"></i>`).join('')}<span>多</span></span></div><div class="study-day-detail" id="study-log-detail" role="status" aria-live="polite">${renderStudyDayDetail()}</div><span id="study-log-keyboard" class="visually-hidden">点选方格查看当天记录；键盘上下方向键切换相邻日期，左右方向键切换同一星期几。</span></section>`;
}

function profile() {
  const vipEntry=go('vip',`<span class="profile-vip-description">升级为 VIP 版，解锁全部功能</span><span class="profile-vip-cta">立即开通 ${icon('arrow')}</span>`,'profile-vip-entry');
  const header=`<header class="account-page-header"><h1>我的</h1>${go('settings',icon('settings')+'<span>设置</span>','account-settings')}</header>`;
  const identity=go('login',`<span class="account-avatar">${icon('person')}</span><span class="account-identity"><strong>${state.loggedIn?'阅读者':'未登录'}</strong><small>${state.loggedIn?'查看与管理账号':'登录后同步阅读记录与词库'}</small></span><span class="account-login-action">${state.loggedIn?'账号':'去登录'}${icon('chevron')}</span>`,'account-login-row');
  const stats=`<section class="account-records" aria-labelledby="account-records-title"><h2 id="account-records-title">学习记录</h2><div class="account-stat-grid">${go('recent','<strong>12</strong><span>已读文章</span>')}${go('words',`<strong>${words.length}</strong><span>词库单词</span>`)}${go('vocabulary/已掌握',`<strong>${state.mastered.size}</strong><span>已掌握</span>`)}</div></section>`;
  const shortcuts=`<div class="account-shortcuts">${go('recent',icon('time')+`<span><strong>最近阅读</strong><small>${state.recent?'继续上次的阅读':'还没有阅读记录'}</small></span>`,'account-shortcut')}${go('favorites',icon('bookmark')+`<span><strong>我的收藏</strong><small>${state.saved.size} 篇已收藏</small></span>`,'account-shortcut')}</div>`;
  const menu=`<section class="account-content" aria-labelledby="account-content-title"><h2 id="account-content-title">我的内容</h2>${shortcuts}<div class="account-menu">${row('book','阅读练习','topics','',`${topics.length} 篇主题短文`)}${row('document','导入文章','import','','添加阅读材料')}${row('help','功能指南','guide')}</div></section>`;
  return result(header,`${identity}${vipEntry}${stats}${studyLog()}${menu}`,bottom('profile'),'account-screen');
}

function settings() {
  return standard('设置',`<div class="settings-group"><p class="group-label">阅读偏好</p><div class="settings-row"><span>外观</span><div class="segmented">${action('light','浅色','',`aria-pressed="${state.theme==='light'}"`)}${action('dark','深色','',`aria-pressed="${state.theme==='dark'}"`)}</div></div><div class="settings-row"><span>正文字号</span><div class="font-control">${action('font-less','A−','icon-button','aria-label="缩小字号"')}<span>${state.fontSize}</span>${action('font-more','A+','icon-button','aria-label="放大字号"')}</div></div></div><div class="settings-group"><p class="group-label">账户与数据</p>${row('person','账号','login','',state.loggedIn?'已登录':'未登录')}${action('clear-history',`${icon('trash')}<span class="menu-copy"><strong>清空最近阅读</strong></span>${icon('chevron')}`,'menu-row')}</div><div class="settings-group"><p class="group-label">关于</p>${row('help','使用指南','guide')}<div class="settings-row"><span>当前版本</span><span class="muted">0.1.0</span></div></div>${endMark}`,'','profile');
}

function login() {
  return standard('账号','<div class="login-brand"><img src="'+logo+'" alt="黑洞英语"><h1>每一次阅读，<br>都算数。</h1><p>登录后，继续你的词汇积累。</p></div>'+`<form id="login-form">${field('邮箱','email','reader@example.com','email')}${field('密码','password','至少 8 位','password')}<p class="form-error" id="form-error" role="alert"></p>${action('login','体验登录效果'+icon('arrow'),'primary')}<p class="login-hint">首次登录会自动创建账号</p></form>${go('reset','忘记密码？','text-button password-link')}<div class="login-divider"><span>也可以</span></div>${action('wechat',icon('wechat')+' 微信登录','secondary full')}${action('guest','先以访客身份阅读','guest-link')}${note('原型只展示登录成功状态；请输入示例信息，密码不会发送或保存。')}`,'','profile');
}

function reset() {
  return standard('重置密码',`<div class="page-lead"><h1>把阅读，<br><em>接着读下去。</em></h1><p>${state.resetStep?'输入邮箱中的验证码，设置新的密码。':'输入账号邮箱，我们会向你发送验证码。'}</p></div><form id="reset-form">${field('邮箱','email','reader@example.com','email',state.resetEmail||'')}${state.resetStep?field('验证码','code','演示验证码：123456')+field('新密码','password','至少 8 位','password'):''}<p class="form-error" id="form-error" role="alert"></p>${action(state.resetStep?'confirm-reset':'request-reset',state.resetStep?'预览重置成功'+icon('arrow'):'模拟发送验证码'+icon('arrow'),'primary')}</form>${state.resetStep?action('request-reset','重新发送示例验证码','guest-link'):''}${note('原型不发送邮件、不变更密码。请仅填写示例信息体验此流程。')}`,'','login');
}

function readingList(favorite=false) {
  const list=favorite?articles.filter(a=>state.saved.has(a.id)):state.recent?articles.slice(0,3):[];
  return standard(favorite?'我的收藏':'最近阅读',list.length?`<div class="page-lead compact"><h1>${favorite?'好文章，<br><em>留着慢慢读。</em>':'读过的世界，<br><em>还在这里。</em>'}</h1><p>${list.length} 篇文章</p></div>${list.map(a=>`<div class="article-row">${articleRow(a)}${favorite?action('save','取消收藏','list-remove',`data-id="${a.id}"`):''}</div>`).join('')}`:empty(favorite?'收藏夹还是空的':'还没有阅读记录',favorite?'遇见好文章时，点一下书签把它留下。':'从今天的一篇文章开始吧。','home','去读外刊'),'','profile');
}

function guide() {
  return standard('功能指南',`<div class="page-lead"><p class="accent-label">READ. NOTICE. REMEMBER.</p><h1>读进去，<br><em>记下来。</em></h1><p>不是把词背过，而是在阅读中用起来。</p></div><div class="guide-list">${[['book','从一篇好文章开始','发现外刊，或导入自己的材料。','home','去读外刊'],['text','遇到生词，轻点一下','查看释义与例句，把想学的词加入词库。','reader','试试查词'],['albums','换个语境，再见一次','从词库生成不同主题的短文，在语境自测中确认理解。','practice-setup','开始练习']].map(([i,h,p,r,t])=>`<section>${icon(i)}<h3>${h}</h3><p>${p}</p>${go(r,t+icon('arrow'),'read-link')}</section>`).join('')}</div>`,'','profile');
}

function vip() {
  const selected=getVipPlan();
  const hero=`<section class="vip-hero"><div class="vip-hero-heading"><div><h1>解锁全部<br><em>阅读特权</em></h1><p>从读懂一篇，到读懂更多。</p></div><span class="vip-wordmark" aria-hidden="true">VIP</span></div></section>`;
  const benefits=`<section class="vip-benefits" aria-labelledby="vip-benefits-title"><div class="vip-section-heading"><h2 id="vip-benefits-title">让每一次阅读，都有收获</h2><span>不限次数</span></div><ul>${vipBenefits.map(benefit=>`<li>${icon(benefit.icon)}<div><h3>${benefit.title}</h3><p>${benefit.description}</p></div></li>`).join('')}</ul></section>`;
  const plans=`<fieldset class="vip-plans"><legend>选择你的 VIP</legend><div class="vip-plan-options">${vipPlans.map(plan=>`<label class="vip-plan"><input class="visually-hidden" type="radio" name="vip-plan" value="${plan.id}" ${selected.id===plan.id?'checked':''}><span class="vip-plan-card"><span class="vip-plan-name">${plan.name}</span><span class="vip-plan-price"><small>¥</small>${plan.price}</span><span class="vip-plan-original"><span class="visually-hidden">参考原价</span><s>¥${plan.originalPrice}</s></span><span class="vip-plan-discount">早鸟 ${Number((plan.price/plan.originalPrice*10).toFixed(1))} 折</span><span class="vip-plan-check" aria-hidden="true">${icon('check')}</span></span></label>`).join('')}</div><p class="vip-plan-summary" role="status">${vipPlanSummary(selected)}</p></fieldset>`;
  const foot=footer(`<div class="vip-purchase">${action('vip-checkout',`<span>立即开通 <strong>¥${selected.price}</strong></span>${icon('arrow')}`,'primary vip-activate')}<div class="vip-purchase-note"><span>支付成功即生效 · 不自动续费</span>${action('vip-help','订阅说明','text-button')}</div>${action('vip-redeem',`邀请码兑换${icon('chevron')}`,'vip-redeem-entry')}</div>`);
  return result(head('开通 VIP','profile'),hero+benefits+plans,foot,'vip-screen');
}

export function renderScreen(route=state.route) {
  const screens={home,shelf,overview,reader,words:wordHome,vocabulary, 'add-words':()=>vocabulary(true),'practice-setup':setup,generating,topics:topicList,'practice-read':()=>reader(true),quiz:quizScreen,result:results,import:imports,'import-link':()=>importForm('link'),'import-paste':()=>importForm('paste'),'import-file':()=>importAsset('file'),'import-album':()=>importAsset('album'),'import-computer':importComputer,'import-processing':importProcessing,'import-preview':importPreview,profile,settings,login,reset,recent:()=>readingList(false),favorites:()=>readingList(true),guide,vip};
  return (screens[route]||home)();
}
