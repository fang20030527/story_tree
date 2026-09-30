import { state, pages, groups, descriptions, words, quiz, logo, getDueWords, vipPlans, getVipPlan, vipPlanSummary, studyDays } from './data.js';
import { esc, icon, go, action, field, note } from './ui.js';
import { renderScreen, renderEditorialDiscovery, renderStudyDayDetail } from './screens.js';

const $ = selector => document.querySelector(selector);
const screen=$('#screen'), phone=$('#phone'), sheet=$('#sheet');
let toastTimer, focusBeforeSheet, galleryOpen=false;
const labels=new Map(pages);
const sampleText='The quiet art of paying attention begins with something simple: noticing what is already there. On a morning walk, the familiar street can become a different place. A tree has new leaves. A window reflects the sky. Someone pauses to say hello. We do not always need a new destination. Sometimes, we only need to look again.';
const related={home:['overview','reader','shelf'],shelf:['import','recent','topics'],words:['vocabulary','practice-setup','quiz'],reader:['overview','vocabulary'],profile:['login','settings','vip'],'practice-setup':['add-words','generating','topics'],topics:['practice-read','quiz','result'],import:['import-paste','import-computer','import-preview']};
const motionPreference=matchMedia('(prefers-reduced-motion: reduce)');
const touchCardSelector='.cover-story,.continue-card,.vocabulary-hero';
const cardTouch={gesture:null,effect:null,pressTimer:null,clearTimer:null,actionTimer:null,blockedClick:null,lastTap:null};

$('#page-links').innerHTML=groups.map(g=>`<section class="page-group"><h2>${g.label}</h2>${g.pages.map(([r,t])=>go(r,t)).join('')}</section>`).join('');
$('#page-select').innerHTML=groups.map(g=>`<optgroup label="${g.label}">${g.pages.map(([r,t])=>`<option value="${r}">${t}</option>`).join('')}</optgroup>`).join('');
$('#page-count').textContent=pages.length+' 页';

function fitPreview(){
  const chrome=innerWidth<=700?130:151;
  $('.preview').style.setProperty('--preview-scale',Math.max(.38,Math.min(1,(innerHeight-chrome)/830)));
}

function render(preserveScroll=false){
  resetCardTouch();
  const scroll=screen.scrollTop;
  const page=renderScreen();
  $('#screen-header').innerHTML=page.header;
  screen.innerHTML=page.content;
  screen.className='screen-scroll '+page.className;
  screen.setAttribute('aria-label',labels.get(state.route)+'内容');
  $('#screen-footer').innerHTML=page.footer;
  phone.dataset.theme=state.theme;
  phone.dataset.route=state.route;
  $('#theme-toggle').textContent=state.theme==='dark'?'浅色':'深色';
  $('#theme-toggle').setAttribute('aria-label',state.theme==='dark'?'切换浅色模式':'切换深色模式');
  $('#page-select').value=state.route;
  $('#current-page-label').textContent=labels.get(state.route);
  $('#note-title').textContent=labels.get(state.route);
  $('#note-desc').textContent=descriptions[state.route]||'沿用红粉阅读室的视觉语言。你可以在手机里继续操作，也可以从左侧直接跳转，查看每一个页面。';
  $('#note-links').innerHTML=(related[state.route]||['home','words','profile']).map(r=>go(r,labels.get(r)+icon('arrow'))).join('');
  document.querySelectorAll('.page-group [data-go]').forEach(el=>{
    if(el.dataset.go===state.route)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');
  });
  screen.scrollTop=preserveScroll?scroll:0;
  document.title=labels.get(state.route)+' · 黑洞英语页面原型';
  // 多端原型在内容更新后同步导航与阅读工具，手机界面不注册此监听。
  document.dispatchEvent(new CustomEvent('prototype:render',{detail:{route:state.route}}));
}

function syncPlatformLinks(){
  const names={'8768':'手机','8769':'iPad','8770':'小程序','8771':'Web'};
  document.querySelectorAll('nav[aria-label="切换平台原型"] a').forEach(link=>{
    const destination=new URL(link.href);
    if(!names[destination.port])return;
    destination.hash=location.hash||'#home';
    link.href=destination.href;
    link.textContent=names[destination.port];
    if(destination.origin===location.origin)link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  });
}

function readRoute(){
  syncPlatformLinks();
  const [route,id]=decodeURIComponent(location.hash.slice(1)||'home').split('/');
  if(route==='pro'){location.replace('#vip');return;}
  if(route==='gallery'){showGallery(true);return;}
  showGallery(false);
  const next=labels.has(route)?route:'home';
  if(next!==state.route){state.query='';state.playing=false;}
  if(['overview','reader'].includes(next))state.articleId=id||'cat';
  if(next==='practice-read')state.topic=Math.max(0,Math.min(3,Number(id)||0));
  if(next==='quiz'&&state.route!=='quiz')resetQuiz();
  if(next==='add-words'&&state.route!=='add-words')state.selectionDraft=new Set(state.selected);
  if(next==='vocabulary')state.wordFilter=['在学','已掌握','未学','今日新增'].includes(id)?id:'全部';
  state.route=next;
  closeSheet(false);
  render();
}

function refreshEditorialDiscovery(reveal=false){
  if(state.route!=='home'){render();return;}
  const discovery=$('#editorial-discovery');
  const active=document.activeElement;
  const wasInside=discovery.contains(active);
  const key=active?.dataset?.key, value=active?.dataset?.value;
  const scroll=screen.scrollTop;
  // 筛选只重绘每日精选下方的内容，保留封面节点与当前浏览位置。
  discovery.innerHTML=renderEditorialDiscovery();
  if(wasInside){
    const focus=[...discovery.querySelectorAll('[data-action="filter"]')].find(button=>button.dataset.key===key&&button.dataset.value===value);
    (focus||discovery).focus({preventScroll:true});
  }
  screen.scrollTop=scroll;
  if(reveal)discovery.scrollIntoView({block:'start'});
}

function navigate(route){
  closeSheet(false);
  showGallery(false);
  if(location.hash==='#'+route)readRoute();else location.hash=route;
}

function showGallery(show){
  if(show)resetCardTouch();
  galleryOpen=show;
  $('#workbench').hidden=show;
  $('#gallery').hidden=!show;
  $('#gallery-toggle').textContent=show?'返回交互':'页面总览';
  if(show){
    const order=['home','shelf','words','profile',...pages.map(([r])=>r).filter(r=>!['home','shelf','words','profile'].includes(r))];
    $('#gallery-grid').innerHTML=order.map(r=>{
      const p=renderScreen(r);
      const markup=`${p.header}<div class="screen-scroll ${p.className}">${p.content}</div>${p.footer}<div class="home-indicator"><span></span></div>`.replace(/\sid="[^"]*"/g,'');
      return `<article class="gallery-item"><div class="gallery-frame"><div class="phone-shell gallery-phone" data-route="${r}" aria-hidden="true" inert>${markup}</div><a href="#${r}" aria-label="打开${labels.get(r)}原型"></a></div>${go(r,labels.get(r)+icon('arrow'),'gallery-open')}</article>`;
    }).join('');
    document.title='页面总览 · 黑洞英语页面原型';
    window.scrollTo(0,0);
  }else $('#gallery-grid').innerHTML='';
}

function toast(message){
  clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').classList.add('visible');
  toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),2300);
}

function openSheet(title,content){
  if(!sheet.open)focusBeforeSheet=document.activeElement;
  sheet.innerHTML=`<div class="sheet-handle" aria-hidden="true"></div><div class="sheet-title"><span>${title}</span>${action('close-sheet',icon('close'),'icon-button','aria-label="关闭弹层"')}</div>${content}`;
  sheet.setAttribute('aria-label',title);sheet.setAttribute('aria-modal','true');
  $('#sheet-shade').hidden=false;
  if(!sheet.open)sheet.show();
  (sheet.querySelector('input')||sheet.querySelector('button')).focus({preventScroll:true});
}

function closeSheet(restore=true){
  if(!sheet.open)return;
  sheet.close();$('#sheet-shade').hidden=true;
  if(restore&&focusBeforeSheet?.isConnected)focusBeforeSheet.focus({preventScroll:true});
}

document.addEventListener('prototype:sheet',event=>{
  if(typeof event.detail?.title==='string'&&typeof event.detail?.content==='string')openSheet(event.detail.title,event.detail.content);
});

function wordSheet(word){
  const w=words.find(x=>x.word===word)||words[0];
  openSheet('语境查词',`<div class="word-sheet-heading"><div><h2>${w.word}</h2><p>${w.phonetic} · ${w.type}</p></div><span class="word-status">${state.mastered.has(word)?'已掌握':'阅读中遇见'}</span></div><p class="word-definition">${w.meaning}</p><div class="word-context"><p>${w.context}</p><span>${w.translation}</span></div><div class="sheet-actions">${action('add-word',(state.added.has(word)?'已加入词库':'加入词库')+icon(state.added.has(word)?'check':'add'),'primary',`data-word-value="${word}"`)}${action('master-word',state.mastered.has(word)?'继续学习':'标记掌握','secondary',`data-word-value="${word}"`)}</div>`);
}

function readerOptions(){
  openSheet('阅读设置',`<div class="settings-row"><span>正文字号</span><div class="font-control">${action('font-less','A−','icon-button','aria-label="缩小字号"')}<span id="sheet-font">${state.fontSize}</span>${action('font-more','A+','icon-button','aria-label="放大字号"')}</div></div><div class="settings-row"><span>阅读主题</span><div class="segmented">${action('light','浅色','',`aria-pressed="${state.theme==='light'}"`)}${action('dark','深色','',`aria-pressed="${state.theme==='dark'}"`)}</div></div>${note('设置会立即作用于当前阅读页。')}`);
}

function resetQuiz(){state.quizIndex=0;state.answers=[];state.choice=null;state.revealed=false;}
function reveal(){if(state.choice===null)return;state.revealed=true;render(true);screen.querySelector('.answer-feedback')?.scrollIntoView({block:'nearest'});}
function changeTheme(theme){state.theme=theme;render(true);if(sheet.open&&sheet.getAttribute('aria-label')==='阅读设置')readerOptions();}
function setTarget(n){state.smartTarget=Math.max(1,Math.min(getDueWords().length||1,Math.trunc(Number(n)||1)));}
function formError(message){const error=$('#form-error');if(error){error.textContent=message;error.scrollIntoView({block:'nearest'});}}

function selectStudyDay(date,focus=false){
  if(!studyDays.some(day=>day.date===date&&!day.future))return;
  state.studySelectedDate=date;
  screen.querySelectorAll('.study-day[data-date]').forEach(button=>{
    const selected=button.dataset.date===date;
    button.setAttribute('aria-pressed',String(selected));button.tabIndex=selected?0:-1;
    if(selected&&focus)button.focus({preventScroll:true});
  });
  $('#study-log-detail').innerHTML=renderStudyDayDetail();
}

function redeemInvite(){
  const input=sheet.querySelector('#vip-invite-code');
  if(!input)return;
  const code=input.value.trim().toUpperCase();
  const error=sheet.querySelector('#vip-invite-error');
  const message=!code?'请先输入邀请码。':code!=='READ30'?'邀请码无效或已失效，请检查后重试。':state.vipInviteRedeemed?'该邀请码已兑换，请勿重复使用。':'';
  if(message){error.textContent=message;input.setAttribute('aria-invalid','true');input.focus();return;}
  state.vipInviteRedeemed=true;
  openSheet('兑换成功',`<div class="vip-redeem-success"><span class="vip-redeem-success-icon" aria-hidden="true">${icon('check')}</span><h3>30 天 VIP，开始更多阅读。</h3><p>智能阅读陪练、语境查词、长难句拆解和语音朗读，全部解锁。</p><p class="vip-preview-note">当前展示兑换成功示例，未开通真实会员。</p>${action('close-sheet','完成','primary')}</div>`);
}

function clearCardEffect(){
  clearTimeout(cardTouch.pressTimer);clearTimeout(cardTouch.clearTimer);
  cardTouch.pressTimer=null;cardTouch.clearTimer=null;
  if(cardTouch.effect){
    const {card,layer}=cardTouch.effect;
    card.classList.remove('is-touch-pressed','is-touch-releasing');
    layer.remove();cardTouch.effect=null;
  }
}

function resetCardTouch(){
  clearCardEffect();clearTimeout(cardTouch.actionTimer);
  cardTouch.gesture=null;cardTouch.lastTap=null;cardTouch.blockedClick=null;cardTouch.actionTimer=null;
}

function cancelCardGesture(){
  if(!cardTouch.gesture)return;
  cardTouch.blockedClick={card:cardTouch.gesture.card,until:performance.now()+500};
  cardTouch.gesture=null;cardTouch.lastTap=null;clearCardEffect();
}

function makeCardEffect(card,clientX,clientY){
  clearCardEffect();
  const rect=card.getBoundingClientRect();
  // 换算到色块自身坐标，兼容桌面手机模型的 CSS zoom。
  const width=card.offsetWidth,height=card.offsetHeight;
  const x=Math.max(0,Math.min(width,(clientX-rect.left)*width/rect.width));
  const y=Math.max(0,Math.min(height,(clientY-rect.top)*height/rect.height));
  const layer=document.createElement('span');layer.className='card-touch-layer';layer.setAttribute('aria-hidden','true');
  layer.style.setProperty('--touch-x',x+'px');layer.style.setProperty('--touch-y',y+'px');
  layer.style.setProperty('--touch-size',2*Math.hypot(Math.max(x,width-x),Math.max(y,height-y))+'px');
  const wave=document.createElement('span');wave.className='card-touch-wave';layer.append(wave);card.append(layer);
  cardTouch.effect={card,layer};
}

function releaseCardEffect(card,x,y){
  if(cardTouch.effect?.card!==card||card.classList.contains('is-touch-releasing'))makeCardEffect(card,x,y);
  card.classList.remove('is-touch-pressed');card.classList.add('is-touch-releasing');
  cardTouch.clearTimer=setTimeout(clearCardEffect,540);
  cardTouch.lastTap={card,at:performance.now()};
}

screen.addEventListener('pointerdown',event=>{
  if(event.isPrimary===false){cancelCardGesture();return;}
  if(event.button!==0||motionPreference.matches||cardTouch.actionTimer)return;
  const card=event.target.closest(touchCardSelector);
  if(!card||event.target.closest('button:disabled'))return;
  resetCardTouch();
  const gesture={card,id:event.pointerId,x:event.clientX,y:event.clientY};cardTouch.gesture=gesture;
  // 留出短暂的手势判断时间，起手滑动不会产生涟漪。
  cardTouch.pressTimer=setTimeout(()=>{
    if(cardTouch.gesture!==gesture||!card.isConnected)return;
    makeCardEffect(card,gesture.x,gesture.y);card.classList.add('is-touch-pressed');
  },80);
},{passive:true});

document.addEventListener('pointermove',event=>{
  const gesture=cardTouch.gesture;if(!gesture||gesture.id!==event.pointerId)return;
  if(Math.hypot(event.clientX-gesture.x,event.clientY-gesture.y)>9)cancelCardGesture();
},{passive:true});

document.addEventListener('pointerup',event=>{
  const gesture=cardTouch.gesture;if(!gesture||gesture.id!==event.pointerId)return;
  const rect=gesture.card.getBoundingClientRect();
  if(Math.hypot(event.clientX-gesture.x,event.clientY-gesture.y)>9||event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom){cancelCardGesture();return;}
  clearTimeout(cardTouch.pressTimer);cardTouch.pressTimer=null;cardTouch.gesture=null;
  releaseCardEffect(gesture.card,gesture.x,gesture.y);
},{passive:true});
document.addEventListener('pointercancel',cancelCardGesture,{passive:true});
screen.addEventListener('pointerout',event=>{
  if(cardTouch.gesture?.id===event.pointerId&&!cardTouch.gesture.card.contains(event.relatedTarget))cancelCardGesture();
},{passive:true});
screen.addEventListener('scroll',cancelCardGesture,{passive:true});
screen.addEventListener('contextmenu',cancelCardGesture);
window.addEventListener('blur',resetCardTouch);
motionPreference.addEventListener('change',resetCardTouch);

document.addEventListener('click',event=>{
  // 精选色块的背景与说明文字也可进入概述，内部收藏按钮仍优先响应。
  const button=event.target.closest('button, .cover-story[data-go]');
  if(!button||button.disabled)return;
  const card=button.closest(touchCardSelector);
  if(card&&screen.contains(card)){
    if(event.detail>0&&cardTouch.blockedClick?.card===card&&performance.now()<cardTouch.blockedClick.until){event.preventDefault();return;}
    if(!motionPreference.matches){
      if(cardTouch.actionTimer)return;
      if(cardTouch.lastTap?.card!==card||performance.now()-cardTouch.lastTap.at>500){
        const rect=button.getBoundingClientRect();releaseCardEffect(card,rect.left+rect.width/2,rect.top+rect.height/2);
      }
      // 给反馈一个可见的起始帧，随后执行原操作，不等待整段动画。
      cardTouch.actionTimer=setTimeout(()=>{
        cardTouch.actionTimer=null;if(button.isConnected)activateButton(button);
      },110);
      return;
    }
  }
  activateButton(button);
});

function activateButton(button){
  if(button.dataset.go){navigate(button.dataset.go);return;}
  if(button.dataset.word){wordSheet(button.dataset.word);return;}
  if(button.dataset.selectWord){const word=button.dataset.selectWord;state.selectionDraft.has(word)?state.selectionDraft.delete(word):state.selectionDraft.add(word);render(true);return;}
  const name=button.dataset.action;
  switch(name){
    case 'gallery':location.hash=galleryOpen?state.route:'gallery';break;
    case 'filter':state[button.dataset.key]=button.dataset.value;if(state.route==='home')refreshEditorialDiscovery();else render();break;
    case 'close-sheet':closeSheet();break;
    case 'study-day':selectStudyDay(button.dataset.date);break;
    case 'vip-redeem':openSheet('邀请码兑换',`<form id="vip-redeem-form" novalidate><p class="vip-redeem-intro">输入你收到的邀请码，兑换 VIP 阅读权益。</p><label class="field" for="vip-invite-code"><span>邀请码</span><input id="vip-invite-code" name="inviteCode" type="text" placeholder="请输入邀请码" maxlength="32" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-describedby="vip-invite-error"></label><p id="vip-invite-error" class="vip-redeem-error" role="alert"></p>${action('submit-vip-invite','立即兑换'+icon('arrow'),'primary')}<div class="vip-redeem-sample">${action('sample-vip-invite','填入示例邀请码','text-button')}</div></form>`);break;
    case 'sample-vip-invite':{const input=sheet.querySelector('#vip-invite-code');input.value='READ30';input.removeAttribute('aria-invalid');sheet.querySelector('#vip-invite-error').textContent='';input.focus();break;}
    case 'submit-vip-invite':redeemInvite();break;
    case 'vip-checkout':{
      const plan=getVipPlan();
      openSheet('确认开通方案',`<div class="vip-order-heading"><div><h3>${plan.name}</h3><p>${vipPlanSummary(plan)}</p></div><span class="vip-order-price"><small>¥</small>${plan.price}</span></div><dl class="vip-order-details"><div><dt>会员有效期</dt><dd>${plan.duration}</dd></div><div><dt>阅读权益</dt><dd>全部四项 · 不限次数</dd></div><div><dt>续费方式</dt><dd>${plan.days?'一次性购买，不自动续费':'一次开通，无需续费'}</dd></div></dl><p class="vip-preview-note">当前为订阅原型，价格与权益仅作方案展示；不会发起支付或扣款。</p>${action('close-sheet','返回套餐选择'+icon('back'),'primary')}`);
      break;
    }
    case 'vip-help':openSheet('订阅说明',`<div class="vip-help"><dl><dt>三种套餐的权益有区别吗？</dt><dd>阅读权益一致，区别在于有效期：月度 30 天、年度 365 天，永久 VIP 长期有效。</dd><dt>会员何时生效？</dt><dd>方案设定为支付成功后立即生效。当前原型不发起支付，也不会改变账号的会员状态。</dd><dt>到期会自动续费吗？</dt><dd>不会。月度与年度 VIP 到期后停止会员权益，不自动扣费；永久 VIP 无需续费。</dd></dl><p class="vip-preview-note">页面价格、划线价与权益均为示例，最终方案待确认。</p>${action('close-sheet','了解了','primary')}</div>`);break;
    case 'search':case 'search-words':openSheet(name==='search'?'搜索文章':'搜索单词',`<form id="search-form">${field(name==='search'?'标题、刊物或主题':'单词或中文释义','search','输入关键词','search',state.query)}${action('submit-search','搜索'+icon('search'),'primary')}</form>`);break;
    case 'submit-search':state.query=sheet.querySelector('[name=search]').value.trim();closeSheet();refreshEditorialDiscovery(true);break;
    case 'clear-search':state.query='';state.wordFilter='全部';refreshEditorialDiscovery();break;
    case 'reset-editorial-scope':state.query='';state.category='全部';refreshEditorialDiscovery();break;
    case 'reset-editorial':state.query='';state.category='全部';state.publication='all';refreshEditorialDiscovery();break;
    case 'save':{const id=button.dataset.id;const removing=state.saved.has(id);removing?state.saved.delete(id):state.saved.add(id);render(true);toast(removing?'已从收藏中移除':'已收藏，可以在书架找到');break;}
    case 'empty-toggle':state.empty=!state.empty;render();break;
    case 'translate':state.translated=!state.translated;render(true);break;
    case 'audio':state.playing=!state.playing;render(true);break;
    case 'reader-options':readerOptions();break;
    case 'font-less':case 'font-more':state.fontSize=Math.max(15,Math.min(23,state.fontSize+(name==='font-more'?1:-1)));render(true);if(sheet.open&&sheet.getAttribute('aria-label')==='阅读设置')readerOptions();break;
    case 'light':case 'dark':changeTheme(name);break;
    case 'add-word':{const word=button.dataset.wordValue;state.added.add(word);wordSheet(word);toast('已加入词库，下一次在文章里复习');break;}
    case 'master-word':{const word=button.dataset.wordValue;state.mastered.has(word)?state.mastered.delete(word):state.mastered.add(word);render(true);wordSheet(word);break;}
    case 'finish-reading':state.recent=true;openSheet('读完了',`<div class="sheet-content"><h3>又多读懂了一点世界。</h3><p>遇见的生词，可以在词库里继续练习。</p>${go('words','去词库看看'+icon('arrow'),'primary')}${go('home','继续发现文章','secondary full')}</div>`);break;
    case 'selection-mode':state.selectionMode=button.dataset.mode==='custom'?'custom':'smart';render(true);break;
    case 'target-less':case 'target-more':setTarget(Math.min(state.smartTarget,getDueWords().length)+(name==='target-more'?1:-1));render(true);break;
    case 'select-all-words':state.selectionDraft=state.selectionDraft.size===words.length?new Set():new Set(words.map(w=>w.word));render(true);break;
    case 'confirm-words':if(state.selectionDraft.size){state.selected=new Set(state.selectionDraft);state.selectionMode='custom';navigate('practice-setup');}break;
    case 'start-generation':{
      state.practiceWords=state.selectionMode==='custom'?[...state.selected]:getDueWords().slice(0,state.smartTarget).map(w=>w.word);
      if(!state.practiceWords.length){toast(state.selectionMode==='custom'?'请先选择练习单词':'当前没有待复习单词');return;}
      state.target=state.practiceWords.length;state.generationFailed=false;resetQuiz();navigate('generating');break;
    }
    case 'generation-failure':state.generationFailed=!state.generationFailed;render();break;
    case 'retry-generation':state.generationFailed=false;render();break;
    case 'answer':if(!state.revealed){state.choice=Number(button.dataset.choice);render(true);}break;
    case 'reveal-answer':reveal();break;
    case 'unsure':state.choice=-1;reveal();break;
    case 'next-question':state.answers.push({word:quiz[state.quizIndex].word,correct:state.choice===quiz[state.quizIndex].answer});if(state.quizIndex===quiz.length-1)navigate('result');else{state.quizIndex++;state.choice=null;state.revealed=false;render();}break;
    case 'fill-sample':state.importTitle='The quiet art of paying attention';state.importText=sampleText;render();break;
    case 'fill-link':$('#import-form [name=url]').value='https://example.com/reading';break;
    case 'submit-import':{
      const form=$('#import-form');
      if(button.dataset.mode==='link'){
        const value=form.elements.url.value.trim();let valid=false;
        try{valid=['http:','https:'].includes(new URL(value).protocol);}catch{valid=false;}
        if(!valid){formError('请输入完整的 HTTP 或 HTTPS 文章链接。');return;}
        state.importSource='网页链接';state.importTitle='The quiet art of paying attention';
      }else{
        const text=form.elements.body.value.trim();const count=text?text.split(/\s+/).length:0;
        if(count<20||count>5000){formError('请粘贴 20–5,000 词的英文正文，或填入示例体验。');return;}
        state.importText=text;state.importTitle=form.elements.title.value.trim()||'The quiet art of paying attention';state.importSource='粘贴正文';
      }
      state.importFailed=false;navigate('import-processing');break;
    }
    case 'sample-asset':state.importSource=button.dataset.mode==='file'?'本地文件':'图片';state.importTitle='The quiet art of paying attention';state.importFailed=false;navigate('import-processing');break;
    case 'computer-uploaded':state.importSource='电脑上传';state.importFailed=false;navigate('import-processing');break;
    case 'import-failure':state.importFailed=!state.importFailed;render();break;
    case 'retry-import':state.importFailed=false;render();break;
    case 'confirm-import':state.importTitle=$('#import-title').value.trim()||'The quiet art of paying attention';state.imported=true;state.shelfFilter='导入';navigate('shelf');toast('示例文章已加入书架');break;
    case 'clear-history':openSheet('清空最近阅读',`<div class="sheet-content"><h3>清空这份阅读记录？</h3><p>这会清空当前原型中的示例记录，刷新原型可恢复。书架收藏仍然保留。</p>${action('confirm-clear-history','清空示例记录','primary')}${action('close-sheet','保留记录','secondary full')}</div>`);break;
    case 'confirm-clear-history':state.recent=false;closeSheet();toast('示例阅读记录已清空');break;
    case 'login':{
      const form=$('#login-form');
      if(!form.elements.email.validity.valid||!form.elements.email.value.trim()){formError('请输入格式正确的示例邮箱。');return;}
      if(form.elements.password.value.length<8){formError('示例密码至少输入 8 位。');return;}
      form.elements.password.value='';state.loggedIn=true;navigate('profile');toast('已切换为示例登录状态');break;
    }
    case 'request-reset':{
      const form=$('#reset-form');
      if(!form.elements.email.value.trim()||!form.elements.email.validity.valid){formError('请输入格式正确的示例邮箱。');return;}
      state.resetEmail=form.elements.email.value;state.resetStep=true;render();toast('示例验证码：123456，未发送邮件');break;
    }
    case 'confirm-reset':{
      const form=$('#reset-form');
      if(form.elements.code.value!=='123456'){formError('请使用演示验证码 123456。');return;}
      if(form.elements.password.value.length<8){formError('示例密码至少输入 8 位。');return;}
      form.elements.password.value='';state.resetStep=false;navigate('login');toast('已展示重置完成效果，未变更真实密码');break;
    }
    case 'wechat':openSheet('微信登录',`<div class="sheet-content"><h3>在手机上，用微信继续。</h3><p>正式应用会在此唤起微信授权。本地原型可以直接查看登录后的页面。</p>${action('demo-wechat','查看登录后效果'+icon('arrow'),'primary')}</div>`);break;
    case 'demo-wechat':state.loggedIn=true;navigate('profile');break;
    case 'guest':openSheet('访客阅读',`<div class="sheet-content"><h3>先从一篇文章开始。</h3><p>正式应用首次使用需确认已满 14 周岁。此处仅演示后续页面，不创建访客账户。</p>${go('home','浏览示例文章'+icon('arrow'),'primary')}</div>`);break;
  }
}

document.addEventListener('input',event=>{
  if(event.target.matches('#import-form [name=body]')){const text=event.target.value.trim();$('#word-count').textContent=(text?text.split(/\s+/).length:0)+' 词';}
  if(event.target.id==='vip-invite-code'){event.target.removeAttribute('aria-invalid');sheet.querySelector('#vip-invite-error').textContent='';}
});
document.addEventListener('change',event=>{
  if(event.target.id==='target-input'){setTarget(event.target.value);render(true);}
  if(event.target.matches('input[name="vip-plan"]')&&vipPlans.some(plan=>plan.id===event.target.value)){
    state.vipPlan=event.target.value;render(true);
    screen.querySelector('input[name="vip-plan"]:checked')?.focus({preventScroll:true});
  }
});
document.addEventListener('submit',event=>{
  event.preventDefault();
  if(event.target.id==='search-form')sheet.querySelector('[data-action=submit-search]').click();
  if(event.target.id==='login-form')event.target.querySelector('[data-action=login]').click();
  if(event.target.id==='vip-redeem-form')redeemInvite();
});
document.addEventListener('keydown',event=>{
  if(!sheet.open&&event.target.matches('.study-day[data-date]')){
    const days=studyDays.filter(day=>!day.future);
    const index=days.findIndex(day=>day.date===event.target.dataset.date);
    const offsets={ArrowUp:-1,ArrowDown:1,ArrowLeft:-7,ArrowRight:7};
    if(event.key in offsets){event.preventDefault();selectStudyDay(days[Math.max(0,Math.min(days.length-1,index+offsets[event.key]))].date,true);}
  }
  if(!sheet.open)return;
  if(event.key==='Escape'){event.preventDefault();closeSheet();return;}
  if(event.key==='Tab'){
    const items=[...sheet.querySelectorAll('button:not(:disabled), input, textarea, select, a[href]')];
    if(!items.length)return;
    if(event.shiftKey&&document.activeElement===items[0]){event.preventDefault();items.at(-1).focus();}
    else if(!event.shiftKey&&document.activeElement===items.at(-1)){event.preventDefault();items[0].focus();}
  }
});
$('#sheet-shade').addEventListener('click',()=>closeSheet());
$('#page-select').addEventListener('change',event=>navigate(event.target.value));
$('#gallery-toggle').addEventListener('click',()=>{location.hash=galleryOpen?state.route:'gallery';});
$('#theme-toggle').addEventListener('click',()=>changeTheme(state.theme==='dark'?'light':'dark'));
window.addEventListener('hashchange',readRoute);
window.addEventListener('resize',fitPreview);
fitPreview();readRoute();
