import http from "node:http";
import { env } from "./config/env";
import { connectMongo, ensureIndexes } from "./infrastructure/db/mongo";
import {
  MongoAuctionRepository,
  MongoBidRepository,
  MongoIdempotencyRepository,
  MongoRoundRepository,
  MongoTransactionManager,
  MongoUserRepository,
  MongoWalletRepository
} from "./infrastructure/repositories/mongoRepositories";
import { RedisLeaderboardCache } from "./infrastructure/cache/leaderboard";
import { RedisDistributedLock } from "./infrastructure/locks/redlock";
import { BullMqRoundScheduler, startCloseRoundWorker } from "./infrastructure/queue/bullmq";
import { createApp } from "./presentation/http/app";
import { initSocketServer, SocketPublisher } from "./presentation/ws/socket";
import { PlaceBidUseCase } from "./application/usecases/placeBid";
import { FinishRoundUseCase } from "./application/usecases/finishRound";
import { WithdrawFundsUseCase } from "./application/usecases/withdrawFunds";
import { CreateAuctionUseCase } from "./application/usecases/createAuction";
import { StartRoundUseCase } from "./application/usecases/startRound";
import { CreditWalletUseCase } from "./application/usecases/creditWallet";
import { log, logError } from "./infrastructure/logging/logger";

async function bootstrap() {
  await connectMongo();
  await ensureIndexes();

  const auctions = new MongoAuctionRepository();
  const rounds = new MongoRoundRepository();
  const bids = new MongoBidRepository();
  const users = new MongoUserRepository();
  const wallets = new MongoWalletRepository();
  const idempotency = new MongoIdempotencyRepository();
  const tx = new MongoTransactionManager();

  const leaderboard = new RedisLeaderboardCache();
  const lock = new RedisDistributedLock();
  const scheduler = new BullMqRoundScheduler();

  const server = http.createServer();
  const io = initSocketServer(server, env.CORS_ORIGIN);
  const realtime = new SocketPublisher(io);

  const placeBid = new PlaceBidUseCase(
    auctions,
    rounds,
    bids,
    wallets,
    users,
    tx,
    leaderboard,
    scheduler,
    lock,
    realtime,
    env.AUCTION_ANTI_SNIPING_THRESHOLD_MS,
    env.AUCTION_ANTI_SNIPING_EXTENSION_MS,
    env.AUCTION_TOP_N,
    env.AUCTION_MIN_BID_STEP_PERCENT
  );

  const finishRound = new FinishRoundUseCase(
    auctions,
    rounds,
    bids,
    wallets,
    tx,
    scheduler,
    leaderboard,
    realtime,
    env.AUCTION_ROUND_DURATION_MS,
    env.AUCTION_TOP_N
  );

  const withdrawFunds = new WithdrawFundsUseCase(
    bids,
    wallets,
    tx,
    leaderboard,
    realtime,
    env.AUCTION_TOP_N
  );

  const createAuction = new CreateAuctionUseCase(
    auctions,
    rounds,
    scheduler,
    env.AUCTION_ROUND_DURATION_MS
  );

  const startRound = new StartRoundUseCase(
    auctions,
    rounds,
    scheduler,
    env.AUCTION_ROUND_DURATION_MS
  );

  const creditWallet = new CreditWalletUseCase(wallets, users, tx);

  const app = createApp(
    {
      placeBid,
      finishRound,
      withdrawFunds,
      createAuction,
      startRound,
      creditWallet,
      auctions,
      rounds,
      bids,
      wallets,
      idempotency,
      leaderboard,
      leaderboardSize: env.AUCTION_TOP_N,
      minBidStepPercent: env.AUCTION_MIN_BID_STEP_PERCENT
    },
    env.CORS_ORIGIN
  );
  server.on("request", (req, res) => {
    if (req.url?.startsWith("/socket.io")) {
      return;
    }
    app(req, res);
  });

  startCloseRoundWorker(async (roundId) => {
    await finishRound.execute(roundId);
  });

  server.listen(env.PORT, () => {
    log("info", "server.started", { port: env.PORT });
  });
}

bootstrap().catch((error) => {
  logError("server.bootstrap_failed", error);
  process.exit(1);
});
