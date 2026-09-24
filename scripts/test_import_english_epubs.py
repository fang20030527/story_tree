"""批量拆篇的正文、目录和资源路径回归测试。"""
import importlib.util
from pathlib import Path
import unittest
import io
import zipfile

spec = importlib.util.spec_from_file_location('epub_import', Path(__file__).with_name('import-english-epubs.py'))
epub = importlib.util.module_from_spec(spec)
spec.loader.exec_module(epub)


class EpubImportTests(unittest.TestCase):
    def test_line_breaks_do_not_join_words(self):
        root = epub.parse(b'<body><p>First line<br/>Second <em>line</em>.</p></body>')
        self.assertEqual(epub.body_blocks(root, lambda _: None), [{'type': 'text', 'text': 'First line Second line.'}])

    def test_repairs_only_the_known_wired_namespace_error(self):
        root = epub.parse(b'<body xmlns:xmlns="http://www.w3.org/2000/xmlns/"><p>Complete text.</p></body>')
        self.assertEqual(epub.plain(root), 'Complete text.')
        with self.assertRaises(epub.etree.XMLSyntaxError):
            epub.parse(b'<body><p>Truncated')

    def test_toc_order_keeps_continuation_pages_and_deduplicates_repeated_links(self):
        data = io.BytesIO()
        with zipfile.ZipFile(data, 'w') as archive:
            archive.writestr('META-INF/container.xml', '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>')
            archive.writestr('book.opf', '''<package><metadata><meta name="cover" content="cover"/></metadata><manifest>
            <item id="toc" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
            <item id="cover" href="images/001.jpg" media-type="image/jpeg"/>
            <item id="one" href="index_split_001.html"/><item id="two" href="index_split_002.html"/>
            <item id="three" href="index_split_003.html"/></manifest><spine>
            <itemref idref="one"/><itemref idref="two"/><itemref idref="three"/></spine></package>''')
            archive.writestr('toc.ncx', '''<ncx><navMap><navPoint><navLabel><text>Section</text></navLabel>
            <content src="index_split_001.html"/>
            <navPoint><navLabel><text>First</text></navLabel><content src="index_split_001.html"/></navPoint>
            <navPoint><navLabel><text>First</text></navLabel><content src="index_split_001.html"/></navPoint>
            <navPoint><navLabel><text>Second</text></navLabel><content src="index_split_003.html"/></navPoint>
            </navPoint></navMap></ncx>''')
        with zipfile.ZipFile(data) as archive:
            entries, cover, duplicates = epub.toc_entries(archive)
        self.assertEqual([e[1] for e in entries], ['First', 'Second'])
        self.assertEqual(entries[0][3], ['index_split_001.html', 'index_split_002.html'])
        self.assertEqual(cover, 'images/001.jpg')
        self.assertEqual(duplicates, ['index_split_001.html'])

    def test_preserves_inline_text_and_image_order_without_navigation(self):
        root = epub.parse(b'''<body><!-- ignored --><div class="calibre_navbar1">Next | Main menu</div>
        <h1>Title</h1><p>One <strong>bold</strong> paragraph.</p>
        <figure><img src="images/a.jpg"/><figcaption>Caption</figcaption></figure>
        <ul><li>First <em>item</em></li><li>Second item</li></ul>
        <div class="calibre_navbar"><p>This article was downloaded by calibre</p></div></body>''')
        blocks = epub.body_blocks(root, lambda _: {'asset': 'image', 'width': 20, 'height': 10})
        self.assertEqual(blocks, [
            {'type': 'text', 'text': 'One bold paragraph.'},
            {'type': 'image', 'asset': 'image', 'width': 20, 'height': 10},
            {'type': 'text', 'text': 'Caption'},
            {'type': 'text', 'text': 'First item'},
            {'type': 'text', 'text': 'Second item'},
        ])

    def test_image_only_article_and_missing_source_asset_remain_visible(self):
        root = epub.parse(b'<body><p><img src="missing.jpg" alt="Chart"/></p></body>')
        blocks = epub.body_blocks(root, lambda _: None)
        self.assertEqual(blocks, [{'type': 'text', 'text': '［原 EPUB 未包含此图片］Chart'}])

    def test_resolves_relative_assets_but_rejects_remote_and_escaping_paths(self):
        self.assertEqual(epub.local_path('EPUB/text/article.xhtml', '../images/a%20b.jpg'), 'EPUB/images/a b.jpg')
        self.assertEqual(epub.local_path('EPUB/toc.ncx', 'Cartoon: How 9/article.html'), 'EPUB/Cartoon: How 9/article.html')
        for href in ['https://example.com/image.jpg', '../../../secret', '/etc/passwd']:
            with self.assertRaises(ValueError):
                epub.local_path('EPUB/article.xhtml', href)


if __name__ == '__main__':
    unittest.main()
