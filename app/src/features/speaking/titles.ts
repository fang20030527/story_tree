/** 中文标题用系统粗体显示；分隔点跟随前一个词，避免换行后出现在行首。 */
export function speakingTitleText(title: string): string {
  return title.replace(/ ·(?= )/gu, ' ·');
}
