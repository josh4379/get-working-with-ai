/**
 * Get Working With AI — Cloudflare Worker
 * Serves static assets + POST /api/contact → Telegram (JARVIS)
 */

const MAX_FIELD = 500;
const MAX_MESSAGE = 4000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/contact') {
      return handleContact(request, env);
    }

    // Static site
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not found', { status: 404 });
  },
};

async function handleContact(request, env) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  if (request.method !== 'POST') {
    return textResponse('Method not allowed', 405, request);
  }

  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    console.error('Telegram secrets not configured');
    return textResponse('Form service is not configured.', 503, request);
  }

  let fields;
  try {
    fields = await parseForm(request);
  } catch (err) {
    return textResponse(err.message || 'Invalid form data', 400, request);
  }

  // Honeypot (bots fill hidden fields)
  if (fields.website) {
    return textResponse('OK', 200, request);
  }

  const name = clean(fields.name, MAX_FIELD);
  const email = clean(fields.email, MAX_FIELD);
  const company = clean(fields.subject, MAX_FIELD); // form uses name="subject" for company
  const message = clean(fields.message, MAX_MESSAGE);

  if (!name || !email || !message) {
    return textResponse('Name, email, and message are required.', 400, request);
  }

  if (!isValidEmail(email)) {
    return textResponse('Please enter a valid email address.', 400, request);
  }

  const text = [
    '📩 Get Working With AI — question',
    '',
    `Name: ${name}`,
    `Email: ${email}`,
    company ? `Company: ${company}` : null,
    '',
    message,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    await sendTelegram(env, text);
  } catch (err) {
    console.error('Telegram delivery failed:', err);
    return textResponse('Could not send your message. Please email hello@getworkingwithai.com.', 502, request);
  }

  // php-email-form validate.js expects plain text "OK"
  return textResponse('OK', 200, request);
}

async function parseForm(request) {
  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const body = await request.json();
    if (!body || typeof body !== 'object') throw new Error('Invalid JSON body');
    return body;
  }

  // multipart/form-data or application/x-www-form-urlencoded
  const formData = await request.formData();
  const fields = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') fields[key] = value;
  }
  return fields;
}

async function sendTelegram(env, text) {
  const response = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text: text.slice(0, 3900),
        disable_web_page_preview: true,
      }),
    }
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok !== true) {
    console.error('Telegram API error:', response.status, data);
    throw new Error('Telegram delivery failed');
  }
}

function clean(value, max) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ').slice(0, max);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function textResponse(body, status, request) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      ...corsHeaders(request),
    },
  });
}

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowed =
    origin === 'https://getworkingwithai.com' ||
    origin === 'https://www.getworkingwithai.com' ||
    origin.endsWith('.joshuapaulrebelo.workers.dev') ||
    origin.startsWith('http://localhost:') ||
    origin.startsWith('http://127.0.0.1:');

  return {
    'Access-Control-Allow-Origin': allowed ? origin : 'https://getworkingwithai.com',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With',
    Vary: 'Origin',
  };
}
