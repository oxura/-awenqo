import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

type LogLevel = "info" | "warn" | "error" | "debug";

type LogContext = Record<string, unknown>;

export type RequestWithId = Request & { requestId?: string };

const basePayload = (level: LogLevel, message: string, context: LogContext) => ({
  level,
  message,
  time: new Date().toISOString(),
  ...context
});

export function log(level: LogLevel, message: string, context: LogContext = {}) {
  const payload = basePayload(level, message, context);
  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export function logError(message: string, error: unknown, context: LogContext = {}) {
  if (error instanceof Error) {
    log("error", message, {
      ...context,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack
      }
    });
    return;
  }
  log("error", message, { ...context, error });
}

export function requestLogger(req: RequestWithId, res: Response, next: NextFunction) {
  const requestId = req.header("x-request-id") ?? randomUUID();
  req.requestId = requestId;
  res.setHeader("x-request-id", requestId);
  res.setHeader("x-server-time", Date.now().toString());

  const start = Date.now();
  log("info", "request.start", {
    requestId,
    method: req.method,
    path: req.originalUrl,
    ip: req.ip
  });

  res.on("finish", () => {
    log("info", "request.end", {
      requestId,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Date.now() - start
    });
  });

  next();
}
