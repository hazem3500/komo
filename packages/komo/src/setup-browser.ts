import { initComments } from "./index.js";

const url = new URL(location.href);
const project = url.searchParams.get("project") || "_komo";
const invite =
  new URLSearchParams(url.hash.slice(1)).get("invite") || undefined;
const claimKey = invite ? undefined : url.hash.slice(1) || undefined;
history.replaceState(null, "", url.pathname + url.search);
initComments({
  // The API sits beside this page, under any path the server is served at.
  endpoint: location.origin + location.pathname.replace(/\/setup$/, ""),
  project,
  repo: project,
  branch: "shared",
  pageRoot: document.querySelector("main")!,
  onboarding: {
    code: url.searchParams.get("code") || undefined,
    workspace: url.searchParams.get("workspace") || undefined,
    site: url.searchParams.get("site") || undefined,
    claimKey,
    invite,
  },
});
