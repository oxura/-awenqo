import { describe, it, expect, beforeEach } from "vitest";
import { CreditWalletUseCase } from "../../src/application/usecases/creditWallet";
import {
  createMockStorage,
  createMockWalletRepository,
  createMockUserRepository,
  createMockTransactionManager,
  seedWallet,
  seedUser,
  MockStorage
} from "../mocks/repositories";

describe("CreditWalletUseCase", () => {
  let storage: MockStorage;
  let useCase: CreditWalletUseCase;
  let walletRepo: ReturnType<typeof createMockWalletRepository>;
  let userRepo: ReturnType<typeof createMockUserRepository>;
  let txManager: ReturnType<typeof createMockTransactionManager>;

  beforeEach(() => {
    storage = createMockStorage();
    walletRepo = createMockWalletRepository(storage);
    userRepo = createMockUserRepository(storage);
    txManager = createMockTransactionManager();

    useCase = new CreditWalletUseCase(walletRepo, userRepo, txManager);
  });

  describe("crediting existing wallet", () => {
    it("increases available balance", async () => {
      seedUser(storage, "user-1");
      seedWallet(storage, "user-1", 500, 100);

      await useCase.execute("user-1", 200);

      const wallet = await walletRepo.findByUserId("user-1");
      expect(wallet?.availableBalance).toBe(700); // 500 + 200
      expect(wallet?.lockedBalance).toBe(100); // unchanged
    });

    it("uses transaction manager", async () => {
      seedUser(storage, "user-1");
      seedWallet(storage, "user-1", 500, 0);

      await useCase.execute("user-1", 100);

      expect(txManager.withTransaction).toHaveBeenCalled();
    });
  });

  describe("crediting new user", () => {
    it("creates user and wallet if not exists", async () => {
      await useCase.execute("new-user", 1000);

      expect(userRepo.createIfMissing).toHaveBeenCalled();
      expect(walletRepo.createIfMissing).toHaveBeenCalled();

      const wallet = await walletRepo.findByUserId("new-user");
      expect(wallet?.availableBalance).toBe(1000);
      expect(wallet?.lockedBalance).toBe(0);
    });
  });

  describe("validation errors", () => {
    it("throws error for non-positive amount", async () => {
      await expect(
        useCase.execute("user-1", 0)
      ).rejects.toThrow("Amount must be positive");

      await expect(
        useCase.execute("user-1", -100)
      ).rejects.toThrow("Amount must be positive");
    });
  });

  describe("multiple credits", () => {
    it("accumulates balance correctly", async () => {
      seedUser(storage, "user-1");
      seedWallet(storage, "user-1", 0, 0);

      await useCase.execute("user-1", 100);
      await useCase.execute("user-1", 200);
      await useCase.execute("user-1", 50);

      const wallet = await walletRepo.findByUserId("user-1");
      expect(wallet?.availableBalance).toBe(350);
    });
  });
});
