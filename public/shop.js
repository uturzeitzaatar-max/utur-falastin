import {languages, translator} from './i18n.js';

const element = id => document.getElementById(id);
const categories = ['all', 'oil', 'spices', 'food', 'soaps', 'candles', 'gifts'];
const dialog = element('cart');
const status = element('checkout-status');
const cartBody = element('cart-body');
const language = element('language');
const headerMenu = element('header-menu');

headerMenu.addEventListener('click', () => {
  headerMenu.setAttribute('aria-expanded', String(headerMenu.getAttribute('aria-expanded') === 'false'));
});
element('header-links').addEventListener('click', event => {
  if (event.target.closest('a') && headerMenu.getAttribute('aria-expanded') === 'true') {
    headerMenu.setAttribute('aria-expanded', 'false');
    headerMenu.focus();
  }
});
headerMenu.closest('nav').addEventListener('keydown', event => {
  if (event.key === 'Escape' && headerMenu.getAttribute('aria-expanded') === 'true') {
    headerMenu.setAttribute('aria-expanded', 'false');
    headerMenu.focus();
  }
});
let locale = localStorage.getItem('utur-language');
if (!languages.includes(locale)) locale = 'en';
let t = translator(locale);
let selected = 'all';
const view = new URLSearchParams(location.search);
const favoritesOnly = view.has('favorites');
const searchQuery = view.get('q')?.trim() || '';
const favorites = new Set();
try {
  const saved = JSON.parse(localStorage.getItem('utur-favorites'));
  if (Array.isArray(saved)) saved.filter(id => typeof id === 'string').forEach(id => favorites.add(id));
} catch {
  // The favorites list starts empty if stored data is unavailable.
}
const searchable = text => text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
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

function isPurchasable(product) {
  return product.active && Number.isSafeInteger(product.price) && product.price > 0;
}

function items() {
  return catalog.products.filter(p => isPurchasable(p) && cart[p.id]);
}

function quantitiesChanged() {
  localStorage.setItem('utur-cart', JSON.stringify(cart));
  const count = Object.values(cart).reduce((a, b) => a + b, 0);
  element('cart-count').textContent = count || '';
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
  if (!element('products')) return;
  element('catalog-status').textContent = catalogError ? t('catalogError') : '';
  const productGrid = element('products');
  const viewSummary = element('catalog-view');
  viewSummary.hidden = !favoritesOnly && !searchQuery;
  viewSummary.firstElementChild.textContent = favoritesOnly ? t('favorites') : searchQuery;
  const query = searchable(searchQuery);
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
  const groups = new Map();
  for (const product of catalog.products) {
    if (!product.active || (selected !== 'all' && product.category !== selected)) continue;
    const key = product.group || product.id;
    if (favoritesOnly && !favorites.has(key)) continue;
    if (query && ![...product.name, product.size].some(value => searchable(value).includes(query))) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(product);
  }
  if (!groups.size) element('catalog-status').textContent = t('noProducts');
  productGrid.replaceChildren();
  for (const category of categories.slice(1)) {
    const matches = [...groups.values()].filter(variants => variants[0].category === category);
    if (!matches.length) continue;
    const section = node('section', '', 'product-category');
    const heading = node('h2', t(category));
    heading.id = 'category-' + category;
    section.setAttribute('aria-labelledby', heading.id);
    const grid = node('div', '', 'products');
    grid.append(...matches.map(renderProductCard));
    section.append(heading, grid);
    productGrid.append(section);
  }
}

function sizeOf(product) {
  if (['small', 'medium', 'large'].includes(product.size)) return t(product.size);
  return product.size;
}

function productNameAndSize(product) {
  const size = sizeOf(product);
  return size ? nameOf(product) + ' · ' + size : nameOf(product);
}

function productImage(product) {
  const img = node('img');
  img.src = '/assets/' + (product.image || product.id + '.webp');
  img.alt = '';
  img.classList.toggle('packaging-preview', product.image?.startsWith('preview-') === true);
  img.loading = 'lazy';
  img.addEventListener('error', () => { img.src = '/assets/mark.svg'; }, {once: true});
  return img;
}

function descriptionOf(product) {
  return product.description[languages.indexOf(locale)] || product.description[0];
}

function renderProductCard(variants) {
  const product = variants[0];
  const card = node('article', '', 'card');
  const label = nameOf(product);
  const photo = button('', () => openProduct(variants), 'product-photo');
  photo.setAttribute('aria-label', t('details') + ' · ' + label);
  photo.append(productImage(product));
  const copy = node('div', '', 'card-copy');
  const title = node('h3');
  title.append(button(label, () => openProduct(variants), 'product-title'));
  const sizes = variants.map(sizeOf).filter(Boolean);
  const bottom = node('div', '', 'card-bottom');
  const prices = variants.filter(isPurchasable).map(variant => variant.price);
  const price = Math.min(...prices);
  const highestPrice = Math.max(...prices);
  const displayPrice = prices.length ? money(price) + (price === highestPrice ? '' : ' – ' + money(highestPrice)) : t('priceTbc');
  bottom.append(node('strong', displayPrice));
  const sizeSummary = sizes.length > 3 ? sizes[0] + ' – ' + sizes.at(-1) : sizes.join(' / ');
  const cardSummary = product.category === 'candles' && !sizeSummary ? descriptionOf(product) : sizeSummary || t('sizeTbc');
  copy.append(title, node('p', cardSummary, 'product-sizes'), bottom);
  card.append(photo, copy);
  return card;
}

function openProduct(variants) {
  const details = element('product-details');
  const product = variants[0];
  const close = button('×', () => details.close());
  close.setAttribute('aria-label', t('close'));
  const heading = node('h2', nameOf(product));
  heading.id = 'product-details-title';
  const key = product.group || product.id;
  const favoriteLabel = () => t(favorites.has(key) ? 'removeFavorite' : 'saveFavorite');
  const favorite = button(favoriteLabel(), () => {
    if (favorites.has(key)) favorites.delete(key);
    else favorites.add(key);
    try {
      localStorage.setItem('utur-favorites', JSON.stringify([...favorites]));
    } catch {
      // Favorites remain available for this visit.
    }
    favorite.textContent = favoriteLabel();
    renderCatalog();
  }, 'favorite-button');
  const top = node('div', '', 'dialog-top');
  top.append(heading, close);
  const select = node('select');
  const sizeLabel = node('label', t('size'), 'product-size');
  for (const variant of variants) {
    const option = node('option', sizeOf(variant) || t('sizeTbc'));
    option.value = variant.id;
    select.append(option);
  }
  sizeLabel.append(select);
  const price = node('strong');
  price.setAttribute('aria-live', 'polite');
  const chosen = () => variants[select.selectedIndex];
  const add = button(t('add'), () => {
    if (!isPurchasable(chosen())) return;
    changeQuantity(chosen().id, 1);
    details.close();
    openCart();
  }, 'button');
  const actions = node('div', '', 'product-actions');
  actions.append(price, add);
  const photo = node('div');
  function updateVariant() {
    const variant = chosen();
    const purchasable = isPurchasable(variant);
    const image = productImage(variant);
    image.alt = productNameAndSize(variant);
    photo.replaceChildren(image);
    price.textContent = purchasable ? money(variant.price) : t('priceTbc');
    add.hidden = !purchasable;
  }
  select.addEventListener('change', updateVariant);
  updateVariant();
  const description = descriptionOf(product);
  details.replaceChildren(top, photo);
  if (description !== nameOf(product)) details.append(node('p', description));
  details.append(sizeLabel, actions, favorite);
  details.showModal();
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
  const checkoutExpanded = cartBody.querySelector('details')?.open;
  cartBody.replaceChildren();
  renderStatus();
  if (!catalog || !items().length) {
    const empty = node('div', '', 'cart-empty');
    const shop = node('a', t('browse'), 'button');
    shop.href = '/shop/';
    empty.append(node('p', catalogError ? t('catalogError') : t('empty')), shop);
    cartBody.append(empty);
    return;
  }
  const entries = items();
  let subtotal = 0;
  const list = node('ul', '', 'cart-items');
  for (const product of entries) {
    const quantity = cart[product.id];
    subtotal += product.price * quantity;
    const line = node('li', '', 'line');
    const title = node('div');
    title.append(node('strong', nameOf(product)));
    if (sizeOf(product)) title.append(node('small', sizeOf(product)));
    title.append(node('small', money(product.price * quantity)));
    const controls = node('div', '', 'quantity');
    for (const [label, key, delta] of [['−', 'less', -1], ['+', 'more', 1]]) {
      const control = button(label, () => {
        changeQuantity(product.id, delta);
        const next = document.getElementById(control.id) || element('close');
        (next.disabled ? document.getElementById(product.id + '-less') : next)?.focus();
      });
      control.id = product.id + '-' + key;
      control.disabled = busy || (delta > 0 && quantity >= 20);
      control.setAttribute('aria-label', t(key) + ' · ' + productNameAndSize(product));
      if (delta > 0) controls.append(node('span', String(quantity)));
      controls.append(control);
    }
    line.append(productImage(product), title, controls);
    list.append(line);
  }
  const totals = node('dl', '', 'totals');
  const total = subtotal + catalog.shipping;
  for (const [key, value] of [['subtotal', subtotal], ['shipping', catalog.shipping], ['total', total]]) {
    const row = node('div');
    row.append(node('dt', t(key)), node('dd', money(value)));
    totals.append(row);
  }
  const checkoutDetails = node('details', '', 'cart-checkout');
  checkoutDetails.open = Boolean(checkoutExpanded);
  checkoutDetails.append(node('summary', t('checkout'), 'button'), checkoutForm(total));
  cartBody.append(list, totals, checkoutDetails);
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
  const currentPage = document.querySelector('#header-links [aria-current=page]')?.dataset.t;
  document.title = 'UTUR عطر | ' + t(currentPage === 'home' || !currentPage ? 'announcement' : currentPage);
  language.value = locale;
  language.setAttribute('aria-label', t('language'));
  element('close').setAttribute('aria-label', t('close'));
  document.querySelectorAll('[data-label]').forEach(el => el.setAttribute('aria-label', t(el.dataset.label)));
  document.querySelectorAll('[data-t]').forEach(el => { el.textContent = t(el.dataset.t); });
  renderCatalog();
  if (dialog.open) renderCart();
}

language.addEventListener('change', () => {
  locale = language.value;
  localStorage.setItem('utur-language', locale);
  translate();
});
function openCart() {
  renderCart();
  dialog.showModal();
}
element('open-cart').addEventListener('click', openCart);
element('open-account').addEventListener('click', () => element('account-dialog').showModal());
element('open-search').addEventListener('click', () => element('search-dialog').showModal());
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
    .filter(p => isPurchasable(p) && Number.isInteger(cart[p.id]) && cart[p.id] > 0)
    .map(p => [p.id, Math.min(cart[p.id], 20)]));
  quantitiesChanged();
} else {
  catalogError = true;
}
paypalSandbox = dataRequests[1].value?.paypalSandbox === true;
renderCatalog();
if (location.hash.startsWith('#category-')) {
  element(location.hash.slice(1))?.scrollIntoView();
}
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
