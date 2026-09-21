"""将 stable-ts 的词级对齐结果转换为客户端字符时间轴。

用法：python3 tools/audio/build_cues.py paragraphs.json aligned.json output.ts
paragraphs.json 为正文字符串数组；aligned.json 为 stable-ts align 的输出。
"""
import hashlib
import json
import re
import sys
from pathlib import Path

paragraphs = json.loads(Path(sys.argv[1]).read_text())
result = json.loads(Path(sys.argv[2]).read_text())
text = '\n'.join(paragraphs)
words = [word for segment in result['segments'] for word in segment['words']]
spans = []
cursor = 0
for word in words:
    value = word['word'].strip()
    start = text.find(value, cursor)
    if start < 0 or text[cursor:start].strip():
        raise ValueError(f'对齐文本与正文不一致：字符 {cursor}')
    cursor = start + len(value)
    spans.append((start, cursor, word['start'], word['end']))
if text[cursor:].strip():
    raise ValueError('对齐结果未覆盖全文')

cues = []
base = 0
for paragraph_index, paragraph in enumerate(paragraphs):
    for match in re.finditer(r"[A-Za-z]+(?:['’][A-Za-z]+|-[A-Za-z]+)*", paragraph):
        overlapping = [span for span in spans if span[0] < base + match.end() and span[1] > base + match.start()]
        start, end = overlapping[0][2], overlapping[-1][3]
        # 录音未朗读的标题等文本不制造时间戳。
        if start == end and all(span[2] == span[3] for span in spans if base <= span[0] < base + len(paragraph)):
            continue
        cues.append([paragraph_index, match.start(), match.end(), start, end])
    base += len(paragraph) + 1

# 对齐器偶尔给连续短词同一起点；在到下一个起点的声学区间内分配，避免跳词。
i = 0
while i < len(cues):
    j = i + 1
    while j < len(cues) and cues[j][3] == cues[i][3]:
        j += 1
    if j - i > 1:
        end = cues[j][3] if j < len(cues) else cues[j - 1][4]
        start = cues[i][3]
        for k in range(i, j):
            cues[k][3] = round(start + (end - start) * (k - i) / (j - i), 3)
            cues[k][4] = round(start + (end - start) * (k - i + 1) / (j - i), 3)
    i = j

header = "import type { EditorialAudioCue } from '../editorialAudioSync';\n\n"
header += '// 由录音与正文经 stable-ts / Whisper base.en 强制对齐生成；时间单位为秒。\n'
header += f'// 正文 SHA-256：{hashlib.sha256(text.encode()).hexdigest()}\n'
header += 'export const aiArmsRaceAudioCues: readonly EditorialAudioCue[] = [\n'
Path(sys.argv[3]).write_text(header + ''.join('  ' + json.dumps(cue, separators=(',', ':')) + ',\n' for cue in cues) + '];\n')
print(f'已生成 {len(cues)} 个词的时间戳')
