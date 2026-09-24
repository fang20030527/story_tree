"""原刊元数据的中文栏目和阅读难度规则，供导入与补全脚本共用。"""

from __future__ import annotations

import math
import re


_EXACT_CATEGORIES = {
    'Business': '商业',
    'Finance & economics': '经济',
    'Economic & financial indicators': '经济',
    'Science & technology': '科技',
    'Technology Quarterly': '科技',
    'Culture': '文化',
    'Culture & Critics': '文化',
    'Books': '文化',
    'Fiction': '文学',
    'Poems': '文学',
    'Poetry': '文学',
    'Obituary': '人物',
    'Profiles': '人物',
    'The Food Scene': '生活',
    'Cartoons': '文化',
    'Crossword': '文化',
    'Puzzles & Games': '文化',
}

_BROAD_CATEGORIES = {
    'The world this week': '时政',
    'Leaders': '时政',
    'International': '国际',
    'Briefing': '国际',
    'Britain': '国际',
    'United States': '国际',
    'Europe': '国际',
    'Middle East & Africa': '国际',
    'Asia': '国际',
    'China': '国际',
    'The Americas': '国际',
    'Letters': '社会',
}

_GENERIC_HEADLINES = {
    'Politics': '时政',
    'Business': '商业',
    'Cartoon': '文化',
    'Cartoons': '文化',
    'Science and technology': '科技',
}

_CATEGORY_PATTERNS = (
    (r'politic|election|government|congress|senate|presiden|parliament|diplomac|war\b', '时政'),
    (r'econom|financ|market|bank|inflation|interest rate|bond\b|tax\b|business|trade\b', '经济'),
    (r'climat|pollut|carbon|environment|recycl|energy|warming', '环境'),
    (r'health|medicine|medical|disease|cancer|diet|microbiom|hospital|kidney|transplant|vaccine|sleep', '健康'),
    (r'robot|artificial intelligence|\ba[.]?i[.]?s?\b|computer|software|internet|chip|techno|digital', '科技'),
    (r'education|school|university|test score', '教育'),
    (r'forest|wildlife|animal|bird|species|ocean|earth|nature|ecolog', '自然'),
    (r'histor|ancient|archaeolog|centur|heritage', '历史'),
    (r'film|movie|music|book|novel|poem|art\b|fashion|theatre|culture', '文化'),
)


def category_zh(source: str, category: str, title: str) -> str:
    """把出版社的细分栏目合并为稳定的中文主题标签。"""
    if category in {'Science & technology', 'Technology Quarterly'} and re.search(
        r'health|medicine|medical|disease|cancer|diet|microbiom|hospital|kidney|transplant|vaccine|sleep|blue light',
        title, re.IGNORECASE,
    ):
        return '健康'
    if category in _EXACT_CATEGORIES:
        return _EXACT_CATEGORIES[category]
    if title in _GENERIC_HEADLINES:
        return _GENERIC_HEADLINES[title]
    if title.lower().startswith(('cartoon:', 'cartoon—', 'comic:')):
        return '文化'
    normalized = category.lower()
    for pattern, label in (
        (r'politic|washington|election', '时政'),
        (r'scien|techno|artificial intelligence', '科技'),
        (r'health|medicin', '健康'),
        (r'nature|environment|climat', '自然'),
        (r'financial|econom|business|commercial', '经济'),
        (r'food|menu|travel|sport', '生活'),
        (r'fiction|poem|literar', '文学'),
        (r'art|music|theatre|cinema|television|book|critic|culture|comic|cartoon', '文化'),
        (r'profile|personal history|obituary', '人物'),
    ):
        if re.search(pattern, normalized):
            return label
    # 没有明确栏目时以标题关键词补足主题；不从正文猜测未出现的主题。
    for pattern, label in _CATEGORY_PATTERNS:
        if re.search(pattern, title, re.IGNORECASE):
            return label
    if category in _BROAD_CATEGORIES:
        return _BROAD_CATEGORIES[category]
    return {
        'WIRED': '科技',
        'The Atlantic': '社会',
        'The New Yorker': '文化',
        'The Economist': '国际',
    }.get(source, '综合')


_WORD = re.compile(r"[A-Za-z]+(?:[’'-][A-Za-z]+)*")
_SENTENCE_END = re.compile(r'[.!?](?:\s|$)')


def reading_level(blocks: list[dict], word_count: int) -> str:
    """以英文正文的句长和长词比例估计雅思阅读难度（0.5 分档）。"""
    text = ' '.join(block.get('text', '') for block in blocks if block.get('type') == 'text')
    words = _WORD.findall(text)
    if word_count < 50 or len(words) < 50:
        return '难度待评估'
    sentence_count = max(1, len(_SENTENCE_END.findall(text)))
    sentence_length = min(40, len(words) / sentence_count)
    long_word_share = sum(len(re.sub(r"[’'-]", '', word)) >= 8 for word in words) / len(words)
    score = (6.0 + max(0, sentence_length - 12) * 0.055
             + max(0, long_word_share - 0.08) * 5.5
             + min(len(words), 3000) / 3000 * 0.35)
    rounded = min(8.0, max(6.0, math.floor(score * 2 + 0.5) / 2))
    return f'雅思 {rounded:.1f}'
