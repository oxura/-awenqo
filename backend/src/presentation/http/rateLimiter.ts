import { Request, Response, NextFunction } from "express";
import { getRedis } from "../../infrastructure/cache/redis";

/**
 * Simple Redis-based rate limiter middleware.
 * Limits requests per user (by userId in body) or by IP if no userId.
 * 
 * Uses a sliding window counter pattern with Redis INCR + EXPIRE.
 */
export function rateLimiter(options: {
    windowMs: number;
    maxRequests: number;
    keyPrefix: string;
    extractId?: (req: Request) => string | null;
}) {
    const redis = getRedis();
    const { windowMs, maxRequests, keyPrefix, extractId } = options;
    const windowSec = Math.ceil(windowMs / 1000);

    return async (req: Request, res: Response, next: NextFunction) => {
        const id = extractId ? extractId(req) : req.ip ?? "unknown";
        if (!id) {
            return next();
        }

        const key = `${keyPrefix}:${id}`;

        try {
            const current = await redis.incr(key);
            if (current === 1) {
                await redis.expire(key, windowSec);
            }

            res.setHeader("X-RateLimit-Limit", maxRequests);
            res.setHeader("X-RateLimit-Remaining", Math.max(0, maxRequests - current));

            if (current > maxRequests) {
                return res.status(429).json({
                    error: "RATE_LIMITED",
                    message: `Too many requests. Limit: ${maxRequests} per ${windowSec}s window.`
                });
            }

            return next();
        } catch {
            // If Redis fails, allow request (fail-open for availability)
            return next();
        }
    };
}
