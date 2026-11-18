const respond = (body, status = 200) => Response.json(body, {
  status,
  headers: {'Cache-Control': 'no-store'},
});

export async function onRequestPost({request, env}) {
  if (request.headers.get('Origin') !== new URL(request.url).origin) {
    return respond({error: 'Invalid request origin'}, 403);
  }

  const contentType = request.headers.get('Content-Type') || '';
  let submitted;
  try {
    submitted = contentType.includes('application/json')
      ? (await request.json()).email
      : (await request.formData()).get('email');
  } catch {
    return respond({error: 'Invalid request'}, 400);
  }

  const email = typeof submitted === 'string' ? submitted.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return respond({error: 'Invalid email'}, 400);
  }

  try {
    await env.DB.prepare(
      'CREATE TABLE IF NOT EXISTS newsletter_subscribers (email TEXT PRIMARY KEY NOT NULL, subscribed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)'
    ).run();
    await env.DB.prepare(
      'INSERT OR IGNORE INTO newsletter_subscribers (email) VALUES (?)'
    ).bind(email).run();
    return respond({subscribed: true});
  } catch {
    return respond({error: 'Subscriptions are temporarily unavailable'}, 503);
  }
}
