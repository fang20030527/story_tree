import type {
  PublishedEditorialSummary, PublishedEditorialArticle, VocabularyWord, PracticeDto,
  ArticleImportDto, PublicQuestion, AnswerResult, VocabularyInput, WordTranslationDto,
  ImportedArticleSummaryDto, ImportedArticleDto, ImportAssetDescriptor,
} from '@context-reader/contracts';
import type { MiniApp } from './app';
import { dateKey, filterEditorial, heatmap, tokens, utf8Bytes } from './model';
import { readLocal, writeLocal, recordStudy, user } from './storage';

const tabs = new Set(['home', 'shelf', 'words', 'profile']);
const app = () => getApp<MiniApp>();
const api = () => app().services;
type Event = { currentTarget: { dataset: Record<string, string | number | undefined> }; detail?: { value: string } };
type Row = { id: string; title: string; subtitle: string; image: string; source: string };
type Paragraph = { id: string; text: string; tokens: ReturnType<typeof tokens> };
const initial = {
  kind: '', dark: false, statusTop: 20, loading: false, busy: false, error: '', message: '', query: '',
  topic: '全部', publication: '全部外刊', topics: ['全部'], publications: ['全部外刊'],
  catalog: [] as PublishedEditorialSummary[], hero: null as PublishedEditorialSummary | null,
  articles: [] as PublishedEditorialSummary[], visibleCount: 24, total: 0,
  shelfFilter: '全部', rows: [] as Row[], shelfRows: [] as Row[], cursor: '',
  wordFilter: 'all', words: [] as (VocabularyWord & { selected?: boolean })[], selected: [] as VocabularyWord[],
  stats: ['—', '—', '—'], due: '—', added: '—', email: '', password: '', loggedIn: false,
  weeks: heatmap({}), studyDays: 0, selectedDate: dateKey(new Date()), selectedMinutes: 0,
  targetCount: 6, mode: 'smart', quota: '', activePractice: '',
  practice: null as PracticeDto | null, question: null as PublicQuestion | null,
  questionIndex: 0, feedback: null as AnswerResult | null, selectedOption: '', correct: 0,
  questionsTotal: 0, score: 0, manualTerm: '', manualMeaning: '',
  article: null as PublishedEditorialArticle | ImportedArticleDto | null, title: '', titleZh: '',
  source: 'editorial', id: '', image: '', summary: '', keyPoints: [] as string[], meta: '',
  paragraphs: [] as Paragraph[], bookmarked: false, hasAudio: false, playing: false,
  figures: [] as { after: number; url: string; caption: string; video: boolean; direct: boolean }[],
  lookup: null as WordTranslationDto | null, lookupTerm: '', lookupContext: '', wordAdded: false,
  translated: '', translationPending: false,
  importMode: 'url', input: '', importId: '', importStatus: '', previewTitle: '', previewText: '',
  duplicate: '', uploadCode: '', uploadUrl: '', expiresAt: '', inviteOpen: false, plan: 'annual',
};
type Data = typeof initial;
type Screen = { data: Data; setData(data: Partial<Data>): void; getTabBar?: () => { setData(data: { selected: string; dark: boolean }): void } };
type Runtime = { alive: boolean; version: number; options: Record<string, string | undefined>; timer?: ReturnType<typeof setTimeout>; studyTimer?: ReturnType<typeof setInterval>; started?: number; audio?: WechatMiniprogram.InnerAudioContext; audioSource?: string; importFiles?: { path: string; size: number; mediaType: ImportAssetDescriptor['mediaType'] }[]; questionStart: number };
const runtimes = new WeakMap<Screen, Runtime>();
const state = (page: Screen) => runtimes.get(page)!;
function update(page: Screen, data: Partial<Data>) { if (state(page).alive) page.setData(data); }
/** 免费练习按北京时间每天恢复；无限练习账号返回一个很大的兼容数字，不显示。 */
function quotaText(remaining: number) {
  if (remaining > 1_000_000) return '';
  return remaining > 0 ? `今天还可免费练习 ${remaining} 次，北京时间每天 0 点恢复；创建成功后使用 1 次。`
    : '今天的免费练习次数已用完，北京时间每天 0 点恢复。';
}
function media(path?: string) { return path?.startsWith('/') ? app().apiOrigin + path : path ?? ''; }
function navigate(name: string, params: Record<string, string> = {}, replace = false) {
  const query = Object.entries(params).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
  const url = `/pages/${name}/index${query ? '?' + query : ''}`;
  if (tabs.has(name)) wx.switchTab({ url }); else if (replace) wx.redirectTo({ url }); else wx.navigateTo({ url });
}
function guardedNavigate(page: Screen, name: string, params: Record<string, string> = {}, replace = false) { if (state(page).alive) navigate(name, params, replace); }
async function action(page: Screen, operation: () => Promise<void>) {
  if (page.data.busy) return;
  update(page, { busy: true, error: '', message: '' });
  try { await operation(); } catch (error) { update(page, { error: error instanceof Error ? error.message : '操作未完成，请重试' }); }
  finally { update(page, { busy: false }); }
}
function schedule(page: Screen, task: () => Promise<void>, delay = 2500) {
  const runtime = state(page); if (!runtime.alive) return;
  if (runtime.timer) clearTimeout(runtime.timer);
  runtime.timer = setTimeout(() => { if (runtime.alive) void action(page, task); }, Math.min(15_000, Math.max(1500, delay)));
}
function stop(page: Screen) {
  const runtime = state(page); runtime.alive = false; runtime.version += 1;
  if (runtime.timer) clearTimeout(runtime.timer);
  if (runtime.studyTimer) clearInterval(runtime.studyTimer);
  if (runtime.started) { recordStudy(runtime.started); delete runtime.started; }
  runtime.audio?.pause();
}
function applyFilters(page: Screen) {
  const articles = filterEditorial(page.data.catalog.filter(article => article.id !== page.data.hero?.id), page.data.topic, page.data.publication, page.data.query);
  update(page, { articles: articles.slice(0, page.data.visibleCount), total: articles.length });
}
function filterShelf(page: Screen) { update(page, { rows: page.data.shelfRows.filter(row => page.data.shelfFilter === '全部' || row.source === (page.data.shelfFilter === '导入' ? 'imported' : 'editorial')) }); }
function editorialRow(article: PublishedEditorialSummary): Row { return { id: article.id, title: article.titleZh, subtitle: `${article.source} · ${article.minutes} 分钟`, image: media(article.image), source: 'editorial' }; }
function importedRow(article: ImportedArticleSummaryDto): Row { return { id: article.id, title: article.title, subtitle: `导入文章 · ${article.wordCount} 词`, image: media(article.coverImageUrl ?? ''), source: 'imported' }; }
function useArticle(page: Screen, article: PublishedEditorialArticle | ImportedArticleDto, source: string) {
  const editorial = 'titleEn' in article;
  const text = editorial ? article.paragraphs : article.paragraphs.map(paragraph => paragraph.text);
  const figures = editorial ? (article.figures ?? []).map(figure => ({ after: figure.afterParagraph, url: media(figure.image), caption: figure.caption, video: false, direct: false }))
    : (article.media ?? []).map(figure => ({ after: figure.afterParagraph, url: media(figure.url), caption: figure.caption ?? '', video: figure.type === 'video', direct: figure.type === 'video' && figure.direct }));
  update(page, { article, source, title: editorial ? article.titleEn : article.title,
    titleZh: editorial ? article.titleZh : '', summary: editorial ? article.summaryZh : '',
    keyPoints: editorial ? article.keyPointsZh : [], image: editorial ? media(article.image) : '',
    meta: editorial ? `${article.source} · ${article.minutes} 分钟 · ${article.wordCount} 词` : `${article.wordCount} 词 · 导入文章`,
    paragraphs: text.map((text, index) => ({ id: String(index), text, tokens: tokens(text) })),
    figures,
    hasAudio: editorial && !!article.audioUrl,
    bookmarked: readLocal<PublishedEditorialSummary[]>('bookmarks', []).some(item => item.id === article.id),
  });
}
function usePractice(page: Screen, practice: PracticeDto) {
  update(page, { practice, title: practice.article?.title ?? '',
    meta: practice.article ? `${practice.article.wordCount} 词 · 阅读练习` : '',
    paragraphs: practice.article?.paragraphs.map(paragraph => { const text = paragraph.segments.map(segment => segment.text).join(''); return { id: paragraph.id, text, tokens: tokens(text) }; }) ?? [],
    source: 'practice', questionsTotal: practice.questions.length,
  });
}
async function pollPractice(page: Screen) {
  const version = state(page).version, practice = await api().practice(page.data.id);
  if (!state(page).alive || state(page).version !== version) return;
  usePractice(page, practice);
  if (practice.status === 'failed') { update(page, { error: practice.failure?.message ?? '练习未能生成，请返回重新创建' }); return; }
  if (['ready', 'in_progress', 'completed'].includes(practice.status)) { guardedNavigate(page, practice.group ? 'topics' : 'reader', { id: practice.id, source: 'practice' }, true); return; }
  update(page, { message: practice.status === 'validating' ? '正在检查文章和题目' : '正在为这些单词准备新语境' });
  schedule(page, () => pollPractice(page), practice.pollAfterMs ?? 2500);
}
async function pollImport(page: Screen) {
  const version = state(page).version, task = await api().getImport(page.data.importId);
  if (!state(page).alive || state(page).version !== version) return;
  useImport(page, task);
  if (task.status === 'preview_ready') { guardedNavigate(page, 'import-preview', { id: task.id }, true); return; }
  if (task.status === 'confirmed' && task.articleId) { writeLocal('pendingImport', ''); guardedNavigate(page, 'reader', { id: task.articleId, source: 'imported' }, true); return; }
  if (['queued', 'processing'].includes(task.status)) schedule(page, () => pollImport(page), task.pollAfterMs ?? 2500);
}
function useImport(page: Screen, task: ArticleImportDto) {
  update(page, { importId: task.id, importStatus: task.status, previewTitle: task.preview?.title ?? '',
    previewText: task.preview?.text ?? '', duplicate: task.preview?.duplicate.kind ?? '',
    message: ['queued', 'processing'].includes(task.status) ? '文章正在整理中，可以稍后回来查看。' : '',
    error: task.failure?.message ?? (['expired', 'cancelled'].includes(task.status) ? '本次导入已结束，请重新导入' : ''),
  });
  if (task.status === 'preview_ready') writeLocal('importPreview', task);
}
async function pollTranslation(page: Screen, id: string) {
  const result = await api().getTranslation(id, page.data.source);
  if (result.status === 'ready') { update(page, { translated: result.translatedTextZh ?? '', translationPending: false }); return; }
  if (result.status === 'failed') { update(page, { error: result.failure?.message ?? '翻译失败，请重试', translationPending: false }); return; }
  schedule(page, () => pollTranslation(page, id), result.pollAfterMs ?? 2500);
}
function showQuestion(page: Screen, practice: PracticeDto, index: number) {
  const question = practice.questions[index];
  if (!question) { guardedNavigate(page, 'result', { id: practice.id }, true); return; }
  state(page).questionStart = Date.now();
  update(page, { question, questionIndex: index, selectedOption: '', feedback: question.submittedAnswer ?? null });
}
async function load(page: Screen) {
  const version = ++state(page).version, kind = page.data.kind;
  update(page, { loading: true, error: '' });
  try {
    if (kind === 'home') {
      const catalog = await api().catalog();
      if (version !== state(page).version || !state(page).alive) return;
      const articles = catalog.articles.map(article => ({ ...article, image: media(article.image) }));
      update(page, { catalog: articles, hero: articles.find(article => article.id === catalog.featuredArticleId) ?? articles[0] ?? null,
        topics: ['全部', ...new Set(articles.map(article => article.category))], publications: ['全部外刊', ...new Set(articles.map(article => article.source))] }); applyFilters(page);
    } else if (kind === 'shelf') {
      const bookmarks = readLocal<PublishedEditorialSummary[]>('bookmarks', []).map(editorialRow);
      update(page, { shelfRows: bookmarks }); filterShelf(page);
      if (wx.getStorageSync('bhe:age') === true) {
        const imported = await api().imported();
        if (version !== state(page).version || !state(page).alive) return;
        update(page, { shelfRows: [...bookmarks, ...imported.items.map(importedRow)], cursor: imported.nextCursor ?? '' }); filterShelf(page);
      }
    } else if (kind === 'profile') {
      const totals = readLocal<Record<string, number>>('study', {}), recent = readLocal<Row[]>('recent', []);
      update(page, { loggedIn: !!user().email, email: user().email ?? '', weeks: heatmap(totals),
        studyDays: Object.values(totals).filter(ms => ms > 0).length, selectedMinutes: Math.floor((totals[page.data.selectedDate] ?? 0) / 60000), stats: [String(recent.length), '—', '—'] });
      if (wx.getStorageSync('bhe:age') === true) { const words = await api().words(); if (version === state(page).version) update(page, { stats: [String(recent.length), String(words.summary.totalCount), String(words.summary.masteredCount)] }); }
    } else if (kind === 'words' || kind === 'vocabulary') {
      if (wx.getStorageSync('bhe:age') !== true) { update(page, { message: '启用云端学习后，在这里查看你的词库。' }); return; }
      const [dashboard, words] = await Promise.all([api().dashboard(), api().words(page.data.wordFilter as 'all' | 'due' | 'scheduled')]);
      if (version !== state(page).version) return;
      update(page, { words: words.items, cursor: words.nextCursor ?? '', due: String(dashboard.dueLearningCount), added: String(dashboard.todayAddedCount), stats: [String(words.summary.totalCount), String(words.summary.learningCount), String(words.summary.masteredCount)] });
    } else if (kind === 'practice') {
      update(page, { targetCount: readLocal<number>('targetCount', 6) });
      if (wx.getStorageSync('bhe:age') === true) { const dashboard = await api().dashboard(); update(page, { quota: quotaText(dashboard.remainingFreePractices), activePractice: dashboard.incompletePracticeId ?? '' }); }
    } else if (kind === 'article' || kind === 'reader') {
      if (page.data.source === 'practice') { await app().ensureSession(); usePractice(page, await api().practice(page.data.id)); }
      else { const article = page.data.source === 'imported' ? await api().importedArticle(page.data.id) : await api().article(page.data.id); if (version === state(page).version) useArticle(page, article, page.data.source); }
      if (kind === 'reader' && state(page).alive) {
        const recent = readLocal<Row[]>('recent', []).filter(row => row.id !== page.data.id);
        writeLocal('recent', [{ id: page.data.id, title: page.data.titleZh || page.data.title, subtitle: page.data.meta, image: page.data.image, source: page.data.source }, ...recent].slice(0, 100));
        state(page).started = Date.now();
        state(page).studyTimer = setInterval(() => { const runtime = state(page); if (runtime.started) { recordStudy(runtime.started); runtime.started = Date.now(); } }, 60_000);
      }
    } else if (kind === 'generating') { await pollPractice(page); }
    else if (['topics', 'quiz', 'result'].includes(kind)) {
      const practice = await api().practice(page.data.id); if (version !== state(page).version) return; usePractice(page, practice);
      if (kind === 'topics' && practice.group && practice.group.articles.some(article => ['queued', 'generating', 'validating'].includes(article.status))) schedule(page, () => load(page), practice.pollAfterMs ?? 3500);
      if (kind === 'quiz') { showQuestion(page, practice, practice.questions.findIndex(question => !question.submittedAnswer) < 0 ? practice.questions.length : practice.questions.findIndex(question => !question.submittedAnswer)); state(page).started = Date.now(); }
      if (kind === 'result') { const correct = practice.questions.filter(question => question.submittedAnswer?.isCorrect).length; update(page, { correct, score: practice.questions.length ? Math.round(correct / practice.questions.length * 100) : 0 }); }
    } else if (kind === 'import') {
      const pending = page.data.importId || readLocal<string>('pendingImport', '');
      if (pending) { update(page, { importId: pending }); await pollImport(page); }
    } else if (kind === 'import-preview') {
      const task = await api().getImport(page.data.id); useImport(page, task);
    } else if (kind === 'recent') { update(page, { rows: readLocal<Row[]>('recent', []) }); }
  } catch (error) { update(page, { error: error instanceof Error ? error.message : '加载失败，请重试' }); }
  finally { update(page, { loading: false }); wx.stopPullDownRefresh(); }
}

export function registerPage(kind: string) {
  Page({
    data: { ...initial, kind },
    onLoad(this: Screen, options: Record<string, string | undefined>) {
      runtimes.set(this, { alive: true, version: 0, options, questionStart: Date.now() });
      this.setData({ id: options.id ?? '', source: options.source ?? 'editorial', importId: kind === 'import' ? options.id ?? '' : '', statusTop: wx.getWindowInfo().statusBarHeight });
    },
    onShow(this: Screen) { state(this).alive = true; const dark = wx.getStorageSync('bhe:dark') === true; this.setData({ dark, busy: false, playing: false, translationPending: false }); this.getTabBar?.()?.setData({ selected: kind, dark }); void load(this); },
    onHide(this: Screen) { stop(this); },
    onUnload(this: Screen) { stop(this); state(this).audio?.destroy();  },
    onPullDownRefresh(this: Screen) { void load(this); },
    onReachBottom(this: Screen) { if (this.data.kind === 'home') { update(this, { visibleCount: this.data.visibleCount + 24 }); applyFilters(this); } },
    retry(this: Screen) { void load(this); },
    go(this: Screen, event: Event) { navigate(String(event.currentTarget.dataset.page)); },
    enable(this: Screen) { void action(this, async () => { await app().ensureSession(); await load(this); }); },
    input(this: Screen, event: Event) {
      const field = String(event.currentTarget.dataset.field), value = event.detail?.value ?? '';
      if (['input', 'email', 'password', 'manualTerm', 'manualMeaning', 'query'].includes(field)) update(this, { [field]: value });
      if (field === 'query') { update(this, { visibleCount: 24 }); applyFilters(this); }
    },
    filter(this: Screen, event: Event) {
      const field = String(event.currentTarget.dataset.field), value = String(event.currentTarget.dataset.value);
      if (field === 'topic' || field === 'publication') { update(this, { [field]: value, visibleCount: 24 }); applyFilters(this); }
      if (field === 'shelfFilter') { update(this, { shelfFilter: value }); filterShelf(this); }
      if (field === 'wordFilter') { update(this, { wordFilter: value }); void load(this); }
    },
    openArticle(this: Screen, event: Event) { guardedNavigate(this, 'article', { id: String(event.currentTarget.dataset.id), source: String(event.currentTarget.dataset.source ?? 'editorial') }); },
    openRow(this: Screen, event: Event) { const data = event.currentTarget.dataset; navigate(data.source === 'editorial' ? 'article' : 'reader', { id: String(data.id), source: String(data.source) }); },
    read(this: Screen) { navigate('reader', { id: this.data.id, source: this.data.source }); },
    bookmark(this: Screen) {
      const article = this.data.article; if (!article || !('titleEn' in article)) return;
      const list = readLocal<PublishedEditorialSummary[]>('bookmarks', []).filter(item => item.id !== article.id);
      if (!this.data.bookmarked) { const { paragraphs: _paragraphs, ...summary } = article; list.unshift(summary); }
      writeLocal('bookmarks', list); update(this, { bookmarked: !this.data.bookmarked });
    },
    day(this: Screen, event: Event) { const key = String(event.currentTarget.dataset.key); if (key > dateKey(new Date())) return; update(this, { selectedDate: key, selectedMinutes: Math.floor((readLocal<Record<string, number>>('study', {})[key] ?? 0) / 60000) }); },
    more(this: Screen) { void action(this, async () => {
      if (this.data.kind === 'home') { update(this, { visibleCount: this.data.visibleCount + 24 }); applyFilters(this); return; }
      if (!this.data.cursor) return;
      if (this.data.kind === 'shelf') { const result = await api().imported(this.data.cursor); update(this, { shelfRows: [...this.data.shelfRows, ...result.items.map(importedRow)], cursor: result.nextCursor ?? '' }); filterShelf(this); }
      else { const result = await api().words(this.data.wordFilter as 'all' | 'due' | 'scheduled', this.data.cursor); update(this, { words: [...this.data.words, ...result.items], cursor: result.nextCursor ?? '' }); }
    }); },
    mode(this: Screen, event: Event) { const mode = String(event.currentTarget.dataset.value); update(this, { mode }); if (mode === 'custom') void action(this, async () => { await app().ensureSession(); const words = await api().words(); update(this, { words: words.items, cursor: words.nextCursor ?? '' }); }); },
    count(this: Screen, event: Event) { const targetCount = Math.max(1, Math.min(10, this.data.targetCount + Number(event.currentTarget.dataset.delta))); update(this, { targetCount }); writeLocal('targetCount', targetCount); },
    selectWord(this: Screen, event: Event) { const id = String(event.currentTarget.dataset.id), word = this.data.words.find(word => word.wordId === id); if (!word) return;
      let selected = this.data.selected;
      if (selected.some(item => item.wordId === id)) selected = selected.filter(item => item.wordId !== id);
      else if (selected.length < 10) selected = [...selected, word]; else { update(this, { error: '一次最多选择 10 个词' }); return; }
      update(this, { selected, words: this.data.words.map(word => ({ ...word, selected: selected.some(item => item.wordId === word.wordId) })), error: '' });
    },
    addManual(this: Screen) {
      if (!this.data.manualTerm.trim() || !this.data.manualMeaning.trim()) { update(this, { error: '请输入单词和中文释义' }); return; }
      if (this.data.selected.length >= 10) { update(this, { error: '一次最多选择 10 个词' }); return; }
      const selected = [...this.data.selected, { wordId: `manual-${Date.now()}`, term: this.data.manualTerm.trim(), meaningZh: this.data.manualMeaning.trim(), sourceSentence: null } as VocabularyWord];
      update(this, { selected, manualTerm: '', manualMeaning: '', error: '' });
    },
    createPractice(this: Screen) { void action(this, async () => {
      await app().ensureSession();
      if (this.data.mode === 'custom' && !this.data.selected.length) throw new Error('请先选择至少一个单词');
      const items: VocabularyInput[] = this.data.selected.map(word => ({ term: word.term, meaningZh: word.meaningZh, ...(word.sourceSentence ? { sourceSentence: word.sourceSentence } : {}) }));
      const result = await api().createPractice(this.data.mode === 'smart' ? { source: 'vocabulary', targetCount: this.data.targetCount, format: 'topic_set' } : { items, format: 'topic_set' });
      writeLocal('activePractice', result.practiceId); guardedNavigate(this, 'generating', { id: result.practiceId }, true);
    }); },
    resume(this: Screen) { navigate('generating', { id: this.data.activePractice || readLocal<string>('activePractice', '') }); },
    openTopic(this: Screen, event: Event) { const id = String(event.currentTarget.dataset.id), article = this.data.practice?.group?.articles.find(article => article.id === id); if (article && ['ready', 'in_progress', 'completed'].includes(article.status)) navigate('reader', { id, source: 'practice' }); },
    quiz(this: Screen) { navigate('quiz', { id: this.data.id }); },
    option(this: Screen, event: Event) { if (!this.data.feedback && !this.data.busy) update(this, { selectedOption: String(event.currentTarget.dataset.id) }); },
    answer(this: Screen, event: Event) { void action(this, async () => {
      const question = this.data.question; if (!question || this.data.feedback) return;
      const elapsedMs = Math.max(0, Math.min(3_600_000, Date.now() - state(this).questionStart));
      const dontKnow = event.currentTarget.dataset.kind === 'dont_know';
      if (!dontKnow && !this.data.selectedOption) throw new Error('请选择一个答案');
      const result = await api().answer(this.data.id, dontKnow ? { answerKind: 'dont_know', questionId: question.id, elapsedMs } : { answerKind: 'option', questionId: question.id, selectedOptionId: this.data.selectedOption, elapsedMs });
      update(this, { feedback: result });
    }); },
    nextQuestion(this: Screen) { const practice = this.data.practice; if (practice) showQuestion(this, practice, this.data.questionIndex + 1); },
    lookupWord(this: Screen, event: Event) { const term = String(event.currentTarget.dataset.term ?? ''); if (!term || term.length > 80) return;
      const paragraph = this.data.paragraphs[Number(event.currentTarget.dataset.paragraph)]; if (!paragraph) return;
      void action(this, async () => {
        await app().ensureSession();
        update(this, { lookup: null, lookupTerm: term, lookupContext: paragraph.text.slice(0, 1000), wordAdded: false });
        if (this.data.source === 'practice') {
          const target = this.data.practice?.article?.paragraphs.flatMap(paragraph => paragraph.segments).find(segment => segment.targetId && segment.text.trim().toLowerCase() === term.toLowerCase());
          if (target?.targetId) await api().assistance(this.data.id, { kind: 'word_hint', targetId: target.targetId });
        }
        const lookup = await api().lookup(term, paragraph.text); update(this, { lookup });
      });
    },
    closeLookup(this: Screen) { update(this, { lookup: null, lookupTerm: '' }); },
    addWord(this: Screen) { void action(this, async () => { if (!this.data.lookup || this.data.wordAdded) return; await api().addWord({ term: this.data.lookup.term, meaningZh: this.data.lookup.meaningZh, sourceSentence: this.data.lookupContext }); update(this, { wordAdded: true }); }); },
    mastered(this: Screen, event: Event) { void action(this, async () => { await api().mastered(String(event.currentTarget.dataset.id)); await load(this); }); },
    translate(this: Screen) { void action(this, async () => {
      await app().ensureSession(); update(this, { translationPending: true });
      try {
        if (this.data.source === 'editorial') {
          const translated: string[] = [];
          for (const paragraph of this.data.paragraphs) {
            if (!state(this).alive) break;
            const result = await api().sentence(paragraph.text); translated.push(result.translatedTextZh);
            update(this, { translated: translated.join('\n\n') });
          }
          update(this, { translationPending: false });
        } else { const result = await api().translation(this.data.id, this.data.source); await pollTranslation(this, result.id); }
      } catch (error) { update(this, { translationPending: false }); throw error; }
    }); },
    retryTopics(this: Screen) { void action(this, async () => { await api().retryTopics(this.data.practice?.group?.id ?? this.data.id); await load(this); }); },
    audio(this: Screen) {
      const article = this.data.article; if (!article || !('audioUrl' in article) || !article.audioUrl) return;
      const runtime = state(this);
      if (!runtime.audio) { const audio = wx.createInnerAudioContext(); audio.src = media(article.audioUrl); audio.onEnded(() => update(this, { playing: false })); audio.onError(() => update(this, { playing: false, error: '原刊音频暂时无法播放' })); runtime.audio = audio; }
      if (this.data.playing) runtime.audio.pause(); else runtime.audio.play(); update(this, { playing: !this.data.playing });
    },
    login(this: Screen) { void action(this, async () => { await api().login(this.data.email.trim(), this.data.password); update(this, { password: '' }); guardedNavigate(this, 'profile'); }); },
    dark(this: Screen) { const dark = !this.data.dark; wx.setStorageSync('bhe:dark', dark); update(this, { dark }); },
    logout(this: Screen) { wx.showModal({ title: '退出登录', content: '云端数据保留。再次登录同一邮箱即可继续学习。', success: result => { if (result.confirm) { app().logout(); navigate('profile'); } } }); },
    importMode(this: Screen, event: Event) { update(this, { importMode: String(event.currentTarget.dataset.value) }); },
    importArticle(this: Screen) { void action(this, async () => {
      await app().ensureSession(); if (!this.data.input.trim()) throw new Error('请先输入文章内容或链接');
      if (this.data.importMode === 'paste' && utf8Bytes(this.data.input) > 131_072) throw new Error('正文不能超过 128 KiB');
      let id = this.data.importId;
      if (!id) { const task = await api().createImport(this.data.importMode === 'paste' ? { sourceKind: 'paste' } : { sourceKind: 'url', url: this.data.input }); id = task.id; writeLocal('pendingImport', id); update(this, { importId: id }); }
      if (this.data.importMode === 'paste') { await api().paste(id, this.data.input); await api().processImport(id); }
      await pollImport(this);
    }); },
    file(this: Screen, event: Event) { void action(this, async () => {
      await app().ensureSession();
      const album = event.currentTarget.dataset.kind === 'album';
      const files = album ? await new Promise<{ path: string; size: number; mediaType: ImportAssetDescriptor['mediaType'] }[]>((resolve, reject) => wx.chooseMedia({ count: 10, mediaType: ['image'], sourceType: ['album'], success: result => resolve(result.tempFiles.map(file => ({ path: file.tempFilePath, size: file.size, mediaType: file.tempFilePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg' }))), fail: () => reject(new Error('未选择图片')) }))
        : await new Promise<{ path: string; size: number; mediaType: ImportAssetDescriptor['mediaType'] }[]>((resolve, reject) => wx.chooseMessageFile({ count: 1, type: 'file', extension: ['pdf', 'txt', 'md', 'docx', 'epub'], success: result => resolve(result.tempFiles.map(file => ({ path: file.path, size: file.size, mediaType: file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : file.name.toLowerCase().endsWith('.txt') ? 'text/plain' : file.name.toLowerCase().endsWith('.md') ? 'text/markdown' : file.name.toLowerCase().endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/octet-stream' }))), fail: () => reject(new Error('未选择文件')) }));
      state(this).importFiles = files;
      if (files.some(file => file.size > 10_485_760) || files.reduce((sum, file) => sum + file.size, 0) > 31_457_280) throw new Error('单文件上限 10 MiB，整批上限 30 MiB');
      const task = await api().createImport({ sourceKind: album ? 'album' : 'local_file', assets: files.map((file, position) => ({ position, mediaType: file.mediaType, byteSize: file.size })) });
      update(this, { importId: task.id, importStatus: 'awaiting_upload' }); writeLocal('pendingImport', task.id);
      await uploadFiles(this); await pollImport(this);
    }); },
    retryUpload(this: Screen) { void action(this, async () => { await uploadFiles(this); await pollImport(this); }); },
    retryImport(this: Screen) { void action(this, async () => { await api().retryImport(this.data.importId); await pollImport(this); }); },
    newImport(this: Screen) { state(this).version += 1; if (state(this).timer) clearTimeout(state(this).timer); writeLocal('pendingImport', ''); update(this, { importId: '', importStatus: '', uploadCode: '', error: '', message: '', input: '' }); },
    confirmImport(this: Screen, event: Event) { void action(this, async () => { const decision = event.currentTarget.dataset.decision;
      const task = await api().confirmImport(this.data.importId, decision === 'open_existing' || decision === 'save_new_version' ? { similarityDecision: decision } : {});
      if (task.articleId) { writeLocal('pendingImport', ''); guardedNavigate(this, 'reader', { id: task.articleId, source: 'imported' }, true); }
    }); },
    computer(this: Screen) { void action(this, async () => { await app().ensureSession(); const result = await api().computer(); update(this, { uploadCode: result.uploadCode, uploadUrl: result.uploadUrl, expiresAt: result.expiresAt, importId: result.importId }); writeLocal('pendingImport', result.importId);
      const poll = async () => { const status = await api().computerStatus(result.sessionId); if (status.status === 'expired') { update(this, { error: '上传码已过期，请重新获取', uploadCode: '' }); return; } if (status.status === 'uploaded') { update(this, { uploadCode: '' }); await pollImport(this); } else schedule(this, poll, 5000); }; schedule(this, poll, 5000);
    }); },
    copyUpload(this: Screen) { wx.setClipboardData({ data: `${this.data.uploadUrl}\n上传码：${this.data.uploadCode}` }); },
    plan(this: Screen, event: Event) { update(this, { plan: String(event.currentTarget.dataset.value) }); },
    invite(this: Screen) { update(this, { inviteOpen: !this.data.inviteOpen }); },
  });
}
async function uploadFiles(page: Screen) {
  const files = state(page).importFiles;
  if (!files?.length) throw new Error('临时文件已不可用，请重新导入');
  for (const [position, file] of files.entries()) {
    const data = await new Promise<ArrayBuffer>((resolve, reject) => wx.getFileSystemManager().readFile({ filePath: file.path, success: result => typeof result.data === 'string' ? reject(new Error('文件读取失败')) : resolve(result.data), fail: () => reject(new Error('文件读取失败，请重新选择文件')) }));
    await api().asset(page.data.importId, position, data, file.mediaType);
  }
  await api().processImport(page.data.importId); delete state(page).importFiles;
}
