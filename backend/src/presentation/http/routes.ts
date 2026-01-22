import { Router, Request, Response } from "express";
import { z } from "zod";
import { AppError } from "../../application/errors";
import { PlaceBidUseCase } from "../../application/usecases/placeBid";
import { FinishRoundUseCase } from "../../application/usecases/finishRound";
import { WithdrawFundsUseCase } from "../../application/usecases/withdrawFunds";
import { CreateAuctionUseCase } from "../../application/usecases/createAuction";
import { StartRoundUseCase } from "../../application/usecases/startRound";
import { CreditWalletUseCase } from "../../application/usecases/creditWallet";
import {
  AuctionRepository,
  BidRepository,
  IdempotencyRepository,
  RoundRepository,
  WalletRepository
} from "../../application/ports/repositories";
import { LeaderboardCache } from "../../application/ports/services";
import { rateLimiter } from "./rateLimiter";
import { env } from "../../config/env";

const objectIdSchema = z.string().regex(/^[a-f0-9]{24}$/i, "Invalid id");

export type RouterDependencies = {
  placeBid: PlaceBidUseCase;
  finishRound: FinishRoundUseCase;
  withdrawFunds: WithdrawFundsUseCase;
  createAuction: CreateAuctionUseCase;
  startRound: StartRoundUseCase;
  creditWallet: CreditWalletUseCase;
  auctions: AuctionRepository;
  rounds: RoundRepository;
  bids: BidRepository;
  wallets: WalletRepository;
  idempotency: IdempotencyRepository;
  leaderboard: LeaderboardCache;
  leaderboardSize: number;
  minBidStepPercent: number;
};

export function createRouter(deps: RouterDependencies): Router {
  const router = Router();
  const adminToken = env.ADMIN_TOKEN;

  const adminGuard = (req: Request, res: Response, next: () => void) => {
    if (!adminToken) {
      return next();
    }
    const token = req.header("x-admin-token");
    if (!token || token !== adminToken) {
      return res.status(401).json({ error: "UNAUTHORIZED", message: "Invalid admin token" });
    }
    return next();
  };

  const buildIdempotencyResponse = (error: unknown) => {
    if (error instanceof AppError) {
      return { status: error.status, body: { error: error.code, message: error.message } };
    }
    return { status: 500, body: { error: "INTERNAL_SERVER_ERROR" } };
  };

  const withIdempotency = async <T>(
    key: string | undefined,
    scope: string,
    handler: () => Promise<{ status: number; body: T }>
  ): Promise<{ status: number; body: T }> => {
    if (!key) {
      return handler();
    }
    const existing = await deps.idempotency.find(key, scope);
    if (existing && existing.status !== 0) {
      return { status: existing.status, body: existing.response as T };
    }
    const reserved = await deps.idempotency.reserve(key, scope);
    if (!reserved) {
      const stored = await deps.idempotency.find(key, scope);
      if (stored && stored.status !== 0) {
        return { status: stored.status, body: stored.response as T };
      }
      throw new AppError("Idempotency key is already in progress", 409, "IDEMPOTENCY_IN_PROGRESS");
    }
    try {
      const result = await handler();
      await deps.idempotency.finalize(key, scope, result.status, result.body);
      return result;
    } catch (error) {
      const fallback = buildIdempotencyResponse(error);
      await deps.idempotency.finalize(key, scope, fallback.status, fallback.body);
      return fallback as { status: number; body: T };
    }
  };

  router.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  router.post("/admin/auction", adminGuard, async (req, res, next) => {
    try {
      const schema = z.object({
        title: z.string().min(1),
        totalItems: z.number().int().positive(),
        startNow: z.boolean().optional()
      });
      const input = schema.parse(req.body);
      const result = await deps.createAuction.execute(input);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/auction/:auctionId/start", adminGuard, async (req, res, next) => {
    try {
      const { auctionId } = z.object({ auctionId: objectIdSchema }).parse(req.params);
      const round = await deps.startRound.execute(auctionId);
      res.json(round);
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/round/:roundId/close", adminGuard, async (req, res, next) => {
    try {
      const { roundId } = z.object({ roundId: objectIdSchema }).parse(req.params);
      await deps.finishRound.execute(roundId);
      res.json({ status: "closed" });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/auction/:auctionId/stop", adminGuard, async (req, res, next) => {
    try {
      const { auctionId } = z.object({ auctionId: objectIdSchema }).parse(req.params);
      await deps.auctions.update(auctionId, { status: "finished" });
      const round = await deps.rounds.findActiveByAuction(auctionId);
      if (round) {
        const now = new Date();
        await deps.rounds.update(round.id, { endTime: now });
        await deps.finishRound.execute(round.id);
      }
      res.json({ status: "finished" });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/users/:userId/deposit", adminGuard, async (req, res, next) => {
    try {
      const params = z.object({ userId: z.string().min(1) }).parse(req.params);
      const body = z.object({ amount: z.number().finite().positive() }).parse(req.body);
      const idempotencyKey = req.header("x-idempotency-key") ?? undefined;
      const result = await withIdempotency(
        idempotencyKey,
        `deposit:${params.userId}`,
        async () => {
          await deps.creditWallet.execute(params.userId, body.amount, idempotencyKey);
          return { status: 201, body: { status: "credited" } };
        }
      );
      res.status(result.status).json(result.body);
    } catch (error) {
      next(error);
    }
  });

  router.get("/auction/:auctionId", async (req, res, next) => {
    try {
      const params = z.object({ auctionId: objectIdSchema }).parse(req.params);
      const auction = await deps.auctions.findById(params.auctionId);
      if (!auction) {
        throw new AppError("Auction not found", 404, "AUCTION_NOT_FOUND");
      }
      const round = await deps.rounds.findActiveByAuction(params.auctionId);
      res.json({
        auction,
        round,
        config: {
          minBidStepPercent: deps.minBidStepPercent
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/auction/:auctionId/leaderboard", async (req, res, next) => {
    try {
      const params = z.object({ auctionId: objectIdSchema }).parse(req.params);
      const query = z
        .object({
          limit: z.coerce.number().int().positive().max(deps.leaderboardSize).optional()
        })
        .parse(req.query);
      const size = query.limit ?? deps.leaderboardSize;
      const bids = await deps.leaderboard.getTopBids(params.auctionId, size);
      res.json({ bids });
    } catch (error) {
      next(error);
    }
  });

  router.get("/users/:userId/wallet", async (req, res, next) => {
    try {
      const params = z.object({ userId: z.string().min(1) }).parse(req.params);
      const wallet = await deps.wallets.findByUserId(params.userId);
      if (!wallet) {
        return res.json({ userId: params.userId, availableBalance: 0, lockedBalance: 0 });
      }
      res.json(wallet);
    } catch (error) {
      next(error);
    }
  });

  // Rate limiter: 100 bids per user per 10 seconds
  const bidRateLimiter = rateLimiter({
    windowMs: 10000,
    maxRequests: 100,
    keyPrefix: "ratelimit:bid",
    extractId: (req) => {
      try {
        const body = req.body as { userId?: string };
        return body?.userId ?? req.ip ?? null;
      } catch {
        return req.ip ?? null;
      }
    }
  });

  router.post("/auction/:auctionId/bid", bidRateLimiter, async (req, res, next) => {
    try {
      const params = z.object({ auctionId: objectIdSchema }).parse(req.params);
      const body = z
        .object({ userId: z.string().min(1), amount: z.number().finite().positive() })
        .parse(req.body);
      const idempotencyKey = req.header("x-idempotency-key") ?? undefined;
      const result = await withIdempotency(
        idempotencyKey,
        `place-bid:${params.auctionId}:${body.userId}`,
        async () => {
          const bid = await deps.placeBid.execute({
            auctionId: params.auctionId,
            userId: body.userId,
            amount: body.amount,
            idempotencyKey
          });
          return { status: 201, body: bid };
        }
      );
      res.status(result.status).json(result.body);
    } catch (error) {
      next(error);
    }
  });

  router.post("/bid/:bidId/withdraw", async (req, res, next) => {
    try {
      const params = z.object({ bidId: objectIdSchema }).parse(req.params);
      const body = z.object({ userId: z.string().min(1) }).parse(req.body);
      const idempotencyKey = req.header("x-idempotency-key") ?? undefined;
      const result = await withIdempotency(
        idempotencyKey,
        `withdraw:${params.bidId}`,
        async () => {
          await deps.withdrawFunds.execute(params.bidId, body.userId, idempotencyKey);
          return { status: 200, body: { status: "withdrawn" } };
        }
      );
      res.status(result.status).json(result.body);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
