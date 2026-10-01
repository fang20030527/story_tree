import { state, pages, words, logo, getSpeakingItem } from './data.js';
import { icon, go, action, mainNavigation } from './ui.js';

const mode=document.body.dataset.platform;
const labels=new Map(pages);
let mainRoutes=mainNavigation();
document.querySelector('.platform-brand').setAttribute('aria-label','黑洞英语首页');
document.querySelector('#platform-main-nav').innerHTML=mainRoutes.map(([route,glyph,label])=>go(route,icon(glyph)+`<span>${label}</span>`,'platform-nav-item')).join('');
document.querySelector('#platform-secondary-nav').innerHTML=[['practice-setup','book','阅读练习'],['import','upload','导入文章'],['guide','help','功能指南']].map(([route,glyph,label])=>go(route,icon(glyph)+`<span>${label}</span>`,'platform-nav-item')).join('');
document.querySelector(`[data-platform-link="${mode}"]`).setAttribute('aria-current','page');

function mainSection(route){
  if(state.learningMode==='speak'){
    if(['speak-files','speak-import','speak-subtitles'].includes(route))return 'speak-files';
    if(route==='shadowing'&&getSpeakingItem().origin==='file')return 'speak-files';
    if(['speak-materials','speak-overview','shadowing'].includes(route))return 'speak-materials';
    return 'profile';
  }
  if(['home','overview','reader'].includes(route))return 'home';
  if(['shelf','recent','favorites'].includes(route)||route.startsWith('import'))return 'shelf';
  if(['words','vocabulary','add-words','practice-setup','generating','topics','practice-read','quiz','result'].includes(route))return 'words';
  return 'profile';
}

function updatePresentation(){
  const speaking=state.learningMode==='speak';
  mainRoutes=mainNavigation();
  document.querySelector('#platform-main-nav').innerHTML=mainRoutes.map(([route,glyph,label])=>go(route,icon(glyph)+`<span>${label}</span>`,'platform-nav-item')).join('');
  document.querySelector('#platform-secondary-nav').innerHTML=speaking
    ? [['speak-import','upload','导入文件'],['speak-history','time','跟读记录']].map(([route,glyph,label])=>go(route,icon(glyph)+`<span>${label}</span>`,'platform-nav-item')).join('')+action('speech-help',icon('help')+'<span>跟读指南</span>','platform-nav-item')
    : [['practice-setup','book','阅读练习'],['import','upload','导入文章'],['guide','help','功能指南']].map(([route,glyph,label])=>go(route,icon(glyph)+`<span>${label}</span>`,'platform-nav-item')).join('');
  document.querySelector('#platform-secondary-nav').setAttribute('aria-label',speaking?'跟读工具':'阅读工具');
  document.querySelector('.platform-brand').href=speaking?'#speak-materials':'#home';
  const phone=document.querySelector('#phone');
  const section=mainSection(state.route);
  phone.dataset.shelfFilter=state.shelfFilter;
  document.body.dataset.route=state.route;
  document.querySelector('#platform-section-name').textContent=labels.get(state.route);
  document.querySelector('#platform-crumb').textContent=speaking?'我的表达空间':['reader','practice-read'].includes(state.route)?'专注阅读':'我的阅读空间';
  document.querySelectorAll('#platform-main-nav [data-go]').forEach(button=>{
    button.dataset.go===section?button.setAttribute('aria-current','page'):button.removeAttribute('aria-current');
  });
  document.querySelectorAll('#platform-secondary-nav [data-go]').forEach(button=>{
    button.dataset.go===state.route?button.setAttribute('aria-current','page'):button.removeAttribute('aria-current');
  });
  document.querySelector('#platform-account-name').textContent=state.loggedIn?'阅读者':'登录，同步你的积累';
  document.querySelector('.platform-account').setAttribute('aria-label',state.loggedIn?'查看我的账号':'登录并同步学习');
  const isReading=['reader','practice-read'].includes(state.route);
  phone.classList.toggle('has-rail',mode!=='mini'&&isReading);
  const rail=document.querySelector('#platform-rail');
  rail.hidden=mode==='mini'||!isReading;
  const readingWords=[...new Set([...document.querySelectorAll('#screen .inline-word')].map(button=>button.dataset.word))];
  rail.innerHTML=rail.hidden?'':`<p class="rail-eyebrow">READING DESK</p><h2>在语境里，<br>读懂每个词。</h2><div class="rail-reading-tools">${action('translate',icon('text')+(state.translated?'收起译文':'展开译文'),'tool-button',`aria-pressed="${state.translated}"`)}${action('audio',icon(state.playing?'pause':'play')+(state.playing?'暂停示意':'朗读示意'),'tool-button')}</div><div class="rail-font"><span>正文字号</span><div>${action('font-less','A−','icon-button','aria-label="缩小字号"')}<span>${state.fontSize}</span>${action('font-more','A+','icon-button','aria-label="放大字号"')}</div></div><h3>本篇词汇</h3>${readingWords.map(word=>{const item=words.find(w=>w.word===word);return `<button type="button" data-word="${word}" class="rail-word"><strong>${word}</strong><span>${item.meaning}</span>${icon('chevron')}</button>`;}).join('')}${go('words','去词库复习 '+icon('arrow'),'rail-library-link')}`;
  const main=mainRoutes.some(([route])=>route===state.route);
  const miniTitle=document.querySelector('#mini-title');
  miniTitle.textContent=main?'':labels.get(state.route);
  if(main)miniTitle.innerHTML=`<img class="mini-brand-logo" src="${logo}" alt="黑洞英语">`;
  const back=document.querySelector('.mini-back');
  document.querySelector('#mini-close').dataset.go=speaking?'speak-materials':'home';
  const source=document.querySelector('#screen-header [aria-label="返回"]');
  back.hidden=main||!source;
  if(source){back.dataset.go=source.dataset.go;back.innerHTML=icon('back');}
  document.title=`${labels.get(state.route)} · 黑洞英语${mode==='ipad'?' iPad':mode==='mini'?'小程序':' Web'}原型`;
}

document.addEventListener('prototype:render',updatePresentation);
await import('./runtime.js');
updatePresentation();

const orientation=document.querySelector('#orientation-toggle');
orientation.hidden=mode!=='ipad';
orientation.addEventListener('click',()=>{
  const portrait=document.body.classList.toggle('is-portrait');
  orientation.textContent=portrait?'查看横屏':'查看竖屏';
  orientation.setAttribute('aria-pressed',String(portrait));
});
document.querySelector('#mini-more').addEventListener('click',()=>{
  document.dispatchEvent(new CustomEvent('prototype:sheet',{detail:{title:'小程序菜单',content:`<div class="mini-menu">${go('guide',icon('help')+'功能指南')}${go('settings',icon('settings')+'设置')}${action('close-sheet',icon('close')+'返回当前页面')}</div>`}}));
});
