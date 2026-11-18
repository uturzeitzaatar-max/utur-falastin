import {readFile, access} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {languages, translator} from '../public/i18n.js';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const catalog = JSON.parse(await read('../public/catalog.json'));
assert.match(catalog.currency, /^[A-Z]{3}$/);
assert(Number.isSafeInteger(catalog.shipping) && catalog.shipping >= 0);
const ids = new Set();
const categories = ['oil', 'spices', 'food', 'soaps', 'candles', 'gifts'];
for (const product of catalog.products) {
  assert.match(product.id, /^[a-z0-9-]+$/);
  assert(!ids.has(product.id), 'Duplicate product id: ' + product.id);
  ids.add(product.id);
  assert(categories.includes(product.category), 'Unknown category: ' + product.category);
  assert(Number.isSafeInteger(product.price) && product.price > 0, 'Invalid price: ' + product.id);
  assert.equal(typeof product.active, 'boolean');
  assert.equal(typeof product.size, 'string');
  for (const field of ['name', 'description']) {
    assert.equal(product[field].length, languages.length);
    assert(product[field].every(text => typeof text === 'string' && text.trim()));
  }
  const image = product.image || product.id + '.webp';
  assert.match(image, /^[a-zA-Z0-9_-]+\.(webp|png|jpe?g|avif)$/);
  await access(new URL('../public/assets/' + image, import.meta.url));
}
const html = await read('../public/index.html');
for (const [, key] of html.matchAll(/data-t="([^"]+)"/g)) {
  for (const language of languages) assert(translator(language)(key));
}
console.log('Catalog, images and storefront translation keys verified.');
