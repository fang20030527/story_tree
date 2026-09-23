"""为批量 EPUB 索引生成中文标题、中文主题和雅思阅读难度。

标题译文由 JSON 文件提供，键为英文原标题、值为中文标题（发布前可校订）：
python scripts/enrich-editorial-metadata.py --titles path/to/title-translations.json
重跑时会保留与原题匹配的已有中文标题，新增原题缺少译文则拒绝发布。
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re

from editorial_metadata import category_zh, reading_level


ROOT = Path(__file__).resolve().parents[1]
EPUB = ROOT / 'app/src/features/editorial/epub'
INDEX = EPUB / 'index.json'
OUTPUT = EPUB / 'metadata-zh.json'
HAN = re.compile(r'[\u3400-\u9fff]')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--titles', type=Path, help='英文原标题到中文标题的 JSON 映射')
    args = parser.parse_args()
    translations = json.loads(args.titles.read_text(encoding='utf-8')) if args.titles else {}
    if not isinstance(translations, dict):
        raise ValueError('标题译文必须是 JSON 对象')
    index = json.loads(INDEX.read_text(encoding='utf-8'))
    existing = json.loads(OUTPUT.read_text(encoding='utf-8')) if OUTPUT.exists() else {}
    grouped: dict[str, list[dict]] = {}
    for article in index:
        grouped.setdefault(article['issueKey'], []).append(article)
    enriched: dict[str, dict] = {}
    missing: set[str] = set()
    for issue_key, articles in grouped.items():
        body_path = EPUB / 'issues' / f'{issue_key}.json'
        bodies = json.loads(body_path.read_text(encoding='utf-8'))
        for article in articles:
            article_id = article['id']
            english = article['titleEn']
            previous = existing.get(article_id, {})
            old_title = previous.get('titleZh') if previous.get('titleEn') == english else None
            translated = translations.get(english) or old_title
            if (not isinstance(translated, str) or not HAN.search(translated)
                    or '\n' in translated or len(translated) > 140
                    or re.search(r'<[^>]*>', translated)):
                missing.add(english)
                continue
            blocks = bodies.get(article_id)
            if not isinstance(blocks, list) or not blocks:
                raise ValueError(f'正文缺失：{article_id}')
            enriched[article_id] = {
                'titleEn': english,
                'titleZh': translated.strip(),
                'category': category_zh(article['source'], article['category'], english),
                'level': reading_level(blocks, article['wordCount']),
            }
    if missing:
        sample = ', '.join(sorted(missing)[:8])
        raise ValueError(f'{len(missing)} 个英文标题缺少中文译文；请补全 --titles：{sample}')
    if len(enriched) != len(index):
        raise ValueError('中文元数据条数与 EPUB 索引不一致')
    OUTPUT.write_text(json.dumps(enriched, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    print(f'已补全 {len(enriched)} 篇原刊元数据')


if __name__ == '__main__':
    main()
