import { describe, it, expect } from "vitest";
import { shouldExtendRound, extendRound } from "../../src/domain/services/antiSniping";

describe("antiSniping", () => {
    describe("shouldExtendRound", () => {
        it("returns true when within threshold", () => {
            const endTime = new Date("2024-01-01T10:00:00Z");
            const now = new Date("2024-01-01T09:59:30Z"); // 30 seconds before end
            const thresholdMs = 60000; // 60 seconds

            expect(shouldExtendRound(endTime, now, thresholdMs)).toBe(true);
        });

        it("returns false when outside threshold", () => {
            const endTime = new Date("2024-01-01T10:00:00Z");
            const now = new Date("2024-01-01T09:58:00Z"); // 2 minutes before end
            const thresholdMs = 60000; // 60 seconds

            expect(shouldExtendRound(endTime, now, thresholdMs)).toBe(false);
        });

        it("returns true exactly at threshold boundary", () => {
            const endTime = new Date("2024-01-01T10:00:00Z");
            const now = new Date("2024-01-01T09:59:00Z"); // exactly 60 seconds before
            const thresholdMs = 60000;

            expect(shouldExtendRound(endTime, now, thresholdMs)).toBe(true);
        });

        it("returns true when end time has passed", () => {
            const endTime = new Date("2024-01-01T10:00:00Z");
            const now = new Date("2024-01-01T10:00:30Z"); // 30 seconds after end
            const thresholdMs = 60000;

            expect(shouldExtendRound(endTime, now, thresholdMs)).toBe(true);
        });
    });

    describe("extendRound", () => {
        it("extends end time by specified duration", () => {
            const endTime = new Date("2024-01-01T10:00:00Z");
            const extensionMs = 120000; // 2 minutes

            const result = extendRound(endTime, extensionMs);

            expect(result.getTime()).toBe(new Date("2024-01-01T10:02:00Z").getTime());
        });

        it("does not mutate original date", () => {
            const endTime = new Date("2024-01-01T10:00:00Z");
            const originalTime = endTime.getTime();
            const extensionMs = 120000;

            extendRound(endTime, extensionMs);

            expect(endTime.getTime()).toBe(originalTime);
        });

        it("handles zero extension", () => {
            const endTime = new Date("2024-01-01T10:00:00Z");

            const result = extendRound(endTime, 0);

            expect(result.getTime()).toBe(endTime.getTime());
        });
    });
});
