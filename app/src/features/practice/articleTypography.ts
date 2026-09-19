/** 导入的历史正文没有标题元数据，仅识别独立短标题，避免放大普通句子。 */
export function isArticleSectionHeading(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.includes('\n') || trimmed.length > 100) return false;
  const words = trimmed.split(/\s+/);
  if (words.length > 12) return false;
  if (/[.!。！;；,，:：]["'”’)]?$/.test(trimmed)) return false;
  if (/[?？]$/.test(trimmed)) {
    return /^(how|why|what|when|where|who|which)\b/i.test(trimmed);
  }
  return !/[.!?。！？]/.test(trimmed);
}
