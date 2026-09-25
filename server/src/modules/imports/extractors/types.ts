import type { ImportedArticleMedia } from '@context-reader/contracts';

export interface ExtractedArticle {
  title: string | null;
  text: string;
  media?: ImportedArticleMedia[];
}

export interface ImportAssetInput {
  position: number;
  mediaType: string;
  content: Buffer;
}
