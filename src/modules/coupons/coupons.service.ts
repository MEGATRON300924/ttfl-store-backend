import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/app-error";
import { recordAudit } from "@/lib/audit";
import type { CouponType } from "@prisma/client";

export type CartLineForCoupon={vendorId:string;categoryId:string;productId?:string;lineTotal:number};
let productCouponTableReady=false;
async function ensureProductCouponTable(){if(productCouponTableReady)return;await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS coupon_products (coupon_id TEXT NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,PRIMARY KEY(coupon_id,product_id))`);await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS coupon_products_product_idx ON coupon_products(product_id)`);productCouponTableReady=true;}
async function productIdsForCoupon(couponId:string){await ensureProductCouponTable();const rows=await prisma.$queryRawUnsafe<Array<{productId:string}>>(`SELECT product_id AS "productId" FROM coupon_products WHERE coupon_id=$1`,couponId);return rows.map(r=>r.productId);}

export async function validateCoupon(code:string,customerId:string,cartLines:CartLineForCoupon[]):Promise<{coupon:{id:string;code:string};discountAmount:number;eligibleBase:number}>{
  await ensureProductCouponTable();const coupon=await prisma.coupon.findUnique({where:{code:code.toUpperCase()}});
  if(!coupon||!coupon.active)throw AppError.badRequest("This coupon code isn't valid","INVALID_COUPON");
  const now=new Date();if(coupon.startsAt&&coupon.startsAt>now)throw AppError.badRequest("This coupon isn't active yet","COUPON_NOT_STARTED");if(coupon.expiresAt&&coupon.expiresAt<now)throw AppError.badRequest("This coupon has expired","COUPON_EXPIRED");
  const targetedProducts=await productIdsForCoupon(coupon.id);const eligibleLines=cartLines.filter(line=>{if(coupon.vendorId&&line.vendorId!==coupon.vendorId)return false;if(coupon.categoryId&&line.categoryId!==coupon.categoryId)return false;if(targetedProducts.length&&(!line.productId||!targetedProducts.includes(line.productId)))return false;return true;});
  const eligibleBase=eligibleLines.reduce((sum,l)=>sum+l.lineTotal,0);if(eligibleBase<=0)throw AppError.badRequest("This coupon doesn't apply to anything in your cart","COUPON_NOT_APPLICABLE");
  if(coupon.minOrderAmount&&eligibleBase<Number(coupon.minOrderAmount))throw AppError.badRequest(`This coupon needs a minimum order of ₦${Number(coupon.minOrderAmount).toLocaleString()}`,"COUPON_MIN_NOT_MET");
  if(coupon.firstOrderOnly){const prior=await prisma.order.findFirst({where:{customerId,paymentStatus:"PAID"}});if(prior)throw AppError.badRequest("This coupon is only valid on your first order","COUPON_FIRST_ORDER_ONLY");}
  if(coupon.usageLimit!=null&&await prisma.couponRedemption.count({where:{couponId:coupon.id}})>=coupon.usageLimit)throw AppError.badRequest("This coupon has reached its usage limit","COUPON_LIMIT_REACHED");
  if(await prisma.couponRedemption.count({where:{couponId:coupon.id,userId:customerId}})>=coupon.usageLimitPerUser)throw AppError.badRequest("You've already used this coupon","COUPON_ALREADY_USED");
  const discountAmount=computeDiscount(coupon.type,Number(coupon.value),eligibleBase,coupon.maxDiscountAmount?Number(coupon.maxDiscountAmount):null);
  return{coupon:{id:coupon.id,code:coupon.code},discountAmount,eligibleBase};
}
function computeDiscount(type:CouponType,value:number,base:number,maxDiscount:number|null){let discount=type==="PERCENTAGE"?base*(value/100):value;discount=Math.min(discount,base);if(maxDiscount!=null)discount=Math.min(discount,maxDiscount);return Math.round(discount*100)/100;}
export async function recordRedemption(couponId:string,userId:string,orderId:string,discountAmount:number){await prisma.couponRedemption.create({data:{couponId,userId,orderId,discountAmount}});}

async function setCouponProducts(couponId:string,vendorId:string|undefined,productIds:string[]|undefined){await ensureProductCouponTable();const ids=[...new Set(productIds??[])];if(!ids.length)return;const products=await prisma.product.findMany({where:{id:{in:ids},...(vendorId?{vendorId}:{}),deletedAt:null},select:{id:true,vendorId:true}});if(products.length!==ids.length)throw AppError.badRequest("One or more selected products are invalid for this coupon","INVALID_COUPON_PRODUCTS");for(const product of products)await prisma.$executeRawUnsafe(`INSERT INTO coupon_products(coupon_id,product_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,couponId,product.id);}
export async function getCouponProductIds(couponId:string){return productIdsForCoupon(couponId);}

export async function adminCreateCoupon(input:any,adminId:string){const existing=await prisma.coupon.findUnique({where:{code:input.code.toUpperCase()}});if(existing)throw AppError.conflict("A coupon with this code already exists","COUPON_CODE_TAKEN");const{productIds,...data}=input;const coupon=await prisma.coupon.create({data:{...data,code:input.code.toUpperCase()}});await setCouponProducts(coupon.id,input.vendorId,productIds);await recordAudit({actorId:adminId,action:"COUPON_CREATED",targetType:"Coupon",targetId:coupon.id});return coupon;}
export async function adminUpdateCoupon(id:string,input:Partial<{active:boolean;expiresAt:Date;usageLimit:number}>,adminId:string){const coupon=await prisma.coupon.update({where:{id},data:input});await recordAudit({actorId:adminId,action:"COUPON_UPDATED",targetType:"Coupon",targetId:coupon.id,metadata:input});return coupon;}
export async function adminListCoupons(){await ensureProductCouponTable();const coupons=await prisma.coupon.findMany({include:{vendor:{select:{storeName:true}},_count:{select:{redemptions:true}}},orderBy:{createdAt:"desc"}});return Promise.all(coupons.map(async c=>({...c,productIds:await productIdsForCoupon(c.id)})));}
export async function vendorCreateCoupon(vendorId:string,input:any){const existing=await prisma.coupon.findUnique({where:{code:input.code.toUpperCase()}});if(existing)throw AppError.conflict("A coupon with this code already exists","COUPON_CODE_TAKEN");const{productIds,...data}=input;const coupon=await prisma.coupon.create({data:{...data,code:input.code.toUpperCase(),vendorId}});await setCouponProducts(coupon.id,vendorId,productIds);return coupon;}
export async function vendorListCoupons(vendorId:string){await ensureProductCouponTable();const coupons=await prisma.coupon.findMany({where:{vendorId},include:{_count:{select:{redemptions:true}}},orderBy:{createdAt:"desc"}});return Promise.all(coupons.map(async c=>({...c,productIds:await productIdsForCoupon(c.id)})));}
