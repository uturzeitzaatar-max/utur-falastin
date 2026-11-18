const sandbox = 'https://api-m.sandbox.paypal.com';

function json(data, status = 200) {
  return Response.json(data, {status, headers: {'Cache-Control': 'no-store'}});
}

function sandboxEnabled(env) {
  return Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET);
}

export function onRequestGet({env}) {
  return json({paypalSandbox: sandboxEnabled(env)});
}

async function paypal(env, path, body, requestId) {
  const token = await fetch(sandbox + '/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(env.PAYPAL_CLIENT_ID + ':' + env.PAYPAL_CLIENT_SECRET),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!token.ok) throw new Error('Sandbox authentication failed');
  const {access_token} = await token.json();
  const response = await fetch(sandbox + path, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + access_token,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': requestId,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error('Sandbox request failed');
  return response.json();
}

const identifier = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function completeSandbox(env, id) {
  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
  if (!order || order.method !== 'paypal_sandbox') return json({error: 'Unknown order'}, 404);
  if (order.status === 'complete') return json({id});
  const result = await paypal(env, '/v2/checkout/orders/' + encodeURIComponent(order.provider_id) + '/capture', {}, 'capture-' + id);
  const capture = result.purchase_units?.[0]?.payments?.captures?.[0];
  if (capture?.status !== 'COMPLETED' || capture.amount.currency_code !== order.currency ||
      capture.amount.value !== (order.total / 100).toFixed(2)) {
    return json({error: 'Sandbox capture incomplete'}, 409);
  }
  await env.DB.prepare("UPDATE orders SET status = 'complete' WHERE id = ?").bind(id).run();
  return json({id});
}

export async function onRequestPost({request, env}) {
  if (!env.DB) return json({error: 'Order database is unavailable'}, 503);
  const origin = new URL(request.url).origin;
  if (request.headers.get('Origin') !== origin) return json({error: 'Origin mismatch'}, 403);
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) return json({error: 'Expected JSON'}, 415);
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 8192) return json({error: 'Request too large'}, 413);
    body = JSON.parse(raw);
  } catch {
    return json({error: 'Invalid JSON'}, 400);
  }
  if (!body || typeof body !== 'object' || !identifier.test(body.id)) return json({error: 'Invalid order'}, 400);

  try {
    if (body.action === 'capture') {
      if (!sandboxEnabled(env)) return json({error: 'Sandbox is unavailable'}, 503);
      return await completeSandbox(env, body.id);
    }
    if (body.action !== 'place' || !['paypal', 'bit'].includes(body.method) ||
        !Array.isArray(body.items) || !body.items.length || body.items.length > 50) {
      return json({error: 'Invalid checkout'}, 400);
    }
    const customer = body.customer;
    if (!customer ||
        !['name', 'email', 'address'].every(key => typeof customer[key] === 'string' && customer[key].trim() && customer[key].length <= 250) ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) {
      return json({error: 'Invalid delivery details'}, 400);
    }
    const asset = await env.ASSETS.fetch(new Request(new URL('/catalog.json', origin)));
    if (!asset.ok) return json({error: 'Catalog unavailable'}, 503);
    const catalog = await asset.json();
    const products = new Map(catalog.products.filter(p => p.active).map(p => [p.id, p]));
    const unique = new Set();
    const lines = [];
    let total = catalog.shipping;
    for (const item of body.items) {
      const product = products.get(item?.id);
      if (!product || unique.has(item.id) || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20) {
        return json({error: 'Invalid cart'}, 400);
      }
      unique.add(item.id);
      total += product.price * item.quantity;
      lines.push({id: item.id, quantity: item.quantity, unitPrice: product.price});
    }
    if (body.total !== total || body.currency !== catalog.currency) return json({error: 'Catalog prices changed'}, 409);
    const method = body.method === 'paypal' && sandboxEnabled(env) ? 'paypal_sandbox' : body.method + '_simulated';
    const currency = catalog.currency;
    await env.DB.prepare('INSERT OR IGNORE INTO orders (id, method, currency, total, items, status) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(body.id, method, currency, total, JSON.stringify(lines), method === 'paypal_sandbox' ? 'pending' : 'complete').run();
    const saved = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(body.id).first();
    if (saved.method !== method || saved.currency !== currency || saved.total !== total || saved.items !== JSON.stringify(lines)) {
      return json({error: 'Order reference already used'}, 409);
    }
    if (saved.status === 'complete') return json({id: body.id});
    if (saved.approval_url) return json({id: body.id, approvalUrl: saved.approval_url});

    const result = await paypal(env, '/v2/checkout/orders', {
      intent: 'CAPTURE',
      purchase_units: [{amount: {currency_code: currency, value: (total / 100).toFixed(2)}}],
      payment_source: {paypal: {experience_context: {
        shipping_preference: 'NO_SHIPPING',
        user_action: 'PAY_NOW',
        return_url: origin + '/?paypal=approved',
        cancel_url: origin + '/?paypal=canceled',
      }}},
    }, 'create-' + body.id);
    const approvalUrl = result.links?.find(link => ['payer-action', 'approve'].includes(link.rel))?.href;
    if (!result.id || !approvalUrl || new URL(approvalUrl).origin !== 'https://www.sandbox.paypal.com') {
      throw new Error('Unexpected sandbox approval link');
    }
    await env.DB.prepare('UPDATE orders SET provider_id = ?, approval_url = ? WHERE id = ?')
      .bind(result.id, approvalUrl, body.id).run();
    return json({id: body.id, approvalUrl});
  } catch {
    return json({error: 'Checkout unavailable'}, 502);
  }
}
