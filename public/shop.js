import {languages, translator} from './i18n.js';

const element = id => document.getElementById(id);
const categories = ['all', 'oil', 'spices', 'food', 'soaps', 'candles', 'gifts'];
const dialog = element('cart');
const status = element('checkout-status');
const cartBody = element('cart-body');
const language = element('language');
let locale = localStorage.getItem('utur-language');
if (!languages.includes(locale)) locale = 'en';
let t = translator(locale);
let selected = 'all';
let catalog;
let catalogError = false;
let paypalSandbox = false;
let busy = false;
let message;
let orderReference;
let requestSignature;
let customer = {};
let method = 'paypal';
let cart = {};
try {
  const saved = JSON.parse(localStorage.getItem('utur-cart'));
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) cart = saved;
} catch {
  // A stale or invalid cart can be rebuilt from the catalog.
}

function node(tag, content, className) {
  const el = document.createElement(tag);
  if (content) el.textContent = content;
  if (className) el.className = className;
  return el;
}

function button(label, handler, className) {
  const el = node('button', label, className);
  el.type = 'button';
  el.addEventListener('click', handler);
  return el;
}

function money(value) {
  return new Intl.NumberFormat(locale, {style: 'currency', currency: catalog.currency}).format(value / 100);
}

function nameOf(product) {
  return product.name[languages.indexOf(locale)] || product.name[0];
}

function items() {
  return catalog.products.filter(p => p.active && cart[p.id]);
}

function quantitiesChanged() {
  localStorage.setItem('utur-cart', JSON.stringify(cart));
  element('cart-count').textContent = Object.values(cart).reduce((a, b) => a + b, 0);
}

function changeQuantity(id, amount) {
  const quantity = Math.max(0, Math.min(20, (cart[id] || 0) + amount));
  if (quantity) cart[id] = quantity;
  else delete cart[id];
  message = undefined;
  quantitiesChanged();
  if (dialog.open) renderCart();
  else {
    element('notice').textContent = '';
    requestAnimationFrame(() => { element('notice').textContent = t('added'); });
  }
}

function renderCatalog() {
  element('catalog-status').textContent = catalogError ? t('catalogError') : '';
  const productGrid = element('products');
  element('filters').replaceChildren(...categories.map(category => {
    const filter = button(t(category), () => {
      selected = category;
      renderCatalog();
      element('filters').querySelector('[aria-pressed=true]').focus();
    });
    filter.setAttribute('aria-pressed', String(category === selected));
    return filter;
  }));
  if (!catalog) return;
  const products = catalog.products.filter(p => p.active && (selected === 'all' || p.category === selected));
  if (!products.length) element('catalog-status').textContent = t('noProducts');
  productGrid.replaceChildren(...products.map(product => {
    const card = node('article', '', 'card');
    const img = node('img');
    img.src = '/assets/' + (product.image || product.id + '.webp');
    img.alt = '';
    img.loading = 'lazy';
    img.addEventListener('error', () => { img.src = '/assets/mark.svg'; }, {once: true});
    const copy = node('div', '', 'card-copy');
    const category = t(product.category) + (product.size ? ' · ' + product.size : '');
    const description = product.description[languages.indexOf(locale)] || product.description[0];
    const bottom = node('div', '', 'card-bottom');
    const add = button(t('add'), () => changeQuantity(product.id, 1), 'button');
    add.setAttribute('aria-label', t('add') + ' · ' + nameOf(product));
    bottom.append(node('strong', money(product.price)), add);
    copy.append(node('p', category, 'eyebrow'), node('h3', nameOf(product)), node('p', description), bottom);
    card.append(img, copy);
    return card;
  }));
}

function renderStatus() {
  status.replaceChildren();
  if (!message) return;
  status.append(node('span', t(message.key) + (message.id ? ' · ' + message.id : '')));
  if (message.key === 'confirm') status.append(node('br'), button(t('confirm'), () => capture(message.pending), 'button'));
}

function checkoutForm(total) {
  const form = node('form', '', 'checkout');
  form.append(node('p', t('fictional')));
  for (const [key, type] of [['name','text'], ['email','email'], ['address','text']]) {
    const label = node('label', t(key));
    const input = node('input');
    input.type = type;
    input.name = key;
    input.required = true;
    input.maxLength = 250;
    input.autocomplete = 'off';
    input.value = customer[key] || '';
    input.addEventListener('input', () => { customer[key] = input.value; });
    label.append(input);
    form.append(label);
  }
  const payment = node('fieldset');
  payment.append(node('legend', t('payment')));
  for (const [key, labelText] of [['paypal', paypalSandbox ? 'PayPal Sandbox' : t('paySim')], ['bit', t('bit')]]) {
    const label = node('label');
    const input = node('input');
    input.type = 'radio';
    input.name = 'method';
    input.value = key;
    input.checked = method === key;
    input.addEventListener('change', () => { method = key; });
    label.append(input, labelText);
    payment.append(label);
  }
  const submit = node('button', t('place'), 'button');
  submit.type = 'submit';
  form.append(payment, submit);
  form.addEventListener('submit', event => {
    event.preventDefault();
    place(total);
  });
  return form;
}

function renderCart() {
  cartBody.replaceChildren();
  renderStatus();
  if (!catalog || !items().length) {
    cartBody.append(node('p', t('empty')));
    return;
  }
  const entries = items();
  let subtotal = 0;
  for (const product of entries) {
    const quantity = cart[product.id];
    subtotal += product.price * quantity;
    const line = node('div', '', 'line');
    const title = node('div');
    title.append(node('strong', nameOf(product)), node('br'), node('small', money(product.price)));
    const controls = node('div', '', 'quantity');
    for (const [label, key, delta] of [['−', 'less', -1], ['+', 'more', 1]]) {
      const control = button(label, () => {
        changeQuantity(product.id, delta);
        const next = document.getElementById(control.id) || element('close');
        (next.disabled ? document.getElementById(product.id + '-less') : next)?.focus();
      });
      control.id = product.id + '-' + key;
      control.disabled = busy || (delta > 0 && quantity >= 20);
      control.setAttribute('aria-label', t(key) + ' · ' + nameOf(product));
      if (delta > 0) controls.append(node('span', String(quantity)));
      controls.append(control);
    }
    line.append(title, controls);
    cartBody.append(line);
  }
  const totals = node('dl', '', 'totals');
  const total = subtotal + catalog.shipping;
  for (const [key, value] of [['subtotal', subtotal], ['shipping', catalog.shipping], ['total', total]]) {
    const row = node('div');
    row.append(node('dt', t(key)), node('dd', money(value)));
    totals.append(row);
  }
  cartBody.append(totals, checkoutForm(total));
  if (busy || message?.key === 'confirm') {
    cartBody.querySelectorAll('button, input').forEach(control => { control.disabled = true; });
  }
}

async function checkout(payload) {
  const response = await fetch('/api/checkout', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error('Checkout request failed');
  return response.json();
}

function complete(id) {
  cart = {};
  customer = {};
  requestSignature = undefined;
  sessionStorage.removeItem('utur-pending');
  quantitiesChanged();
  message = {key: 'success', id};
}

async function place(total) {
  if (busy) return;
  const order = {action: 'place', method, customer, total, currency: catalog.currency,
    items: items().map(p => ({id: p.id, quantity: cart[p.id]}))};
  const signature = JSON.stringify(order);
  if (signature !== requestSignature) {
    requestSignature = signature;
    orderReference = crypto.randomUUID();
  }
  busy = true;
  message = undefined;
  renderCart();
  try {
    const result = await checkout({...order, id: orderReference});
    if (result.approvalUrl) {
      sessionStorage.setItem('utur-pending', result.id);
      location.assign(result.approvalUrl);
      return;
    }
    complete(result.id);
  } catch {
    message = {key: 'retry'};
  } finally {
    busy = false;
    renderCart();
  }
}

async function capture(pending) {
  if (busy) return;
  busy = true;
  message = undefined;
  renderCart();
  try {
    const result = await checkout({action: 'capture', id: pending});
    complete(result.id);
  } catch {
    message = {key: 'confirm', pending};
  } finally {
    busy = false;
    renderCart();
  }
}

function translate() {
  t = translator(locale);
  document.documentElement.lang = locale;
  document.documentElement.dir = ['ar', 'he'].includes(locale) ? 'rtl' : 'ltr';
  document.title = 'UTUR عطر | ' + t('announcement');
  language.value = locale;
  language.setAttribute('aria-label', t('language'));
  element('close').setAttribute('aria-label', t('close'));
  document.querySelectorAll('[data-t]').forEach(el => { el.textContent = t(el.dataset.t); });
  renderCatalog();
  if (dialog.open) renderCart();
}

language.addEventListener('change', () => {
  locale = language.value;
  localStorage.setItem('utur-language', locale);
  translate();
});
element('open-cart').addEventListener('click', () => {
  renderCart();
  dialog.showModal();
});
translate();

const dataRequests = await Promise.allSettled([
  fetch('/catalog.json').then(response => {
    if (!response.ok) throw new Error('Catalog unavailable');
    return response.json();
  }),
  fetch('/api/checkout').then(response => response.json()),
]);
if (dataRequests[0].status === 'fulfilled') {
  catalog = dataRequests[0].value;
  cart = Object.fromEntries(catalog.products
    .filter(p => p.active && Number.isInteger(cart[p.id]) && cart[p.id] > 0)
    .map(p => [p.id, Math.min(cart[p.id], 20)]));
  quantitiesChanged();
} else {
  catalogError = true;
}
paypalSandbox = dataRequests[1].value?.paypalSandbox === true;
renderCatalog();
if (dialog.open) renderCart();

const paymentReturn = new URL(location.href).searchParams.get('paypal');
const pending = sessionStorage.getItem('utur-pending');
if (paymentReturn && pending) {
  history.replaceState(null, '', '/');
  if (paymentReturn === 'canceled') {
    sessionStorage.removeItem('utur-pending');
    message = {key: 'canceled'};
  } else if (paymentReturn === 'approved') {
    message = {key: 'confirm', pending};
  }
  renderCart();
  if (!dialog.open) dialog.showModal();
}
