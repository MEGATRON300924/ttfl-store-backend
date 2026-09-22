import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/app-error";

type RewardLevel = "BRONZE" | "SILVER" | "GOLD" | "PLATINUM";

const DEFAULTS = {
  purchasePointsPer100: 1,
  reviewPoints: 50,
  referralPoints: 200,
  signupPoints: 100,
  profilePoints: 50,
  appDownloadPoints: 500,
  maxOrderRedemptionPercent: 20,
  pointsPerNaira: 1,
  expirationDays: 365,
};

function levelFor(points: number, spend: number, orders: number): RewardLevel {
  if (points >= 25000 && spend >= 1000000 && orders >= 25) return "PLATINUM";
  if (points >= 10000 && spend >= 400000 && orders >= 10) return "GOLD";
  if (points >= 2500 && spend >= 100000 && orders >= 3) return "SILVER";
  return "BRONZE";
}

async function settingNumber(key: string, fallback: number) {
  const rows = await prisma.$queryRawUnsafe<{ value: string }[]>(`SELECT value FROM reward_settings WHERE key=$1 LIMIT 1`, key);
  const value = rows[0]?.value;
  const parsed = value === undefined ? NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function getAppDownloadPoints() { return settingNumber("appDownloadPoints", DEFAULTS.appDownloadPoints); }

export async function ensureWallet(userId: string) {
  await prisma.$executeRawUnsafe(`INSERT INTO reward_wallets(id,user_id,points_balance,lifetime_earned,lifetime_redeemed,lifetime_spend,completed_orders,level,updated_at) VALUES($1,$2,0,0,0,0,0,'BRONZE',NOW()) ON CONFLICT(user_id) DO NOTHING`, randomUUID(), userId);
}

async function ensureWelcomeReward(userId: string) {
  const existing = await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM reward_ledger WHERE user_id=$1 AND type='SIGNUP' LIMIT 1`, userId);
  if (!existing.length) await awardSignup(userId);
}

async function expirePoints(userId: string) {
  await ensureWallet(userId);
  const expired = await prisma.$queryRawUnsafe<Array<{ id: string; points: number }>>(
    `SELECT l.id, l.points FROM reward_ledger l
     WHERE l.user_id=$1 AND l.points>0 AND l.expires_at IS NOT NULL AND l.expires_at<=NOW()
       AND NOT EXISTS (SELECT 1 FROM reward_ledger e WHERE e.user_id=l.user_id AND e.type='EXPIRATION' AND e.reference_type='EXPIRATION' AND e.reference_id=l.id)
     ORDER BY l.expires_at ASC, l.created_at ASC`, userId
  );
  for (const entry of expired) {
    await prisma.$transaction(async(tx)=>{
      const current=await tx.$queryRawUnsafe<Array<{pointsBalance:number}>>(`SELECT points_balance AS "pointsBalance" FROM reward_wallets WHERE user_id=$1 FOR UPDATE`,userId);
      const amount=Math.max(0,Math.min(Number(current[0]?.pointsBalance??0),Math.floor(entry.points)));
      if(amount<=0)return;
      const inserted=await tx.$queryRawUnsafe<{id:string}[]>(
        `INSERT INTO reward_ledger(id,user_id,type,points,description,reference_type,reference_id,idempotency_key,expires_at,created_at)
         VALUES($1,$2,'EXPIRATION',$3,'Expired TTFL Rewards points','EXPIRATION',$4,$5,NULL,NOW())
         ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`,
        randomUUID(),userId,-amount,entry.id,`expiration:${entry.id}`
      );
      if(inserted.length) await tx.$executeRawUnsafe(`UPDATE reward_wallets SET points_balance=GREATEST(0,points_balance-$1),updated_at=NOW() WHERE user_id=$2`,amount,userId);
    });
  }
}

export async function getWallet(userId: string) {
  await ensureWallet(userId); await expirePoints(userId); await ensureWelcomeReward(userId);
  const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT user_id AS "userId", points_balance AS "pointsBalance", lifetime_earned AS "lifetimeEarned", lifetime_redeemed AS "lifetimeRedeemed", lifetime_spend AS "lifetimeSpend", completed_orders AS "completedOrders", level, updated_at AS "updatedAt" FROM reward_wallets WHERE user_id=$1`, userId);
  return rows[0];
}

export async function getHistory(userId: string, limit = 50) { await ensureWallet(userId); await expirePoints(userId); await ensureWelcomeReward(userId); return prisma.$queryRawUnsafe<any[]>(`SELECT id,type,points,description,reference_type AS "referenceType",reference_id AS "referenceId",expires_at AS "expiresAt",created_at AS "createdAt" FROM reward_ledger WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`, userId, Math.min(Math.max(limit, 1), 100)); }

async function award(userId: string, points: number, type: string, description: string, referenceType?: string, referenceId?: string, idempotencyKey?: string) {
  if (points <= 0) return false; await ensureWallet(userId); const days = await settingNumber("expirationDays", DEFAULTS.expirationDays);
  const inserted = await prisma.$queryRawUnsafe<{ id: string }[]>(`INSERT INTO reward_ledger(id,user_id,type,points,description,reference_type,reference_id,idempotency_key,expires_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,NOW()+($9::int * INTERVAL '1 day'),NOW()) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`, randomUUID(), userId, type, Math.floor(points), description, referenceType ?? null, referenceId ?? null, idempotencyKey ?? randomUUID(), days);
  if (!inserted.length) return false; await prisma.$executeRawUnsafe(`UPDATE reward_wallets SET points_balance=points_balance+$1,lifetime_earned=lifetime_earned+$1,updated_at=NOW() WHERE user_id=$2`, Math.floor(points), userId); return true;
}

export async function awardPurchase(userId: string, orderId: string, totalAmount: number) { const base=Math.floor(totalAmount/100*(await settingNumber("purchasePointsPer100",DEFAULTS.purchasePointsPer100))); const wallet=await getWallet(userId); const multipliers:Record<RewardLevel,number>={BRONZE:1,SILVER:1.1,GOLD:1.25,PLATINUM:1.5}; return award(userId,Math.floor(base*multipliers[wallet.level as RewardLevel]),"PURCHASE","Reward for TTFL Store order","ORDER",orderId,`purchase:${orderId}`); }
export async function awardReview(userId:string,reviewId:string){return award(userId,await settingNumber("reviewPoints",DEFAULTS.reviewPoints),"REVIEW","Verified purchase review reward","REVIEW",reviewId,`review:${reviewId}`);}
export async function awardSignup(userId:string){return award(userId,await settingNumber("signupPoints",DEFAULTS.signupPoints),"SIGNUP","Welcome to TTFL Store Rewards","USER",userId,`signup:${userId}`);}
export async function awardProfile(userId:string){return award(userId,await settingNumber("profilePoints",DEFAULTS.profilePoints),"PROFILE","Profile completion reward","USER",userId,`profile:${userId}`);}
export async function awardReferral(userId:string,referralId:string){return award(userId,await settingNumber("referralPoints",DEFAULTS.referralPoints),"REFERRAL","Successful TTFL referral reward","REFERRAL",referralId,`referral:${referralId}:${userId}`);}

export async function redeem(userId:string,points:number,kind:"ORDER_DISCOUNT"|"DELIVERY_DISCOUNT",referenceId?:string){if(!Number.isInteger(points)||points<=0)throw AppError.badRequest("Enter a valid number of reward points","INVALID_REWARD_POINTS");const wallet=await getWallet(userId);if(points>Number(wallet.pointsBalance))throw AppError.badRequest("You do not have enough TTFL Rewards points","INSUFFICIENT_REWARD_POINTS");return{pointsRedeemed:points,nairaValue:points,kind,referenceId:referenceId??null,message:"Points are applied and deducted when you complete a qualifying checkout."};}

export async function reservePointsForOrder(userId:string,orderId:string,points:number){if(!Number.isInteger(points)||points<=0)return;await getWallet(userId);await prisma.$transaction(async(tx)=>{const inserted=await tx.$queryRawUnsafe<{id:string}[]>(`INSERT INTO reward_ledger(id,user_id,type,points,description,reference_type,reference_id,idempotency_key,expires_at,created_at) VALUES($1,$2,'REWARD_RESERVATION',$3,'TTFL Rewards points reserved for checkout','ORDER',$4,$5,NULL,NOW()) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`,randomUUID(),userId,-points,orderId,`reward-reserve:${orderId}`);if(!inserted.length)return;const updated=await tx.$executeRawUnsafe(`UPDATE reward_wallets SET points_balance=points_balance-$1,updated_at=NOW() WHERE user_id=$2 AND points_balance >= $1`,points,userId);if(updated!==1)throw AppError.badRequest("Your reward balance changed. Please try again","REWARD_BALANCE_CHANGED");});}

export async function finalizeReservedPoints(orderId:string){const rows=await prisma.$queryRawUnsafe<Array<{userId:string;points:number}>>(`SELECT user_id AS "userId",(-points)::int AS points FROM reward_ledger WHERE type='REWARD_RESERVATION' AND reference_type='ORDER' AND reference_id=$1 LIMIT 1`,orderId);if(!rows.length)return;const{userId,points}=rows[0];await prisma.$transaction(async(tx)=>{const changed=await tx.$executeRawUnsafe(`UPDATE reward_ledger SET type='REDEEM',description='TTFL Rewards order discount' WHERE user_id=$1 AND type='REWARD_RESERVATION' AND reference_type='ORDER' AND reference_id=$2`,userId,orderId);if(changed)await tx.$executeRawUnsafe(`UPDATE reward_wallets SET lifetime_redeemed=lifetime_redeemed+$1,updated_at=NOW() WHERE user_id=$2`,points,userId);});}

export async function releaseReservedPoints(orderId:string){const rows=await prisma.$queryRawUnsafe<Array<{id:string;userId:string;points:number}>>(`SELECT id,user_id AS "userId",(-points)::int AS points FROM reward_ledger WHERE type='REWARD_RESERVATION' AND reference_type='ORDER' AND reference_id=$1 LIMIT 1`,orderId);if(!rows.length)return;const{userId,points}=rows[0];await prisma.$transaction(async(tx)=>{const changed=await tx.$executeRawUnsafe(`UPDATE reward_ledger SET type='RESERVATION_RELEASED',description='TTFL Rewards reservation released',points=$1 WHERE id=$2 AND type='REWARD_RESERVATION'`,points,rows[0].id);if(changed)await tx.$executeRawUnsafe(`UPDATE reward_wallets SET points_balance=points_balance+$1,updated_at=NOW() WHERE user_id=$2`,points,userId);});}

export async function reverseRedemption(orderId:string){const rows=await prisma.$queryRawUnsafe<Array<{id:string;userId:string;points:number}>>(`SELECT id,user_id AS "userId",(-points)::int AS points FROM reward_ledger WHERE type='REDEEM' AND reference_type='ORDER' AND reference_id=$1 LIMIT 1`,orderId);if(!rows.length)return;const{userId,points}=rows[0];await prisma.$transaction(async(tx)=>{const changed=await tx.$executeRawUnsafe(`UPDATE reward_ledger SET type='REFUND_REVERSAL',points=$1,description='TTFL Rewards points returned after order refund',reference_type='ORDER',reference_id=$2 WHERE id=$3 AND type='REDEEM'`,points,orderId,rows[0].id);if(changed)await tx.$executeRawUnsafe(`UPDATE reward_wallets SET points_balance=points_balance+$1,lifetime_redeemed=GREATEST(0,lifetime_redeemed-$1),updated_at=NOW() WHERE user_id=$2`,points,userId);});}

export async function refreshLevel(userId:string){await ensureWallet(userId);const rows=await prisma.$queryRawUnsafe<any[]>(`SELECT points_balance AS "pointsBalance", lifetime_spend AS "lifetimeSpend", completed_orders AS "completedOrders" FROM reward_wallets WHERE user_id=$1`,userId);const w=rows[0];const level=levelFor(Number(w.pointsBalance),Number(w.lifetimeSpend),Number(w.completedOrders));await prisma.$executeRawUnsafe(`UPDATE reward_wallets SET level=$1,updated_at=NOW() WHERE user_id=$2`,level,userId);return level;}
export async function recordPurchase(userId:string,orderId:string,totalAmount:number){await ensureWallet(userId);const claimed=await prisma.$queryRawUnsafe<{id:string}[]>(`INSERT INTO reward_purchase_claims(id,order_id,user_id,amount,created_at) VALUES($1,$2,$3,$4,NOW()) ON CONFLICT(order_id) DO NOTHING RETURNING id`,randomUUID(),orderId,userId,totalAmount);if(!claimed.length)return;await prisma.$executeRawUnsafe(`UPDATE reward_wallets SET lifetime_spend=lifetime_spend+$1,completed_orders=completed_orders+1,updated_at=NOW() WHERE user_id=$2`,totalAmount,userId);await awardPurchase(userId,orderId,totalAmount);await refreshLevel(userId);}
export async function reversePurchase(orderId:string){const rows=await prisma.$queryRawUnsafe<{userId:string;amount:number}[]>(`DELETE FROM reward_purchase_claims WHERE order_id=$1 RETURNING user_id AS "userId",amount`,orderId);if(!rows.length)return;const{userId,amount}=rows[0];await prisma.$executeRawUnsafe(`UPDATE reward_wallets SET lifetime_spend=GREATEST(0,lifetime_spend-$1),completed_orders=GREATEST(0,completed_orders-1),updated_at=NOW() WHERE user_id=$2`,amount,userId);const earned=await prisma.$queryRawUnsafe<{points:number}[]>(`SELECT COALESCE(SUM(points),0)::int AS points FROM reward_ledger WHERE user_id=$1 AND reference_type='ORDER' AND reference_id=$2 AND type='PURCHASE'`,userId,orderId);const points=Number(earned[0]?.points??0);if(points>0){await prisma.$executeRawUnsafe(`UPDATE reward_wallets SET points_balance=GREATEST(0,points_balance-$1),lifetime_earned=GREATEST(0,lifetime_earned-$1),updated_at=NOW() WHERE user_id=$2`,points,userId);await prisma.$executeRawUnsafe(`INSERT INTO reward_ledger(id,user_id,type,points,description,reference_type,reference_id,created_at) VALUES($1,$2,'REVERSAL',$3,'Order refund reward reversal','ORDER',$4,NOW())`,randomUUID(),userId,-points,orderId);}await refreshLevel(userId);}
export async function getSettings(){return prisma.$queryRawUnsafe<any[]>(`SELECT key,value,updated_at AS "updatedAt" FROM reward_settings ORDER BY key`);}
export async function updateSettings(values:Record<string,number>){for(const[key,value]of Object.entries(values))if(Number.isFinite(value)&&value>=0)await prisma.$executeRawUnsafe(`INSERT INTO reward_settings(key,value,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`,key,String(value));return getSettings();}
