import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/app-error";
import { slugify } from "@/utils/slugify";
import { recordAudit } from "@/lib/audit";

export type CategoryVariationType = "PRODUCT" | "CLOTHING" | "OTHER";
export type CategoryVariationOption = { id: string; label: string; value: string };
export type CategoryVariation = { id: string; key: string; name: string; type: CategoryVariationType; options: CategoryVariationOption[] };
export type CategoryVariationConfig = { enabled: boolean; variations: CategoryVariation[] };

const EMPTY_CONFIG: CategoryVariationConfig = { enabled: false, variations: [] };
let columnReady: Promise<void> | null = null;

async function ensureVariationColumn() {
  if (!columnReady) columnReady = prisma.$executeRawUnsafe('ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "variationConfig" JSONB').then(() => undefined);
  await columnReady;
}

let defaultCategoriesReady: Promise<void> | null = null;
const DEFAULT_CATEGORY_TREE: Array<{ name: string; slug: string; icon?: string; children: Array<{ name: string; slug: string }> }> = [
  { name: "Electronics", slug: "electronics", icon: "Monitor", children: [
    { name: "Audio & Headphones", slug: "audio-headphones" }, { name: "Cameras & Photography", slug: "cameras-photography" },
    { name: "TVs & Home Entertainment", slug: "tvs-home-entertainment" }, { name: "Wearable Technology", slug: "wearable-technology" },
    { name: "Cables & Adapters", slug: "cables-adapters" }, { name: "Power Banks & Chargers", slug: "power-banks-chargers" }
  ]},
  { name: "Computers & Laptops", slug: "computers-laptops", icon: "Laptop", children: [
    { name: "Laptops", slug: "laptops" }, { name: "Desktop Computers", slug: "desktop-computers" }, { name: "Monitors", slug: "monitors" },
    { name: "Computer Components", slug: "computer-components" }, { name: "Keyboards & Mice", slug: "keyboards-mice" },
    { name: "Printers & Scanners", slug: "printers-scanners" }, { name: "Networking", slug: "computer-networking" }, { name: "Storage Devices", slug: "storage-devices" }
  ]},
  { name: "Phones & Tablets", slug: "phones-tablets", icon: "Smartphone", children: [
    { name: "Mobile Phones", slug: "mobile-phones" }, { name: "Tablets", slug: "tablets" }, { name: "Phone Cases & Covers", slug: "phone-cases-covers" }, { name: "Phone Pouches & Sleeves", slug: "phone-pouches-sleeves" },
    { name: "Chargers & Power Adapters", slug: "phone-chargers-power-adapters" }, { name: "Charging Cables", slug: "charging-cables" },
    { name: "Wireless Chargers", slug: "wireless-chargers" }, { name: "Power Banks", slug: "phone-power-banks" },
    { name: "Screen Protectors", slug: "screen-protectors" }, { name: "Phone Mounts & Stands", slug: "phone-mounts-stands" },
    { name: "Selfie Sticks & Tripods", slug: "selfie-sticks-tripods" }, { name: "Phone Grips & Rings", slug: "phone-grips-rings" },
    { name: "Stylus Pens", slug: "stylus-pens" }, { name: "Earphones & Earbuds", slug: "earphones-earbuds" },
    { name: "Bluetooth Headsets", slug: "bluetooth-headsets" }, { name: "Memory Cards & SIM Accessories", slug: "memory-cards-sim-accessories" },
    { name: "Phone Parts & Repairs", slug: "phone-parts-repairs" }, { name: "Smartwatches", slug: "smartwatches" }
  ]},
  { name: "Fashion", slug: "fashion", icon: "Shirt", children: [
    { name: "Men's Clothing", slug: "mens-clothing" }, { name: "Women's Clothing", slug: "womens-clothing" }, { name: "Unisex Clothing", slug: "unisex-clothing" },
    { name: "T-Shirts & Tops", slug: "t-shirts-tops" }, { name: "Shirts & Blouses", slug: "shirts-blouses" }, { name: "Dresses & Jumpsuits", slug: "dresses-jumpsuits" },
    { name: "Trousers, Jeans & Shorts", slug: "trousers-jeans-shorts" }, { name: "Skirts", slug: "skirts" }, { name: "Coats & Jackets", slug: "coats-jackets" }, { name: "Suits & Formalwear", slug: "suits-formalwear" },
    { name: "Shoes & Footwear", slug: "shoes-footwear" }, { name: "Bags & Handbags", slug: "bags-handbags" }, { name: "Jewellery", slug: "jewellery" }, { name: "Fine Jewellery", slug: "fine-jewellery" }, { name: "Fashion Jewellery", slug: "fashion-jewellery" },
    { name: "Rings", slug: "rings" }, { name: "Necklaces & Pendants", slug: "necklaces-pendants" }, { name: "Bracelets & Bangles", slug: "bracelets-bangles" },
    { name: "Earrings", slug: "earrings" }, { name: "Jewellery Sets", slug: "jewellery-sets" }, { name: "Watches", slug: "watches" },
    { name: "Sunglasses & Eyewear", slug: "sunglasses-eyewear" }, { name: "Belts", slug: "belts" }, { name: "Hats & Caps", slug: "hats-caps" },
    { name: "Scarves & Accessories", slug: "scarves-accessories" }, { name: "Underwear & Lingerie", slug: "underwear-lingerie" },
    { name: "Sportswear", slug: "sportswear" }, { name: "Traditional & Cultural Wear", slug: "traditional-cultural-wear" }
  ]},
  { name: "Beauty & Personal Care", slug: "beauty-personal-care", icon: "Sparkles", children: [
    { name: "Skincare", slug: "skincare" }, { name: "Makeup", slug: "makeup" }, { name: "Hair Care", slug: "hair-care" },
    { name: "Fragrances", slug: "fragrances" }, { name: "Bath & Body", slug: "bath-body" }, { name: "Grooming & Shaving", slug: "grooming-shaving" },
    { name: "Nail Care", slug: "nail-care" }, { name: "Beauty Tools", slug: "beauty-tools" }
  ]},
  { name: "Home & Living", slug: "home-living", icon: "House", children: [
    { name: "Furniture", slug: "furniture" }, { name: "Bedding & Linens", slug: "bedding-linens" }, { name: "Kitchen & Dining", slug: "kitchen-dining" },
    { name: "Home Decor", slug: "home-decor" }, { name: "Lighting", slug: "lighting" }, { name: "Storage & Organisation", slug: "storage-organisation" },
    { name: "Bathroom Accessories", slug: "bathroom-accessories" }, { name: "Cleaning Supplies", slug: "cleaning-supplies" }, { name: "Smart Home", slug: "smart-home" }
  ]},
  { name: "Health & Wellness", slug: "health-wellness", icon: "HeartPulse", children: [
    { name: "Fitness & Exercise Equipment", slug: "fitness-exercise-equipment" }, { name: "Personal Health Devices", slug: "personal-health-devices" },
    { name: "Mobility & Support", slug: "mobility-support" }, { name: "Wellness Accessories", slug: "wellness-accessories" }
  ]},
  { name: "Sports & Outdoors", slug: "sports-outdoors", icon: "Dumbbell", children: [
    { name: "Football & Soccer", slug: "football-soccer" }, { name: "Gym & Fitness", slug: "gym-fitness" }, { name: "Cycling", slug: "cycling" },
    { name: "Camping & Hiking", slug: "camping-hiking" }, { name: "Swimming", slug: "swimming" }, { name: "Rackets & Court Sports", slug: "rackets-court-sports" },
    { name: "Outdoor Recreation", slug: "outdoor-recreation" }
  ]},
  { name: "Automotive & Motorcycles", slug: "automotive-motorcycles", icon: "Car", children: [
    { name: "Cars", slug: "cars" }, { name: "Motorcycles & Scooters", slug: "motorcycles-scooters" }, { name: "Car Parts", slug: "car-parts" },
    { name: "Motorcycle Parts", slug: "motorcycle-parts" }, { name: "Tyres & Wheels", slug: "tyres-wheels" }, { name: "Car Electronics", slug: "car-electronics" },
    { name: "Vehicle Accessories", slug: "vehicle-accessories" }, { name: "Tools & Maintenance", slug: "vehicle-tools-maintenance" }
  ]},
  { name: "Baby & Kids", slug: "baby-kids", icon: "Baby", children: [
    { name: "Baby Clothing", slug: "baby-clothing" }, { name: "Baby Care", slug: "baby-care" }, { name: "Prams & Car Seats", slug: "prams-car-seats" },
    { name: "Feeding & Nursing", slug: "feeding-nursing" }, { name: "Kids' Shoes", slug: "kids-shoes" }, { name: "School Essentials", slug: "school-essentials" }
  ]},
  { name: "Toys & Games", slug: "toys-games", icon: "Puzzle", children: [
    { name: "Board Games", slug: "board-games" }, { name: "Puzzles", slug: "puzzles" }, { name: "Dolls & Figures", slug: "dolls-figures" },
    { name: "Building Toys", slug: "building-toys" }, { name: "Outdoor Toys", slug: "outdoor-toys" }, { name: "Video Games", slug: "video-games" }
  ]},
  { name: "Books & Stationery", slug: "books-stationery", icon: "BookOpen", children: [
    { name: "Books", slug: "books" }, { name: "Educational Materials", slug: "educational-materials" }, { name: "Office Stationery", slug: "office-stationery" },
    { name: "Art & Craft Supplies", slug: "art-craft-supplies" }, { name: "Musical Instruments", slug: "musical-instruments" }
  ]},
  { name: "Food & Groceries", slug: "food-groceries", icon: "ShoppingBasket", children: [
    { name: "Packaged Food", slug: "packaged-food" }, { name: "Beverages", slug: "beverages" }, { name: "Pantry Essentials", slug: "pantry-essentials" },
    { name: "Snacks & Confectionery", slug: "snacks-confectionery" }, { name: "Food Gifts", slug: "food-gifts" }
  ]},
  { name: "Office & Business", slug: "office-business", icon: "BriefcaseBusiness", children: [
    { name: "Office Furniture", slug: "office-furniture" }, { name: "Business Equipment", slug: "business-equipment" }, { name: "POS & Payment Devices", slug: "pos-payment-devices" },
    { name: "Packaging & Shipping", slug: "packaging-shipping" }, { name: "Security & Surveillance", slug: "security-surveillance" }
  ]},
  { name: "Tools & Home Improvement", slug: "tools-home-improvement", icon: "Wrench", children: [
    { name: "Hand Tools", slug: "hand-tools" }, { name: "Power Tools", slug: "power-tools" }, { name: "Electrical Supplies", slug: "electrical-supplies" },
    { name: "Plumbing Supplies", slug: "plumbing-supplies" }, { name: "Building Materials", slug: "building-materials" }, { name: "Safety Equipment", slug: "safety-equipment" }
  ]},
  { name: "Garden & Outdoor", slug: "garden-outdoor", icon: "Trees", children: [
    { name: "Garden Tools", slug: "garden-tools" }, { name: "Plants & Seeds", slug: "plants-seeds" }, { name: "Outdoor Furniture", slug: "outdoor-furniture" },
    { name: "Irrigation & Watering", slug: "irrigation-watering" }
  ]},
  { name: "Travel & Luggage", slug: "travel-luggage", icon: "Luggage", children: [
    { name: "Suitcases", slug: "suitcases" }, { name: "Backpacks", slug: "backpacks" }, { name: "Travel Accessories", slug: "travel-accessories" }
  ]},
  { name: "Pet Supplies", slug: "pet-supplies", icon: "PawPrint", children: [
    { name: "Pet Food", slug: "pet-food" }, { name: "Pet Toys", slug: "pet-toys" }, { name: "Beds & Carriers", slug: "pet-beds-carriers" },
    { name: "Grooming & Care", slug: "pet-grooming-care" }
  ]},
  { name: "Home Appliances", slug: "home-appliances", icon: "Refrigerator", children: [
    { name: "Refrigerators & Freezers", slug: "refrigerators-freezers" }, { name: "Washing Machines", slug: "washing-machines" },
    { name: "Air Conditioners", slug: "air-conditioners" }, { name: "Fans", slug: "fans" }, { name: "Irons & Steamers", slug: "irons-steamers" },
    { name: "Vacuum Cleaners", slug: "vacuum-cleaners" }, { name: "Microwaves & Ovens", slug: "microwaves-ovens" },
    { name: "Blenders & Mixers", slug: "blenders-mixers" }, { name: "Cookers & Hobs", slug: "cookers-hobs" }, { name: "Water Dispensers", slug: "water-dispensers" }
  ]},
  { name: "Gaming & Consoles", slug: "gaming-consoles", icon: "Gamepad2", children: [
    { name: "Gaming Consoles", slug: "gaming-consoles-hardware" }, { name: "Console Games", slug: "console-games" },
    { name: "Controllers & Accessories", slug: "controllers-accessories" }, { name: "Gaming Headsets", slug: "gaming-headsets" },
    { name: "VR Headsets", slug: "vr-headsets" }, { name: "Gaming Chairs & Desks", slug: "gaming-chairs-desks" }
  ]},
  { name: "Arts, Crafts & Collectibles", slug: "arts-crafts-collectibles", icon: "Palette", children: [
    { name: "Art Supplies", slug: "art-supplies" }, { name: "Craft Supplies", slug: "craft-supplies" },
    { name: "Handmade Goods", slug: "handmade-goods" }, { name: "Collectibles & Memorabilia", slug: "collectibles-memorabilia" },
    { name: "Antiques & Vintage", slug: "antiques-vintage" }
  ]},
  { name: "Musical Instruments & DJ", slug: "musical-instruments-dj", icon: "Music", children: [
    { name: "Guitars & Basses", slug: "guitars-basses" }, { name: "Keyboards & Pianos", slug: "keyboards-pianos" },
    { name: "Drums & Percussion", slug: "drums-percussion" }, { name: "DJ Equipment", slug: "dj-equipment" },
    { name: "Recording Equipment", slug: "recording-equipment" }, { name: "Microphones", slug: "microphones" }
  ]}
];

async function findOrCreateCategory(name: string, slug: string, parentId?: string, icon?: string) {
  const existing = await prisma.category.findFirst({ where: { OR: [{ slug }, { name: { equals: name, mode: "insensitive" } }] } });
  if (existing) return existing;
  return prisma.category.create({ data: { name, slug, ...(parentId ? { parentId } : {}), ...(icon ? { icon } : {}) } });
}

async function ensureSmartHomeCategory() {
  const home = await findOrCreateCategory("Home & Living", "home-living", undefined, "House");
  await findOrCreateCategory("Smart Home", "smart-home", home.id);
}

async function ensureDefaultCategories() {
  if (!defaultCategoriesReady) defaultCategoriesReady = (async () => {
    const roots = await Promise.all(DEFAULT_CATEGORY_TREE.map((item) => findOrCreateCategory(item.name, item.slug, undefined, item.icon)));
    for (let index = 0; index < DEFAULT_CATEGORY_TREE.length; index++) {
      const root = roots[index];
      await Promise.all(DEFAULT_CATEGORY_TREE[index].children.map((child) => findOrCreateCategory(child.name, child.slug, root.id)));
    }
    // Keep the Smart Home category available even when a previous seed only partially completed.
    await ensureSmartHomeCategory();
  })();
  await defaultCategoriesReady;
}

function normalizeConfig(value: unknown): CategoryVariationConfig {
  if (!value || typeof value !== "object") return EMPTY_CONFIG;
  const raw = value as Record<string, unknown>;
  const variations = Array.isArray(raw.variations) ? raw.variations : [];
  return {
    enabled: raw.enabled === true && variations.length > 0,
    variations: variations.map((item): CategoryVariation | null => {
      const v = item as Record<string, unknown>;
      const options = Array.isArray(v.options) ? v.options : [];
      const type: CategoryVariationType = v.type === "CLOTHING" || v.type === "OTHER" ? v.type : "PRODUCT";
      return {
        id: String(v.id || crypto.randomUUID()), key: String(v.key || slugify(String(v.name || "option"))), name: String(v.name || "Option"),
        type,
        options: options.map((option): CategoryVariationOption => { const o = option as Record<string, unknown>; const valueText = String(o.value ?? o.label ?? "").trim(); return { id: String(o.id || crypto.randomUUID()), label: String(o.label || valueText), value: valueText }; }).filter((o) => o.value),
      };
    }).filter((v): v is CategoryVariation => v !== null && v.name.trim() !== "" && v.options.length > 0),
  };
}

async function configsFor(ids: string[]) {
  await ensureVariationColumn();
  if (!ids.length) return new Map<string, CategoryVariationConfig>();
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; variationConfig: unknown }>>(`SELECT "id", "variationConfig" FROM "categories" WHERE "id" = ANY($1::text[])`, ids);
  return new Map(rows.map((row) => [row.id, normalizeConfig(row.variationConfig)]));
}
function withConfig<T extends { id: string }>(category: T, configs: Map<string, CategoryVariationConfig>) { return { ...category, variationConfig: configs.get(category.id) ?? EMPTY_CONFIG }; }

export async function listCategories() {
  await ensureDefaultCategories();
  const categories = await prisma.category.findMany({ where: { parentId: null }, include: { children: true }, orderBy: { name: "asc" } });
  const configs = await configsFor(categories.flatMap((category) => [category.id, ...category.children.map((child) => child.id)]));
  return categories.map((category) => ({ ...withConfig(category, configs), children: category.children.map((child) => withConfig(child, configs)) }));
}
export async function getCategoryBySlug(slug: string) {
  await ensureDefaultCategories();
  const category = await prisma.category.findUnique({ where: { slug }, include: { children: true } });
  if (!category) throw AppError.notFound("Category not found");
  const configs = await configsFor([category.id, ...category.children.map((child) => child.id)]);
  return { ...withConfig(category, configs), children: category.children.map((child) => withConfig(child, configs)) };
}
export async function createCategory(input: { name: string; icon?: string | null; parentSlug?: string; variationConfig?: CategoryVariationConfig }, adminId: string) {
  await ensureVariationColumn(); let parentId: string | undefined;
  if (input.parentSlug) { const parent = await prisma.category.findUnique({ where: { slug: input.parentSlug } }); if (!parent) throw AppError.badRequest("Parent category not found"); parentId = parent.id; }
  const baseSlug = slugify(input.name); let slug = baseSlug; let suffix = 1; while (await prisma.category.findUnique({ where: { slug } })) slug = `${baseSlug}-${++suffix}`;
  const variationConfig = normalizeConfig(input.variationConfig);
  const category = await prisma.category.create({ data: { name: input.name, slug, icon: input.icon ?? null, parentId } });
  await prisma.$executeRawUnsafe('UPDATE "categories" SET "variationConfig" = $1::jsonb WHERE "id" = $2', JSON.stringify(variationConfig), category.id);
  await recordAudit({ actorId: adminId, action: "CATEGORY_CREATED", targetType: "Category", targetId: category.id, metadata: { variationConfig } });
  return { ...category, variationConfig };
}
export async function updateCategory(id: string, input: { name?: string; icon?: string | null; variationConfig?: CategoryVariationConfig }, adminId: string) {
  await ensureVariationColumn();
  const category = await prisma.category.update({ where: { id }, data: { ...(input.name !== undefined ? { name: input.name } : {}), ...(input.icon !== undefined ? { icon: input.icon } : {}) } });
  if (input.variationConfig !== undefined) await prisma.$executeRawUnsafe('UPDATE "categories" SET "variationConfig" = $1::jsonb WHERE "id" = $2', JSON.stringify(normalizeConfig(input.variationConfig)), id);
  const configs = await configsFor([id]); const result = withConfig(category, configs);
  await recordAudit({ actorId: adminId, action: "CATEGORY_UPDATED", targetType: "Category", targetId: category.id, metadata: { ...input, variationConfig: result.variationConfig } });
  return result;
}
export async function deleteCategory(id: string, adminId: string) {
  const category = await prisma.category.findUnique({ where: { id }, include: { _count: { select: { products: true, children: true } } } });
  if (!category) throw AppError.notFound("Category not found");
  if (category._count.products > 0) throw AppError.badRequest("This category has products. Move or remove those products before deleting it.");
  if (category._count.children > 0) throw AppError.badRequest("This category has subcategories. Delete or move its subcategories first.");
  await prisma.category.delete({ where: { id } });
  await recordAudit({ actorId: adminId, action: "CATEGORY_UPDATED", targetType: "Category", targetId: id, metadata: { deleted: true } });
}
