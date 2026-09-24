"""批量导入固定 GitHub 快照的 EPUB；依赖 lxml、Pillow、imageio-ffmpeg。

python scripts/import-english-epubs.py [--workers 6] [--limit 4]
原包缓存可续跑，按 Git blob SHA 校验；无数据库或 AI 调用。
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import io
import json
import math
import os
from pathlib import Path
import posixpath
import re
import subprocess
import tempfile
import time
from urllib.parse import unquote, urlsplit, quote
from urllib.request import Request, urlopen
import zipfile

from lxml import etree
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.local-test-results/epub-import'
OUT = ROOT / 'app/src/features/editorial/epub'
ASSETS = ROOT / 'server/assets/editorial/epub'
REPO = 'hehonghui/awesome-english-ebooks'
COMMIT = '31d15f6ae17b7ca1c622ed8488e11e9cf6669f8c'
SOURCES = {'01_economist': ('economist', 'The Economist'),
           '02_new_yorker': ('new-yorker', 'The New Yorker'),
           '04_atlantic': ('atlantic', 'The Atlantic'), '05_wired': ('wired', 'WIRED')}
PRESERVED = 'economist-2026-09-19'


def plain(node):
    return re.sub(r'\s+', ' ', ''.join(node.itertext())).strip() if node is not None else ''


def tag(node):
    return etree.QName(node).localname if isinstance(node.tag, str) else ''


def parse(data):
    # 部分 Calibre 导出的 WIRED 页面带有非法 xmlns:xmlns 声明。
    # 只清理这一冗余声明，仍使用严格解析，避免恢复模式静默截断正文。
    data = re.sub(rb'\s+xmlns:xmlns=(?:"[^"]*"|\x27[^\x27]*\x27)', b'', data)
    root = etree.fromstring(data, parser=etree.XMLParser(resolve_entities=False, no_network=True))
    for line_break in root.findall('.//{*}br'):
        line_break.text = ' '
    return root


def local_path(base, href):
    # ZIP 内可合法存在带冒号的目录名（如 Cartoon: How 9/...）。
    if '://' in href or href.startswith('//') or href.lower().startswith(('data:', 'javascript:', 'file:')):
        raise ValueError('EPUB 内部资源不能是远程地址')
    path = posixpath.normpath(posixpath.join(posixpath.dirname(base), unquote(href.split('#')[0].split('?')[0])))
    if path.startswith('../') or path.startswith('/'):
        raise ValueError('EPUB 资源路径越界')
    return path


def toc_entries(archive):
    container = parse(archive.read('META-INF/container.xml'))
    opf_path = container.find('.//{*}rootfile').get('full-path')
    opf = parse(archive.read(opf_path))
    ncx_item = next(n for n in opf.findall('.//{*}item')
                    if n.get('media-type') == 'application/x-dtbncx+xml')
    ncx_path = local_path(opf_path, ncx_item.get('href'))
    nav = parse(archive.read(ncx_path)).find('{*}navMap')
    entries, seen, duplicates = [], set(), []

    def visit(parent, section='原刊'):
        for point in parent.findall('{*}navPoint'):
            title = plain(point.find('{*}navLabel/{*}text'))
            if point.findall('{*}navPoint'):
                visit(point, title)
            else:
                href = point.find('{*}content').get('src')
                path = local_path(ncx_path, href)
                if path in seen:
                    duplicates.append(path)
                    continue
                seen.add(path)
                entries.append((path, title, section))
    visit(nav)
    if not entries:
        raise ValueError('期刊目录为空')
    items = {n.get('id'): n for n in opf.findall('.//{*}item')}
    cover_id = next((n.get('content') for n in opf.findall('.//{*}meta') if n.get('name') == 'cover'), None)
    cover_item = items.get(cover_id)
    if cover_item is None:
        cover_item = next((n for n in items.values() if 'cover-image' in n.get('properties', '').split()), None)
    cover = local_path(opf_path, cover_item.get('href')) if cover_item is not None else next(
        (n for n in archive.namelist() if re.search(r'(^|/)cover\.(jpg|jpeg|png)$', n, re.I)), None)
    spine = [local_path(opf_path, items[n.get('idref')].get('href')) for n in opf.findall('.//{*}spine/{*}itemref')]
    expanded = []
    for index, (path, title, section) in enumerate(entries):
        pages = [path]
        # 旧版 Calibre 会将一篇长文拆成多个连续文件；目录仅链接首个文件。
        if 'index_split_' in path:
            start = spine.index(path)
            end = spine.index(entries[index + 1][0]) if index + 1 < len(entries) else len(spine)
            pages = spine[start:end]
            if not pages:
                raise ValueError('目录与 spine 顺序不一致: ' + path)
        expanded.append((path, title, section, pages))
    return expanded, cover, duplicates


def body_blocks(root, image):
    """按 DOM 顺序保留混排文本、段落、列表、表格及插图，不渲染 HTML。"""
    blocks = []
    text_tags = {'p', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'figcaption', 'td', 'th', 'pre'}
    forbidden = {'script', 'style', 'nav', 'noscript', 'source', 'svg'}

    def add_text(value):
        value = re.sub(r'\s+', ' ', value).strip()
        if value:
            blocks.append({'type': 'text', 'text': value})

    def visit(node):
        name = tag(node)
        if not name:
            return
        classes = node.get('class', '').split()
        if name in forbidden or name == 'h1' or not name:
            return
        if any(c.startswith('calibre_navbar') or c in {
            'link_navbar', 'te_article_title', 'te_article_datePublished', 'te_article_rubric',
            'ny_article_h1_title', 'ny_article_datePublished', 'ny_article_rubric', 'ny_article_author',
            'ny_article_category', 'ad_div', 'ad_h1',
        } for c in classes):
            return
        if node.get('data-testid') in {'BylinesWrapper', 'ContentHeaderRubric', 'PaywallInlineBarrierWrapper'}:
            return
        if name == 'img':
            src = node.get('src')
            if src:
                result = image(src)
                if result is None:
                    add_text('［原 EPUB 未包含此图片］' + (node.get('alt') or ''))
                else:
                    blocks.append({'type': 'image', **result})
            return
        # 纯段落整体提取，避免内联强调、链接被拆散；嵌套段落和图片递归保序。
        structured_children = any(tag(n) in text_tags | {'img', 'div', 'table'} for n in node.iterdescendants())
        if name in text_tags and not structured_children:
            add_text(plain(node))
            return
        add_text(node.text or '')
        for child in node:
            visit(child)
            add_text(child.tail or '')

    visit(root)
    return blocks


def get_bytes(url):
    for attempt in range(4):
        try:
            with urlopen(Request(url, headers={'User-Agent': 'english-epub-import'}), timeout=90) as response:
                return response.read()
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)


def blob_sha(data):
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')


def import_issue(entry):
    path = entry['path']
    slug, source = SOURCES[path.split('/')[0]]
    match = re.search(r'(20\d\d)[._-](\d\d)[._-](\d\d)', posixpath.basename(path))
    if not match:
        raise ValueError('未识别期刊日期: ' + path)
    date = '-'.join(match.groups())
    base_key = slug + '-' + date
    key = base_key + '-' + entry['sha'][:8]
    parsed_cache = CACHE / ('parsed-v5-' + entry['sha'] + '.json')
    if parsed_cache.exists() and (OUT / 'issues' / (key + '.json')).exists():
        result = json.loads(parsed_cache.read_text(encoding='utf-8'))
        if (not any('://' not in name for name in result[2].get('missingImages', []))
                and all((ASSETS / (asset_id + '.webp')).is_file() for asset_id in result[1])):
            return result
    cached = CACHE / (entry['sha'] + '.epub')
    if cached.exists():
        data = cached.read_bytes()
    else:
        data = get_bytes(f'https://raw.githubusercontent.com/{REPO}/{COMMIT}/{quote(path)}')
        if blob_sha(data) != entry['sha']:
            raise ValueError('下载校验不一致: ' + path)
        cached.write_bytes(data)
    if blob_sha(data) != entry['sha']:
        raise ValueError('缓存校验不一致: ' + path)
    metadata, articles, images, missing_images, video_posters, excluded = [], {}, {}, set(), set(), []
    repaired_images = {}
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries, cover, duplicates = toc_entries(archive)
        if base_key == PRESERVED:
            preserved = json.loads((OUT.parent / 'issues' / (base_key + '.json')).read_text(encoding='utf-8'))
            if len(preserved) != len(entries) or [a['titleEn'] for a in preserved] != [e[1] for e in entries]:
                raise ValueError('已有期刊与仓库目录不匹配')
            return [], {}, dict(key=key, path=path, blob=entry['sha'], source=source, issueDate=date,
                                tocCount=len(entries), articleCount=len(preserved), preserved=True)

        def asset(name):
            if name in images:
                return images[name]
            if name not in archive.namelist():
                # 某些标题包含斜杠，导致文章被写入子目录但仍使用根目录图片相对路径。
                # 仅在 ZIP 中存在唯一同名文件时修复，不猜测多义引用。
                matches = [n for n in archive.namelist() if posixpath.basename(n) == posixpath.basename(name)]
                if len(matches) == 1:
                    repaired_images[name] = matches[0]
                    name = matches[0]
                else:
                    missing_images.add(name)
                    return None
            raw = archive.read(name)
            if not raw:
                missing_images.add(name)
                return None
            digest = hashlib.sha256(raw).hexdigest()[:24]
            target = ASSETS / (digest + '.webp')
            is_video = name.lower().endswith(('.mp4', '.webm', '.mov'))
            if is_video:
                video_posters.add(name)
            if target.exists():
                with Image.open(target) as cached_image:
                    width, height = cached_image.size
            else:
                if is_video:
                    # 原 EPUB 的 img 偶尔指向 MP4；保留首帧作原刊插图。
                    from imageio_ffmpeg import get_ffmpeg_exe
                    # moov 在文件末尾的视频需要可 seek 的文件输入。
                    with tempfile.NamedTemporaryFile(dir=CACHE, suffix='.mp4', delete=False) as video:
                        video.write(raw)
                        video_path = Path(video.name)
                    try:
                        raw = subprocess.run([get_ffmpeg_exe(), '-v', 'error', '-i', str(video_path),
                                              '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'],
                                             capture_output=True, check=True, timeout=60).stdout
                    finally:
                        video_path.unlink()
                with Image.open(io.BytesIO(raw)) as original:
                    converted = ImageOps.exif_transpose(original).convert('RGB')
                    # 图表保留较高分辨率，正文展示比例不变。
                    converted.thumbnail((1600, 2400))
                    width, height = converted.size
                    buffer = io.BytesIO()
                    converted.save(buffer, format='WEBP', quality=84, method=4)
                    # 不让其他并行期刊读到只写了一半的同名图片。
                    with tempfile.NamedTemporaryFile(dir=ASSETS, suffix='.tmp', delete=False) as pending:
                        pending.write(buffer.getvalue())
                        pending_path = pending.name
                    os.replace(pending_path, target)
            info = dict(asset=digest, width=width, height=height)
            images[name] = info
            return info

        cover_image = asset(cover) if cover else None

        def resolve_image(page, src):
            if urlsplit(src).scheme or urlsplit(src).netloc:
                missing_images.add(src)
                return None
            return asset(local_path(page, src))

        for index, (page, title, section, pages) in enumerate(entries):
            root = parse(archive.read(page))
            body = root.find('{*}body')
            if body is None:
                raise ValueError('缺少正文: ' + page)
            blocks = body_blocks(body, lambda src: resolve_image(page, src))
            for continuation in pages[1:]:
                continued_body = parse(archive.read(continuation)).find('{*}body')
                if continued_body is None:
                    raise ValueError('缺少续篇正文: ' + continuation)
                blocks.extend(body_blocks(continued_body, lambda src: resolve_image(continuation, src)))
            paragraphs = [b['text'] for b in blocks if b['type'] == 'text']
            if not blocks:
                excluded.append(dict(path=page, title=title, reason='原 EPUB 仅包含导航或链接，没有正文'))
                continue
            # 新 ID 与生成器的随机 EPUB 文件名无关，重跑同一来源保持稳定。
            content_key = title + '\0' + json.dumps(blocks, ensure_ascii=False, sort_keys=True)
            article_id = base_key + '-' + hashlib.sha256(content_key.encode()).hexdigest()[:16]
            words = len(re.findall(r"\b[\w]+(?:[’'-][\w]+)*\b", ' '.join(paragraphs)))
            first_image = next((b for b in blocks if b['type'] == 'image'), cover_image)
            if first_image is None:
                raise ValueError('文章及期刊均无配图: ' + page)
            rubric = next((plain(n) for n in root.iter() if n.get('class') in {'te_article_rubric', 'ny_article_rubric'}), '')
            origin = next((n.get('href') for n in root.iter() if tag(n) and (n.get('rel') == 'calibre-downloaded-from' or 'origin_link' in n.get('class', '').split())), '')
            category = next((plain(n) for n in root.iter() if n.get('class') == 'ny_article_category'), section)
            summary = rubric or next((p for p in paragraphs if len(p) > 100), '') or '本篇为原刊图表或短文，请在正文中查看。'
            # 概述仅显示原文导语；完整段落保留于正文。
            summary = summary[:600]
            metadata.append(dict(id=article_id, titleEn=title, summary=summary, source=source, sourceUrl=origin,
                                 category=category, wordCount=words, minutes=max(1, math.ceil(words / 180)),
                                 image=first_image['asset'], issueDate=date, issueKey=key, order=index))
            articles[article_id] = blocks
    write_json(OUT / 'issues' / (key + '.json'), articles)
    result = metadata, {v['asset']: v for v in images.values()}, dict(
        key=key, path=path, blob=entry['sha'], source=source, issueDate=date,
        tocCount=len(entries), articleCount=len(metadata), preserved=False,
        words=sum(a['wordCount'] for a in metadata), images=len(images),
        duplicateTocPaths=duplicates, missingImages=sorted(missing_images), videoPosters=sorted(video_posters),
        excludedEntries=excluded,
        repairedImagePaths=repaired_images,
        articleIds=[a['id'] for a in metadata])
    write_json(parsed_cache, result)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--workers', type=int, default=6)
    parser.add_argument('--limit', type=int)
    args = parser.parse_args()
    CACHE.mkdir(parents=True, exist_ok=True)
    ASSETS.mkdir(parents=True, exist_ok=True)
    tree_path = CACHE / 'tree.json'
    if not tree_path.exists():
        tree_path.write_bytes(get_bytes(f'https://api.github.com/repos/{REPO}/git/trees/{COMMIT}?recursive=1'))
    tree = json.loads(tree_path.read_text(encoding='utf-8-sig'))
    if tree.get('truncated') or tree['sha'] != COMMIT:
        raise ValueError('仓库树不完整或快照不匹配')
    entries = [e for e in tree['tree'] if e['type'] == 'blob' and e['path'].lower().endswith('.epub')]
    if args.limit:
        entries = entries[:args.limit]
    metadata, images, reports, errors = [], {}, [], []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        jobs = {pool.submit(import_issue, e): e for e in entries}
        for future in as_completed(jobs):
            entry = jobs[future]
            try:
                articles, assets, report = future.result()
                metadata.extend(articles)
                images.update(assets)
                reports.append(report)
                print(f"[{len(reports)}/{len(entries)}] {report['key']}: {report['articleCount']} articles", flush=True)
            except Exception as error:
                errors.append(dict(path=entry['path'], error=str(error)))
                print(f"FAILED {entry['path']}: {error}", flush=True)
    reports.sort(key=lambda r: (r['issueDate'], r['source']), reverse=True)
    metadata.sort(key=lambda a: (a['issueDate'], a['source'], a['issueKey']), reverse=True)
    unique_metadata = list({a['id']: a for a in reversed(metadata)}.values())
    unique_metadata.reverse()
    duplicate_articles = len(metadata) - len(unique_metadata)
    metadata = unique_metadata
    report = dict(repository=REPO, commit=COMMIT, epubCount=len(entries),
                  articleCount=len(metadata) + sum(r['articleCount'] for r in reports if r['preserved']),
                  duplicateArticleCount=duplicate_articles, issues=reports, errors=errors)
    write_json(OUT / 'import-report.json', report)
    if errors:
        raise SystemExit(f'{len(errors)} 本导入失败；不发布索引，请修复后续跑')
    if len({a['id'] for a in metadata}) != len(metadata) or len({r['key'] for r in reports}) != len(reports):
        raise ValueError('重复文章 ID 或期刊标识')
    known_ids = {a['id'] for a in metadata}
    if any(not (ASSETS / (asset_id + '.webp')).is_file() for asset_id in images):
        raise ValueError('生成插图文件不完整')
    all_bodies = {}
    for issue in reports:
        if not issue['preserved'] and not set(issue['articleIds']).issubset(known_ids):
            raise ValueError('索引漏收文章: ' + issue['path'])
        if not issue['preserved']:
            all_bodies[issue['key']] = json.loads((OUT / 'issues' / (issue['key'] + '.json')).read_text(encoding='utf-8'))
    for article in metadata:
        if len(article['id']) > 64:
            raise ValueError('文章 ID 超过存储约束')
        blocks = all_bodies[article['issueKey']][article['id']]
        if not blocks or any(b['type'] == 'image' and b['asset'] not in images for b in blocks):
            raise ValueError('正文或插图不完整: ' + article['id'])
    write_json(OUT / 'index.json', metadata)
    lines = ['// 由 scripts/import-english-epubs.py 生成，请勿手动编辑。',
             "import type { RawEpubBlock, EpubMetadata } from '../epubCatalog';",
             "export const epubMetadata = require('./index.json') as EpubMetadata[];", '',
             '// 原生端按需读取已打包的期号文件；Web 端由 loaders.web.ts 网络加载。',
             'export function prefetchEpubIssue(_issueKey: string): Promise<void> { return Promise.resolve(); }', '',
             'export const issueLoaders: Record<string, () => Record<string, RawEpubBlock[]>> = {']
    lines.extend(f"  '{r['key']}': () => require('./issues/{r['key']}.json')," for r in reports if not r['preserved'])
    lines.extend(['};', ''])
    (OUT / 'loaders.ts').write_text('\n'.join(lines), encoding='utf-8')
    print(json.dumps({'epubs': len(reports), 'articles': report['articleCount'], 'images': len(images)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
