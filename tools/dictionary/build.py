"""将用户提供的剑桥 MDX 转成随客户端打包的文本词典，不执行 HTML 脚本。"""

import argparse
import hashlib
import json
from os.path import commonprefix
from pathlib import Path
import re
import unicodedata

from lxml import html


SHARDS = 128
POS = {
    'noun': 'n.', 'verb': 'v.', 'adjective': 'adj.', 'adverb': 'adv.',
    'pronoun': 'pron.', 'preposition': 'prep.', 'conjunction': 'conj.',
    'determiner': 'det.', 'exclamation': 'excl.', 'interjection': 'int.',
    'auxiliary verb': 'aux.', 'modal verb': 'modal v.', 'phrasal verb': 'phr. v.',
    'prefix': 'pref.', 'suffix': 'suf.', 'number': 'num.', 'idiom': 'idiom',
}
CHINESE = re.compile(r'[\u3400-\u9fff]')
FORM = re.compile(r'[（(]([a-zA-Z][a-zA-Z \x27-]*?)\s*的(?:复数|过去式|过去分词|现在分词|第三人称单数|比较级|最高级)')


def normalize_term(term):
    term = unicodedata.normalize('NFKC', term)
    term = re.sub('[‘’]', "'", term)
    term = re.sub('[‐‑–—]', '-', term)
    return re.sub(r'\s+', ' ', term).strip().lower()


def has_class(name):
    return "contains(concat(' ', normalize-space(@class), ' '), ' " + name + " ')"


def elements(node, name):
    return node.xpath('descendant-or-self::*[' + has_class(name) + ']')


def text(node):
    return re.sub(r'\s+', ' ', ''.join(node.itertext())).strip()


def compact_meanings(meanings, separator='；', limit=200):
    result = ''
    for meaning in dict.fromkeys(meanings):
        candidate = result + (separator if result else '') + meaning
        if len(candidate) > limit - 2:
            return (result + separator + '…') if result else meaning[:limit - 1] + '…'
        result = candidate
    return result


def parse_entry(value):
    value = value.strip('\x00\r\n ')
    if value.startswith('@@@LINK='):
        return normalize_term(value[8:])
    if not CHINESE.search(value):
        return None
    try:
        document = html.fromstring(value)
    except (ValueError, html.etree.ParserError):
        return None
    groups = {}
    phonetics = {'phoneticUk': None, 'phoneticUs': None}
    for block in elements(document, 'entry-body__el'):
        translations = block.xpath('.//*[' + has_class('ddef_d') + ']//*[' + has_class('trans') + ']')
        meanings = []
        for translation in translations:
            # 独立的短语义项不能混进主词条，例句也不是词义。
            if any('phrase-block' in ancestor.get('class', '').split()
                   or 'examp' in ancestor.get('class', '').split()
                   for ancestor in translation.iterancestors()):
                continue
            meaning = text(translation)
            if CHINESE.search(meaning) and meaning not in meanings:
                meanings.append(meaning)
        if not meanings:
            continue
        headers = elements(block, 'pos-header')
        header = headers[0] if headers else block
        poses = elements(header, 'pos')
        pos = text(poses[0]) if poses else '—'
        pos = POS.get(pos, pos)[:40]
        groups.setdefault(pos, []).extend(meanings)
        for region, field in [('uk', 'phoneticUk'), ('us', 'phoneticUs')]:
            region_nodes = elements(header, region)
            ipas = elements(region_nodes[0], 'ipa') if region_nodes else []
            if ipas and not phonetics[field]:
                phonetics[field] = '/' + text(ipas[0]).strip('/')[:198] + '/'
    if not groups:
        return None
    labels = list(groups)
    lines = [((pos + ' ') if len(groups) > 1 else '') + compact_meanings(meanings)
             for pos, meanings in groups.items()]
    result = {
        'partOfSpeech': compact_meanings(labels, ' / ', 40),
        'meaningZh': compact_meanings(lines, '\n'),
        **phonetics,
    }
    forms = FORM.findall(result['meaningZh'])
    if forms:
        result['baseTerm'] = normalize_term(forms[0])
    return result


def shard_for(term):
    result = 0
    for character in term:
        result = (result * 31 + ord(character)) % SHARDS
    return result


def prefer_entry(key, previous, entry):
    if previous is None:
        return entry
    if isinstance(entry, dict):
        return previous if isinstance(previous, dict) else entry
    if isinstance(previous, dict):
        return previous
    # MDX 含同名跳转（如 restores → store / restore），优先同词干目标。
    def score(target):
        return (len(commonprefix([key, target])), -abs(len(key) - len(target)))
    return entry if score(entry) > score(previous) else previous


def build(source, output):
    from readmdict import MDX

    dictionary = MDX(str(source))
    entries = {}
    for index, (raw_key, raw_value) in enumerate(dictionary.items()):
        key = normalize_term(raw_key.decode('utf-8'))
        # 跳过词典 UI、语法/例句/同义词页面等非查词索引。
        if len(key) > 80 or '_' in key or '.html' in key or not re.search('[a-z]', key):
            continue
        entry = parse_entry(raw_value.decode('utf-8'))
        if entry and entry != key:
            entries[key] = prefer_entry(key, entries.get(key), entry)
        if index % 10000 == 0:
            print(f'扫描 {index}/{len(dictionary)}，已保留 {len(entries)} 项', flush=True)

    def resolve(key):
        seen = set()
        while key not in seen:
            seen.add(key)
            value = entries.get(key)
            if not isinstance(value, str):
                return key if value else None
            key = value
        return None

    # 扁平化跳转链并删除循环/无中文目标，保证每个打包索引均可查。
    usable = {}
    for key, value in entries.items():
        target = resolve(key)
        if target:
            usable[key] = target if isinstance(value, str) else value
    for value in usable.values():
        if isinstance(value, dict) and value.get('baseTerm') not in usable:
            value.pop('baseTerm', None)
    shards = [{} for _ in range(SHARDS)]
    for key in sorted(usable):
        shards[shard_for(key)][key] = usable[key]
    data_path = output / 'data'
    data_path.mkdir(parents=True, exist_ok=True)
    total_bytes = 0
    for index, shard in enumerate(shards):
        payload = json.dumps(shard, ensure_ascii=False, separators=(',', ':')) + '\n'
        (data_path / f'{index:03}.json').write_text(payload, encoding='utf-8')
        total_bytes += len(payload.encode('utf-8'))
    loaders = '\n'.join(f"  () => require('./data/{i:03}.json') as DictionaryShard," for i in range(SHARDS))
    (output / 'generated.ts').write_text(
        '// 此文件由 tools/dictionary/build.py 生成，请勿手改。\n'
        "import type { DictionaryShard } from './types';\n\n"
        '// 静态 require 确保所有分片随发布包提供，查询时才解析对应分片。\n'
        'export const dictionaryShards: readonly (() => DictionaryShard)[] = [\n' + loaders + '\n];\n',
        encoding='utf-8',
    )
    digest = hashlib.sha256()
    with source.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    manifest = {
        'formatVersion': 1, 'source': 'CDEPE En-Cn V2025.5.18',
        'sourceSha256': digest.hexdigest(), 'sourceIndexCount': len(dictionary),
        'entryCount': sum(isinstance(v, dict) for v in usable.values()),
        'aliasCount': sum(isinstance(v, str) for v in usable.values()),
        'shardCount': SHARDS, 'dataBytes': total_bytes,
        'notice': '原词典声明：仅供个人学习研究使用，不得用于商业用途。',
    }
    (output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(manifest, ensure_ascii=False, indent=2), flush=True)


if __name__ == '__main__':
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=root / '剑桥在线英汉双解词典完美版/cdepe.mdx')
    parser.add_argument('--output', type=Path, default=root / 'app/src/features/dictionary')
    args = parser.parse_args()
    build(args.source, args.output)
