import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "@/middleware/auth";
import { asyncHandler } from "@/middleware/error-handler";
import * as service from "./affiliates.service";
import { convertOrder } from "./affiliate-convert.service";
import * as settings from "@/modules/settings/settings.service";

export const affiliatesRouter=Router();

affiliatesRouter.get("/program",asyncHandler(async(_req,res)=>res.json({program:await service.getProgram()})));

affiliatesRouter.post("/click",asyncHandler(async(req,res)=>{
  const data=z.object({code:z.string().min(3).max(50),sessionId:z.string().min(8).max(120),referralType:z.enum(["CUSTOMER","VENDOR"]).optional(),landingPath:z.string().max(500).optional(),source:z.string().max(500).optional()}).parse(req.body);
  res.json(await service.recordClick(data.code,data));
}));

affiliatesRouter.get("/vendor-invite",asyncHandler(async(req,res)=>{
  const code=z.string().min(3).max(50).parse(req.query.code);
  const sessionId=typeof req.query.sessionId==="string"?req.query.sessionId:undefined;
  res.json(await service.getVendorInvite(code,sessionId,req.user?.sub));
}));

affiliatesRouter.post("/vendor-reward/claim",requireAuth,asyncHandler(async(req,res)=>{
  const data=z.object({code:z.string().min(3).max(50),sessionId:z.string().min(8).max(120)}).parse(req.body);
  res.json(await service.claimVendorReward(req.user!.sub,data.code,data.sessionId));
}));

affiliatesRouter.post("/vendor-reward/decline",requireAuth,asyncHandler(async(req,res)=>{
  const data=z.object({code:z.string().min(3).max(50),sessionId:z.string().min(8).max(120)}).parse(req.body);
  res.json(await service.declineVendorReward(req.user!.sub,data.code,data.sessionId));
}));

affiliatesRouter.get("/vendor-rewards",requireAuth,asyncHandler(async(req,res)=>res.json({rewards:await service.getMyVendorRewards(req.user!.sub)})));
affiliatesRouter.post("/vendor-reward/redeem",requireAuth,requireRole("VENDOR"),asyncHandler(async(req,res)=>res.json(await service.redeemVendorReward(req.user!.sub))));

affiliatesRouter.post("/join",requireAuth,asyncHandler(async(req,res)=>res.json({affiliate:await service.join(req.user!.sub)})));
affiliatesRouter.get("/dashboard",requireAuth,asyncHandler(async(req,res)=>res.json({dashboard:await service.getDashboard(req.user!.sub)})));

affiliatesRouter.patch("/profile",requireAuth,asyncHandler(async(req,res)=>{
  const data=z.object({displayName:z.string().trim().min(2).max(80),displayAvatarUrl:z.string().url().max(1000).nullable().optional()}).parse(req.body);
  res.json({dashboard:await service.updateProfile(req.user!.sub,data)});
}));

affiliatesRouter.post("/convert",requireAuth,asyncHandler(async(req,res)=>{
  const data=z.object({orderNumber:z.string().min(5).max(40),code:z.string().min(3).max(50),sessionId:z.string().min(8).max(120)}).parse(req.body);
  res.json(await convertOrder(req.user!.sub,data.orderNumber,data.code,data.sessionId));
}));

affiliatesRouter.get("/admin/settings",requireAuth,requireRole("ADMIN"),asyncHandler(async(_req,res)=>{
  const keys=[
    settings.SETTING_KEYS.AFFILIATE_PROGRAM_ENABLED,settings.SETTING_KEYS.AFFILIATE_CUSTOMER_REFERRALS_ENABLED,settings.SETTING_KEYS.AFFILIATE_VENDOR_REFERRALS_ENABLED,
    settings.SETTING_KEYS.AFFILIATE_VENDOR_REWARD_ENABLED,settings.SETTING_KEYS.AFFILIATE_VENDOR_REWARD_TIER,settings.SETTING_KEYS.AFFILIATE_VENDOR_REWARD_MONTHS,settings.SETTING_KEYS.AFFILIATE_VENDOR_QUALIFICATION,
  ];
  const values=await Promise.all(keys.map(async key=>[key,await settings.getSetting(key)] as const));
  res.json({settings:Object.fromEntries(values)});
}));

affiliatesRouter.put("/admin/settings",requireAuth,requireRole("ADMIN"),asyncHandler(async(req,res)=>{
  const data=z.object({
    programEnabled:z.boolean(),customerReferralsEnabled:z.boolean(),vendorReferralsEnabled:z.boolean(),vendorRewardEnabled:z.boolean(),
    vendorRewardTier:z.enum(["PRO","BUSINESS","ENTERPRISE"]),vendorRewardMonths:z.number().int().min(1).max(12),vendorQualification:z.enum(["APPROVED_VENDOR","FIRST_PAID_VENDOR_PLAN"]),
  }).parse(req.body);
  const values:{key:string;value:string}[]=[
    {key:settings.SETTING_KEYS.AFFILIATE_PROGRAM_ENABLED,value:String(data.programEnabled)},
    {key:settings.SETTING_KEYS.AFFILIATE_CUSTOMER_REFERRALS_ENABLED,value:String(data.customerReferralsEnabled)},
    {key:settings.SETTING_KEYS.AFFILIATE_VENDOR_REFERRALS_ENABLED,value:String(data.vendorReferralsEnabled)},
    {key:settings.SETTING_KEYS.AFFILIATE_VENDOR_REWARD_ENABLED,value:String(data.vendorRewardEnabled)},
    {key:settings.SETTING_KEYS.AFFILIATE_VENDOR_REWARD_TIER,value:data.vendorRewardTier},
    {key:settings.SETTING_KEYS.AFFILIATE_VENDOR_REWARD_MONTHS,value:String(data.vendorRewardMonths)},
    {key:settings.SETTING_KEYS.AFFILIATE_VENDOR_QUALIFICATION,value:data.vendorQualification},
  ];
  for(const item of values)await settings.setSetting(item.key,item.value);
  res.json({program:await service.getProgram()});
}));
