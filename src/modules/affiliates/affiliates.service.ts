import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/app-error";
import { getSetting, getSettingNumber, SETTING_KEYS } from "@/modules/settings/settings.service";
import { getPlanForTier } from "@/modules/vendor-plans/vendor-plans.service";
import type { VendorTier } from "@prisma/client";

const DEFAULT_RATE=5;
type AttributionRow={affiliate_id:string;commission_rate:string};
type ReferralType="CUSTOMER"|"VENDOR";

export async function ensureAffiliateTables(){
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS affiliates (id TEXT PRIMARY KEY,user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,code TEXT NOT NULL UNIQUE,status TEXT NOT NULL DEFAULT 'ACTIVE',commission_rate NUMERIC(5,2) NOT NULL DEFAULT 5,clicks INTEGER NOT NULL DEFAULT 0,conversions INTEGER NOT NULL DEFAULT 0,pending_earnings NUMERIC(12,2) NOT NULL DEFAULT 0,paid_earnings NUMERIC(12,2) NOT NULL DEFAULT 0,display_name TEXT,display_avatar_url TEXT,vendor_code TEXT UNIQUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await prisma.$executeRawUnsafe(`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS display_name TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS display_avatar_url TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS vendor_code TEXT UNIQUE`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS affiliate_clicks (id TEXT PRIMARY KEY,affiliate_id TEXT NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,session_id TEXT,referral_type TEXT NOT NULL DEFAULT 'CUSTOMER',landing_path TEXT,source TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await prisma.$executeRawUnsafe(`ALTER TABLE affiliate_clicks ADD COLUMN IF NOT EXISTS referral_type TEXT NOT NULL DEFAULT 'CUSTOMER'`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS affiliate_clicks_affiliate_idx ON affiliate_clicks(affiliate_id)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS affiliate_clicks_created_idx ON affiliate_clicks(created_at)`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS affiliate_attributions (id TEXT PRIMARY KEY,affiliate_id TEXT NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,order_id TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,commission_rate NUMERIC(5,2) NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS affiliate_attributions_affiliate_idx ON affiliate_attributions(affiliate_id)`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS affiliate_commissions (id TEXT PRIMARY KEY,affiliate_id TEXT NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,order_id TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,order_amount NUMERIC(12,2) NOT NULL,amount NUMERIC(12,2) NOT NULL,status TEXT NOT NULL DEFAULT 'PENDING',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),paid_at TIMESTAMPTZ)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS affiliate_commissions_affiliate_idx ON affiliate_commissions(affiliate_id)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS affiliate_commissions_status_idx ON affiliate_commissions(status)`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS affiliate_vendor_rewards (id TEXT PRIMARY KEY,affiliate_id TEXT NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,referred_user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,status TEXT NOT NULL DEFAULT 'CLAIMED',reward_tier TEXT NOT NULL,reward_months INTEGER NOT NULL,claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),redeemed_at TIMESTAMPTZ,expires_at TIMESTAMPTZ,declined_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS affiliate_vendor_rewards_affiliate_idx ON affiliate_vendor_rewards(affiliate_id)`);
}

function makeCode(firstName:string,lastName:string){const base=`${firstName}${lastName}`.replace(/[^a-z0-9]/gi,"").toUpperCase().slice(0,10)||"TTFL";return `${base}-${randomBytes(3).toString("hex").toUpperCase()}`;}
async function uniqueCode(firstName:string,lastName:string){let code=makeCode(firstName,lastName);while((await prisma.$queryRawUnsafe<Array<{id:string}>>(`SELECT id FROM affiliates WHERE code=$1 OR vendor_code=$1 LIMIT 1`,code))[0])code=makeCode(firstName,lastName);return code;}
async function vendorCode(firstName:string,lastName:string){let code=`V-${makeCode(firstName,lastName)}`;while((await prisma.$queryRawUnsafe<Array<{id:string}>>(`SELECT id FROM affiliates WHERE code=$1 OR vendor_code=$1 LIMIT 1`,code))[0])code=`V-${makeCode(firstName,lastName)}`;return code;}

export async function getProgram(){await ensureAffiliateTables();return{enabled:(await getSetting(SETTING_KEYS.AFFILIATE_PROGRAM_ENABLED))==="true",customerReferralsEnabled:(await getSetting(SETTING_KEYS.AFFILIATE_CUSTOMER_REFERRALS_ENABLED))==="true",vendorReferralsEnabled:(await getSetting(SETTING_KEYS.AFFILIATE_VENDOR_REFERRALS_ENABLED))==="true",vendorRewardEnabled:(await getSetting(SETTING_KEYS.AFFILIATE_VENDOR_REWARD_ENABLED))==="true",vendorRewardTier:await getSetting(SETTING_KEYS.AFFILIATE_VENDOR_REWARD_TIER),vendorRewardMonths:Math.max(1,await getSettingNumber(SETTING_KEYS.AFFILIATE_VENDOR_REWARD_MONTHS)),vendorQualification:await getSetting(SETTING_KEYS.AFFILIATE_VENDOR_QUALIFICATION),commissionRate:DEFAULT_RATE,cookieDays:30,minimumPayout:10000};}

export async function join(userId:string){
  await ensureAffiliateTables();
  const user=await prisma.user.findUnique({where:{id:userId}});
  if(!user)throw AppError.notFound("User not found");
  const existing=await prisma.$queryRawUnsafe<Array<{id:string;code:string;vendor_code:string|null;status:string;commission_rate:string;display_name:string|null;display_avatar_url:string|null}>>(`SELECT id,code,vendor_code,status,commission_rate::text,display_name,display_avatar_url FROM affiliates WHERE user_id=$1 LIMIT 1`,userId);
  if(existing[0]){
    if(!existing[0].vendor_code){const vc=await vendorCode(user.firstName,user.lastName);await prisma.$executeRawUnsafe(`UPDATE affiliates SET vendor_code=$1,updated_at=NOW() WHERE id=$2`,vc,existing[0].id);existing[0].vendor_code=vc;}
    if(!existing[0].display_name){await prisma.$executeRawUnsafe(`UPDATE affiliates SET display_name=$1,updated_at=NOW() WHERE id=$2`,[user.firstName,user.lastName].filter(Boolean).join(" ")||"TTFL Affiliate",existing[0].id);existing[0].display_name=[user.firstName,user.lastName].filter(Boolean).join(" ")||"TTFL Affiliate";}
    return existing[0];
  }
  const code=await uniqueCode(user.firstName,user.lastName),vc=await vendorCode(user.firstName,user.lastName),id=randomBytes(16).toString("hex"),displayName=[user.firstName,user.lastName].filter(Boolean).join(" ")||"TTFL Affiliate";
  await prisma.$executeRawUnsafe(`INSERT INTO affiliates(id,user_id,code,vendor_code,commission_rate,display_name,display_avatar_url) VALUES($1,$2,$3,$4,$5,$6,$7)`,id,userId,code,vc,DEFAULT_RATE,displayName,user.avatarUrl??null);
  return{id,code,vendor_code:vc,status:"ACTIVE",commission_rate:String(DEFAULT_RATE),display_name:displayName,display_avatar_url:user.avatarUrl??null};
}

export async function getDashboard(userId:string){
  await ensureAffiliateTables();
  const rows=await prisma.$queryRawUnsafe<any[]>(`SELECT id,code,vendor_code,status,commission_rate::text,clicks,conversions,pending_earnings::text,paid_earnings::text,display_name,display_avatar_url,created_at FROM affiliates WHERE user_id=$1 LIMIT 1`,userId);
  const affiliate=rows[0];if(!affiliate)return null;
  const commissions=await prisma.$queryRawUnsafe<any[]>(`SELECT c.id,c.order_id,o.order_number,c.order_amount::text,c.amount::text,c.status,c.created_at,c.paid_at FROM affiliate_commissions c JOIN orders o ON o.id=c.order_id WHERE c.affiliate_id=$1 ORDER BY c.created_at DESC LIMIT 50`,affiliate.id);
  const rewards=await prisma.$queryRawUnsafe<any[]>(`SELECT r.id,r.status,r.reward_tier AS "rewardTier",r.reward_months AS "rewardMonths",r.claimed_at AS "claimedAt",r.redeemed_at AS "redeemedAt",r.expires_at AS "expiresAt",u.first_name AS "firstName",u.last_name AS "lastName",u.email FROM affiliate_vendor_rewards r JOIN users u ON u.id=r.referred_user_id WHERE r.affiliate_id=$1 ORDER BY r.created_at DESC LIMIT 50`,affiliate.id);
  return{affiliate:{id:affiliate.id,code:affiliate.code,vendorCode:affiliate.vendor_code,status:affiliate.status,commissionRate:Number(affiliate.commission_rate),clicks:affiliate.clicks,conversions:affiliate.conversions,pendingEarnings:Number(affiliate.pending_earnings),paidEarnings:Number(affiliate.paid_earnings),displayName:affiliate.display_name,displayAvatarUrl:affiliate.display_avatar_url,createdAt:affiliate.created_at},commissions:commissions.map(c=>({id:c.id,orderId:c.order_id,orderNumber:c.order_number,orderAmount:Number(c.order_amount),amount:Number(c.amount),status:c.status,createdAt:c.created_at,paidAt:c.paid_at})),vendorRewards:rewards};
}

export async function updateProfile(userId:string,input:{displayName:string;displayAvatarUrl?:string|null}){
  await ensureAffiliateTables();const affiliate=await prisma.$queryRawUnsafe<Array<{id:string}>>(`SELECT id FROM affiliates WHERE user_id=$1 LIMIT 1`,userId);if(!affiliate[0])throw AppError.notFound("Affiliate account not found");
  const name=input.displayName.trim();if(name.length<2||name.length>80)throw AppError.badRequest("Display name must be 2–80 characters","INVALID_DISPLAY_NAME");
  const avatar=input.displayAvatarUrl?.trim()||null;if(avatar&&!/^https?:\/\//i.test(avatar))throw AppError.badRequest("Avatar URL must be a valid URL","INVALID_AVATAR_URL");
  await prisma.$executeRawUnsafe(`UPDATE affiliates SET display_name=$1,display_avatar_url=$2,updated_at=NOW() WHERE id=$3`,name,avatar,affiliate[0].id);
  return getDashboard(userId);
}

export async function recordClick(code:string,input:{sessionId?:string;landingPath?:string;source?:string;referralType?:ReferralType}){
  await ensureAffiliateTables();const type=input.referralType==="VENDOR"?"VENDOR":"CUSTOMER";const program=await getProgram();if(!program.enabled||(type==="VENDOR"&&!program.vendorReferralsEnabled)||(type==="CUSTOMER"&&!program.customerReferralsEnabled))return{tracked:false};
  const column=type==="VENDOR"?"vendor_code":"code";const rows=await prisma.$queryRawUnsafe<Array<{id:string}>>(`SELECT id FROM affiliates WHERE ${column}=$1 AND status='ACTIVE' LIMIT 1`,code.trim().toUpperCase());if(!rows[0])return{tracked:false};
  await prisma.$executeRawUnsafe(`INSERT INTO affiliate_clicks(id,affiliate_id,session_id,referral_type,landing_path,source) VALUES($1,$2,$3,$4,$5,$6)`,randomBytes(16).toString("hex"),rows[0].id,input.sessionId??null,type,input.landingPath??null,input.source??null);
  await prisma.$executeRawUnsafe(`UPDATE affiliates SET clicks=clicks+1,updated_at=NOW() WHERE id=$1`,rows[0].id);return{tracked:true,referralType:type};
}

export async function getVendorInvite(code:string,sessionId?:string,userId?:string){
  await ensureAffiliateTables();const program=await getProgram();if(!program.enabled||!program.vendorReferralsEnabled||!program.vendorRewardEnabled)return{show:false};
  const rows=await prisma.$queryRawUnsafe<any[]>(`SELECT a.id,a.user_id,a.display_name,a.display_avatar_url,u.avatar_url FROM affiliates a JOIN users u ON u.id=a.user_id WHERE a.vendor_code=$1 AND a.status='ACTIVE' LIMIT 1`,code.trim().toUpperCase());const affiliate=rows[0];if(!affiliate)return{show:false};
  if(userId&&userId===affiliate.user_id)return{show:false};
  if(sessionId){const click=await prisma.$queryRawUnsafe<Array<{id:string}>>(`SELECT id FROM affiliate_clicks WHERE affiliate_id=$1 AND session_id=$2 AND referral_type='VENDOR' AND created_at>=NOW()-INTERVAL '30 days' ORDER BY created_at DESC LIMIT 1`,affiliate.id,sessionId);if(!click[0])return{show:false};}
  if(userId){const claimed=await prisma.$queryRawUnsafe<Array<{status:string;rewardTier:string;rewardMonths:number}>>(`SELECT status,reward_tier AS "rewardTier",reward_months AS "rewardMonths" FROM affiliate_vendor_rewards WHERE referred_user_id=$1 LIMIT 1`,userId);if(claimed[0])return{show:false,alreadyClaimed:true,status:claimed[0].status};}
  return{show:true,affiliate:{id:affiliate.id,displayName:affiliate.display_name||"TTFL Affiliate",avatarUrl:affiliate.display_avatar_url||affiliate.avatar_url||null},perk:{tier:program.vendorRewardTier,months:program.vendorRewardMonths}};
}

export async function claimVendorReward(userId:string,code:string,sessionId:string){
  await ensureAffiliateTables();const program=await getProgram();if(!program.enabled||!program.vendorReferralsEnabled||!program.vendorRewardEnabled)throw AppError.badRequest("Vendor referral rewards are currently unavailable","VENDOR_REFERRAL_DISABLED");
  const rows=await prisma.$queryRawUnsafe<any[]>(`SELECT a.id,a.user_id,a.display_name FROM affiliates a WHERE a.vendor_code=$1 AND a.status='ACTIVE' LIMIT 1`,code.trim().toUpperCase());const affiliate=rows[0];if(!affiliate)throw AppError.notFound("Referral invitation not found","REFERRAL_NOT_FOUND");if(affiliate.user_id===userId)throw AppError.badRequest("You cannot claim your own referral reward","SELF_REFERRAL");
  const click=await prisma.$queryRawUnsafe<Array<{id:string}>>(`SELECT id FROM affiliate_clicks WHERE affiliate_id=$1 AND session_id=$2 AND referral_type='VENDOR' AND created_at>=NOW()-INTERVAL '30 days' ORDER BY created_at DESC LIMIT 1`,affiliate.id,sessionId);if(!click[0])throw AppError.badRequest("This reward must be claimed from the original vendor referral link","REFERRAL_SESSION_INVALID");
  const existing=await prisma.$queryRawUnsafe<Array<{id:string;status:string}>>(`SELECT id,status FROM affiliate_vendor_rewards WHERE referred_user_id=$1 LIMIT 1`,userId);if(existing[0])return{claimed:false,alreadyClaimed:true,status:existing[0].status};
  const months=Math.max(1,await getSettingNumber(SETTING_KEYS.AFFILIATE_VENDOR_REWARD_MONTHS));const tier=await getSetting(SETTING_KEYS.AFFILIATE_VENDOR_REWARD_TIER) as VendorTier;
  if(!(["PRO","BUSINESS","ENTERPRISE"] as string[]).includes(tier))throw AppError.badRequest("The configured vendor reward plan is invalid","INVALID_VENDOR_REWARD_PLAN");
  const id=randomBytes(16).toString("hex");
  await prisma.$executeRawUnsafe(`INSERT INTO affiliate_vendor_rewards(id,affiliate_id,referred_user_id,status,reward_tier,reward_months) VALUES($1,$2,$3,'CLAIMED',$4,$5)`,id,affiliate.id,userId,tier,months);
  return{claimed:true,alreadyClaimed:false,status:"CLAIMED",reward:{id,tier,months},affiliate:{displayName:affiliate.display_name||"TTFL Affiliate"}};
}

export async function declineVendorReward(userId:string,code:string,sessionId:string){
  await ensureAffiliateTables();const invite=await getVendorInvite(code,sessionId,userId);if(!invite.show)return{declined:false};const rows=await prisma.$queryRawUnsafe<Array<{id:string}>>(`SELECT a.id FROM affiliates a WHERE a.vendor_code=$1 LIMIT 1`,code.trim().toUpperCase());if(!rows[0])return{declined:false};await prisma.$executeRawUnsafe(`UPDATE affiliate_vendor_rewards SET status='DECLINED',declined_at=NOW(),updated_at=NOW() WHERE referred_user_id=$1 AND affiliate_id=$2 AND status='DECLINED'`,userId,rows[0].id);return{declined:true};
}

export async function getMyVendorRewards(userId:string){
  await ensureAffiliateTables();const rows=await prisma.$queryRawUnsafe<any[]>(`SELECT r.id,r.status,r.reward_tier AS "rewardTier",r.reward_months AS "rewardMonths",r.claimed_at AS "claimedAt",r.redeemed_at AS "redeemedAt",r.expires_at AS "expiresAt",a.display_name AS "affiliateDisplayName" FROM affiliate_vendor_rewards r JOIN affiliates a ON a.id=r.affiliate_id WHERE r.referred_user_id=$1 ORDER BY r.created_at DESC`,userId);return rows;
}

export async function redeemVendorReward(userId:string){
  await ensureAffiliateTables();
  const vendor=await prisma.vendorProfile.findUnique({where:{userId}});
  if(!vendor)throw AppError.badRequest("Create your TTFL Store vendor profile before applying this reward","VENDOR_PROFILE_REQUIRED");
  if(vendor.status!=="APPROVED")throw AppError.badRequest("Your vendor profile must be approved before the reward can be applied","VENDOR_NOT_APPROVED");
  const reward=await prisma.$queryRawUnsafe<Array<{id:string;affiliate_id:string;status:string;reward_tier:string;reward_months:number;expires_at:Date|null}>>(`SELECT id,affiliate_id,status,reward_tier,reward_months,expires_at FROM affiliate_vendor_rewards WHERE referred_user_id=$1 ORDER BY created_at DESC LIMIT 1`,userId);
  if(!reward[0])throw AppError.notFound("You do not have a saved vendor referral reward","REWARD_NOT_FOUND");
  if(reward[0].status==="REDEEMED")return{redeemed:false,alreadyRedeemed:true};
  if(reward[0].status!=="CLAIMED")throw AppError.badRequest("This vendor reward is not available","REWARD_NOT_AVAILABLE");
  const tier=reward[0].reward_tier as VendorTier;const plan=await getPlanForTier(tier);const current=await prisma.vendorSubscription.findUnique({where:{vendorId:vendor.id},include:{plan:true,payments:true}});
  if(current&&current.plan.tier!=="FREE"&&current.payments.some(p=>p.status==="PAID"&&Number(p.amount)>0))throw AppError.badRequest("You already have a paid vendor subscription. The saved reward cannot replace it.","PAID_PLAN_ALREADY_ACTIVE");
  const now=new Date();const expires=new Date(now);expires.setMonth(expires.getMonth()+Math.max(1,reward[0].reward_months));
  await prisma.$transaction(async(tx)=>{
    if(current)await tx.vendorSubscription.update({where:{id:current.id},data:{planId:plan.id,status:"ACTIVE",startDate:now,renewalDate:expires,cancelledAt:null}});
    else await tx.vendorSubscription.create({data:{vendorId:vendor.id,planId:plan.id,status:"ACTIVE",startDate:now,renewalDate:expires}});
    await tx.vendorProfile.update({where:{id:vendor.id},data:{tier}});
    await tx.$executeRawUnsafe(`UPDATE affiliate_vendor_rewards SET status='REDEEMED',redeemed_at=$1,updated_at=NOW() WHERE id=$2 AND status='CLAIMED'`,now,reward[0].id);
  });
  return{redeemed:true,tier,months:reward[0].reward_months,expiresAt:expires};
}

export async function resolveAttribution(code:string|undefined,customerId:string){if(!code)return null;await ensureAffiliateTables();const rows=await prisma.$queryRawUnsafe<Array<{id:string;user_id:string;commission_rate:string}>>(`SELECT id,user_id,commission_rate::text FROM affiliates WHERE code=$1 AND status='ACTIVE' LIMIT 1`,code.trim().toUpperCase());if(!rows[0]||rows[0].user_id===customerId)return null;return{id:rows[0].id,commissionRate:Number(rows[0].commission_rate)};}
export async function attachOrder(orderId:string,affiliateId:string,commissionRate:number){await ensureAffiliateTables();await prisma.$executeRawUnsafe(`INSERT INTO affiliate_attributions(id,affiliate_id,order_id,commission_rate) VALUES($1,$2,$3,$4) ON CONFLICT(order_id) DO NOTHING`,randomBytes(16).toString("hex"),affiliateId,orderId,commissionRate);}
export async function recordPaidOrder(tx:any,orderId:string,orderAmount:number){const attribution=await tx.$queryRawUnsafe(`SELECT affiliate_id,commission_rate::text FROM affiliate_attributions WHERE order_id=$1 LIMIT 1`) as AttributionRow[];if(!attribution[0])return;const rate=Number(attribution[0].commission_rate);const amount=Math.round(orderAmount*rate)/100;await tx.$queryRawUnsafe(`WITH inserted AS (INSERT INTO affiliate_commissions(id,affiliate_id,order_id,order_amount,amount,status) VALUES($1,$2,$3,$4,$5,'PENDING') ON CONFLICT(order_id) DO NOTHING RETURNING affiliate_id,amount) UPDATE affiliates a SET conversions=conversions+1,pending_earnings=pending_earnings+inserted.amount,updated_at=NOW() FROM inserted WHERE a.id=inserted.affiliate_id`,randomBytes(16).toString("hex"),attribution[0].affiliate_id,orderId,orderAmount,amount);}
