// Sign-in and session options shared by the Worker and Node runtimes. Each one
// is off by default. A trusted identity proxy (KOMO_PROXY_AUTH) forces the
// strict settings: reads need a session and guests are refused.
import { gcpIap } from "./iap";
import { ConfigError } from "./validation";

/** The account a sign-in proxy vouches for. */
export type ProxyIdentity = { id: string; email: string };

/** A proxy in front of Palette that authenticates each request it forwards. */
export interface ProxyAuthProvider {
  name: string;
  /** The OAuth provider whose sign-in route and account ids it takes over. */
  signIn: "google";
  /** Verifies the proxy's signed assertion. Throws a 401 HttpError otherwise. */
  identify(request: Request): Promise<ProxyIdentity>;
}

const PROVIDERS: Record<string, (audience: string) => ProxyAuthProvider> = {
  "gcp-iap": gcpIap,
};

export type AuthOptions = {
  proxy?: ProxyAuthProvider;
  /** Path the proxy protects for the sign-in handlers, or "". */
  signInPrefix: string;
  requireSessionForReads: boolean;
  allowGuests: boolean;
  /** Session lifetime cap in milliseconds; undefined keeps the default. */
  sessionMaxAge?: number;
};

type OptionEnv = Partial<Record<string, unknown>>;

/** One option under any of its names. Names that disagree are a mistake. */
function option(env: OptionEnv, names: string[]): string | undefined {
  const values = [
    ...new Set(
      names
        .map((name) => env[name])
        .filter((value) => value !== undefined && value !== null && value !== "")
        .map(String),
    ),
  ];
  if (values.length > 1)
    throw new ConfigError(`${names.join(" and ")} are set to different values. Set one.`);
  return values[0];
}

function flag(env: OptionEnv, name: string, fallback: boolean) {
  const value = option(env, [name]);
  if (value === undefined) return fallback;
  if (value !== "true" && value !== "false")
    throw new ConfigError(`${name} must be true or false.`);
  return value === "true";
}

/** Path prefix such as "/backoffice"; "" when unset. */
export function authPrefix(value: string | undefined): string {
  if (!value) return "";
  const prefix = value.replace(/\/+$/, "");
  if (
    !/^(\/[A-Za-z0-9._~-]+)+$/.test(prefix) ||
    prefix.split("/").some((segment) => segment === "." || segment === "..")
  )
    throw new ConfigError("KOMO_AUTH_PATH_PREFIX must be a path such as /backoffice.");
  return prefix;
}

function resolve(env: OptionEnv): AuthOptions {
  const name = option(env, ["KOMO_PROXY_AUTH"]);
  const audience = option(env, ["KOMO_PROXY_AUDIENCE", "KOMO_IAP_AUDIENCE"]);
  if (!name && option(env, ["KOMO_PROXY_AUDIENCE"]))
    throw new ConfigError("KOMO_PROXY_AUDIENCE needs KOMO_PROXY_AUTH, such as gcp-iap.");
  const provider = name ?? (audience ? "gcp-iap" : undefined);
  if (provider && !Object.hasOwn(PROVIDERS, provider))
    throw new ConfigError(
      `KOMO_PROXY_AUTH "${provider}" is not supported. Use one of: ${Object.keys(PROVIDERS).join(", ")}.`,
    );
  if (provider && !audience)
    throw new ConfigError(`KOMO_PROXY_AUTH=${provider} needs KOMO_PROXY_AUDIENCE.`);
  const proxy = provider ? PROVIDERS[provider](audience!) : undefined;

  const signInPrefix = authPrefix(option(env, ["KOMO_AUTH_PATH_PREFIX", "KOMO_AUTH_PREFIX"]));
  if (signInPrefix && !proxy)
    throw new ConfigError("KOMO_AUTH_PATH_PREFIX only applies with KOMO_PROXY_AUTH.");

  const days = option(env, ["KOMO_SESSION_MAX_AGE_DAYS"]);
  if (days !== undefined && !(/^\d{1,5}$/.test(days) && +days >= 1 && +days <= 36500))
    throw new ConfigError("KOMO_SESSION_MAX_AGE_DAYS must be a whole number of days from 1 to 36500.");

  // Parse both flags even when a proxy overrides them, so typos still fail.
  const requireSessionForReads = flag(env, "KOMO_REQUIRE_SESSION_FOR_READS", false);
  const allowGuests = flag(env, "KOMO_ALLOW_GUESTS", true);
  return {
    proxy,
    signInPrefix,
    requireSessionForReads: !!proxy || requireSessionForReads,
    allowGuests: !proxy && allowGuests,
    sessionMaxAge: days === undefined ? undefined : +days * 86400000,
  };
}

const resolved = new WeakMap<object, AuthOptions>();
/** The server's sign-in options. Throws ConfigError on an invalid value. */
export function authOptions(env: object): AuthOptions {
  let options = resolved.get(env);
  if (!options) resolved.set(env, (options = resolve(env as OptionEnv)));
  return options;
}

/** Split PUBLIC_URL into its origin and an optional path the app is served under. */
export function publicLocation(value: string): { origin: string; path: string } {
  const url = new URL(value);
  const path = url.pathname.replace(/\/+$/, "");
  if (
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    (path && !/^(\/[A-Za-z0-9._~-]+)+$/.test(path)) ||
    `${url.origin}${path}` !== value.replace(/\/+$/, "") ||
    (url.protocol !== "https:" &&
      !["localhost", "127.0.0.1"].includes(url.hostname))
  )
    throw new ConfigError(
      "PUBLIC_URL must be an HTTPS origin, optionally with a path such as https://example.com/komo (localhost allowed for development)",
    );
  return { origin: url.origin, path };
}
