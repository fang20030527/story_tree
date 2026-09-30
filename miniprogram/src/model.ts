import type { PublishedEditorialSummary } from '@context-reader/contracts';
export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function heatmap(totals: Record<string, number>, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() - 84);
  const today = dateKey(now);
  return Array.from({ length: 13 }, (_, week) => ({ week, days: Array.from({ length: 7 }, (_, day) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + week * 7 + day), key = dateKey(date), ms = key > today ? 0 : totals[key] ?? 0;
    return { key, minutes: Math.floor(ms / 60_000), future: key > today, today: key === today, level: ms === 0 ? 0 : ms < 300_000 ? 1 : ms < 600_000 ? 2 : ms < 1_200_000 ? 3 : 4 };
  }) }));
}
export function filterEditorial(articles: PublishedEditorialSummary[], topic: string, publication: string, query: string) {
  const normalized = query.trim().toLowerCase();
  return articles.filter(article => (topic === '全部' || topic === article.category)
    && (publication === '全部外刊' || publication === article.source)
    && `${article.titleZh} ${article.titleEn} ${article.source}`.toLowerCase().includes(normalized));
}
export function tokens(text: string) {
  return text.split(/([A-Za-z]+(?:['’-][A-Za-z]+)*)/u).filter(Boolean).map((part, index) => ({ text: part, term: /^[A-Za-z]/u.test(part) ? part : '', index }));
}
export function utf8Bytes(text: string) {
  let count = 0;
  for (const character of text) { const point = character.codePointAt(0)!; count += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4; }
  return count;
}
