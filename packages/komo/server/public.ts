import type {
  ExportedHandlerFetchHandler,
  ExportedHandlerScheduledHandler,
} from "@cloudflare/workers-types";
import type { ServerEnv } from "./public-env.js";

export type { ServerEnv } from "./public-env.js";
declare const server: {
  fetch: ExportedHandlerFetchHandler<ServerEnv>;
  scheduled: ExportedHandlerScheduledHandler<ServerEnv>;
};
export default server;

export declare function drainWebhooks(env: Pick<ServerEnv, "DB" | "PALETTE_WEBHOOK_KEYS" | "PALETTE_WEBHOOK_SEND">): Promise<void>;
