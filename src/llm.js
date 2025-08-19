import fetch from 'node-fetch';
import { encoding_for_model } from 'tiktoken';

export function countTokens(text, model = 'gpt-4.1') {
  const enc = encoding_for_model(model);
  const tokenCount = enc.encode(text).length;
  enc.free();  // release WASM memory if applicable
  return tokenCount;
}

export function truncateToTokenLimit(text, maxTokens, model = "gpt-4.1") {
  if (text == null) text = "";
  text = String(text);

  const enc = encoding_for_model(model);
  try {
    let tokens = enc.encode(text);

    if (tokens.length <= maxTokens) {
      return text; // already within limit
    }

    // progressively chop down the text until it's under the limit
    let truncated = text;
    while (tokens.length > maxTokens && truncated.length > 0) {
      // Chop more aggressively if text is very long
      const ratio = maxTokens / tokens.length;
      const newLength = Math.floor(truncated.length * ratio * 0.9); // 0.9 as safety margin
      truncated = truncated.slice(0, newLength);

      tokens = enc.encode(truncated);
    }

    return truncated;
  } finally {
    enc.free();
  }
}

export async function queryLLM(prompt) {
  console.log(`Input tokens: ${countTokens(prompt, 'gpt-4.1')}`);

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY in environment");
  }

  // Count input tokens
  const enc = encoding_for_model("gpt-4.1");
  const inputTokens = enc.encode(prompt).length;
  console.log(`Input tokens: ${inputTokens}`);

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: "gpt-4.1",
      messages: [
        { role: 'user', content: prompt }
      ],
      max_tokens: 500,
      temperature: 0.7
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${response.statusText}\n${err}`);
  }

  const data = await response.json();

  const output = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!output) {
    throw new Error("No content returned from OpenAI API");
  }

  // Count output tokens
  const outputTokens = enc.encode(output).length;
  console.log(`Output tokens: ${outputTokens}`);

  return output;
}