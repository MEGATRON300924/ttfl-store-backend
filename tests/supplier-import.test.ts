import assert from "node:assert/strict";
import test from "node:test";
import { extractMetadata, validateSupplierUrl } from "../src/modules/products/supplier-import.service";

test("supplier URL validation only accepts HTTPS supported-store hosts", async () => {
  await assert.rejects(() => validateSupplierUrl("http://www.aliexpress.com/item/123.html"), /Supported stores/);
  await assert.rejects(() => validateSupplierUrl("https://example.com/product"), /Supported stores/);
  await assert.rejects(() => validateSupplierUrl("https://127.0.0.1/product"), /Supported stores/);
});

test("supplier metadata parser extracts product JSON-LD and safe image URLs", () => {
  const html = `<!doctype html><html><head><meta property="og:title" content="Fallback title"></head><body>
    <script type="application/ld+json">
      {"@context":"https://schema.org","@type":"Product","name":"Wireless Headphones","description":"Bluetooth headphones with noise cancellation.","image":["https://ae01.alicdn.com/kf/item.jpg","http://evil.example/tracker.png"],"offers":{"@type":"Offer","price":"19.99","priceCurrency":"USD"}}
    </script>
  </body></html>`;
  const result = extractMetadata(html, new URL("https://www.aliexpress.com/item/123.html"));
  assert.equal(result.name, "Wireless Headphones");
  assert.equal(result.description, "Bluetooth headphones with noise cancellation.");
  assert.equal(result.supplierPrice, 19.99);
  assert.equal(result.supplierCurrency, "USD");
  assert.deepEqual(result.images, ["https://ae01.alicdn.com/kf/item.jpg"]);
});

test("supplier metadata parser falls back to Open Graph fields", () => {
  const html = `<meta property="og:title" content="Portable Speaker"><meta property="og:description" content="Compact Bluetooth speaker"><meta property="og:image" content="https://www.aliexpress.com/images/speaker.jpg">`;
  const result = extractMetadata(html, new URL("https://www.aliexpress.com/item/123.html"));
  assert.equal(result.name, "Portable Speaker");
  assert.equal(result.description, "Compact Bluetooth speaker");
  assert.deepEqual(result.images, ["https://www.aliexpress.com/images/speaker.jpg"]);
});

test("Jiji product pages extract NGN pricing and Jiji-hosted images", () => {
  const html = `<meta property="og:title" content="Used iPhone 13"><meta property="og:description" content="Good condition"><meta property="product:price:amount" content="450000"><meta property="og:image" content="https://img.jiji.ng/item/phone.jpg">`;
  const result = extractMetadata(html, new URL("https://jiji.ng/item/123"));
  assert.equal(result.name, "Used iPhone 13");
  assert.equal(result.supplierPrice, 450000);
  assert.equal(result.supplierCurrency, "NGN");
  assert.deepEqual(result.images, ["https://img.jiji.ng/item/phone.jpg"]);
});

test("SHEIN product pages extract JSON-LD and SHEIN CDN images", () => {
  const html = `<script type="application/ld+json">{"@type":"Product","name":"Women's blouse","description":"Lightweight blouse","image":["https://img.ltwebstatic.com/images/blouse.jpg"],"offers":{"price":"12.50","priceCurrency":"USD"}}</script>`;
  const result = extractMetadata(html, new URL("https://us.shein.com/product-p-123.html"));
  assert.equal(result.name, "Women's blouse");
  assert.equal(result.supplierPrice, 12.5);
  assert.equal(result.supplierCurrency, "USD");
  assert.deepEqual(result.images, ["https://img.ltwebstatic.com/images/blouse.jpg"]);
});

test("Jumia product pages extract metadata and Jumia CDN images", () => {\n  const html = `<meta property="og:title" content="Android smartphone"><meta property="og:description" content="Dual SIM smartphone"><meta property="product:price:amount" content="125000"><meta property="product:price:currency" content="NGN"><meta property="og:image" content="https://ng.jumia.is/unsafe/fit-in/500x500/product.jpg">`;\n  const result = extractMetadata(html, new URL("https://www.jumia.com.ng/catalog/product/123"));\n  assert.equal(result.name, "Android smartphone");\n  assert.equal(result.supplierPrice, 125000);\n  assert.equal(result.supplierCurrency, "NGN");\n  assert.deepEqual(result.images, ["https://ng.jumia.is/unsafe/fit-in/500x500/product.jpg"]);\n});\n\ntest("supplier URL validation rejects lookalike domains", async () => {
  await assert.rejects(() => validateSupplierUrl("https://jiji.ng.attacker.example/item"), /Supported stores/);
  await assert.rejects(() => validateSupplierUrl("https://shein.com.attacker.example/product"), /Supported stores/);\n  await assert.rejects(() => validateSupplierUrl("https://jumia.com.ng.attacker.example/product"), /Supported stores/);
});
