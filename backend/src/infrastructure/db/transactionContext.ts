import { AsyncLocalStorage } from "node:async_hooks";
import { ClientSession } from "mongodb";

const sessionStorage = new AsyncLocalStorage<ClientSession>();

export function runWithSession<T>(session: ClientSession, handler: () => Promise<T>): Promise<T> {
  return sessionStorage.run(session, handler);
}

export function getSession(): ClientSession | undefined {
  return sessionStorage.getStore();
}
