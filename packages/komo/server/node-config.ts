// Startup checks and the client address for the Node runtime.
import { isIP } from "node:net";
import { ConfigError, HttpError, sitePattern } from "./validation";
import { paletteEnv } from "./public-env";

/** Checks PROJECTS, naming the project and origin that are wrong. */
export function checkProjects(value: string): void {
  let configured: unknown;
  try {
    configured = JSON.parse(value);
  } catch {
    throw new ConfigError("PROJECTS must be JSON on one line.");
  }
  if (!configured || typeof configured !== "object" || Array.isArray(configured))
    throw new ConfigError("PROJECTS must map project keys to repo and origins.");
  for (const [key, project] of Object.entries(configured)) {
    if (!project || typeof project.repo !== "string" || !Array.isArray(project.origins))
      throw new ConfigError(`PROJECTS.${key} needs a repo and a list of origins.`);
    for (const site of project.origins as unknown[]) {
      let normal: string;
      try {
        normal = sitePattern(site);
      } catch (error) {
        if (!(error instanceof HttpError)) throw error;
        throw new ConfigError(
          `PROJECTS.${key} has an invalid origin ${JSON.stringify(site)}. ${error.message}`,
        );
      }
      if (normal !== site)
        throw new ConfigError(
          `PROJECTS.${key} has origin ${JSON.stringify(site)}; write it as ${JSON.stringify(normal)}.`,
        );
    }
  }
}

// Each trusted proxy appends the address it received the request from to
// X-Forwarded-For, so with `hops` trusted proxies the client is the entry `hops`
// places from the right. Entries further left are whatever the client sent and
// are never trusted.

/** PALETTE_TRUSTED_PROXY_HOPS, or its older name PALETTE_PROXY_HOPS (each also read as KOMO_); 0 when unset. */
export function trustedProxyHops(settings: Record<string, string | undefined>): number {
  const env = paletteEnv(settings);
  const values = [
    ...new Set(
      [env.PALETTE_TRUSTED_PROXY_HOPS, env.PALETTE_PROXY_HOPS].filter(
        (value) => value !== undefined && value !== "",
      ),
    ),
  ];
  if (values.length > 1)
    throw new ConfigError(
      "PALETTE_TRUSTED_PROXY_HOPS and PALETTE_PROXY_HOPS are set to different values. Set one.",
    );
  if (values.length === 0) return 0;
  const hops = Number(values[0]);
  if (!/^\d$/.test(values[0]!) || hops > 8)
    throw new ConfigError("PALETTE_TRUSTED_PROXY_HOPS must be a whole number from 0 to 8.");
  return hops;
}

export function clientAddress(
  forwardedFor: string | string[] | undefined,
  hops: number,
  socketAddress: string | undefined,
): string {
  const fallback = socketAddress ?? "local";
  if (hops === 0) return fallback;
  const entries = (Array.isArray(forwardedFor) ? forwardedFor.join(",") : (forwardedFor ?? ""))
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  // Fewer entries than trusted proxies: something skipped a proxy. Use the peer.
  const ip = entries.length >= hops ? entries[entries.length - hops] : undefined;
  return ip && isIP(ip) ? ip : fallback;
}
