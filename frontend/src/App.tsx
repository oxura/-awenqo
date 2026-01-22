import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";
const WS_URL = import.meta.env.VITE_WS_URL || API_URL;

type Auction = {
  id: string;
  title: string;
  totalItems: number;
  status: string;
  currentRoundNumber: number;
};

type Round = {
  id: string;
  auctionId: string;
  roundNumber: number;
  startTime: string;
  endTime: string;
  status: string;
};

type Bid = {
  id: string;
  userId: string;
  amount: number;
  timestamp: string;
};

type RoundHistory = {
  roundId: string;
  roundNumber?: number;
  closedAt: string;
  winners: Bid[];
};

type Wallet = {
  userId: string;
  availableBalance: number;
  lockedBalance: number;
};

export default function App() {
  const [auctionId, setAuctionId] = useState(() => localStorage.getItem("auctionId") || "");
  const [auction, setAuction] = useState<Auction | null>(null);
  const [round, setRound] = useState<Round | null>(null);
  const [leaderboard, setLeaderboard] = useState<Bid[]>([]);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [userId, setUserId] = useState(() => localStorage.getItem("userId") || "user-001");
  const [bidAmount, setBidAmount] = useState("100");
  const [depositAmount, setDepositAmount] = useState("1000");
  const [auctionTitle, setAuctionTitle] = useState("Gift Drop");
  const [totalItems, setTotalItems] = useState("100");
  const [isExtended, setIsExtended] = useState(false);
  const [minBidStepPercent, setMinBidStepPercent] = useState(5);
  const [adminToken, setAdminToken] = useState(() => localStorage.getItem("adminToken") || "");
  const [alert, setAlert] = useState<{ type: "error" | "success"; message: string } | null>(null);
  const [leaderboardView, setLeaderboardView] = useState<"leaderboard" | "winners">("leaderboard");
  const [roundHistory, setRoundHistory] = useState<RoundHistory[]>([]);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [pendingBid, setPendingBid] = useState<Bid | null>(null);
  const [isBidPending, setIsBidPending] = useState(false);
  const [isDepositPending, setIsDepositPending] = useState(false);

  useEffect(() => {
    localStorage.setItem("userId", userId);
  }, [userId]);

  useEffect(() => {
    localStorage.setItem("adminToken", adminToken);
  }, [adminToken]);

  useEffect(() => {
    if (!auctionId) {
      return;
    }
    localStorage.setItem("auctionId", auctionId);
  }, [auctionId]);

  useEffect(() => {
    if (!auctionId) {
      return;
    }

    const socketInstance = io(WS_URL, { query: { auctionId } });
    socketInstance.on("leaderboard:update", (payload) => {
      setLeaderboard(
        (payload.bids || []).map((bid: any) => ({
          id: bid.id,
          userId: bid.userId,
          amount: bid.amount,
          timestamp: bid.timestamp
        }))
      );
    });
    socketInstance.on("round:extended", (payload) => {
      setRound((prev) => (prev ? { ...prev, endTime: payload.endTime } : prev));
      setIsExtended(true);
      setTimeout(() => setIsExtended(false), 1200);
    });
    socketInstance.on("round:closed", (payload) => {
      const winners = (payload?.winners || []).map((bid: any) => ({
        id: bid.id,
        userId: bid.userId,
        amount: bid.amount,
        timestamp: bid.timestamp
      }));
      if (payload?.roundId && winners.length > 0) {
        setRoundHistory((prev) => {
          const existing = prev.filter((entry) => entry.roundId !== payload.roundId);
          const entry: RoundHistory = {
            roundId: payload.roundId,
            roundNumber: round?.id === payload.roundId ? round?.roundNumber : undefined,
            closedAt: new Date().toISOString(),
            winners
          };
          return [entry, ...existing].slice(0, 6);
        });
      }
      fetchAuctionState();
      fetchLeaderboard();
      fetchWallet();
    });

    return () => {
      socketInstance.disconnect();
    };
  }, [auctionId]);

  async function fetchAuctionState() {
    if (!auctionId) {
      return;
    }
    const res = await fetch(`${API_URL}/api/auction/${auctionId}`);
    syncServerTime(res);
    if (!res.ok) {
      return;
    }
    const data = (await res.json()) as {
      auction: Auction;
      round: Round | null;
      config?: { minBidStepPercent?: number };
    };
    setAuction(data.auction);
    setRound(data.round);
    setMinBidStepPercent(data.config?.minBidStepPercent ?? 5);
  }

  async function fetchLeaderboard() {
    if (!auctionId) {
      return;
    }
    const res = await fetch(`${API_URL}/api/auction/${auctionId}/leaderboard?limit=100`);
    syncServerTime(res);
    if (!res.ok) {
      return;
    }
    const data = await res.json();
    setLeaderboard(
      (data.bids || []).map((bid: any) => ({
        id: bid.id,
        userId: bid.userId,
        amount: bid.amount,
        timestamp: bid.timestamp
      }))
    );
  }

  async function fetchWallet() {
    if (!userId) {
      return;
    }
    const res = await fetch(`${API_URL}/api/users/${userId}/wallet`);
    syncServerTime(res);
    if (!res.ok) {
      return;
    }
    const data = await res.json();
    setWallet(data);
  }

  useEffect(() => {
    fetchAuctionState();
    fetchLeaderboard();
    fetchWallet();
  }, [auctionId, userId]);

  useEffect(() => {
    if (!auctionId) {
      setRoundHistory([]);
      return;
    }
    const stored = localStorage.getItem(`roundHistory:${auctionId}`);
    if (stored) {
      try {
        setRoundHistory(JSON.parse(stored) as RoundHistory[]);
      } catch {
        setRoundHistory([]);
      }
    } else {
      setRoundHistory([]);
    }
  }, [auctionId]);

  useEffect(() => {
    if (!auctionId) {
      return;
    }
    localStorage.setItem(`roundHistory:${auctionId}`, JSON.stringify(roundHistory));
  }, [auctionId, roundHistory]);

  function buildAdminHeaders(extra: Record<string, string> = {}) {
    const headers: Record<string, string> = { ...extra };
    if (adminToken) {
      headers["x-admin-token"] = adminToken;
    }
    return headers;
  }

  async function parseResponse<T>(res: Response): Promise<T | null> {
    if (res.ok) {
      if (res.status === 204) {
        return null;
      }
      return (await res.json().catch(() => null)) as T | null;
    }
    const payload = await res.json().catch(() => null);
    throw new Error(payload?.message || payload?.error || "Request failed");
  }

  function syncServerTime(res: Response) {
    const header = res.headers.get("x-server-time");
    if (!header) {
      return;
    }
    const serverTime = Number(header);
    if (Number.isFinite(serverTime)) {
      setServerOffsetMs(serverTime - Date.now());
    }
  }

  const timeLeft = useMemo(() => {
    if (!round) {
      return null;
    }
    const end = new Date(round.endTime).getTime();
    const now = Date.now() + serverOffsetMs;
    return Math.max(0, end - now);
  }, [round, serverOffsetMs]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (round) {
        setRound((prev) => (prev ? { ...prev } : prev));
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [round]);

  const countdown = useMemo(() => {
    if (timeLeft === null) {
      return "--:--";
    }
    const totalSeconds = Math.floor(timeLeft / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }, [timeLeft]);

  const effectiveLeaderboard = useMemo(() => {
    if (!pendingBid) {
      return leaderboard;
    }
    const combined = [pendingBid, ...leaderboard.filter((bid) => bid.id !== pendingBid.id)];
    return combined.sort((a, b) => {
      if (b.amount !== a.amount) {
        return b.amount - a.amount;
      }
      return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    });
  }, [leaderboard, pendingBid]);

  const winning = useMemo(() => {
    if (!auction) {
      return false;
    }
    const top = effectiveLeaderboard.slice(0, auction.totalItems);
    return top.some((bid) => bid.userId === userId);
  }, [effectiveLeaderboard, auction, userId]);

  const minBid = useMemo(() => {
    if (effectiveLeaderboard.length === 0) {
      return 1;
    }
    return Math.ceil(effectiveLeaderboard[0].amount * (1 + minBidStepPercent / 100));
  }, [effectiveLeaderboard, minBidStepPercent]);

  async function handlePlaceBid() {
    if (!auctionId) {
      return;
    }
    if (isBidPending) {
      return;
    }
    const amountValue = Number(bidAmount);
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      setAlert({ type: "error", message: "Enter a valid bid amount." });
      return;
    }
    if (amountValue < minBid) {
      setAlert({ type: "error", message: `Bid must be at least ${minBid}.` });
      return;
    }
    setAlert(null);
    const previousWallet = wallet ? { ...wallet } : null;
    if (wallet) {
      setWallet({
        ...wallet,
        availableBalance: wallet.availableBalance - amountValue,
        lockedBalance: wallet.lockedBalance + amountValue
      });
    }
    const optimisticBid: Bid = {
      id: `pending-${Date.now()}`,
      userId,
      amount: amountValue,
      timestamp: new Date().toISOString()
    };
    setPendingBid(optimisticBid);
    setIsBidPending(true);
    try {
      const res = await fetch(`${API_URL}/api/auction/${auctionId}/bid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, amount: amountValue })
      });
      syncServerTime(res);
      await parseResponse(res);
      setAlert({ type: "success", message: "Bid placed." });
      await fetchWallet();
      await fetchLeaderboard();
    } catch (error) {
      if (previousWallet) {
        setWallet(previousWallet);
      }
      setAlert({ type: "error", message: error instanceof Error ? error.message : "Bid failed." });
    } finally {
      setPendingBid(null);
      setIsBidPending(false);
    }
  }

  async function handleCreateAuction() {
    const total = Number(totalItems);
    if (!Number.isFinite(total) || total <= 0) {
      setAlert({ type: "error", message: "Total winners must be a positive number." });
      return;
    }
    setAlert(null);
    try {
      const res = await fetch(`${API_URL}/api/admin/auction`, {
        method: "POST",
        headers: buildAdminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          title: auctionTitle,
          totalItems: total,
          startNow: true
        })
      });
      syncServerTime(res);
      const data = await parseResponse<{ auction: Auction; round?: Round }>(res);
      if (data?.auction) {
        setAuctionId(data.auction.id);
        setAuction(data.auction);
        setRound(data.round ?? null);
        setAlert({ type: "success", message: "Auction created." });
      }
    } catch (error) {
      setAlert({ type: "error", message: error instanceof Error ? error.message : "Create failed." });
    }
  }

  async function handleStartRound() {
    if (!auctionId) {
      return;
    }
    setAlert(null);
    try {
      const res = await fetch(`${API_URL}/api/admin/auction/${auctionId}/start`, {
        method: "POST",
        headers: buildAdminHeaders()
      });
      syncServerTime(res);
      const data = await parseResponse<Round>(res);
      if (data) {
        setRound(data);
        setAlert({ type: "success", message: "Round started." });
      }
    } catch (error) {
      setAlert({ type: "error", message: error instanceof Error ? error.message : "Start failed." });
    }
  }

  async function handleStopAuction() {
    if (!auctionId) {
      return;
    }
    setAlert(null);
    try {
      const res = await fetch(`${API_URL}/api/admin/auction/${auctionId}/stop`, {
        method: "POST",
        headers: buildAdminHeaders()
      });
      syncServerTime(res);
      await parseResponse(res);
      setAlert({ type: "success", message: "Auction stopped." });
      await fetchAuctionState();
      await fetchLeaderboard();
    } catch (error) {
      setAlert({ type: "error", message: error instanceof Error ? error.message : "Stop failed." });
    }
  }

  async function handleDeposit() {
    if (!userId) {
      return;
    }
    if (isDepositPending) {
      return;
    }
    const amountValue = Number(depositAmount);
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      setAlert({ type: "error", message: "Enter a valid deposit amount." });
      return;
    }
    setAlert(null);
    const previousWallet = wallet ? { ...wallet } : null;
    if (wallet) {
      setWallet({
        ...wallet,
        availableBalance: wallet.availableBalance + amountValue
      });
    }
    setIsDepositPending(true);
    try {
      const res = await fetch(`${API_URL}/api/admin/users/${userId}/deposit`, {
        method: "POST",
        headers: buildAdminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ amount: amountValue })
      });
      syncServerTime(res);
      await parseResponse(res);
      setAlert({ type: "success", message: "Wallet credited." });
      await fetchWallet();
    } catch (error) {
      if (previousWallet) {
        setWallet(previousWallet);
      }
      setAlert({ type: "error", message: error instanceof Error ? error.message : "Deposit failed." });
    } finally {
      setIsDepositPending(false);
    }
  }

  return (
    <div className="min-h-screen px-6 py-8 text-mist">
      <header className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-neon">CryptoBot</p>
            <h1 className="text-4xl font-bold">Telegram Gift Auctions</h1>
          </div>
          <div className="rounded-full border border-white/20 px-4 py-2 text-xs uppercase tracking-widest">
            Live Demo
          </div>
        </div>
      </header>

      {alert && (
        <div
          className={`mx-auto mt-6 w-full max-w-6xl rounded-2xl border px-4 py-3 text-sm ${
            alert.type === "error"
              ? "border-ember/60 bg-ember/10 text-ember"
              : "border-neon/60 bg-neon/10 text-neon"
          }`}
        >
          {alert.message}
        </div>
      )}

      <main className="mx-auto mt-6 grid w-full max-w-6xl gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="flex flex-col gap-6">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur card-glow">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-blush">Auction</p>
                <h2 className="text-2xl font-semibold">{auction?.title || "No auction selected"}</h2>
                <p className="text-sm text-white/60">ID: {auction?.id || "-"}</p>
                <p className="text-xs uppercase tracking-[0.3em] text-white/40">
                  Status: {auction?.status ?? "unknown"}
                </p>
              </div>
              <div
                className={`flex items-center gap-4 rounded-2xl border border-white/10 px-5 py-3 ${
                  isExtended ? "animate-pulse border-ember/60" : ""
                }`}
              >
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-white/50">Round</p>
                  <p className="text-lg font-semibold">#{round?.roundNumber ?? "-"}</p>
                </div>
                <div className="h-10 w-px bg-white/10" />
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-white/50">Time Left</p>
                  <p className="text-lg font-semibold text-neon">{countdown}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-white/50">Insights</p>
                <h3 className="text-lg font-semibold">
                  {leaderboardView === "leaderboard" ? "Leaderboard" : "Round Winners"}
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setLeaderboardView("leaderboard")}
                  className={`rounded-full border px-3 py-1 text-xs uppercase tracking-widest ${
                    leaderboardView === "leaderboard"
                      ? "border-neon/70 bg-neon/10 text-neon"
                      : "border-white/20 text-white/60"
                  }`}
                >
                  Leaderboard
                </button>
                <button
                  onClick={() => setLeaderboardView("winners")}
                  className={`rounded-full border px-3 py-1 text-xs uppercase tracking-widest ${
                    leaderboardView === "winners"
                      ? "border-ember/70 bg-ember/10 text-ember"
                      : "border-white/20 text-white/60"
                  }`}
                >
                  Winners
                </button>
              </div>
            </div>
            {leaderboardView === "leaderboard" ? (
              <div className="mt-4 max-h-[360px] space-y-3 overflow-y-auto pr-2 scrollbar-hidden">
                {effectiveLeaderboard.length === 0 && (
                  <div className="rounded-2xl border border-white/10 bg-black/30 p-4 text-sm text-white/60">
                    No bids yet.
                  </div>
                )}
                {effectiveLeaderboard.map((bid, index) => (
                  <div
                    key={bid.id}
                    className={`flex items-center justify-between rounded-2xl border border-white/10 px-4 py-3 ${
                      index < (auction?.totalItems ?? 0) ? "bg-emerald-500/10" : "bg-black/30"
                    }`}
                  >
                    <div>
                      <p className="text-sm font-semibold">#{index + 1}</p>
                      <p className="text-xs text-white/50">{bid.userId}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-semibold text-moss">{bid.amount.toLocaleString()}</p>
                      <p className="text-xs text-white/50">{new Date(bid.timestamp).toLocaleTimeString()}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4 max-h-[360px] space-y-3 overflow-y-auto pr-2 scrollbar-hidden">
                {roundHistory.length === 0 && (
                  <div className="rounded-2xl border border-white/10 bg-black/30 p-4 text-sm text-white/60">
                    No completed rounds yet.
                  </div>
                )}
                {roundHistory.map((entry) => (
                  <div key={entry.roundId} className="rounded-2xl border border-white/10 bg-black/30 p-4">
                    <div className="flex items-center justify-between text-xs uppercase tracking-[0.3em] text-white/50">
                      <span>
                        Round {entry.roundNumber ?? entry.roundId.slice(-4).toUpperCase()}
                      </span>
                      <span>{new Date(entry.closedAt).toLocaleTimeString()}</span>
                    </div>
                    <div className="mt-3 space-y-2">
                      {entry.winners.map((winner, index) => (
                        <div key={winner.id} className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-semibold text-moss">Winner #{index + 1}</p>
                            <p className="text-xs text-white/50">{winner.userId}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold text-neon">
                              {winner.amount.toLocaleString()}
                            </p>
                            <p className="text-xs text-white/40">
                              {new Date(winner.timestamp).toLocaleTimeString()}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <aside className="flex flex-col gap-6">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
            <h3 className="text-lg font-semibold">Your Wallet</h3>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-white/50">Available</p>
                <p className="text-xl font-semibold text-neon">
                  {wallet?.availableBalance?.toLocaleString() ?? "0"}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-white/50">Locked</p>
                <p className="text-xl font-semibold text-ember">
                  {wallet?.lockedBalance?.toLocaleString() ?? "0"}
                </p>
              </div>
            </div>
            <div className="mt-4">
              <label
                htmlFor="user-id"
                className="text-xs uppercase tracking-[0.3em] text-white/50"
              >
                User ID
              </label>
              <input
                id="user-id"
                name="userId"
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-2 text-sm"
              />
            </div>
            <div className="mt-4 flex gap-2">
              <input
                id="deposit-amount"
                name="depositAmount"
                value={depositAmount}
                onChange={(event) => setDepositAmount(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-2 text-sm"
                placeholder="Deposit amount"
              />
              <button
                onClick={handleDeposit}
                disabled={isDepositPending}
                className={`rounded-2xl bg-neon px-4 py-2 text-xs font-semibold uppercase tracking-widest text-ink ${
                  isDepositPending ? "cursor-not-allowed opacity-60" : ""
                }`}
              >
                {isDepositPending ? "Depositing..." : "Deposit"}
              </button>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
            <h3 className="text-lg font-semibold">Place Bid</h3>
            <p className="text-sm text-white/60">
              You are currently {winning ? "winning" : "outbid"}. Minimum bid: {minBid}.
            </p>
            <div className="mt-4 flex gap-2">
              <input
                id="bid-amount"
                name="bidAmount"
                value={bidAmount}
                onChange={(event) => setBidAmount(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-2 text-sm"
                placeholder={`Bid amount (min ${minBid})`}
              />
              <button
                onClick={handlePlaceBid}
                disabled={isBidPending}
                className={`rounded-2xl bg-ember px-4 py-2 text-xs font-semibold uppercase tracking-widest ${
                  isBidPending ? "cursor-not-allowed opacity-60" : ""
                }`}
              >
                {isBidPending ? "Placing..." : "Bid"}
              </button>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
            <h3 className="text-lg font-semibold">Admin Controls</h3>
            <div className="mt-3 space-y-3">
              <input
                id="admin-token"
                name="adminToken"
                value={adminToken}
                onChange={(event) => setAdminToken(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-2 text-sm"
                placeholder="Admin token (optional)"
              />
              <input
                id="auction-title"
                name="auctionTitle"
                value={auctionTitle}
                onChange={(event) => setAuctionTitle(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-2 text-sm"
                placeholder="Auction title"
              />
              <input
                id="total-winners"
                name="totalItems"
                value={totalItems}
                onChange={(event) => setTotalItems(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-2 text-sm"
                placeholder="Total winners"
              />
              <button
                onClick={handleCreateAuction}
                className="w-full rounded-2xl border border-neon/60 px-4 py-2 text-xs font-semibold uppercase tracking-widest"
              >
                Create & Start Auction
              </button>
              <div className="flex gap-2">
                <button
                  onClick={handleStartRound}
                  className="flex-1 rounded-2xl border border-white/20 px-4 py-2 text-xs uppercase tracking-widest"
                >
                  Start Round
                </button>
                <button
                  onClick={handleStopAuction}
                  className="flex-1 rounded-2xl border border-white/20 px-4 py-2 text-xs uppercase tracking-widest"
                >
                  Stop Auction
                </button>
              </div>
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="auction-id"
                  className="text-xs uppercase tracking-[0.3em] text-white/50"
                >
                  Auction ID
                </label>
                <input
                  id="auction-id"
                  name="auctionId"
                  value={auctionId}
                  onChange={(event) => setAuctionId(event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-2 text-sm"
                  placeholder="Paste auction ID"
                />
              </div>
              <button
                onClick={() => {
                  fetchAuctionState();
                  fetchLeaderboard();
                }}
                className="w-full rounded-2xl bg-white/10 px-4 py-2 text-xs uppercase tracking-widest"
              >
                Sync Data
              </button>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}
