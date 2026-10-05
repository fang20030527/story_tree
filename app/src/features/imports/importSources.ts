/** The ways to bring an article in, in the order the import screens list them. */
export const importSources = [
  { id: 'link', label: '网页链接', icon: 'link' },
  { id: 'paste', label: '粘贴正文', icon: 'clipboard' },
  { id: 'album', label: '相册', icon: 'image' },
  { id: 'local', label: '本地', icon: 'folder' },
  { id: 'computer', label: '电脑', icon: 'laptop-outline' },
] as const;
