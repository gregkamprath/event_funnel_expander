import fetch from 'node-fetch';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

export async function queryLLM(prompt) {
  console.log('Loaded API Key:', OPENAI_API_KEY ? 'Yes' : 'No');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4',  // or 'gpt-3.5-turbo'
      messages: [
        { role: 'user', content: prompt }
      ],
      max_tokens: 500,
      temperature: 0.7
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}
