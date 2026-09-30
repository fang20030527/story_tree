const imageRoot = '../../app/assets/images/editorial/';
const articles = [
  { id: 'cat', title: 'Meet the First New Cat Species Discovered in 100 Years', zh: '百年来首次发现的全新猫科物种', source: 'National Geographic', category: '自然', words: '1,494', minutes: 10, image: 'new-cat-species-002.jpg', summary: '一百年来，科学家首次确认了一种新的猫科动物。跟随研究者的发现，认识这位藏身南美森林的小型猎手，了解物种分类与保护之间的联系。' },
  { id: 'ai', title: 'Can the AI arms race be stopped?', zh: '人工智能军备竞赛能被叫停吗？', source: 'The Economist', category: '科技', words: '966', minutes: 7, image: 'ai-arms-race.jpg', cover: true, audio: true, summary: '技术风险催生暂停研发的呼声，地缘政治竞争却让全面放缓难以实现。这篇文章讨论人工智能安全与国家竞争之间的矛盾，以及仍然可能推进的安全合作。' },
  { id: 'viking', title: 'The Viking word hidden in the Declaration of American Independence', zh: '藏在美国《独立宣言》中的维京词语', source: 'BBC Future', category: '文化', words: '1,808', minutes: 13, image: 'viking-word-independence-001.webp', summary: '一个日常词语，也可能带着漫长的历史。沿着语言演变的线索，看看维京人的词语如何进入英语，又怎样出现在美国《独立宣言》中。' },
  { id: 'agent', title: 'The Secret Agent With the Sketchbook', zh: '拿着速写本的秘密特工', source: 'National Geographic', category: '历史', words: '2,443', minutes: 17, image: 'secret-agent-sketchbook-011.jpg', summary: '速写本记录了一个不同寻常的战时故事。从画作与人物经历出发，了解这位秘密特工如何观察和记录他身处的世界。' },
];

const phone = document.querySelector('#phone');
const scroll = document.querySelector('.screen-scroll');
const searchPanel = document.querySelector('#search-panel');
const searchInput = document.querySelector('#search-input');
const searchToggle = document.querySelector('#search-toggle');
const dialog = document.querySelector('#article-dialog');
const saved = new Set();
let activeCategory = 'all';
let activeArticle = null;
let toastTimer;

function fitPreview() {
  const scale = Math.max(0.4, Math.min(1, (window.innerHeight - 150) / 830));
  document.querySelector('.preview').style.setProperty('--preview-scale', String(scale));
}
window.addEventListener('resize', fitPreview);
fitPreview();

const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="#${name}"/></svg>`;
const isFiltering = () => activeCategory !== 'all' || searchInput.value.trim() !== '';

function renderArticles() {
  const query = searchInput.value.trim().toLocaleLowerCase();
  const filtering = isFiltering();
  const list = articles.filter((article) => (filtering || article.id !== 'cat')
    && (activeCategory === 'all' || article.category === activeCategory)
    && `${article.title} ${article.zh} ${article.source} ${article.category}`.toLocaleLowerCase().includes(query));
  document.querySelector('#hero').hidden = filtering;
  document.querySelector('#continuation').hidden = filtering;
  document.querySelector('#list-title').textContent = query ? '搜索结果' : activeCategory !== 'all' ? `${activeCategory}文章` : '值得一读';
  document.querySelector('#result-count').textContent = filtering ? `${list.length} 篇文章` : '换个角度，看世界';
  document.querySelector('#article-list').innerHTML = list.map((article) => `
    <article class="article-row"><button type="button" class="article-open" data-article="${article.id}" aria-label="查看：${article.zh}">
      <div class="article-copy"><p class="article-source">${article.source} <span>／ ${article.category}</span></p>
      <h4>${article.zh}</h4><span class="reading-meta">${article.words} 词 · ${article.minutes} 分钟${article.audio ? ` · ${icon('headphones')} 原刊录音` : ''}</span></div>
      <img class="article-image${article.cover ? ' cover' : ''}" src="${imageRoot}${article.image}" alt="" loading="lazy">
    </button></article>`).join('');
  document.querySelector('#empty-state').hidden = list.length !== 0;
}

function showToast(message) {
  clearTimeout(toastTimer);
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.add('visible');
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3000);
}

function updateSaveButton() {
  const isSaved = saved.has(activeArticle.id);
  const button = document.querySelector('#save-article');
  button.innerHTML = `${icon(isSaved ? 'check' : 'bookmark')}<span>${isSaved ? '已加入书架' : '加入书架'}</span>`;
  button.setAttribute('aria-pressed', String(isSaved));
}

function openArticle(id) {
  activeArticle = articles.find((article) => article.id === id);
  if (!activeArticle) return;
  document.querySelector('#dialog-title').textContent = activeArticle.title;
  document.querySelector('#dialog-title-zh').textContent = activeArticle.zh;
  document.querySelector('#dialog-source').textContent = `${activeArticle.source} ／ ${activeArticle.category}`;
  document.querySelector('#dialog-summary').textContent = activeArticle.summary;
  document.querySelector('#dialog-meta').textContent = `${activeArticle.words} 词 · ${activeArticle.minutes} 分钟`;
  const image = document.querySelector('#dialog-image');
  image.src = `${imageRoot}${activeArticle.image}`;
  image.style.objectFit = activeArticle.cover ? 'contain' : 'cover';
  updateSaveButton();
  // 非模态 dialog 留在手机画框内；inert 与 Escape 提供相同的键盘隔离。
  for (const element of phone.children) if (element !== dialog) element.inert = true;
  dialog.show();
  dialog.scrollTop = 0;
  document.querySelector('#dialog-close').focus();
}

function closeArticle() {
  dialog.close();
  for (const element of phone.children) element.inert = false;
  document.querySelector(`[data-article="${activeArticle?.id}"]`)?.focus({ preventScroll: true });
}

function closeSearch() {
  searchPanel.hidden = true;
  searchToggle.setAttribute('aria-expanded', 'false');
  searchInput.value = '';
  renderArticles();
  searchToggle.focus();
}

document.querySelector('.theme-toggle').addEventListener('click', (event) => {
  const dark = phone.dataset.theme !== 'dark';
  phone.dataset.theme = dark ? 'dark' : 'light';
  const button = event.currentTarget;
  button.setAttribute('aria-label', dark ? '切换到浅色' : '切换到深色');
  button.setAttribute('aria-pressed', String(dark));
  button.innerHTML = `${icon(dark ? 'sun' : 'moon')}<span>${dark ? '浅色' : '深色'}</span>`;
});
document.querySelectorAll('[data-width]').forEach((button) => button.addEventListener('click', () => {
  document.querySelector('.preview').style.setProperty('--preview-width', `${Number(button.dataset.width) + 14}px`);
  document.querySelectorAll('[data-width]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
}));
document.querySelectorAll('[data-category]').forEach((button) => button.addEventListener('click', () => {
  activeCategory = button.dataset.category;
  document.querySelectorAll('[data-category]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
  renderArticles();
  scroll.scrollTo({ top: 0, behavior: 'instant' });
}));
searchToggle.addEventListener('click', () => {
  if (!searchPanel.hidden) return closeSearch();
  searchPanel.hidden = false;
  searchToggle.setAttribute('aria-expanded', 'true');
  searchInput.focus();
});
searchInput.addEventListener('input', () => { renderArticles(); scroll.scrollTop = 0; });
document.querySelector('#search-cancel').addEventListener('click', closeSearch);
document.querySelector('#reset-filters').addEventListener('click', () => {
  searchInput.value = '';
  document.querySelector('[data-category="all"]').click();
});
document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-article]');
  if (button) openArticle(button.dataset.article);
});
document.querySelector('#dialog-close').addEventListener('click', closeArticle);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (dialog.open) closeArticle();
    else if (!searchPanel.hidden) closeSearch();
  }
  if (dialog.open && event.key === 'Tab') {
    const buttons = dialog.querySelectorAll('button');
    if (event.shiftKey && document.activeElement === buttons[0]) {
      event.preventDefault(); buttons[buttons.length - 1].focus();
    } else if (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]) {
      event.preventDefault(); buttons[0].focus();
    }
  }
});
document.querySelector('#save-article').addEventListener('click', () => {
  if (saved.has(activeArticle.id)) saved.delete(activeArticle.id);
  else saved.add(activeArticle.id);
  updateSaveButton();
});
document.querySelectorAll('[data-nav]').forEach((button) => button.addEventListener('click', () => {
  if (button.dataset.nav === '外刊') {
    closeSearch();
    document.querySelector('[data-category="all"]').click();
    scroll.scrollTo({ top: 0, behavior: 'smooth' });
  } else {
    showToast(`${button.dataset.nav}页将在视觉方向确定后展开，本次先预览外刊首页。`);
  }
}));
renderArticles();
