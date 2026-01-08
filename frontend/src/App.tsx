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

  useEffect(() => {
    localStorage.setItem("userId", userId);
  }, [userId]);

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

    return () => {
      socketInstance.disconnect();
    };
  }, [auctionId]);

  async function fetchAuctionState() {
    if (!auctionId) {
      return;
    }
    const res = await fetch(`${API_URL}/api/auction/${auctionId}`);
    if (!res.ok) {
      return;
    }
    const data = await res.json();
    setAuction(data.auction);
    setRound(data.round);
  }

  async function fetchLeaderboard() {
    if (!auctionId) {
      return;
    }
    const res = await fetch(`${API_URL}/api/auction/${auctionId}/leaderboard?limit=100`);
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

  const timeLeft = useMemo(() => {
    if (!round) {
      return null;
    }
    const end = new Date(round.endTime).getTime();
    return Math.max(0, end - Date.now());
  }, [round]);

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

  const winning = useMemo(() => {
    if (!auction) {
      return false;
    }
    const top = leaderboard.slice(0, auction.totalItems);
    return top.some((bid) => bid.userId === userId);
  }, [leaderboard, auction, userId]);

  const minBid = useMemo(() => {
    if (leaderboard.length === 0) {
      return 1;
    }
    return Math.ceil(leaderboard[0].amount * 1.05);
  }, [leaderboard]);

  async function handlePlaceBid() {
    if (!auctionId) {
      return;
    }
    const amountValue = Number(bidAmount);
    if (!amountValue) {
      return;
    }
    await fetch(`${API_URL}/api/auction/${auctionId}/bid`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, amount: amountValue })
    });
    await fetchWallet();
  }

  async function handleCreateAuction() {
    const res = await fetch(`${API_URL}/api/admin/auction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: auctionTitle,
        totalItems: Number(totalItems),
        startNow: true
      })
    });
    if (!res.ok) {
      return;
    }
    const data = await res.json();
    setAuctionId(data.auction.id);
    setAuction(data.auction);
    setRound(data.round);
  }

  async function handleStartRound() {
    if (!auctionId) {
      return;
    }
    const res = await fetch(`${API_URL}/api/admin/auction/${auctionId}/start`, {
      method: "POST"
    });
    if (!res.ok) {
      return;
    }
    const data = await res.json();
    setRound(data);
  }

  async function handleStopAuction() {
    if (!auctionId) {
      return;
    }
    await fetch(`${API_URL}/api/admin/auction/${auctionId}/stop`, { method: "POST" });
    await fetchAuctionState();
  }

  async function handleDeposit() {
    if (!userId) {
      return;
    }
    await fetch(`${API_URL}/api/admin/users/${userId}/deposit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: Number(depositAmount) })
    });
    await fetchWallet();
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

      <main className="mx-auto mt-10 grid w-full max-w-6xl gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="flex flex-col gap-6">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur card-glow">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-blush">Auction</p>
                <h2 className="text-2xl font-semibold">{auction?.title || "No auction selected"}</h2>
                <p className="text-sm text-white/60">ID: {auction?.id || "-"}</p>
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
              <h3 className="text-lg font-semibold">Top Bids</h3>
              <button
                onClick={fetchLeaderboard}
                className="rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-widest"
              >
                Refresh
              </button>
            </div>
            <div className="mt-4 max-h-[360px] space-y-3 overflow-y-auto pr-2 scrollbar-hidden">
              {leaderboard.length === 0 && (
                <div className="rounded-2xl border border-white/10 bg-black/30 p-4 text-sm text-white/60">
                  No bids yet.
                </div>
              )}
              {leaderboard.map((bid, index) => (
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
              <label className="text-xs uppercase tracking-[0.3em] text-white/50">User ID</label>
              <input
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-2 text-sm"
              />
            </div>
            <div className="mt-4 flex gap-2">
              <input
                value={depositAmount}
                onChange={(event) => setDepositAmount(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-2 text-sm"
                placeholder="Deposit amount"
              />
              <button
                onClick={handleDeposit}
                className="rounded-2xl bg-neon px-4 py-2 text-xs font-semibold uppercase tracking-widest text-ink"
              >
                Deposit
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
                value={bidAmount}
                onChange={(event) => setBidAmount(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-2 text-sm"
                placeholder={`Bid amount (min ${minBid})`}
              />
              <button
                onClick={handlePlaceBid}
                className="rounded-2xl bg-ember px-4 py-2 text-xs font-semibold uppercase tracking-widest"
              >
                Bid
              </button>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
            <h3 className="text-lg font-semibold">Admin Controls</h3>
            <div className="mt-3 space-y-3">
              <input
                value={auctionTitle}
                onChange={(event) => setAuctionTitle(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-2 text-sm"
                placeholder="Auction title"
              />
              <input
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
                <label className="text-xs uppercase tracking-[0.3em] text-white/50">Auction ID</label>
                <input
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
