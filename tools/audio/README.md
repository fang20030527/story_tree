# 外刊音频时间轴

客户端直接读取静态词级时间戳，不在手机上识别音频。每条记录为：段落下标、起始字符、结束字符、开始秒数、结束秒数。

当前 `aiArmsRaceAudioCues.ts` 使用 bundled `ai-arms-race.mp3` 与 catalog 正文，经 stable-ts 2.19.1 / Whisper base.en 本地强制对齐生成。正文前约 17 秒为片头；录音未读出 `Effective doomerism` 标题，该标题不进入时间轴。时间戳属于自动对齐结果，存在词边界误差。

更新音频或正文后，将段落字符串数组导出为 `paragraphs.json`，再重新生成，不能继续沿用旧的字符偏移。以下命令需要 Python、ffmpeg，并首次下载本地 Whisper 模型；不会上传录音。

```python
import json
import stable_whisper

paragraphs = json.load(open('paragraphs.json'))
model = stable_whisper.load_model('base.en', device='cpu')
result = model.align('ai-arms-race.mp3', '\n'.join(paragraphs), language='en')
result.save_as_json('aligned.json')
```

```sh
python3 tools/audio/build_cues.py paragraphs.json aligned.json app/src/features/editorial/audio/aiArmsRaceAudioCues.ts
```

播放器使用实际播放秒数查找时间轴，拖动后、倒退和暂停时使用同一套定位逻辑。片头和片尾不高亮正文，词间停顿保留上一个词。单词高亮保留原有点击查词和生词背景色；手动滚动会暂停自动跟随，点击「恢复跟随朗读」重新开启。
