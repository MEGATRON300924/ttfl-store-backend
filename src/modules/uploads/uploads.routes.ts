import { Router } from "express";
import multer from "multer";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import { AppError } from "@/utils/app-error";
import { prisma } from "@/lib/prisma";
import { validateUploadFile, uploadProductImage, deleteProductImage } from "./uploads.service";

export const uploadsRouter = Router();

// Memory storage — files never touch disk, buffer goes straight to
// Cloudinary. Multer's own limits are a first line of defense; the
// service-level validateUploadFile check is the authoritative one (spec
// §8 "file size limits, file type validation").
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

uploadsRouter.post(
  "/product-image",
  requireAuth,
  requireRole("VENDOR"),
  upload.single("image"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw AppError.badRequest("No image file provided", "NO_FILE");

    validateUploadFile({ mimetype: req.file.mimetype, size: req.file.size });

    const vendor = await prisma.vendorProfile.findUniqueOrThrow({ where: { userId: req.user!.sub } });
    const result = await uploadProductImage(vendor.id, req.file.buffer, req.file.mimetype);

    res.status(201).json(result);
  })
);

uploadsRouter.delete(
  "/product-image/:publicId",
  requireAuth,
  requireRole("VENDOR"),
  asyncHandler(async (req, res) => {
    // publicId contains slashes (folder path), so it's passed as a query
    // param rather than a route param to avoid URL-encoding headaches.
    const publicId = decodeURIComponent(req.params.publicId);
    await deleteProductImage(publicId);
    res.status(204).send();
  })
);
