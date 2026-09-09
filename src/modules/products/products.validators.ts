import { z } from "zod";

const optionalString = (schema: z.ZodString) => z.preprocess((value) => (value === "" || value === undefined ? undefined : value), schema.optional());
const optionalNumber = (schema: z.ZodNumber) => z.preprocess((value) => (value === "" || value === undefined || value === null ? undefined : value), schema.optional());

const baseProductFields = {
  name: z.string().min(3).max(160),
  description: z.string().min(10).max(5000),
  categorySlug: z.string().min(1, "Category is required"),
  price: z.number().nonnegative().max(999_999_999).default(0),
  previousPrice: optionalNumber(z.number().positive().max(999_999_999)),
  condition: z.enum(["NEW", "USED"]).default("NEW"),
  stock: z.number().int().min(0).default(1),
  location: optionalString(z.string().max(120)),
  images: z.array(z.string().url()).min(1, "At least one product image is required").max(10),
  specifications: z.record(z.string()).optional(),
  estimatedDeliveryDays: z.number().int().min(1).max(90).default(7),
  comingSoon: z.boolean().default(false),
  availableAt: z.preprocess((value) => (value === "" || value === undefined || value === null ? undefined : value), z.string().datetime().optional()),
};

const sellingMethodFields = z.discriminatedUnion("sellingMethod", [
  z.object({ sellingMethod: z.literal("CHECKOUT") }),
  z.object({ sellingMethod: z.literal("EXTERNAL_LINK"), externalUrl: z.string().url("A valid external purchase URL is required") }),
  z.object({ sellingMethod: z.literal("WHATSAPP"), whatsappNumber: optionalString(z.string().min(7).max(20)) }),
]);

export const createProductSchema = z.object(baseProductFields).and(sellingMethodFields).superRefine((data, ctx) => {
  if (!data.comingSoon && data.price <= 0) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A valid product price is required", path: ["price"] });
  if (data.previousPrice !== undefined && data.previousPrice <= data.price) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Previous price must be greater than the current price to represent a discount", path: ["previousPrice"] });
});

export const updateProductSchema = z.object({
  name: baseProductFields.name.optional(),
  description: baseProductFields.description.optional(),
  categorySlug: baseProductFields.categorySlug.optional(),
  price: baseProductFields.price,
  previousPrice: optionalNumber(z.number().positive().max(999_999_999)),
  condition: baseProductFields.condition.optional(),
  stock: baseProductFields.stock.optional(),
  location: optionalString(z.string().max(120)),
  images: baseProductFields.images.optional(),
  specifications: baseProductFields.specifications,
  estimatedDeliveryDays: z.number().int().min(1).max(90).optional(),
  comingSoon: z.boolean().optional(),
  availableAt: z.preprocess((value) => (value === "" || value === undefined || value === null ? undefined : value), z.string().datetime().optional()),
  status: z.enum(["DRAFT", "ACTIVE", "OUT_OF_STOCK"]).optional(),
  sellingMethod: z.enum(["CHECKOUT", "EXTERNAL_LINK", "WHATSAPP"]).optional(),
  externalUrl: optionalString(z.string().url("A valid external purchase URL is required")),
  whatsappNumber: optionalString(z.string().min(7).max(20)),
});

export const productSearchSchema = z.object({
  q: z.string().max(120).optional(), category: z.string().optional(), vendor: z.string().optional(),
  minPrice: z.coerce.number().nonnegative().optional(), maxPrice: z.coerce.number().positive().optional(),
  condition: z.enum(["NEW", "USED"]).optional(), sellingMethod: z.enum(["CHECKOUT", "EXTERNAL_LINK", "WHATSAPP"]).optional(),
  location: z.string().optional(), verifiedOnly: z.coerce.boolean().optional(), comingSoon: z.coerce.boolean().optional(),
  sort: z.enum(["relevance", "price_asc", "price_desc", "newest", "rating"]).default("relevance"),
  page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(48).default(24),
});

export const availabilityNotificationSchema = z.object({
  email: optionalString(z.string().email()),
  whatsapp: optionalString(z.string().min(7).max(20)),
  notifyEmail: z.boolean().default(false),
  notifyWhatsApp: z.boolean().default(false),
});

export const referralEventSchema = z.object({ sessionId: z.string().max(120).optional(), source: z.string().max(80).optional(), campaign: z.string().max(80).optional() });
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type ProductSearchInput = z.infer<typeof productSearchSchema>;
