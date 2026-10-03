/** 系统分享与「在其他应用中打开」都进入口语导入，不把文件路径放进路由参数。 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    const url = new URL(path);
    if (url.hostname === 'expo-sharing') return `/speaking/import?source=shared&share=${Date.now()}`;
    return path;
  } catch { return path; }
}
