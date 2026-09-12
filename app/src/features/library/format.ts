import type { ArticleImportSourceKind } from '@context-reader/contracts';

export function sourceLabel(sourceKind: ArticleImportSourceKind): string {
  switch (sourceKind) {
    case 'url':
      return '网页链接';
    case 'paste':
      return '粘贴正文';
    case 'album':
      return '相册';
    case 'local_file':
      return '本地文件';
    case 'computer':
      return '电脑上传';
  }
}

export function formatEntryDate(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('zh-CN');
}
