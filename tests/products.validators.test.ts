import assert from "node:assert/strict";
import test from "node:test";
import { createProductSchema, updateProductSchema } from "../src/modules/products/products.validators";

const validProduct = {
  name: "Wireless Headphones",
  description: "A reliable pair of wireless headphones.",
  categorySlug: "audio",
  price: 100,
  stock: 2,
  images: ["https://example.com/headphones.jpg"],
  sellingMethod: "CHECKOUT" as const,
};

test("product creation accepts blank optional Europe and US prices", () => {
  const parsed = createProductSchema.parse({
    ...validProduct,
    euPrice: "",
    usPrice: "",
  });

  assert.equal(parsed.euPrice, undefined);
  assert.equal(parsed.usPrice, undefined);
});

test("product creation rejects a zero market price when one is supplied", () => {
  assert.throws(() => createProductSchema.parse({ ...validProduct, euPrice: 0 }));
  assert.throws(() => createProductSchema.parse({ ...validProduct, usPrice: 0 }));
});

test("partial product updates do not default an omitted price to zero", () => {
  const parsed = updateProductSchema.parse({ status: "ACTIVE" });
  assert.equal(parsed.price, undefined);
  assert.equal(parsed.status, "ACTIVE");
});
