"""批量原刊的主题和难度回归测试。"""

import unittest

from editorial_metadata import category_zh, reading_level


class EditorialMetadataTests(unittest.TestCase):
    def test_publisher_sections_use_stable_chinese_topics(self):
        self.assertEqual(category_zh('The Economist', 'Science & technology', 'Politics'), '科技')
        self.assertEqual(category_zh('The Economist', 'Finance & economics', 'Markets'), '经济')
        self.assertEqual(category_zh('The New Yorker', 'Poems', 'Spring'), '文学')
        self.assertEqual(category_zh('The Economist', 'The world this week', 'Business'), '商业')
        self.assertEqual(category_zh('The Economist', 'The world this week', 'Cartoon: How 9/11 empowers a president'), '文化')
        self.assertEqual(category_zh('WIRED', '原刊', 'How Robots Learn'), '科技')
        self.assertEqual(category_zh('The Atlantic', '原刊', 'The Future of Health Care'), '健康')
        self.assertEqual(category_zh('The Economist', 'Science & technology', 'A transplanted pig kidney'), '健康')
        self.assertEqual(category_zh('The Economist', 'Letters', 'Could AIs become conscious?'), '科技')
        self.assertEqual(category_zh('The Economist', 'Leaders', 'Raise interest rates'), '经济')

    def test_difficulty_uses_body_and_marks_image_only_entries_unassessed(self):
        self.assertEqual(reading_level([{'type': 'image', 'asset': 'x'}], 0), '难度待评估')
        easy = [{'type': 'text', 'text': ('Birds fly across the sky. ' * 30)}]
        hard = [{'type': 'text', 'text': ('International organisations reconsider their complicated relationships and responsibilities. ' * 30)}]
        easy_level = reading_level(easy, 150)
        hard_level = reading_level(hard, 210)
        self.assertRegex(easy_level, r'^雅思 [678]\.\d$')
        self.assertGreaterEqual(float(hard_level.split()[1]), float(easy_level.split()[1]))


if __name__ == '__main__':
    unittest.main()
