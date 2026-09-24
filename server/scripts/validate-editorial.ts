import { fileURLToPath } from 'node:url';

import { createPublishedEditorialStore } from '../src/modules/editorial/published-content';

const directory = fileURLToPath(new URL('../../content/editorial/', import.meta.url));
const store = createPublishedEditorialStore(directory);

try {
  const { catalog } = await store.validate();
  process.stdout.write(`已校验 ${catalog.articles.length} 篇已发布外刊。\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : '外刊内容校验失败'}\n`);
  process.exitCode = 1;
}
