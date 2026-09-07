const DEFAULT_BASE_URL = 'https://direct.evolink.ai/v1';
const DEFAULT_TEXT_MODEL = 'gemini-3.8-flash';
const DEFAULT_MODERATION_MODEL = 'evolink-moderation-1.0';
const DEFAULT_TIMEOUT_MS = 60_000;

export class EvoLinkError extends Error {
  constructor(message, { status, code, type, suggestion, cause } = {}) {
    super(message, { cause });
    this.name = 'EvoLinkError';
    this.status = status;
    this.code = code;
    this.type = type;
    this.suggestion = suggestion;
  }
}

function getConfig(overrides = {}) {
  const apiKey = overrides.apiKey ?? process.env.EVOLINK_API_KEY;

  if (!apiKey) {
    throw new EvoLinkError('EVOLINK_API_KEY is not configured.');
  }

  const timeoutMs = Number(
    overrides.timeoutMs ?? process.env.EVOLINK_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS,
  );

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new EvoLinkError('EVOLINK_TIMEOUT_MS must be a positive number.');
  }

  return {
    apiKey,
    baseUrl: (
      overrides.baseUrl ??
      process.env.EVOLINK_BASE_URL ??
      DEFAULT_BASE_URL
    ).replace(/\/+$/, ''),
    timeoutMs,
  };
}

async function post(path, body, configOverrides) {
  const config = getConfig(configOverrides);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  let response;
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new EvoLinkError(
        `EvoLink request timed out after ${config.timeoutMs} ms.`,
        { cause: error },
      );
    }

    throw new EvoLinkError('Unable to reach EvoLink.', { cause: error });
  } finally {
    clearTimeout(timeout);
  }

  const responseText = await response.text();
  let data;

  try {
    data = responseText ? JSON.parse(responseText) : null;
  } catch (error) {
    throw new EvoLinkError('EvoLink returned a non-JSON response.', {
      status: response.status,
      cause: error,
    });
  }

  if (!response.ok) {
    const details = data?.error ?? data ?? {};
    const message = details.message ?? response.statusText ?? 'Request failed';

    throw new EvoLinkError(`EvoLink request failed (${response.status}): ${message}`, {
      status: response.status,
      code: details.code,
      type: details.type,
      suggestion: details.fallback_suggestion,
    });
  }

  return { data, status: response.status };
}

function extractText(content) {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : part?.text ?? ''))
      .join('');
  }

  return '';
}

export async function generateText({
  prompt,
  messages,
  model = process.env.EVOLINK_TEXT_MODEL ?? DEFAULT_TEXT_MODEL,
  maxCompletionTokens,
  reasoningEffort,
  config,
} = {}) {
  const chatMessages = messages ?? (prompt ? [{ role: 'user', content: prompt }] : null);

  if (!Array.isArray(chatMessages) || chatMessages.length === 0) {
    throw new EvoLinkError('generateText requires a prompt or a non-empty messages array.');
  }

  if (chatMessages.at(-1)?.role === 'assistant') {
    throw new EvoLinkError('The final Gemini message cannot use the assistant role.');
  }

  const body = {
    model,
    messages: chatMessages,
    stream: false,
  };

  if (maxCompletionTokens !== undefined) {
    body.max_completion_tokens = maxCompletionTokens;
  }

  if (reasoningEffort !== undefined) {
    body.reasoning_effort = reasoningEffort;
  }

  const { data, status } = await post('/chat/completions', body, config);
  const choice = data?.choices?.[0];
  const text = extractText(choice?.message?.content).trim();

  if (!text) {
    throw new EvoLinkError('EvoLink returned no Gemini text.', { status });
  }

  return {
    id: data.id,
    model: data.model ?? model,
    text,
    finishReason: choice.finish_reason,
    usage: data.usage,
    status,
  };
}

export async function moderateText(
  input,
  {
    model = process.env.EVOLINK_MODERATION_MODEL ?? DEFAULT_MODERATION_MODEL,
    config,
  } = {},
) {
  if (
    (typeof input !== 'string' || input.trim() === '') &&
    (!Array.isArray(input) || input.length === 0)
  ) {
    throw new EvoLinkError('moderateText requires non-empty input.');
  }

  const { data, status } = await post('/moderations', { model, input }, config);
  const result = data?.results?.[0];
  const summary = data?.evolink_summary ?? result?.evolink_summary;

  if (!result || !summary?.risk_level) {
    throw new EvoLinkError('EvoLink returned an invalid moderation response.', {
      status,
    });
  }

  return {
    id: data.id,
    model: data.model ?? model,
    riskLevel: summary.risk_level,
    flagged: summary.flagged ?? result.flagged,
    violations: summary.violations ?? [],
    maxCategory: summary.max_category,
    maxScore: summary.max_score,
    categories: result.categories,
    categoryScores: result.category_scores,
    status,
  };
}
