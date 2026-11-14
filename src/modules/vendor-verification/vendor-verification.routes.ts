import { Router } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { v2 as cloudinary } from "cloudinary";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import { AppError } from "@/utils/app-error";
import { prisma } from "@/lib/prisma";
import { getVendorProfileForUser } from "@/lib/vendor-access";
import { recordAudit } from "@/lib/audit";

export const vendorVerificationRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const allowedMime = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const allowedDocumentTypes = ["GOVERNMENT_ID", "BUSINESS_REGISTRATION", "PROOF_OF_ADDRESS", "TAX_DOCUMENT", "OTHER"] as const;
type VerificationDocument = { id: string; type: typeof allowedDocumentTypes[number]; name: string; mimeType: string; format: string; publicId: string; bytes: number; uploadedAt: string };

let ready = false;
async function ensureTables() {
  if (ready) return;
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS vendor_legal_verifications (
    id TEXT PRIMARY KEY,
    vendor_id TEXT NOT NULL UNIQUE REFERENCES vendor_profiles(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','UNDER_REVIEW','APPROVED','REJECTED')),
    legal_entity_type TEXT NOT NULL DEFAULT 'INDIVIDUAL',
    legal_name TEXT,
    registration_number TEXT,
    country TEXT NOT NULL DEFAULT 'Nigeria',
    state TEXT,
    city TEXT,
    registered_address TEXT,
    representative_name TEXT,
    representative_role TEXT,
    contact_email TEXT,
    contact_phone TEXT,
    tax_id TEXT,
    website TEXT,
    documents JSONB NOT NULL DEFAULT '[]'::jsonb,
    declaration_accepted BOOLEAN NOT NULL DEFAULT FALSE,
    submitted_at TIMESTAMPTZ,
    reviewed_at TIMESTAMPTZ,
    reviewed_by TEXT,
    rejection_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS vendor_legal_verifications_status_idx ON vendor_legal_verifications(status, submitted_at DESC)`);
  await prisma.$executeRawUnsafe(`ALTER TABLE store_badges DROP CONSTRAINT IF EXISTS store_badges_badge_check`);
  await prisma.$executeRawUnsafe(`ALTER TABLE store_badges ADD CONSTRAINT store_badges_badge_check CHECK (badge IN ('REGISTERED','VERIFIED','BUSINESS','ENTERPRISE','PLATINUM'))`);
  await prisma.$executeRawUnsafe(`INSERT INTO store_badges (id,vendor_id,badge) SELECT md5(vp.id || ':registered'),vp.id,'REGISTERED' FROM vendor_profiles vp ON CONFLICT (vendor_id,badge) DO NOTHING`);
  await prisma.$executeRawUnsafe(`DELETE FROM store_badges sb WHERE sb.badge IN ('VERIFIED','BUSINESS') AND NOT EXISTS (SELECT 1 FROM vendor_legal_verifications v WHERE v.vendor_id=sb.vendor_id AND v.status='APPROVED')`);
  await prisma.$executeRawUnsafe(`UPDATE vendor_profiles vp SET verified=EXISTS (SELECT 1 FROM vendor_legal_verifications v WHERE v.vendor_id=vp.id AND v.status='APPROVED')`);
  ready = true;
}

const detailsSchema = z.object({
  legalEntityType: z.enum(["INDIVIDUAL", "REGISTERED_BUSINESS", "LIMITED_COMPANY"]),
  legalName: z.string().trim().min(2).max(180),
  registrationNumber: z.string().trim().max(100).nullable().optional(),
  country: z.string().trim().min(2).max(80).default("Nigeria"),
  state: z.string().trim().max(100).nullable().optional(),
  city: z.string().trim().max(100).nullable().optional(),
  registeredAddress: z.string().trim().min(5).max(400),
  representativeName: z.string().trim().min(2).max(160),
  representativeRole: z.string().trim().max(100).nullable().optional(),
  contactEmail: z.string().trim().email().max(320),
  contactPhone: z.string().trim().min(5).max(40),
  taxId: z.string().trim().max(100).nullable().optional(),
  website: z.string().trim().url().max(500).nullable().optional(),
  declarationAccepted: z.boolean(),
}).superRefine((value, ctx) => {
  if (value.legalEntityType !== "INDIVIDUAL" && !value.registrationNumber) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Business registration number is required for registered businesses.", path: ["registrationNumber"] });
  }
});

async function ownVerification(userId: string) {
  await ensureTables();
  const vendor = await getVendorProfileForUser(userId);
  const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT id,status,legal_entity_type AS "legalEntityType",legal_name AS "legalName",registration_number AS "registrationNumber",country,state,city,registered_address AS "registeredAddress",representative_name AS "representativeName",representative_role AS "representativeRole",contact_email AS "contactEmail",contact_phone AS "contactPhone",tax_id AS "taxId",website,documents,declaration_accepted AS "declarationAccepted",submitted_at AS "submittedAt",reviewed_at AS "reviewedAt",rejection_reason AS "rejectionReason",updated_at AS "updatedAt" FROM vendor_legal_verifications WHERE vendor_id=$1 LIMIT 1`, vendor.id);
  return { vendor, verification: rows[0] ?? null };
}

vendorVerificationRouter.get("/me", requireAuth, requireRole("VENDOR"), asyncHandler(async (req,res) => {
  const { vendor, verification } = await ownVerification(req.user!.sub);
  const badgeRows = await prisma.$queryRawUnsafe<Array<{badge:string}>>(`SELECT badge FROM store_badges WHERE vendor_id=$1 ORDER BY created_at ASC`, vendor.id);
  res.json({ verification, badges: badgeRows.map(row=>row.badge), storeName: vendor.storeName });
}));

vendorVerificationRouter.put("/me", requireAuth, requireRole("VENDOR"), asyncHandler(async (req,res) => {
  await ensureTables();
  const data = detailsSchema.parse(req.body);
  if (!data.declarationAccepted) throw AppError.badRequest("You must confirm that the information is accurate before saving.", "DECLARATION_REQUIRED");
  const vendor = await getVendorProfileForUser(req.user!.sub);
  const existing = await prisma.$queryRawUnsafe<any[]>(`SELECT status FROM vendor_legal_verifications WHERE vendor_id=$1 LIMIT 1`, vendor.id);
  if (existing[0]?.status === "APPROVED") throw AppError.conflict("Your store is already legally verified. Contact TTFL support if your legal details need to change.", "VERIFICATION_ALREADY_APPROVED");
  const status = existing[0]?.status === "SUBMITTED" || existing[0]?.status === "UNDER_REVIEW" ? "DRAFT" : (existing[0]?.status ?? "DRAFT");
  await prisma.$executeRawUnsafe(`INSERT INTO vendor_legal_verifications (id,vendor_id,status,legal_entity_type,legal_name,registration_number,country,state,city,registered_address,representative_name,representative_role,contact_email,contact_phone,tax_id,website,declaration_accepted,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW())
    ON CONFLICT (vendor_id) DO UPDATE SET status=$3,legal_entity_type=$4,legal_name=$5,registration_number=$6,country=$7,state=$8,city=$9,registered_address=$10,representative_name=$11,representative_role=$12,contact_email=$13,contact_phone=$14,tax_id=$15,website=$16,declaration_accepted=$17,updated_at=NOW()`,
    randomUUID(),vendor.id,status,data.legalEntityType,data.legalName,data.registrationNumber??null,data.country,data.state??null,data.city??null,data.registeredAddress,data.representativeName,data.representativeRole??null,data.contactEmail,data.contactPhone,data.taxId??null,data.website??null,data.declarationAccepted);
  await recordAudit({actorId:req.user!.sub,action:"VENDOR_PROFILE_UPDATED",targetType:"VendorLegalVerification",targetId:vendor.id,ipAddress:req.ip,metadata:{event:"legal_verification_details_saved"}});
  res.json({message:"Legal information saved.",verification:(await ownVerification(req.user!.sub)).verification});
}));

vendorVerificationRouter.post("/me/documents", requireAuth, requireRole("VENDOR"), upload.single("document"), asyncHandler(async (req,res) => {
  await ensureTables();
  if (!req.file) throw AppError.badRequest("Choose a document to upload.", "NO_FILE");
  if (!allowedMime.has(req.file.mimetype)) throw AppError.badRequest("Upload a PDF, JPEG, PNG, or WebP document.", "INVALID_DOCUMENT_TYPE");
  const type = z.enum(allowedDocumentTypes).parse(req.body.type);
  const vendor = await getVendorProfileForUser(req.user!.sub);
  const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT status,documents FROM vendor_legal_verifications WHERE vendor_id=$1 LIMIT 1`,vendor.id);
  if (!rows[0]) throw AppError.badRequest("Save your legal information before uploading documents.", "VERIFICATION_DETAILS_REQUIRED");
  if (rows[0].status === "APPROVED") throw AppError.conflict("Approved legal documents cannot be changed through this form.", "VERIFICATION_ALREADY_APPROVED");
  const cloudName=process.env.CLOUDINARY_CLOUD_NAME, apiKey=process.env.CLOUDINARY_API_KEY, apiSecret=process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) throw AppError.internal("Secure document uploads are not configured.", "UPLOADS_NOT_CONFIGURED");
  cloudinary.config({cloud_name:cloudName,api_key:apiKey,api_secret:apiSecret});
  const publicId = `ttfl-store/vendor-verification/${vendor.id}/${randomUUID()}`;
  const result:any = await new Promise((resolve,reject)=>{
    const stream=cloudinary.uploader.upload_stream({public_id:publicId,folder:"",resource_type:"raw",type:"authenticated",use_filename:false,unique_filename:false},(error,uploaded)=>error||!uploaded?reject(AppError.internal("Document upload failed. Please try again.","DOCUMENT_UPLOAD_FAILED")):resolve(uploaded));
    stream.end(req.file!.buffer);
  });
  const doc:VerificationDocument={id:randomUUID(),type,name:req.file.originalname.slice(0,180),mimeType:req.file.mimetype,format:result.format??"bin",publicId:result.public_id,bytes:req.file.size,uploadedAt:new Date().toISOString()};
  const documents=[...(rows[0].documents??[]),doc];
  await prisma.$executeRawUnsafe(`UPDATE vendor_legal_verifications SET documents=$2::jsonb,updated_at=NOW() WHERE vendor_id=$1`,vendor.id,JSON.stringify(documents));
  await recordAudit({actorId:req.user!.sub,action:"VENDOR_PROFILE_UPDATED",targetType:"VendorLegalVerification",targetId:vendor.id,ipAddress:req.ip,metadata:{event:"legal_document_uploaded",documentType:type}});
  res.status(201).json({document:{id:doc.id,type:doc.type,name:doc.name,bytes:doc.bytes,uploadedAt:doc.uploadedAt}});
}));

vendorVerificationRouter.post("/me/submit", requireAuth, requireRole("VENDOR"), asyncHandler(async(req,res)=>{
  await ensureTables();
  const vendor=await getVendorProfileForUser(req.user!.sub);
  const rows=await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM vendor_legal_verifications WHERE vendor_id=$1 LIMIT 1`,vendor.id);
  if(!rows[0]) throw AppError.badRequest("Complete your legal information first.","VERIFICATION_DETAILS_REQUIRED");
  if(rows[0].status==="APPROVED") throw AppError.conflict("Your store is already verified.","VERIFICATION_ALREADY_APPROVED");
  if(!rows[0].declaration_accepted) throw AppError.badRequest("Accept the accuracy declaration before submitting.","DECLARATION_REQUIRED");
  const documents=rows[0].documents??[];
  if(!documents.length) throw AppError.badRequest("Upload at least one supporting legal document before submitting.","VERIFICATION_DOCUMENT_REQUIRED");
  await prisma.$executeRawUnsafe(`UPDATE vendor_legal_verifications SET status='SUBMITTED',submitted_at=NOW(),reviewed_at=NULL,reviewed_by=NULL,rejection_reason=NULL,updated_at=NOW() WHERE vendor_id=$1`,vendor.id);
  await recordAudit({actorId:req.user!.sub,action:"VENDOR_APPLICATION_SUBMITTED",targetType:"VendorLegalVerification",targetId:vendor.id,ipAddress:req.ip,metadata:{event:"legal_verification_submitted",documentCount:documents.length}});
  res.json({message:"Your legal verification request has been submitted for review.",verification:(await ownVerification(req.user!.sub)).verification});
}));

vendorVerificationRouter.get("/admin", requireAuth, requireRole("ADMIN"), asyncHandler(async(req,res)=>{
  await ensureTables();
  const status=typeof req.query.status==="string"?req.query.status:"SUBMITTED";
  if(!["DRAFT","SUBMITTED","UNDER_REVIEW","APPROVED","REJECTED"].includes(status)) throw AppError.badRequest("Invalid verification status.");
  const rows=await prisma.$queryRawUnsafe<any[]>(`SELECT v.id,v.vendor_id AS "vendorId",v.status,v.legal_entity_type AS "legalEntityType",v.legal_name AS "legalName",v.registration_number AS "registrationNumber",v.country,v.state,v.city,v.registered_address AS "registeredAddress",v.representative_name AS "representativeName",v.representative_role AS "representativeRole",v.contact_email AS "contactEmail",v.contact_phone AS "contactPhone",v.tax_id AS "taxId",v.website,v.documents,v.submitted_at AS "submittedAt",v.reviewed_at AS "reviewedAt",v.rejection_reason AS "rejectionReason",vp."storeName",vp."storeSlug",u.email AS "ownerEmail",u."firstName",u."lastName" FROM vendor_legal_verifications v JOIN vendor_profiles vp ON vp.id=v.vendor_id JOIN users u ON u.id=vp."userId" WHERE v.status=$1 ORDER BY v.submitted_at DESC NULLS LAST`,status);
  res.json({verifications:rows.map(row=>({...row,documents:(row.documents??[]).map((doc:VerificationDocument)=>({id:doc.id,type:doc.type,name:doc.name,mimeType:doc.mimeType,bytes:doc.bytes,uploadedAt:doc.uploadedAt}))}))});
}));

vendorVerificationRouter.get("/admin/:vendorId/document/:documentId", requireAuth, requireRole("ADMIN"), asyncHandler(async(req,res)=>{
  await ensureTables();
  const rows=await prisma.$queryRawUnsafe<any[]>(`SELECT documents FROM vendor_legal_verifications WHERE vendor_id=$1 LIMIT 1`,req.params.vendorId);
  const doc=(rows[0]?.documents??[]).find((item:VerificationDocument)=>item.id===req.params.documentId);
  if(!doc) throw AppError.notFound("Verification document not found.");
  const cloudName=process.env.CLOUDINARY_CLOUD_NAME,apiKey=process.env.CLOUDINARY_API_KEY,apiSecret=process.env.CLOUDINARY_API_SECRET;
  if(!cloudName||!apiKey||!apiSecret) throw AppError.internal("Secure document storage is not configured.");
  cloudinary.config({cloud_name:cloudName,api_key:apiKey,api_secret:apiSecret});
  const url=cloudinary.utils.private_download_url(doc.publicId,doc.format,{resource_type:"raw",type:"authenticated",expires_at:Math.floor(Date.now()/1000)+300});
  res.json({url});
}));

vendorVerificationRouter.post("/admin/:vendorId/decision", requireAuth, requireRole("ADMIN"), asyncHandler(async(req,res)=>{
  await ensureTables();
  const input=z.object({decision:z.enum(["APPROVE","REJECT"]),reason:z.string().trim().max(1200).nullable().optional()}).parse(req.body);
  if(input.decision==="REJECT"&&!input.reason) throw AppError.badRequest("Provide a reason when rejecting a verification.");
  const rows=await prisma.$queryRawUnsafe<any[]>(`SELECT id,status FROM vendor_legal_verifications WHERE vendor_id=$1 LIMIT 1`,req.params.vendorId);
  if(!rows[0]||!["SUBMITTED","UNDER_REVIEW"].includes(rows[0].status)) throw AppError.conflict("This verification is not awaiting a decision.","VERIFICATION_NOT_REVIEWABLE");
  const approved=input.decision==="APPROVE";
  await prisma.$executeRawUnsafe(`UPDATE vendor_legal_verifications SET status=$2,reviewed_at=NOW(),reviewed_by=$3,rejection_reason=$4,updated_at=NOW() WHERE vendor_id=$1`,req.params.vendorId,approved?"APPROVED":"REJECTED",req.user!.sub,approved?null:input.reason);
  await prisma.$executeRawUnsafe(`DELETE FROM store_badges WHERE vendor_id=$1 AND badge IN ('VERIFIED','BUSINESS')`,req.params.vendorId);
  if(approved){
    await prisma.$executeRawUnsafe(`UPDATE vendor_profiles SET verified=TRUE WHERE id=$1`,req.params.vendorId);
    await prisma.$executeRawUnsafe(`INSERT INTO store_badges (id,vendor_id,badge) VALUES ($1,$2,'VERIFIED'),($3,$2,'BUSINESS') ON CONFLICT (vendor_id,badge) DO NOTHING`,randomUUID(),req.params.vendorId,randomUUID());
  }else{
    await prisma.$executeRawUnsafe(`UPDATE vendor_profiles SET verified=FALSE WHERE id=$1`,req.params.vendorId);
    await prisma.$executeRawUnsafe(`INSERT INTO store_badges (id,vendor_id,badge) VALUES ($1,$2,'REGISTERED') ON CONFLICT (vendor_id,badge) DO NOTHING`,randomUUID(),req.params.vendorId);
  }
  await recordAudit({actorId:req.user!.sub,action:"VENDOR_PROFILE_UPDATED",targetType:"VendorLegalVerification",targetId:req.params.vendorId,ipAddress:req.ip,metadata:{decision:input.decision,reason:input.reason??null}});
  res.json({message:approved?"Legal verification approved. Verified Store and Business Store badges have been awarded.":"Legal verification rejected.",status:approved?"APPROVED":"REJECTED"});
}));
