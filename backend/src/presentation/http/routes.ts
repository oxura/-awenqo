import { Router, Request, Response } from "express";
import { z } from "zod";
import { AppError } from "../../application/errors";
import { PlaceBidUseCase } from "../../application/usecases/placeBid";
import { FinishRoundUseCase } from "../../application/usecases/finishRound";
import { WithdrawFundsUseCase } from "../../application/usecases/withdrawFunds";
import { CreateAuctionUseCase } from "../../application/usecases/createAuction";
import { StartRoundUseCase } from "../../application/usecases/startRound";
import { CreditWalletUseCase } from "../../application/usecases/creditWallet";
import { AuctionRepository, BidRepository, RoundRepository, WalletRepository } from "../../application/ports/repositories";
import { LeaderboardCache } from "../../application/ports/services";
import { rateLimiter } from "./rateLimiter";

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
  leaderboard: LeaderboardCache;
  leaderboardSize: number;
};

export function createRouter(deps: RouterDependencies): Router {
  const router = Router();

  router.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  router.post("/admin/auction", async (req, res, next) => {
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

  router.post("/admin/auction/:auctionId/start", async (req, res, next) => {
    try {
      const { auctionId } = z.object({ auctionId: z.string().min(1) }).parse(req.params);
      const round = await deps.startRound.execute(auctionId);
      res.json(round);
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/round/:roundId/close", async (req, res, next) => {
    try {
      const { roundId } = z.object({ roundId: z.string().min(1) }).parse(req.params);
      await deps.finishRound.execute(roundId);
      res.json({ status: "closed" });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/auction/:auctionId/stop", async (req, res, next) => {
    try {
      const { auctionId } = z.object({ auctionId: z.string().min(1) }).parse(req.params);
      await deps.auctions.update(auctionId, { status: "finished" });
      res.json({ status: "finished" });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/users/:userId/deposit", async (req, res, next) => {
    try {
      const params = z.object({ userId: z.string().min(1) }).parse(req.params);
      const body = z.object({ amount: z.number().positive() }).parse(req.body);
      await deps.creditWallet.execute(params.userId, body.amount);
      res.status(201).json({ status: "credited" });
    } catch (error) {
      next(error);
    }
  });

  router.get("/auction/:auctionId", async (req, res, next) => {
    try {
      const params = z.object({ auctionId: z.string().min(1) }).parse(req.params);
      const auction = await deps.auctions.findById(params.auctionId);
      if (!auction) {
        throw new AppError("Auction not found", 404, "AUCTION_NOT_FOUND");
      }
      const round = await deps.rounds.findActiveByAuction(params.auctionId);
      res.json({ auction, round });
    } catch (error) {
      next(error);
    }
  });

  router.get("/auction/:auctionId/leaderboard", async (req, res, next) => {
    try {
      const params = z.object({ auctionId: z.string().min(1) }).parse(req.params);
      const limit = z
        .object({ limit: z.string().optional() })
        .parse(req.query).limit;
      const size = limit ? Math.min(Number(limit), deps.leaderboardSize) : deps.leaderboardSize;
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
      const params = z.object({ auctionId: z.string().min(1) }).parse(req.params);
      const body = z.object({ userId: z.string().min(1), amount: z.number().positive() }).parse(req.body);
      const bid = await deps.placeBid.execute({
        auctionId: params.auctionId,
        userId: body.userId,
        amount: body.amount
      });
      res.status(201).json(bid);
    } catch (error) {
      next(error);
    }
  });

  router.post("/bid/:bidId/withdraw", async (req, res, next) => {
    try {
      const params = z.object({ bidId: z.string().min(1) }).parse(req.params);
      const body = z.object({ userId: z.string().min(1) }).parse(req.body);
      await deps.withdrawFunds.execute(params.bidId, body.userId);
      res.json({ status: "withdrawn" });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
