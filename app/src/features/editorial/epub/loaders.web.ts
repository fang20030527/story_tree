import type { EpubMetadata, RawEpubBlock } from '../epubCatalog';

export const epubMetadata = require('./index.json') as EpubMetadata[];

type IssueBody = Record<string, RawEpubBlock[]>;
const loadedIssues = new Map<string, IssueBody>();
const pendingIssues = new Map<string, Promise<void>>();

export async function prefetchEpubIssue(issueKey: string): Promise<void> {
  if (loadedIssues.has(issueKey)) return;
  if (!/^[a-z0-9-]+$/u.test(issueKey)) throw new Error('外刊期号格式无效');
  const pending = pendingIssues.get(issueKey);
  if (pending) return pending;

  const operation = (async () => {
    const response = await fetch(`/epub/issues/${issueKey}.json`);
    if (!response.ok) throw new Error('外刊正文加载失败');
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('外刊正文格式无效');
    }
    loadedIssues.set(issueKey, body as IssueBody);
  })();
  pendingIssues.set(issueKey, operation);
  try {
    await operation;
  } finally {
    pendingIssues.delete(issueKey);
  }
}

export const issueLoaders: Record<string, () => IssueBody> = new Proxy({}, {
  get(_target, issueKey) {
    if (typeof issueKey !== 'string') return undefined;
    return () => {
      const issue = loadedIssues.get(issueKey);
      if (!issue) throw new Error('外刊正文尚未加载');
      return issue;
    };
  },
});
