import { TransactionManager, UserRepository, WalletRepository } from "../ports/repositories";
import { AppError } from "../errors";

export class CreditWalletUseCase {
  constructor(
    private readonly walletRepo: WalletRepository,
    private readonly userRepo: UserRepository,
    private readonly tx: TransactionManager
  ) {}

  async execute(userId: string, amount: number, idempotencyKey?: string): Promise<void> {
    if (amount <= 0) {
      throw new AppError("Amount must be positive", 400, "INVALID_AMOUNT");
    }
    await this.tx.withTransaction(async () => {
      await this.userRepo.createIfMissing({ id: userId, username: userId, walletAddress: "n/a" });
      await this.walletRepo.createIfMissing(userId);
      await this.walletRepo.updateBalances(userId, amount, 0, {
        reason: "credit",
        idempotencyKey
      });
    });
  }
}
