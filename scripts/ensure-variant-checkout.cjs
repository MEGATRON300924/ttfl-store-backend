const fs = require("node:fs");
const path = require("node:path");

const file = path.join(process.cwd(), "src/modules/orders/orders.service.ts");
let source = fs.readFileSync(file, "utf8");

if (!source.includes("function resolveProductVariant")) {
  const marker = "async function generateOrderNumber()";
  const helper = `function resolveProductVariant(product: Product, variantKey?: string){\n  if(!variantKey) return undefined;\n  const raw=(product.specifications && typeof product.specifications === "object" && !Array.isArray(product.specifications)) ? (product.specifications as Record<string, unknown>)["_variations"] : undefined;\n  if(!Array.isArray(raw)) throw AppError.badRequest("The selected product variation is no longer available","VARIANT_UNAVAILABLE");\n  const variant=raw.find((item)=>item && typeof item==="object" && (item as Record<string,unknown>).key===variantKey) as Record<string,unknown>|undefined;\n  if(!variant) throw AppError.badRequest("The selected product variation is no longer available","VARIANT_UNAVAILABLE");\n  const price=variant.price===""||variant.price===null||variant.price===undefined?Number(product.price):Number(variant.price);\n  if(!Number.isFinite(price)||price<0) throw AppError.badRequest("The selected product variation has an invalid price","INVALID_VARIANT_PRICE");\n  return {key:variantKey,label:typeof variant.label==="string"?variant.label:variantKey,options:variant.options && typeof variant.options==="object" && !Array.isArray(variant.options)?variant.options as Record<string,string>:{},price};\n}\n\n`;
  if (!source.includes(marker)) throw new Error("Could not locate order-number helper in orders.service.ts");
  source = source.replace(marker, helper + marker);
}

source = source.replace(
  "const d=deals.get(p.id);if(p.stock<line.quantity)",
  "const d=deals.get(p.id);const variant=resolveProductVariant(p,line.variantKey);if(p.stock<line.quantity)"
);
source = source.replace(
  "g.items.push({product:p,quantity:line.quantity,unitPrice:d?.salePrice??Number(p.price)});",
  "g.items.push({product:p,quantity:line.quantity,unitPrice:d?.salePrice??variant?.price??Number(p.price),variant});"
);
source = source.replace(
  "items:{create:g.items.map(i=>({productId:i.product.id,productName:i.product.name,unitPrice:i.unitPrice,quantity:i.quantity,lineTotal:i.unitPrice*i.quantity}))}",
  "items:{create:g.items.map(i=>({productId:i.product.id,productName:i.product.name,unitPrice:i.unitPrice,quantity:i.quantity,lineTotal:i.unitPrice*i.quantity,...(i.variant?{variantKey:i.variant.key,variantLabel:i.variant.label,variantOptions:i.variant.options}: {})}))}"
);

fs.writeFileSync(file, source);
console.log("Variant checkout patch applied.");
