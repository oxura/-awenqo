import { Server } from "socket.io";
import http from "node:http";
import { RealtimePublisher } from "../../application/ports/services";

export function initSocketServer(server: http.Server, corsOrigin: string): Server {
  const io = new Server(server, {
    cors: {
      origin: corsOrigin === "*" ? true : corsOrigin,
      credentials: true
    }
  });

  io.on("connection", (socket) => {
    const auctionId = socket.handshake.query.auctionId as string | undefined;
    if (auctionId) {
      socket.join(`auction:${auctionId}`);
    }
    socket.on("join", (payload: { auctionId: string }) => {
      socket.join(`auction:${payload.auctionId}`);
    });
  });

  return io;
}

export class SocketPublisher implements RealtimePublisher {
  constructor(private readonly io: Server) {}

  publish(event: Parameters<RealtimePublisher["publish"]>[0]): void {
    const room = event.auctionId ? `auction:${event.auctionId}` : undefined;
    if (room) {
      if (event.type === "round:extended") {
        this.io.to(room).emit(event.type, { ...event, endTime: event.endTime.toISOString() });
        return;
      }
      this.io.to(room).emit(event.type, event);
    } else {
      this.io.emit(event.type, event);
    }
  }
}
