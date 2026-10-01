# 原创练习文本使用本机英文合成音；时间轴由实际生成的 PCM 长度决定。
Add-Type -AssemblyName System.Speech
$taskRoot = Join-Path $PSScriptRoot '../app/assets/speaking'
New-Item -ItemType Directory -Path $taskRoot -Force | Out-Null
$taskScripts = @(
  @{ id='curiosity'; title='A little more curiosity'; subtitle='把好奇心，说出来'; category='日常表达'; lines=@(
    @('There is always something new to notice.','总有一些新鲜事，值得我们留意。'),
    @('A small question can open a much bigger conversation.','一个小小的问题，可以打开一场更大的对话。'),
    @('We do not need to have all the answers.','我们不必拥有所有答案。'),
    @('Sometimes, it is enough to be curious.','有时候，保持好奇就已经足够。'),
    @('Take a moment, and look at things a little differently.','留出一点时间，试着从不同角度看待事物。'),
    @('The best ideas often begin with a simple question.','最好的想法，往往始于一个简单的问题。')) },
  @{ id='conversation'; title='The art of a good conversation'; subtitle='一场好对话，从倾听开始'; category='访谈对话'; lines=@(
    @('A good conversation starts with a little attention.','一场好的对话，从一点专注开始。'),
    @('Give the other person time to finish their thought.','给对方时间，让他们说完自己的想法。'),
    @('Ask a question that invites a story.','问一个能引出故事的问题。'),
    @('You might discover something you never expected.','你可能会发现意料之外的事情。')) },
  @{ id='small-steps'; title='Small steps, lasting change'; subtitle='小小一步，也能改变日常'; category='演讲片段'; lines=@(
    @('Lasting change rarely happens all at once.','长久的改变，很少在一瞬间发生。'),
    @('It begins with one small step that you can take today.','它始于你今天就能迈出的一小步。'),
    @('Make that step simple enough to repeat.','让这一步足够简单，能够坚持重复。'),
    @('Over time, those small steps become a new habit.','久而久之，这些小小的步伐会成为新的习惯。')) }
)
$taskSynth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$taskSynth.SelectVoice('Microsoft Zira Desktop')
$taskSynth.Rate = -1
$taskMaterials = @()
try {
  foreach ($taskScript in $taskScripts) {
    $taskPCM = New-Object System.IO.MemoryStream
    $taskCues = @()
    $taskCursor = 0.0
    $taskIndex = 0
    foreach ($taskLine in $taskScript.lines) {
      $taskOutput = New-Object System.IO.MemoryStream
      $taskSynth.SetOutputToWaveStream($taskOutput)
      $taskSynth.Speak($taskLine[0])
      $taskSynth.SetOutputToNull()
      $taskBytes = $taskOutput.ToArray()
      $taskOffset = 12
      while ($taskOffset -lt $taskBytes.Length) {
        $taskChunk = [System.Text.Encoding]::ASCII.GetString($taskBytes,$taskOffset,4)
        $taskLength = [BitConverter]::ToInt32($taskBytes,$taskOffset+4)
        if ($taskChunk -eq 'fmt ') { $taskFormat = $taskBytes[($taskOffset+8)..($taskOffset+7+$taskLength)]; $taskByteRate = [BitConverter]::ToInt32($taskFormat,8) }
        if ($taskChunk -eq 'data') {
          $taskPCM.Write($taskBytes,$taskOffset+8,$taskLength)
          $taskEnd = $taskCursor + $taskLength / $taskByteRate
          $taskIndex++
          $taskCues += @{ id="cue-$taskIndex"; start=[Math]::Round($taskCursor,3); end=[Math]::Round($taskEnd,3); en=$taskLine[0]; zh=$taskLine[1] }
          $taskGap = New-Object byte[] ([int]($taskByteRate * 0.7))
          $taskPCM.Write($taskGap,0,$taskGap.Length)
          $taskCursor = $taskEnd + 0.7
        }
        $taskOffset += 8 + $taskLength + ($taskLength % 2)
      }
      $taskOutput.Dispose()
    }
    $taskWave = New-Object System.IO.MemoryStream
    $taskWriter = New-Object System.IO.BinaryWriter($taskWave)
    $taskWriter.Write([System.Text.Encoding]::ASCII.GetBytes('RIFF'))
    $taskWriter.Write([int](4+8+$taskFormat.Length+8+$taskPCM.Length))
    $taskWriter.Write([System.Text.Encoding]::ASCII.GetBytes('WAVEfmt '))
    $taskWriter.Write([int]$taskFormat.Length)
    $taskWriter.Write([byte[]]$taskFormat)
    $taskWriter.Write([System.Text.Encoding]::ASCII.GetBytes('data'))
    $taskWriter.Write([int]$taskPCM.Length)
    $taskWriter.Write($taskPCM.ToArray())
    [System.IO.File]::WriteAllBytes((Join-Path $taskRoot "$($taskScript.id).wav"),$taskWave.ToArray())
    $taskMaterials += @{ id=$taskScript.id; title=$taskScript.title; subtitle=$taskScript.subtitle; category=$taskScript.category; duration=[Math]::Round($taskCursor,3); cues=$taskCues }
    $taskPCM.Dispose(); $taskWave.Dispose()
  }
  $taskManifest = @{ materials=$taskMaterials; source='Microsoft Zira Desktop / 原创合成示范音' } | ConvertTo-Json -Depth 10
  [System.IO.File]::WriteAllText((Join-Path $taskRoot 'catalog.json'),$taskManifest,(New-Object System.Text.UTF8Encoding($false)))
} finally { $taskSynth.Dispose() }
