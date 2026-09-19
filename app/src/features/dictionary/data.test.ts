import { WordTranslationResultSchema } from '@context-reader/contracts';

import { dictionaryShards } from './generated';
import manifest from './manifest.json';

it('ships a consistent dictionary whose definitions satisfy the shared contract', () => {
  const entries = new Map(dictionaryShards.flatMap((load) => Object.entries(load())));
  let definitions = 0;
  let aliases = 0;
  for (const [key, entry] of entries) {
    let shard = 0;
    for (const character of key) shard = (shard * 31 + character.codePointAt(0)!) % dictionaryShards.length;
    if (!Object.prototype.hasOwnProperty.call(dictionaryShards[shard](), key)) {
      throw new Error(`词条分片不匹配：${key}`);
    }
    if (typeof entry === 'string') {
      aliases += 1;
      if (typeof entries.get(entry) !== 'object') throw new Error(`跳转未解析：${key}`);
    } else {
      definitions += 1;
      const { baseTerm, ...definition } = entry;
      const result = WordTranslationResultSchema.safeParse(definition);
      if (!result.success) throw new Error(`词条格式错误：${key} ${result.error.message}`);
      if (baseTerm && !entries.has(baseTerm)) throw new Error(`词形目标缺失：${key}`);
    }
  }
  expect(definitions).toBe(manifest.entryCount);
  expect(aliases).toBe(manifest.aliasCount);
  expect(dictionaryShards).toHaveLength(manifest.shardCount);
});
