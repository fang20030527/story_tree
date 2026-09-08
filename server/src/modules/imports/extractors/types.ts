export interface ExtractedArticle {
  title: string | null;
  text: string;
}

export interface ImportAssetInput {
  position: number;
  mediaType: string;
  content: Buffer;
}
