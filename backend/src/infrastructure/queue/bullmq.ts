import { Queue, QueueEvents, Worker } from "bullmq";
import { RoundScheduler } from "../../application/ports/services";
import { env } from "../../config/env";

// Use URL-based connection to avoid ioredis version mismatch with bullmq's internal ioredis
const connection = { url: env.REDIS_URL };

const closeRoundQueue = new Queue("close-round", { connection });
const queueEvents = new QueueEvents("close-round", { connection });

export function getCloseRoundQueue(): Queue {
  return closeRoundQueue;
}

export class BullMqRoundScheduler implements RoundScheduler {
  async scheduleCloseRound(roundId: string, runAt: Date): Promise<void> {
    await closeRoundQueue.add(
      "close-round",
      { roundId },
      { jobId: roundId, delay: Math.max(0, runAt.getTime() - Date.now()) }
    );
  }

  async rescheduleCloseRound(roundId: string, runAt: Date): Promise<void> {
    // HIGH PRIORITY FIX: Safely handle job removal in any state
    // Job might be: waiting, delayed, active, completed, failed, or not exist
    try {
      const job = await closeRoundQueue.getJob(roundId);
      if (job) {
        const state = await job.getState();
        // Only remove if job is in a removable state
        if (state === "delayed" || state === "waiting") {
          await job.remove();
        }
        // If job is active/completed/failed, let it run - FinishRoundUseCase
        // has timing check that will reschedule if round was extended
      }
    } catch {
      // Job might have been removed by another process, ignore
    }

    // Always schedule new job (BullMQ will replace if same jobId exists)
    await closeRoundQueue.add(
      "close-round",
      { roundId },
      {
        jobId: `${roundId}-${runAt.getTime()}`, // Unique ID per reschedule
        delay: Math.max(0, runAt.getTime() - Date.now())
      }
    );
  }
}

export function startCloseRoundWorker(handler: (roundId: string) => Promise<void>): Worker {
  return new Worker(
    "close-round",
    async (job) => {
      await handler(job.data.roundId as string);
    },
    { connection }
  );
}

export async function waitForQueueReady(): Promise<void> {
  await queueEvents.waitUntilReady();
}
