"""音频匹配不能串刊、串期或在歧义时选择任意一条。"""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('audio', Path(__file__).with_name('import-editorial-audio.py'))
audio = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audio)
URL = 'https://www.economist.com/media-assets/audio/test.mp3'


class AudioTests(unittest.TestCase):
    def match(self, articles, entries=None):
        return audio.match_entries(articles, [{'path': 'manifest.json', 'issueDate': '2025-01-04',
            'entries': entries or [{'article': 'China’s future', 'url': URL}]}])

    def article(self, **changes):
        return dict({'id': 'one', 'source': 'The Economist', 'issueDate': '2025-01-04',
                     'titleEn': "China's future"}, **changes)

    def test_normalizes_typography(self):
        matched, unmatched = self.match([self.article()])
        self.assertEqual(matched['one']['url'], URL)
        self.assertEqual(unmatched, [])

    def test_does_not_cross_publication_date_or_partial_title(self):
        for changes in [{'source': 'WIRED'}, {'issueDate': '2025-01-11'}, {'titleEn': 'China’s future is bright'}]:
            matched, unmatched = self.match([self.article(**changes)])
            self.assertFalse(matched)
            self.assertEqual(unmatched[0]['reason'], 'no_matching_title')

    def test_rejects_ambiguous_articles_and_conflicting_recordings(self):
        matched, unmatched = self.match([self.article(), self.article(id='two')])
        self.assertFalse(matched)
        self.assertEqual(unmatched[0]['reason'], 'ambiguous_title')
        matched, unmatched = self.match([self.article()], [
            {'article': 'China’s future', 'url': URL},
            {'article': 'China’s future', 'url': URL.replace('test.mp3', 'other.mp3')}])
        self.assertFalse(matched)
        self.assertEqual(len(unmatched), 2)

    def test_rejects_unexpected_audio_urls(self):
        matched, unmatched = self.match([self.article()], [{'article': 'China’s future', 'url': 'http://localhost/test.mp3'}])
        self.assertFalse(matched)
        self.assertEqual(unmatched[0]['reason'], 'invalid_url')


if __name__ == '__main__':
    unittest.main()
