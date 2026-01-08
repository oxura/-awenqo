export class AppError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400,
    public readonly code: string = "BAD_REQUEST"
  ) {
    super(message);
  }
}
