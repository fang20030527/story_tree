"""按期号和标题把本地《经济学人》录音关联到精选外刊文章。"""
import argparse
from collections import defaultdict
import html
import json
from pathlib import Path
import re
import unicodedata
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
EPUB = ROOT / 'app/src/features/editorial/epub'
SPECIAL_ISSUE = ROOT / 'app/src/features/editorial/issues/economist-2026-09-19.json'
DUPLICATES = ROOT / 'app/src/features/editorial/duplicateArticles.json'
FILENAME = re.compile(r'^(?P<number>\d{3}) - (?P<title>.+) - (?P<digest>[0-9a-f]{10})\.mp3$', re.IGNORECASE)
ISSUE_DATE = re.compile(r'^\d{4}-\d{2}-\d{2}$')


def title_key(value):
    text = html.unescape(unicodedata.normalize('NFKC', value)).casefold()
    text = re.sub(r'<[^>]*>', ' ', text)
    text = text.replace('_', ' ')
    text = text.translate(str.maketrans({
        '’': "'", '‘': "'", '“': '"', '”': '"', '–': '-', '—': '-',
    }))
    return ' '.join(re.sub(r'[^\w]+', ' ', text, flags=re.UNICODE).split())


def read_articles():
    articles = json.loads((EPUB / 'index.json').read_text(encoding='utf-8'))
    articles.extend(json.loads(SPECIAL_ISSUE.read_text(encoding='utf-8')))
    return [article for article in articles
            if article.get('source') == 'The Economist'
            and article.get('id') and article.get('issueDate')
            and article.get('titleEn')]


def candidate_target(candidates, duplicate_ids):
    targets = {duplicate_ids.get(article['id'], article['id']) for article in candidates}
    if len(targets) != 1:
        return None
    return next(iter(targets))


def make_audio_url(article_id):
    return f'/v1/editorial/audio/{quote(article_id, safe="")}'


def import_audio(audio_root):
    if not audio_root.is_dir():
        raise ValueError(f'音频目录不存在：{audio_root}')
    missing_years = [year for year in ('2025', '2026') if not (audio_root / year).is_dir()]
    if missing_years:
        raise ValueError(f'缺少音频年份目录：{", ".join(missing_years)}')

    articles = read_articles()
    articles_by_date = defaultdict(list)
    for article in articles:
        articles_by_date[article['issueDate']].append(article)
    duplicates = json.loads(DUPLICATES.read_text(encoding='utf-8'))

    candidates_by_article = defaultdict(list)
    unmatched = []
    scanned = 0
    for year in ('2025', '2026'):
        year_directory = audio_root / year
        if not year_directory.is_dir():
            continue
        for issue_directory in sorted(year_directory.iterdir()):
            issue_date = issue_directory.name
            if not issue_directory.is_dir() or not ISSUE_DATE.fullmatch(issue_date):
                continue
            if issue_date[:4] != year:
                continue
            by_title = defaultdict(list)
            for article in articles_by_date.get(issue_date, []):
                by_title[title_key(article['titleEn'])].append(article)

            for source_file in sorted(issue_directory.iterdir()):
                if not source_file.is_file() or source_file.suffix.casefold() != '.mp3':
                    continue
                scanned += 1
                match = FILENAME.fullmatch(source_file.name)
                if not match:
                    unmatched.append({
                        'issueDate': issue_date,
                        'file': source_file.name,
                        'reason': 'invalid_filename',
                    })
                    continue

                file_title = match.group('title')
                key = title_key(file_title)
                exact = by_title.get(key, [])
                match_type = 'exact'
                selected = exact
                if not selected:
                    selected = [article for article in articles_by_date.get(issue_date, [])
                                if len(key) >= 32
                                and title_key(article['titleEn']).startswith(key)]
                    match_type = 'truncated_title'

                if not selected:
                    unmatched.append({
                        'issueDate': issue_date,
                        'file': source_file.name,
                        'title': file_title,
                        'reason': 'no_matching_title',
                    })
                    continue

                target_id = candidate_target(selected, duplicates)
                if target_id is None:
                    unmatched.append({
                        'issueDate': issue_date,
                        'file': source_file.name,
                        'title': file_title,
                        'candidateArticleIds': [article['id'] for article in selected],
                        'reason': 'ambiguous_title',
                    })
                    continue

                if any(article['id'] != target_id for article in selected):
                    match_type = 'duplicate_alias'
                candidates_by_article[target_id].append({
                    'issueDate': issue_date,
                    'file': source_file.name,
                    'relativePath': f'{year}/{issue_date}/{source_file.name}',
                    'title': file_title,
                    'matchType': match_type,
                })

    if scanned == 0:
        raise ValueError('音频目录中没有可导入的 MP3 文件')

    mapping = {}
    server_mapping = {}
    matched = []
    for article_id, records in sorted(candidates_by_article.items()):
        if len(records) != 1:
            unmatched.extend({
                'issueDate': record['issueDate'],
                'file': record['file'],
                'title': record['title'],
                'articleId': article_id,
                'reason': 'multiple_audio_files_for_article',
            } for record in records)
            continue
        record = records[0]
        mapping[article_id] = make_audio_url(article_id)
        server_mapping[article_id] = record['relativePath']
        matched.append({'articleId': article_id, **record})

    counts = defaultdict(int)
    for record in matched:
        counts[record['matchType']] += 1
    report = {
        'sourceFolders': ['2025', '2026'],
        'scannedFileCount': scanned,
        'matchedArticleCount': len(mapping),
        'matchTypes': dict(sorted(counts.items())),
        'unmatchedFileCount': len(unmatched),
        'matched': matched,
        'unmatched': unmatched,
    }
    (EPUB / 'audio-local.json').write_text(
        json.dumps(mapping, ensure_ascii=False, indent=2) + '\n', encoding='utf-8',
    )
    (EPUB / 'audio-local-report.json').write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8',
    )
    server_manifest = ROOT / 'server/assets/editorial/audio-local.json'
    server_manifest.parent.mkdir(parents=True, exist_ok=True)
    server_manifest.write_text(
        json.dumps(server_mapping, ensure_ascii=False, indent=2) + '\n', encoding='utf-8',
    )
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('audio_root', type=Path, help='包含 2025/ 和 2026/ 子目录的音频目录')
    args = parser.parse_args()
    report = import_audio(args.audio_root)
    print(json.dumps({key: report[key] for key in (
        'scannedFileCount', 'matchedArticleCount', 'matchTypes', 'unmatchedFileCount',
    )}, ensure_ascii=False))


if __name__ == '__main__':
    main()
