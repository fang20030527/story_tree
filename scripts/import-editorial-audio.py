"""将固定 GitHub 快照的音频清单按刊物、期号、完整标题匹配到外刊。仅用标准库。"""
from concurrent.futures import ThreadPoolExecutor
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import re
import unicodedata
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'app/src/features/editorial/epub'
CACHE = ROOT / '.local-test-results/epub-import/audio'
REPO = 'hehonghui/awesome-english-ebooks'
COMMIT = '31d15f6ae17b7ca1c622ed8488e11e9cf6669f8c'


def title_key(title):
    text = unicodedata.normalize('NFKC', title).casefold()
    return ' '.join(text.translate(str.maketrans({'’': "'", '‘': "'", '“': '"', '”': '"', '–': '-', '—': '-'})).split())


def match_entries(articles, manifests):
    index = defaultdict(list)
    for article in articles:
        index[(article['source'], article['issueDate'], title_key(article['titleEn']))].append(article['id'])
    candidates = defaultdict(list)
    unmatched = []
    for manifest in manifests:
        for entry in manifest['entries']:
            record = dict(entry, issueDate=manifest['issueDate'], manifest=manifest['path'])
            url = urlsplit(entry['url'])
            if url.scheme != 'https' or url.hostname != 'www.economist.com' or not url.path.startswith('/media-assets/audio/') or not url.path.endswith('.mp3'):
                unmatched.append(dict(record, reason='invalid_url'))
                continue
            ids = index[('The Economist', manifest['issueDate'], title_key(entry['article']))]
            if len(ids) != 1:
                unmatched.append(dict(record, reason='ambiguous_title' if ids else 'no_matching_title'))
            else:
                candidates[ids[0]].append(record)
    matched = {}
    for article_id, records in candidates.items():
        if len({r['url'] for r in records}) != 1:
            unmatched.extend(dict(r, reason='conflicting_audio') for r in records)
        else:
            matched[article_id] = records[0]
    return matched, unmatched


def fetch(url):
    with urlopen(Request(url, headers={'User-Agent': 'editorial-audio-import'}), timeout=60) as response:
        return response.read()


def load_manifest(node):
    path = CACHE / (node['sha'] + '.json')
    data = path.read_bytes() if path.exists() else fetch(f'https://raw.githubusercontent.com/{REPO}/{COMMIT}/{quote(node["path"])}')
    digest = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
    if digest != node['sha']:
        raise ValueError('音频清单 Git blob 校验失败')
    path.write_bytes(data)
    date = re.search(r'(\d{4})\.(\d{2})\.(\d{2})_audios.json$', node['path'])
    if not date:
        raise ValueError('音频清单日期无法识别')
    return {'path': node['path'], 'blob': node['sha'], 'issueDate': '-'.join(date.groups()), 'entries': json.loads(data)}


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    tree = json.loads(fetch(f'https://api.github.com/repos/{REPO}/git/trees/{COMMIT}?recursive=1'))
    if tree.get('truncated'):
        raise ValueError('仓库目录不完整')
    nodes = sorted((n for n in tree['tree'] if n['path'].endswith('_audios.json')), key=lambda n: n['path'])
    with ThreadPoolExecutor(max_workers=5) as pool:
        manifests = list(pool.map(load_manifest, nodes))
    articles = json.loads((OUT / 'index.json').read_text(encoding='utf-8'))
    matched, unmatched = match_entries(articles, manifests)
    mapping = {key: value['url'] for key, value in sorted(matched.items())}
    report = {'repository': REPO, 'commit': COMMIT, 'manifestCount': len(manifests),
              'entryCount': sum(len(m['entries']) for m in manifests), 'matchedCount': len(matched),
              'manifests': [{k: v for k, v in m.items() if k != 'entries'} for m in manifests],
              'matched': matched, 'unmatched': unmatched}
    for name, data in [('audio.json', mapping), ('audio-report.json', report)]:
        (OUT / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({k: report[k] for k in ['manifestCount', 'entryCount', 'matchedCount']}, ensure_ascii=False))
    print('unmatched:', len(unmatched))


if __name__ == '__main__':
    main()
