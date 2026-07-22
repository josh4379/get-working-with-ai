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
    return textResponse('Please use the form on the website to send a question.', 405, request);
  }

  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    console.error('Telegram secrets not configured');
    return textResponse(
      'We cannot take form messages right now. Please email hello@getworkingwithai.com.',
      503,
      request
    );
  }

  let fields;
  try {
    fields = await parseForm(request);
  } catch (err) {
    console.error('Form parse failed:', err);
    return textResponse(
      'We could not read your form. Please refresh the page and try again, or email hello@getworkingwithai.com.',
      400,
      request
    );
  }

  // Honeypot (bots fill hidden fields)
  if (fields.website) {
    return textResponse('OK', 200, request);
  }

  // Cloudflare Turnstile — gate existing handler on success === true
  const turnstileToken =
    typeof fields['cf-turnstile-response'] === 'string'
      ? fields['cf-turnstile-response'].trim()
      : '';
  if (!turnstileToken) {
    return textResponse(
      'Please complete the security check and try again.',
      403,
      request
    );
  }
  if (!env.TURNSTILE_SECRET) {
    console.error('TURNSTILE_SECRET not configured');
    return textResponse(
      'We cannot take form messages right now. Please email hello@getworkingwithai.com.',
      503,
      request
    );
  }

  const clientIp =
    request.headers.get('CF-Connecting-IP') ||
    (request.headers.get('X-Forwarded-For') || '').split(',')[0].trim() ||
    '';

  try {
    const verifyRes = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          secret: env.TURNSTILE_SECRET,
          response: turnstileToken,
          ...(clientIp ? { remoteip: clientIp } : {}),
        }),
      }
    );
    const verify = await verifyRes.json().catch(() => ({}));
    if (verify.success !== true) {
      console.error('Turnstile siteverify failed:', verify['error-codes'] || verify);
      return textResponse(
        'Security check failed. Please refresh the page and try again, or email hello@getworkingwithai.com.',
        403,
        request
      );
    }
  } catch (err) {
    console.error('Turnstile siteverify error:', err);
    return textResponse(
      'Security check could not be completed. Please try again, or email hello@getworkingwithai.com.',
      503,
      request
    );
  }

  const name = clean(fields.name, MAX_FIELD);
  const email = clean(fields.email, MAX_FIELD);
  const company = clean(fields.subject, MAX_FIELD); // form uses name="subject" for company
  const message = clean(fields.message, MAX_MESSAGE);

  if (!name) {
    return textResponse('Please enter your full name.', 400, request);
  }
  if (!email) {
    return textResponse('Please enter your email address.', 400, request);
  }
  if (!isValidEmail(email)) {
    return textResponse(
      'That email address does not look valid. Please check it and try again.',
      400,
      request
    );
  }
  if (!company) {
    return textResponse('Please enter your company or organisation.', 400, request);
  }
  if (!message) {
    return textResponse('Please write your question before sending.', 400, request);
  }

  const text = [
    '📩 Get Working With AI — question',
    '',
    `Name: ${name}`,
    `Email: ${email}`,
    `Company: ${company}`,
    '',
    message,
  ].join('\n');

  try {
    await sendTelegram(env, text);
  } catch (err) {
    console.error('Telegram delivery failed:', err);
    return textResponse(
      'We could not deliver your message right now. Please email hello@getworkingwithai.com and we will get back to you.',
      502,
      request
    );
  }

  // Client expects plain text "OK"
  return textResponse('OK', 200, request);
}

async function parseForm(request) {
  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const body = await request.json();
    if (!body || typeof body !== 'object') {
      throw new Error('Invalid JSON body');
    }
    return body;
  }

  if (
    !contentType.includes('multipart/form-data') &&
    !contentType.includes('application/x-www-form-urlencoded')
  ) {
    throw new Error('Missing or unsupported Content-Type');
  }

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
