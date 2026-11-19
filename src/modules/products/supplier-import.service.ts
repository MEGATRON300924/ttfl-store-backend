import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AppError } from "@/utils/app-error";

type Supplier = "AliExpress" | "Jiji" | "SHEIN" | "Jumia";
const EXACT_HOSTS: Record<Supplier, Set<string>> = {
  AliExpress: new Set(["aliexpress.com", "www.aliexpress.com", "m.aliexpress.com"]),
  Jiji: new Set(["jiji.ng", "www.jiji.ng", "m.jiji.ng"]),
  SHEIN: new Set(["shein.com"]),
  Jumia: new Set(["jumia.com.ng", "www.jumia.com.ng", "m.jumia.com.ng"]),
};
function supplierForHost(hostname: string): Supplier | null {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (EXACT_HOSTS.AliExpress.has(host)) return "AliExpress";
  if (EXACT_HOSTS.Jiji.has(host)) return "Jiji";
  if (host === "shein.com" || host.endsWith(".shein.com")) return "SHEIN";
  if (EXACT_HOSTS.Jumia.has(host)) return "Jumia";
  return null;
}
function isAllowedImageHost(hostname: string, supplier: Supplier, pageHost: string): boolean {
  const host = hostname.toLowerCase();
  const suffix = supplier === "Jiji" ? ".jiji.ng" : supplier === "SHEIN" ? ".shein.com" : supplier === "Jumia" ? ".jumia.com.ng" : ".aliexpress.com";
  if (host === pageHost || host.endsWith(suffix)) return true;
  if (supplier === "AliExpress") return host === "alicdn.com" || host.endsWith(".alicdn.com") || host === "aliexpress-media.com" || host.endsWith(".aliexpress-media.com");
  if (supplier === "SHEIN") return host === "ltwebstatic.com" || host.endsWith(".ltwebstatic.com");
  if (supplier === "Jumia") return host === "jumia.is" || host.endsWith(".jumia.is");
  return false;
}
const MAX_HTML_BYTES = 2_000_000;
const FETCH_TIMEOUT_MS = 12_000;
const FX_CACHE_MS = 15 * 60 * 1000;

type ProductMetadata = {
  name: string | null;
  description: string | null;
  images: string[];
  supplierPrice: number | null;
  supplierCurrency: string | null;
};

let fxCache: { ngnPerUsd: number; fetchedAt: number } | null = null;

function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const octets = address.split(".").map(Number);
    const [a, b] = octets;
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    return normalized === "::1" || normalized === "::" || normalized.startsWith("fc") ||
      normalized.startsWith("fd") || normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") || normalized.startsWith("fea") ||
      normalized.startsWith("feb") || normalized.startsWith("::ffff:");
  }
  return true;
}

export async function validateSupplierUrl(raw: string): Promise<URL> {
  let url: URL;
  try { url = new URL(raw); } catch { throw AppError.badRequest("Enter a valid HTTPS product URL from a supported store.", "INVALID_SUPPLIER_URL"); }
  if (url.protocol !== "https:" || url.username || url.password || supplierForHost(url.hostname) === null) {
    throw AppError.badRequest("Supported stores: HTTPS AliExpress, Jiji Nigeria, SHEIN and Jumia product pages.", "UNSUPPORTED_SUPPLIER_HOST");
  }
  if (url.port && url.port !== "443") throw AppError.badRequest("The supplier URL uses an unsupported port.", "INVALID_SUPPLIER_URL");
  const addresses = await lookup(url.hostname, { all: true, verbatim: true }).catch(() => []);
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw AppError.badRequest("The supplier host could not be safely verified.", "UNSAFE_SUPPLIER_HOST");
  }
  url.hash = "";
  return url;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_m, n: string) => String.fromCodePoint(parseInt(n, 16)));
}

function plainText(value: unknown, max = 5000): string | null {
  if (typeof value !== "string") return null;
  const cleaned = decodeHtml(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

function metaContent(html: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=[\"']${escaped}[\"'][^>]+content=[\"']([^\"']*)[\"'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=[\"']([^\"']*)[\"'][^>]+(?:property|name)=[\"']${escaped}[\"'][^>]*>`, "i"),
  ];
  for (const pattern of patterns) { const match = html.match(pattern); if (match?.[1]) return decodeHtml(match[1]); }
  return null;
}

function collectProductNodes(value: unknown, output: Record<string, unknown>[], depth = 0): void {
  if (depth > 8 || !value || typeof value !== "object") return;
  if (Array.isArray(value)) { for (const item of value) collectProductNodes(item, output, depth + 1); return; }
  const item = value as Record<string, unknown>;
  const type = item["@type"];
  if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) output.push(item);
  for (const nested of Object.values(item)) collectProductNodes(nested, output, depth + 1);
}


type AliExpressEmbeddedData = {
  name: string | null;
  description: string | null;
  images: string[];
  price: number | null;
  currency: string | null;
};

function extractJsonObjectAfter(source: string, start: number): unknown | null {
  const open = source.indexOf("{", start);
  if (open < 0) return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(source.slice(open, index + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

function extractAliExpressEmbeddedData(html: string): AliExpressEmbeddedData {
  const roots: unknown[] = [];
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const script = match[1];
    if (script.length > 1_000_000) continue;
    const trimmed = script.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try { roots.push(JSON.parse(trimmed)); } catch { /* Script is not standalone JSON. */ }
    }
    const assignment = /(?:window\.)?runParams\s*=\s*/g;
    let found: RegExpExecArray | null;
    while ((found = assignment.exec(script)) !== null) {
      const parsed = extractJsonObjectAfter(script, found.index + found[0].length);
      if (parsed) roots.push(parsed);
    }
  }

  const modules: Record<string, Record<string, unknown>> = {};
  const seen = new Set<object>();
  let visited = 0;
  const walk = (value: unknown, depth = 0): void => {
    if (!value || typeof value !== "object" || depth > 14 || visited > 30000 || seen.has(value as object)) return;
    seen.add(value as object);
    visited += 1;
    if (Array.isArray(value)) {
      for (const child of value) walk(child, depth + 1);
      return;
    }
    const object = value as Record<string, unknown>;
    for (const key of ["titleModule", "imageModule", "priceModule", "descriptionModule"]) {
      const candidate = object[key];
      if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
        modules[key] = candidate as Record<string, unknown>;
      }
    }
    for (const child of Object.values(object)) walk(child, depth + 1);
  };
  for (const root of roots) walk(root);

  const title = modules.titleModule?.subject ?? modules.titleModule?.title;
  const description = modules.descriptionModule?.description ?? modules.descriptionModule?.productDescription;
  const imageModule = modules.imageModule ?? {};
  const rawImages = imageModule.imagePathList ?? imageModule.imageUrlList ?? imageModule.images;
  const images = Array.isArray(rawImages) ? rawImages.filter((item): item is string => typeof item === "string") : [];
  const priceModule = modules.priceModule ?? {};
  const amountObject = priceModule.minAmount && typeof priceModule.minAmount === "object"
    ? priceModule.minAmount as Record<string, unknown> : {};
  const rawPrice = amountObject.value ?? priceModule.minPrice ?? priceModule.maxPrice;
  const price = Number(typeof rawPrice === "string" ? rawPrice.replace(/,/g, "") : rawPrice);
  const currency = amountObject.currency ?? priceModule.currencyCode ?? priceModule.currency;
  return {
    name: plainText(title, 160),
    description: plainText(description, 5000),
    images,
    price: Number.isFinite(price) && price > 0 ? price : null,
    currency: typeof currency === "string" ? currency.toUpperCase().slice(0, 3) : null,
  };
}

export function extractMetadata(html: string, sourceUrl: URL): ProductMetadata {
  const supplier = supplierForHost(sourceUrl.hostname) ?? "AliExpress";
  const products: Record<string, unknown>[] = [];
  const scripts = html.matchAll(/<script[^>]+type=[\"']application\/ld\+json[\"'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of scripts) {
    try { collectProductNodes(JSON.parse(decodeHtml(match[1])), products); } catch { /* Ignore malformed third-party JSON-LD. */ }
  }
  const product = products[0];
  const embedded = supplier === "AliExpress" ? extractAliExpressEmbeddedData(html) : null;
  const offerValue = product?.offers;
  const offer = Array.isArray(offerValue) ? offerValue[0] : offerValue;
  const offerObject = offer && typeof offer === "object" ? offer as Record<string, unknown> : {};
  const priceValue = Number(offerObject.price ?? offerObject.lowPrice ?? metaContent(html, "product:price:amount") ?? embedded?.price);
  const currencyValue = offerObject.priceCurrency ?? metaContent(html, "product:price:currency") ?? embedded?.currency;
  const rawImages = product?.image ?? metaContent(html, "og:image") ?? embedded?.images;
  const imageValues = Array.isArray(rawImages) ? rawImages : rawImages ? [rawImages] : [];
  const images = Array.from(new Set(imageValues.flatMap((item) => {
    const candidate = typeof item === "string" ? item : item && typeof item === "object" ? (item as Record<string, unknown>).url : null;
    if (typeof candidate !== "string") return [];
    try {
      const imageUrl = new URL(candidate, sourceUrl);
      const host = imageUrl.hostname.toLowerCase();
      if (imageUrl.protocol !== "https:" || !isAllowedImageHost(host, supplier, sourceUrl.hostname.toLowerCase())) return [];
      return [imageUrl.toString()];
    } catch { return []; }
  }))).slice(0, 8);
  return {
    name: plainText(product?.name) ?? plainText(metaContent(html, "og:title")) ?? embedded?.name ?? plainText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1], 160),
    description: plainText(product?.description) ?? plainText(metaContent(html, "og:description"), 5000) ?? plainText(metaContent(html, "description"), 5000) ?? embedded?.description,
    images,
    supplierPrice: Number.isFinite(priceValue) && priceValue > 0 ? priceValue : null,
    supplierCurrency: typeof currencyValue === "string" ? currencyValue.toUpperCase().slice(0, 3) : (supplier === "Jiji" && Number.isFinite(priceValue) && priceValue > 0 ? "NGN" : null),
  };
}

async function fetchSupplierHtml(initialUrl: URL): Promise<{ html: string; finalUrl: URL }> {
  let current = initialUrl;
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(current, {
        method: "GET", redirect: "manual", signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; TTFLStoreProductImporter/1.0)", Accept: "text/html,application/xhtml+xml" },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location || redirect === 3) throw AppError.badRequest("The supplier page redirected too many times.", "SUPPLIER_REDIRECT_LIMIT");
        current = await validateSupplierUrl(new URL(location, current).toString());
        continue;
      }
      if (!response.ok) throw AppError.badRequest("The supplier did not return a product page. The listing may be unavailable or protected.", "SUPPLIER_PAGE_UNAVAILABLE");
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().includes("text/html")) throw AppError.badRequest("The supplied URL did not return an HTML product page.", "SUPPLIER_NOT_HTML");
      const declaredLength = Number(response.headers.get("content-length") ?? 0);
      if (declaredLength > MAX_HTML_BYTES) throw AppError.badRequest("The supplier page is too large to import safely.", "SUPPLIER_PAGE_TOO_LARGE");
      const reader = response.body?.getReader();
      if (!reader) throw AppError.badRequest("The supplier page returned no readable content.", "SUPPLIER_EMPTY_PAGE");
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_HTML_BYTES) { await reader.cancel(); throw AppError.badRequest("The supplier page is too large to import safely.", "SUPPLIER_PAGE_TOO_LARGE"); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return { html: new TextDecoder().decode(bytes), finalUrl: current };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw AppError.badRequest("The supplier store could not be reached or timed out. Try again or enter the product details manually.", "SUPPLIER_FETCH_FAILED");
    } finally {
      clearTimeout(timeout);
    }
  }
  throw AppError.badRequest("Unable to follow the supplier product link.", "SUPPLIER_FETCH_FAILED");
}

async function getNgnPerUsd(): Promise<{ rate: number; timestamp: string }> {
  if (fxCache && Date.now() - fxCache.fetchedAt < FX_CACHE_MS) {
    return { rate: fxCache.ngnPerUsd, timestamp: new Date(fxCache.fetchedAt).toISOString() };
  }
  const response = await fetch("https://open.er-api.com/v6/latest/USD", { signal: AbortSignal.timeout(5000) }).catch(() => null);
  if (!response?.ok) throw AppError.internal("Live currency conversion is temporarily unavailable. Please try again later.", "FX_UNAVAILABLE");
  const data = await response.json() as { result?: string; rates?: Record<string, number>; time_last_update_utc?: string };
  const rate = Number(data.rates?.NGN);
  if (data.result !== "success" || !Number.isFinite(rate) || rate <= 0) throw AppError.internal("Live currency conversion is temporarily unavailable.", "FX_UNAVAILABLE");
  fxCache = { ngnPerUsd: rate, fetchedAt: Date.now() };
  return { rate, timestamp: data.time_last_update_utc ? new Date(data.time_last_update_utc).toISOString() : new Date().toISOString() };
}

export async function importSupplierProduct(rawUrl: string) {
  const url = await validateSupplierUrl(rawUrl);
  const { html, finalUrl } = await fetchSupplierHtml(url);
  const metadata = extractMetadata(html, finalUrl);
  if (!metadata.name && !metadata.description && metadata.images.length === 0) {
    throw AppError.badRequest("We couldn't extract product details from this page. The store may be blocking automated access; please enter the details manually.", "NO_PRODUCT_METADATA");
  }
  let price: { usd: number | null; ngn: number | null; ngnPerUsd: number | null; source: string; timestamp: string | null } = {
    usd: null, ngn: null, ngnPerUsd: null, source: "open.er-api.com", timestamp: null,
  };
  if (metadata.supplierPrice !== null && metadata.supplierCurrency) {
    const fx = await getNgnPerUsd();
    let usd: number | null = null;
    if (metadata.supplierCurrency === "USD") usd = metadata.supplierPrice;
    else if (metadata.supplierCurrency === "NGN") usd = metadata.supplierPrice / fx.rate;
    else {
      const currencyResponse = await fetch(`https://open.er-api.com/v6/latest/USD`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
      if (currencyResponse?.ok) {
        const rates = (await currencyResponse.json() as { rates?: Record<string, number> }).rates;
        const sourceRate = Number(rates?.[metadata.supplierCurrency]);
        if (Number.isFinite(sourceRate) && sourceRate > 0) usd = metadata.supplierPrice / sourceRate;
      }
    }
    if (usd !== null) price = { usd: Number(usd.toFixed(2)), ngn: Math.round(usd * fx.rate), ngnPerUsd: fx.rate, source: "open.er-api.com", timestamp: fx.timestamp };
  }
  return {
    sourceUrl: finalUrl.toString(),
    supplier: supplierForHost(finalUrl.hostname) ?? "Unknown",
    extracted: { name: metadata.name, description: metadata.description, images: metadata.images },
    supplierPrice: metadata.supplierPrice === null ? null : { amount: metadata.supplierPrice, currency: metadata.supplierCurrency },
    conversion: price,
    warnings: ["Imported details are estimates from the supplier page. Review all text, images, variants, shipping costs and legal requirements before listing.", "Supplier cost is reference information only and is not your TTFL Store selling price."],
  };
}
