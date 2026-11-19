import assert from "node:assert/strict";
import test from "node:test";
import { extractMetadata, validateSupplierUrl } from "../src/modules/products/supplier-import.service";

test("supplier URL validation only accepts HTTPS AliExpress hosts", async () => {
  await assert.rejects(() => validateSupplierUrl("http://www.aliexpress.com/item/123.html"), /HTTPS AliExpress/);
  await assert.rejects(() => validateSupplierUrl("https://example.com/product"), /HTTPS AliExpress/);
  await assert.rejects(() => validateSupplierUrl("https://127.0.0.1/product"), /HTTPS AliExpress/);
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
