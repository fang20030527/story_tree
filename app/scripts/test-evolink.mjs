import assert from 'node:assert/strict';

import { generateText, moderateText } from '../server/evolink.mjs';

const apiKey = process.env.EVOLINK_API_KEY ?? '';

function redact(value) {
  return String(value).replaceAll(apiKey, '<redacted>');
}

async function runCheck(name, check) {
  try {
    await check();
    return true;
  } catch (error) {
    console.error(`✗ ${name}: ${redact(error?.message ?? error)}`);

    if (error?.suggestion) {
      console.error(`  suggestion=${redact(error.suggestion)}`);
    }

    return false;
  }
}

if (!apiKey) {
  console.error('EVOLINK_API_KEY is missing from .env.');
  process.exitCode = 1;
} else {
  const geminiPassed = await runCheck('Gemini 3.8 Flash', async () => {
    const result = await generateText({
      prompt: '只回复四个字：连接成功',
      maxCompletionTokens: 256,
      reasoningEffort: 'low',
    });

    assert.ok(result.text);
    console.log(
      `✓ Gemini: HTTP ${result.status}, model=${result.model}, text=${JSON.stringify(result.text.slice(0, 80))}`,
    );
  });

  const moderationPassed = await runCheck('EvoLink Moderation 1.0', async () => {
    const result = await moderateText('我正在阅读一篇关于气候变化的英文文章。');

    assert.match(result.riskLevel, /^(low|medium|high)$/);
    console.log(
      `✓ Moderation: HTTP ${result.status}, model=${result.model}, risk=${result.riskLevel}, flagged=${result.flagged}`,
    );
  });

  if (!geminiPassed || !moderationPassed) {
    process.exitCode = 1;
  } else {
    console.log('✓ Both EvoLink API checks passed.');
  }
}
