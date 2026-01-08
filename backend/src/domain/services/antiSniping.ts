export function shouldExtendRound(endTime: Date, now: Date, thresholdMs: number): boolean {
  return endTime.getTime() - now.getTime() <= thresholdMs;
}

export function extendRound(endTime: Date, extensionMs: number): Date {
  return new Date(endTime.getTime() + extensionMs);
}
