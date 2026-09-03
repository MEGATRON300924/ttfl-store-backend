import { v2 as cloudinary } from "cloudinary";

import { AppError } from "@/utils/app-error";
import { logger } from "@/lib/logger";

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
]);

let configured = false;

function ensureConfigured() {
  if (configured) return;

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    throw AppError.internal(
      "Image uploads aren't configured yet — missing Cloudinary credentials",
      "UPLOADS_NOT_CONFIGURED"
    );
  }

  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
  });

  configured = true;
}

export function validateUploadFile(file: {
  mimetype: string;
  size: number;
}) {
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    throw AppError.badRequest(
      "Only JPEG, PNG, WebP, or AVIF images are allowed",
      "INVALID_FILE_TYPE"
    );
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw AppError.badRequest(
      "Images must be under 5MB",
      "FILE_TOO_LARGE"
    );
  }
}

export async function uploadProductImage(
  vendorId: string,
  buffer: Buffer,
  mimetype: string
): Promise<{ url: string; publicId: string }> {
  ensureConfigured();

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `ttfl-store/vendors/${vendorId}/products`,
        resource_type: "image",
        transformation: [{ quality: "auto", fetch_format: "auto" }],
      },
      (error, result) => {
        if (error || !result) {
          logger.error("Cloudinary upload failed", { error });
          return reject(AppError.internal("Image upload failed, please try again", "UPLOAD_FAILED"));
        }
        resolve({ url: result.secure_url, publicId: result.public_id });
      }
    );
    stream.end(buffer);
  });
}

export async function deleteProductImage(publicId: string) {
  ensureConfigured();
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (err) {
    logger.warn("Cloudinary delete failed (non-fatal)", { publicId, err });
  }
}

export async function uploadAvatar(
  userId: string,
  buffer: Buffer,
  mimetype: string
): Promise<{ url: string; publicId: string }> {
  ensureConfigured();

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `ttfl-store/users/${userId}/avatar`,
        resource_type: "image",
        transformation: [{ width: 256, height: 256, crop: "fill", gravity: "face", quality: "auto", fetch_format: "auto" }],
      },
      (error, result) => {
        if (error || !result) {
          logger.error("Cloudinary avatar upload failed", { error });
          return reject(AppError.internal("Avatar upload failed, please try again", "UPLOAD_FAILED"));
        }
        resolve({ url: result.secure_url, publicId: result.public_id });
      }
    );
    stream.end(buffer);
  });
}

export async function uploadStoreBranding(
  vendorId: string,
  type: "logo" | "banner",
  buffer: Buffer,
  mimetype: string
): Promise<{ url: string; publicId: string; type: "logo" | "banner" }> {
  ensureConfigured();
  const folder = `ttfl-store/vendors/${vendorId}/store`;
  const transformation = type === "logo"
    ? [{ width: 512, height: 512, crop: "limit", quality: "auto", fetch_format: "auto" }]
    : [{ width: 1600, height: 600, crop: "limit", quality: "auto", fetch_format: "auto" }];

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, public_id: type, overwrite: true, invalidate: true, resource_type: "image", transformation },
      (error, result) => {
        if (error || !result) {
          logger.error("Cloudinary store branding upload failed", { error, vendorId, type });
          return reject(AppError.internal("Store image upload failed, please try again", "STORE_UPLOAD_FAILED"));
        }
        resolve({ url: result.secure_url, publicId: result.public_id, type });
      }
    );
    stream.end(buffer);
  });
}

export async function uploadStoreGalleryImage(
  userId: string,
  buffer: Buffer,
  mimetype: string
): Promise<{ url: string; publicId: string }> {
  ensureConfigured();
  const vendor = await import("@/lib/prisma").then(({ prisma }) => prisma.vendorProfile.findUnique({ where: { userId }, select: { id: true } }));
  if (!vendor) throw AppError.notFound("Vendor profile not found");

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `ttfl-store/vendors/${vendor.id}/store/gallery`,
        resource_type: "image",
        transformation: [{ width: 1600, height: 1200, crop: "limit", quality: "auto", fetch_format: "auto" }],
      },
      (error, result) => {
        if (error || !result) {
          logger.error("Cloudinary store gallery upload failed", { error, vendorId: vendor.id });
          return reject(AppError.internal("Gallery image upload failed, please try again", "GALLERY_UPLOAD_FAILED"));
        }
        resolve({ url: result.secure_url, publicId: result.public_id });
      }
    );
    stream.end(buffer);
  });
}

export async function deleteStoreBranding(publicId: string) {
  ensureConfigured();
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (err) {
    logger.warn("Cloudinary store branding delete failed (non-fatal)", { publicId, err });
  }
}
