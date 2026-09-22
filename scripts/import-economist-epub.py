"""Import the supplied issue, preserving TOC order, text, and local illustrations.

Usage: python scripts/import-economist-epub.py path/to/issue.epub
"""
import datetime
import json
import math
from pathlib import Path
import posixpath
import re
import sys
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ISSUE = '2026-09-19'
OUT = ROOT / 'app/src/features/editorial/issues'
ASSETS = ROOT / 'app/assets/editorial' / ISSUE
NS = {'h': 'http://www.w3.org/1999/xhtml'}


def text(element):
    return re.sub(r'\s+', ' ', ''.join(element.itertext())).strip() if element is not None else ''


def by_class(root, name):
    return next((e for e in root.iter() if name in e.get('class', '').split()), None)


def main(path):
    OUT.mkdir(parents=True, exist_ok=True)
    ASSETS.mkdir(parents=True, exist_ok=True)
    # 重导入原刊时保留人工校订的中文标题、主题分类及估计阅读难度。
    issue_path = OUT / f'economist-{ISSUE}.json'
    existing = {
        article['id']: article
        for article in json.loads(issue_path.read_text(encoding='utf-8'))
    } if issue_path.exists() else {}
    articles, assets, report = [], {}, []
    with zipfile.ZipFile(path) as archive:
        def asset(src):
            name = posixpath.basename(src)
            if name not in assets:
                from PIL import Image
                import io
                data = archive.read('EPUB/' + src)
                width, height = Image.open(io.BytesIO(data)).size
                (ASSETS / name).write_bytes(data)
                assets[name] = {'width': width, 'height': height}
            return name

        toc = ET.fromstring(archive.read('EPUB/book_toc.html'))
        for section_link in toc.findall('.//h:a', NS):
            section = text(section_link)
            index = ET.fromstring(archive.read('EPUB/' + section_link.get('href')))
            for link in index.findall('.//h:a', NS):
                href = link.get('href')
                root = ET.fromstring(archive.read('EPUB/' + href))
                title = text(by_class(root, 'te_article_title'))
                if not title:
                    raise ValueError('Missing article: ' + href)
                body = root.find('h:body', NS)
                paragraphs, blocks = [], []
                started = False
                for node in body:
                    if node.get('class') == 'te_article_title':
                        started = True
                        continue
                    if not started or node.get('class') in ('link_navbar', 'te_article_datePublished', 'te_article_rubric'):
                        continue
                    tag = node.tag.split('}')[-1]
                    if tag in ('p', 'h2', 'h3', 'h4', 'blockquote', 'ul', 'ol', 'table'):
                        value = text(node)
                        if value:
                            paragraphs.append(value)
                            blocks.append({'type': 'text', 'text': value})
                        for img in node.iter('{'+NS['h']+'}img'):
                            name = asset(img.get('src'))
                            blocks.append({'type': 'image', 'asset': name, **assets[name]})
                images = [b for b in blocks if b['type'] == 'image']
                cover = images[0]['asset'] if images else asset('static_images/cover.jpg')
                rubric = text(by_class(root, 'te_article_rubric'))
                origin = by_class(root, 'origin_link')
                date = text(by_class(root, 'te_article_datePublished'))
                published = datetime.datetime.strptime(re.sub(r'(\d+)(st|nd|rd|th)', r'\1', date), '%b %d %Y').date().isoformat()
                words = len(re.findall(r"\b[\w]+(?:[’'-][\w]+)*\b", ' '.join(paragraphs)))
                article = dict(id='economist-'+ISSUE+'-'+Path(href).stem, titleZh=title, titleEn=title,
                    summaryZh=rubric or (paragraphs[0] if paragraphs else '本篇为原刊经济数据图表，请在正文中查看。'),
                    keyPointsZh=[section, '《经济学人》2026 年 9 月 19 日刊 · 原文'], source='The Economist',
                    category=section, wordCount=words, minutes=max(1, math.ceil(words/180)), level='英文原版',
                    image=cover, section='featured', publishedAt=published, issueDate=ISSUE,
                    sourceUrl=origin.get('href') if origin is not None else '', paragraphs=paragraphs, bodyBlocks=blocks)
                previous = existing.get(article['id'])
                if previous and previous.get('titleEn') == title:
                    for field in ('titleZh', 'category', 'level'):
                        if previous.get(field):
                            article[field] = previous[field]
                articles.append(article)
                report.append(dict(file=href, title=title, paragraphs=len(paragraphs), images=len(images), words=words))
        expected = [n for n in archive.namelist() if n.endswith('.html') and by_class(ET.fromstring(archive.read(n)), 'te_article_title') is not None]
        assert len(articles) == len(expected) == len(set(a['id'] for a in articles))
    (OUT / 'economist-2026-09-19.json').write_text(json.dumps(articles, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    lines = ["// Generated by scripts/import-economist-epub.py.", "import type { EditorialArticle } from '../catalog';", "import entries from './economist-2026-09-19.json';", '', 'const images: Record<string, number> = {']
    for name in assets:
        lines.append(f"  '{name}': require('../../../../assets/editorial/{ISSUE}/{name}'),")
    lines += ['};', '', 'export const economistSeptember19: EditorialArticle[] = entries.map<EditorialArticle>((entry) => ({', '  ...entry,', "  section: 'featured',", '  hasAudio: false,', '  image: images[entry.image]!,', '  bodyBlocks: entry.bodyBlocks.map((block) => block.type === "image"', '    ? { type: "image", image: images[block.asset!]!, width: block.width!, height: block.height! }', '    : { type: "text", text: block.text! }),', '}));', '']
    (OUT / 'economist-2026-09-19.ts').write_text('\n'.join(lines), encoding='utf-8')
    print(json.dumps({'articles':len(articles),'images':len(assets),'words':sum(a['wordCount'] for a in articles),'imageOnly':[a['titleEn'] for a in articles if not a['paragraphs']]},ensure_ascii=False))


if __name__ == '__main__':
    main(sys.argv[1])
