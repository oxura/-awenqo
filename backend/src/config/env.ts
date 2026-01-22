import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  MONGO_URI: z.string().min(1),
  REDIS_URL: z.string().min(1),
  CORS_ORIGIN: z.string().default("*"),
  ADMIN_TOKEN: z.string().optional().default(""),
  AUCTION_ROUND_DURATION_MS: z.coerce.number().int().positive().default(300000),
  AUCTION_ANTI_SNIPING_THRESHOLD_MS: z.coerce.number().int().positive().default(60000),
  AUCTION_ANTI_SNIPING_EXTENSION_MS: z.coerce.number().int().positive().default(120000),
  AUCTION_TOP_N: z.coerce.number().int().positive().default(100),
  AUCTION_MIN_BID_STEP_PERCENT: z.coerce.number().int().positive().default(5)
});

export const env = EnvSchema.parse(process.env);
