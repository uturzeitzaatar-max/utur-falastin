# UTUR · عطر

A responsive Palestinian storefront inspired by UTUR’s [original site](https://sites.google.com/view/utur-falastin/home). It includes a persistent cart, a server-validated test checkout, and English, Arabic, Hebrew, Italian, German and Bosnian. Arabic and Hebrew use right-to-left layout.

## Edit products and prices

Open [public/catalog.json](public/catalog.json) in GitHub and use the pencil icon. Each product has its own entry. Commit your edits to redeploy with Cloudflare Git integration.

| Field | How to edit |
| --- | --- |
| `id` | Give new products a unique lowercase identifier. Keep existing IDs to preserve carts. |
| `category` | Use `oil`, `spices`, `food`, `soaps`, `candles` or `gifts`. |
| `price` | Set the integer amount in minor units. In ILS, `6800` means ₪68.00. |
| `active` | Use `false` to hide a product and prevent checkout. |
| `size` | Enter a display label such as `500 ml`, or use an empty string. |
| `group` | Give variants of the same product a shared group. Each size keeps its own unique ID and price. |
| `name`, `description` | Enter six translations in order: English, Arabic, Hebrew, Italian, German, Bosnian. |
| `image` | Optionally set a filename from `public/assets/`. The default is `<id>.webp`. |

`shipping` is a flat test shipping charge in minor units. `currency` is shared across the shop. The prices, products, shipping charge and generated product photos are sample content. The store displays a test notice and prompts shoppers to use fictional delivery details. The test database stores product lines and payment state only. It does not store delivery details.

## Run locally

Use Node.js 22 or later.

```sh
npm ci
npm run check
npm run dev
```

Wrangler creates and migrates a local D1 database and prints the local URL. Both payment options work as simulations by default.

## Deploy on Cloudflare Pages Free

1. In Cloudflare, create a D1 database on the Free plan. In its console, run [migrations/0001_orders.sql](migrations/0001_orders.sql).
2. Create a **Pages** project using Git integration. Choose this repository, branch `main`, framework preset **None**, leave the build command empty, and set the output directory to `public`. Keep the repository root as the project root so Pages finds `functions/`.
3. In the Pages project’s settings, add a D1 binding named `DB` pointing to the database for the environment you intend to test. Redeploy after adding the binding. Use a separate database if you also enable checkout on preview deployments.
4. Open the deployed shop, add a product and submit a checkout with fictional details. The order reference should appear in the cart. In D1, run `SELECT id, method, currency, total, status, created_at FROM orders ORDER BY created_at DESC LIMIT 20;` to verify the record.

`wrangler.local.jsonc` contains a local-only database ID. Bind the actual cloud database in the Pages dashboard.

## Test payments

- **PayPal simulation** runs without credentials. To use the PayPal sandbox, create a sandbox app and test buyer in the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/). In Pages settings, add `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` as secrets for the test environment, then redeploy. Locally, use a gitignored `.dev.vars` file. Use the sandbox buyer for approval and confirm the sandbox capture after returning to UTUR. The server creates and captures orders on PayPal’s sandbox API only.
- **bit simulation** exercises checkout and creates a test order without messaging a phone or contacting bit. Real bit merchant checkout needs the setup details from [your payment provider](https://www.bitpay.co.il/he/bit-for-businesses).

Before accepting live orders, confirm the catalog and delivery terms, implement the merchant’s live payment integrations and configure actual fulfillment and order notifications. There is no live-payment switch in this source.
