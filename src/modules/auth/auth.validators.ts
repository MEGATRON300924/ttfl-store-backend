import { z } from "zod";

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(72, "Password is too long")
  .regex(/[a-z]/, "Password needs a lowercase letter")
  .regex(/[A-Z]/, "Password needs an uppercase letter")
  .regex(/[0-9]/, "Password needs a number");

const optionalText = (min: number, max: number) => z.preprocess((value) => typeof value === "string" && value.trim() === "" ? undefined : value,z.string().min(min).max(max).optional());

export const registerCustomerSchema = z.object({ firstName:z.string().min(1).max(80),lastName:z.string().min(1).max(80),email:z.string().email().toLowerCase(),phone:z.string().min(7,"A valid phone number is required").max(20),password:passwordSchema });
export const registerVendorSchema = registerCustomerSchema.extend({ storeName:z.string().min(2).max(120),storeCategory:z.string().trim().min(2).max(120),storeType:z.enum(["PUBLIC","PRIVATE","DISPLAY"]),whatsappNumber:optionalText(7,20),location:optionalText(2,120) });
export const loginSchema=z.object({email:z.string().email().toLowerCase(),password:z.string().min(1)});export const forgotPasswordSchema=z.object({email:z.string().email().toLowerCase()});export const resetPasswordSchema=z.object({token:z.string().min(10),password:passwordSchema});export const changePasswordSchema=z.object({currentPassword:z.string().min(1),newPassword:passwordSchema});export const verifyEmailSchema=z.object({token:z.string().min(10)});export type RegisterCustomerInput=z.infer<typeof registerCustomerSchema>;export type RegisterVendorInput=z.infer<typeof registerVendorSchema>;export type LoginInput=z.infer<typeof loginSchema>;export const updateProfileSchema=z.object({firstName:z.string().min(1).max(80).optional(),lastName:z.string().min(1).max(80).optional(),phone:z.string().min(7).max(20).optional()});export const avatarSchema=z.object({avatarUrl:z.string().url()});
