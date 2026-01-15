declare module "redlock" {
  import Redis from "ioredis";

  interface Lock {
    unlock(): Promise<void>;
  }

  interface Options {
    retryCount?: number;
    retryDelay?: number;
    retryJitter?: number;
  }

  class Redlock {
    constructor(clients: Redis[], options?: Options);
    lock(resource: string, ttl: number): Promise<Lock>;
  }

  export default Redlock;
}
