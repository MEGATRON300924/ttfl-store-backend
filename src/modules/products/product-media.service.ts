import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/app-error";
import { getVendorProfileForUser } from "@/lib/vendor-access";

function isCloudinaryVideoUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "res.cloudinary.com" && url.pathname.includes("/video/upload/");
  } catch {
    return false;
  }
}

export async function replaceProductVideos(userId: string, productId: string, videos: string[]) {
  const vendor = await getVendorProfileForUser(userId);
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true, vendorId: true } });
  if (!product || product.vendorId !== vendor.id) throw AppError.forbidden("You can only edit your own products");

  const uniqueVideos = Array.from(new Set(videos.map((video) => video.trim()).filter(Boolean)));
  if (uniqueVideos.length > 3) throw AppError.badRequest("A product can have up to 3 videos", "VIDEO_LIMIT_REACHED");
  if (uniqueVideos.some((video) => !isCloudinaryVideoUrl(video))) throw AppError.badRequest("Product videos must be uploaded through TTFL Store", "INVALID_VIDEO_URL");

  await prisma.productImage.deleteMany({
    where: {
      productId,
      url: { contains: "/video/upload/" },
    },
  });

  if (uniqueVideos.length > 0) {
    const imageCount = await prisma.productImage.count({ where: { productId } });
    await prisma.productImage.createMany({
      data: uniqueVideos.map((url, index) => ({
        productId,
        url,
        position: imageCount + index,
        isPrimary: false,
      })),
    });
  }

  return uniqueVideos;
}
