import type { CommentsOptions, Identity } from "./types.js";

type SetupResult = {
  project: string;
  repo: string;
  token: string;
  user: Identity;
};
const key = (options: CommentsOptions) =>
  `komo:setup:${options.endpoint}:${options.onboarding?.code}`;

/** Retain only public settings so a reload before CLI sync can resume commenting. */
export function rememberProject(options: CommentsOptions, result: SetupResult) {
  try {
    localStorage.setItem(
      key(options),
      JSON.stringify({ project: result.project, repo: result.repo })
    );
  } catch {
    /* Storage may be disabled. */
  }
}
export function resumeProject(options: CommentsOptions): CommentsOptions {
  if (!options.onboarding?.inProject) return options;
  try {
    const saved = JSON.parse(localStorage.getItem(key(options)) || "null");
    if (
      typeof saved?.project === "string" &&
      saved.project.startsWith("komo_") &&
      typeof saved.repo === "string"
    )
      return {
        ...options,
        project: saved.project,
        repo: saved.repo,
        onboarding: undefined,
      };
  } catch {
    /* Use the setup panel if storage is unavailable. */
  }
  return options;
}

/** Normalize pasted page URLs into exact site origins before owner approval. */
export function setupSites(value: string, currentOrigin: string): string[] {
  const sites = value
    .split(/\s+/)
    .filter(Boolean)
    .map((value) => {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        throw new Error(
          "Enter a full HTTPS site address, such as https://your-site.com."
        );
      }
      if (url.protocol !== "https:" || url.username || url.password)
        throw new Error(
          "Use HTTPS addresses for production and preview sites."
        );
      return url.origin;
    });
  const result = [...new Set([currentOrigin, ...sites])];
  if (result.length > 10) throw new Error("Connect up to ten sites at a time.");
  return result;
}

export function connectProject(
  options: CommentsOptions,
  signal: AbortSignal,
  sites: string[] = [location.origin]
): Promise<SetupResult> {
  const endpoint = new URL(options.endpoint);
  const url = new URL("/setup/connect", endpoint);
  url.searchParams.set("code", options.onboarding!.code!);
  url.searchParams.set("origin", location.origin);
  url.searchParams.set("sites", JSON.stringify(sites));
  const popup = window.open(
    "about:blank",
    "komo-connect",
    "popup,width=600,height=720"
  );
  if (!popup) return Promise.reject(new Error("Allow popups to set up inline feedback."));
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      window.removeEventListener("message", receive);
      signal.removeEventListener("abort", cancel);
      clearInterval(closed);
      clearTimeout(timeout);
      popup.close();
    };
    const fail = (message: string) => {
      cleanup();
      reject(new Error(message));
    };
    const cancel = () => fail("Setup closed. Reopen inline feedback to try again.");
    const receive = (event: MessageEvent) => {
      const result = event.data;
      if (
        event.origin !== endpoint.origin ||
        event.source !== popup ||
        result?.type !== "komo:setup" ||
        result.code !== options.onboarding?.code
      )
        return;
      if (
        typeof result.project !== "string" ||
        !/^komo_[a-f0-9]{32}$/.test(result.project) ||
        typeof result.repo !== "string" ||
        typeof result.token !== "string" ||
        !result.token ||
        result.user?.verified !== true ||
        typeof result.user.id !== "string" ||
        !result.user.id.startsWith("google:") ||
        typeof result.user.name !== "string"
      )
        return;
      cleanup();
      resolve(result);
    };
    const closed = window.setInterval(() => {
      if (popup.closed) fail("Sign-in closed. Try connecting again.");
    }, 1000);
    const timeout = window.setTimeout(
      () => fail("Setup expired. Run komo init again."),
      600000
    );
    window.addEventListener("message", receive);
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    else popup.location.href = url.href;
  });
}
