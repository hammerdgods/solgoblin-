import { PublicKey } from "@solana/web3.js";
import { z } from "zod";

export const walletSchema = z
  .string()
  .trim()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Invalid wallet address")
  .refine((s) => {
    try {
      return new PublicKey(s).toBase58() === s;
    } catch {
      return false;
    }
  }, "Invalid wallet address");

export const modeSchema = z.enum(["live", "demo"]).default("live");
export const assetSchema = z.enum(["SOL", "USDC"]);
export const riskLevelSchema = z.enum(["low", "medium", "high"]);

export const preferencesSchema = z.object({
  maxRiskLevel: riskLevelSchema,
  maxWithdrawalDelayHours: z.number().min(0).max(24 * 60),
  allowedAssets: z.array(assetSchema).min(1),
  horizonDays: z.number().int().min(1).max(3650),
});

export const amountSchema = z.number().finite().min(0).max(1e12);
