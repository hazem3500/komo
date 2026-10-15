import { initKomo } from "@hazem3500/komo";

// Same hosted project and preview-gateway rules as the landing page demo.
initKomo({
  endpoint: /^[a-z0-9-]+-komo-site\.off-brand\.workers\.dev$/.test(
    location.hostname,
  )
    ? location.origin
    : undefined,
  sessionDomain: "off-brand.workers.dev",
  sessionEndpoint: "https://komo.offbr.co",
  project: "komo-github-demo",
  repo: "tjcages/komo",
  autoHideDrawer: false,
});

// GitHub follows the OS theme (data-color-mode="auto"); this pins light or dark.
const root = document.documentElement;
const dark = matchMedia("(prefers-color-scheme: dark)");
const read = () => {
  try {
    return localStorage.getItem("komo-demo-theme");
  } catch {
    return null;
  }
};
const isDark = () => (root.dataset.colorMode === "auto" ? dark.matches : root.dataset.colorMode === "dark");
const icons = {
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
};
const toggle = document.createElement("button");
toggle.type = "button";
toggle.style.cssText =
  "position:fixed;left:16px;bottom:16px;z-index:2147483646;width:44px;height:44px;border-radius:50%;display:grid;place-items:center;cursor:pointer;padding:0;border:0;color:var(--fgColor-default,#1f2328);background:var(--bgColor-default,#fff);box-shadow:0 1px 2px rgba(0,0,0,.05),0 2px 4px rgba(0,0,0,.02),0 0 0 .5px var(--borderColor-default,rgba(0,0,0,.2));transition:transform 150ms cubic-bezier(.22,1,.36,1)";
toggle.onpointerdown = () => (toggle.style.transform = "scale(.98)");
toggle.onpointerup = toggle.onpointerleave = () => (toggle.style.transform = "");
const apply = (mode: string) => {
  root.dataset.colorMode = mode;
  const next = isDark() ? "light" : "dark";
  toggle.setAttribute("aria-label", `Switch to ${next} mode`);
  toggle.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${isDark() ? icons.sun : icons.moon}</svg>`;
};
toggle.onclick = () => {
  const mode = isDark() ? "light" : "dark";
  try {
    localStorage.setItem("komo-demo-theme", mode);
  } catch {}
  apply(mode);
};
apply(read() ?? "auto");
document.body.append(toggle);
