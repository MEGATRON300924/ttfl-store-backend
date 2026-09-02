import { Router } from "express";
import multer from "multer";

import {
  asyncHandler,
} from "@/middleware/error-handler";

import {
  requireAuth,
  requireRole,
} from "@/middleware/auth";

import {
  AppError,
} from "@/utils/app-error";

import {
  prisma,
} from "@/lib/prisma";

import {
  validateUploadFile,
  uploadProductImage,
  deleteProductImage,
  uploadAvatar,
  uploadStoreBranding,
  deleteStoreBranding,
} from "./uploads.service";

export const uploadsRouter = Router();

// ---------------------------------------------------------------------------
// Multer
// ---------------------------------------------------------------------------

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

// ---------------------------------------------------------------------------
// Product image
// ---------------------------------------------------------------------------

uploadsRouter.post(
  "/product-image",
  requireAuth,
  requireRole("VENDOR"),
  upload.single("image"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw AppError.badRequest(
        "No image file provided",
        "NO_FILE"
      );
    }

    validateUploadFile({
      mimetype: req.file.mimetype,
      size: req.file.size,
    });

    const vendor =
      await prisma.vendorProfile.findUniqueOrThrow({
        where: {
          userId: req.user!.sub,
        },
      });

    const result = await uploadProductImage(
      vendor.id,
      req.file.buffer,
      req.file.mimetype
    );

    res.status(201).json(result);
  })
);

// ---------------------------------------------------------------------------
// Delete product image
// ---------------------------------------------------------------------------

uploadsRouter.delete(
  "/product-image/:publicId",
  requireAuth,
  requireRole("VENDOR"),
  asyncHandler(async (req, res) => {
    const publicId = decodeURIComponent(
      req.params.publicId
    );

    await deleteProductImage(publicId);

    res.status(204).send();
  })
);

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------

uploadsRouter.post(
  "/avatar",
  requireAuth,
  upload.single("image"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw AppError.badRequest(
        "No image file provided",
        "NO_FILE"
      );
    }

    validateUploadFile({
      mimetype: req.file.mimetype,
      size: req.file.size,
    });

    const result = await uploadAvatar(
      req.user!.sub,
      req.file.buffer,
      req.file.mimetype
    );

    res.status(201).json(result);
  })
);

// ---------------------------------------------------------------------------
// Vendor store branding
// ---------------------------------------------------------------------------

uploadsRouter.post(
  "/store-branding",
  requireAuth,
  requireRole("VENDOR"),
  upload.single("image"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw AppError.badRequest(
        "No image file provided",
        "NO_FILE"
      );
    }

    validateUploadFile({
      mimetype: req.file.mimetype,
      size: req.file.size,
    });

    const type = req.body.type;

    if (type !== "logo" && type !== "banner") {
      throw AppError.badRequest(
        'Branding type must be either "logo" or "banner"',
        "INVALID_BRANDING_TYPE"
      );
    }

    const vendor =
      await prisma.vendorProfile.findUniqueOrThrow({
        where: {
          userId: req.user!.sub,
        },
      });

    const result = await uploadStoreBranding(
      vendor.id,
      type,
      req.file.buffer,
      req.file.mimetype
    );

    const updateData =
      type === "logo"
        ? {
            logoUrl: result.url,
            logoPublicId: result.publicId,
          }
        : {
            bannerUrl: result.url,
            bannerPublicId: result.publicId,
          };

    const updatedProfile =
      await prisma.vendorProfile.update({
        where: {
          id: vendor.id,
        },
        data: updateData,
      });

    res.status(201).json({
      ...result,
      vendorProfile: updatedProfile,
    });
  })
);

// ---------------------------------------------------------------------------
// Delete vendor store branding
// ---------------------------------------------------------------------------

uploadsRouter.delete(
  "/store-branding",
  requireAuth,
  requireRole("VENDOR"),
  asyncHandler(async (req, res) => {
    const type = req.query.type;

    if (type !== "logo" && type !== "banner") {
      throw AppError.badRequest(
        'Type must be either "logo" or "banner"',
        "INVALID_BRANDING_TYPE"
      );
    }

    const vendor =
      await prisma.vendorProfile.findUniqueOrThrow({
        where: {
          userId: req.user!.sub,
        },
      });

    const publicId =
      type === "logo"
        ? vendor.logoPublicId
        : vendor.bannerPublicId;

    if (publicId) {
      await deleteStoreBranding(publicId);
    }

    const updateData =
      type === "logo"
        ? {
            logoUrl: null,
            logoPublicId: null,
          }
        : {
            bannerUrl: null,
            bannerPublicId: null,
          };

    await prisma.vendorProfile.update({
      where: {
        id: vendor.id,
      },
      data: updateData,
    });

    res.status(204).send();
  })
);