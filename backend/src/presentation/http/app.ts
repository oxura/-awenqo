import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { ZodError } from "zod";
import { AppError } from "../../application/errors";
import { createRouter, RouterDependencies } from "./routes";

export function createApp(deps: RouterDependencies, corsOrigin: string) {
  const app = express();
  app.use(express.json());
  app.use(cors({ origin: corsOrigin === "*" ? true : corsOrigin }));

  app.use("/api", createRouter(deps));

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: "VALIDATION_ERROR", details: err.flatten() });
    }
    if (err instanceof AppError) {
      return res.status(err.status).json({ error: err.code, message: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  });

  return app;
}
