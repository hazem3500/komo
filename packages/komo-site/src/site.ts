import "./site.css";
import "./theme.css";
import "./logo";
import { createTryCursors } from "./try-cursors";
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const check =
  document.querySelector<HTMLTemplateElement>("#check-icon")!.innerHTML;
document
  .querySelectorAll<HTMLButtonElement>("[data-copy]")
  .forEach((button) => {
    // Text buttons swap only their icon, matching the code copy buttons.
    const icon = button.querySelector<HTMLElement>(".glyph") ?? button;
    const original = icon.innerHTML;
    let timer: number;
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy!);
        clearTimeout(timer);
        icon.innerHTML = check;
        button.classList.remove("uncopying", "restored");
        button.classList.add("copied");
        document.querySelector("#copy-status")!.textContent = "Copied";
        // Shrink the check out, then pop the copy icon back in.
        timer = window.setTimeout(() => {
          button.classList.add("uncopying");
          timer = window.setTimeout(
            () => {
              icon.innerHTML = original;
              button.classList.remove("copied", "uncopying");
              button.classList.add("restored");
            },
            reduceMotion.matches ? 0 : 180,
          );
        }, 1800);
      } catch {
        document.querySelector("#copy-status")!.textContent =
          "Copy unavailable. Select the code to copy it.";
      }
    });
  });
const toggle = document.querySelector<HTMLButtonElement>(".nav-toggle");
const navigation = document.querySelector<HTMLElement>("#navigation");
const compactNav = matchMedia("(max-width: 700px)");
function setNavigation(open: boolean, restoreFocus = false) {
  if (!toggle || !navigation) return;
  if (open) {
    const rect = toggle.getBoundingClientRect();
    navigation.style.setProperty("--nav-top", `${rect.top}px`);
  }
  toggle.setAttribute("aria-expanded", String(open));
  toggle.setAttribute(
    "aria-label",
    open ? "Close navigation" : "Open navigation",
  );
  document.body.classList.toggle("nav-open", open);
  navigation.inert = compactNav.matches && !open;
  if (open)
    navigation
      .querySelector<HTMLAnchorElement>("nav a")
      ?.focus({ preventScroll: true });
  else if (restoreFocus) toggle.focus({ preventScroll: true });
}
toggle?.addEventListener("click", () =>
  setNavigation(toggle.getAttribute("aria-expanded") !== "true"),
);
document
  .querySelector("[data-nav-close]")
  ?.addEventListener("click", () => setNavigation(false, true));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && document.body.classList.contains("nav-open"))
    setNavigation(false, true);
});
document.addEventListener("pointerdown", (event) => {
  if (!compactNav.matches || !document.body.classList.contains("nav-open"))
    return;
  const target = event.target as Node;
  if (!navigation?.contains(target) && !toggle?.contains(target))
    setNavigation(false);
});
document.addEventListener("focusin", (event) => {
  if (
    compactNav.matches &&
    document.body.classList.contains("nav-open") &&
    !navigation?.contains(event.target as Node) &&
    !toggle?.contains(event.target as Node)
  )
    setNavigation(false);
});
navigation?.addEventListener("click", (event) => {
  if (
    !compactNav.matches ||
    !document.body.classList.contains("nav-open") ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
    return;
  const link = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
  if (!link || link.target === "_blank" || link.hasAttribute("download"))
    return;
  const url = new URL(link.href);
  const path = (value: string) => value.replace(/\/+$/, "") || "/";
  if (
    url.origin === location.origin &&
    path(url.pathname) === path(location.pathname) &&
    url.search === location.search &&
    url.hash === location.hash
  ) {
    event.preventDefault();
    setNavigation(false, true);
  }
});
compactNav.addEventListener("change", () => setNavigation(false));
setNavigation(false);

import { initKomo } from "@hazem3500/komo";
import { mountScene } from "./scene";
import { mountFeatureScenes } from "./feature-scenes";
import { mountUsageScene } from "./usage-scene";
import { mountConnectScene } from "./connect-scene";

function mountFrameworkTabs() {
  document
    .querySelectorAll<HTMLElement>("[data-framework-tabs]")
    .forEach((tabs) => {
      const buttons = Array.from(
        tabs.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
      );
      const panels = Array.from(
        tabs.querySelectorAll<HTMLElement>('[role="tabpanel"]'),
      );
      const select = (index: number) => {
        buttons.forEach((button, i) => {
          const active = i === index;
          button.setAttribute("aria-selected", String(active));
          button.tabIndex = active ? 0 : -1;
          const panel = panels[i]!;
          panel.hidden = !active;
          panel.setAttribute("aria-hidden", String(!active));
        });
      };
      buttons.forEach((button, index) => {
        button.addEventListener("click", () => select(index));
        button.addEventListener("keydown", (event) => {
          const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
          if (!keys.includes(event.key)) return;
          event.preventDefault();
          const length = buttons.length;
          const next =
            event.key === "ArrowRight"
              ? (index + 1) % length
              : event.key === "ArrowLeft"
                ? (index - 1 + length) % length
                : event.key === "Home"
                  ? 0
                  : length - 1;
          buttons[next]!.focus();
          select(next);
        });
      });
    });
}

mountScene();
mountFeatureScenes();
mountUsageScene();
mountConnectScene();
mountFrameworkTabs();
const review = initKomo({
  // Preview API versions are selected by the same-origin Worker gateway.
  endpoint: /^[a-z0-9-]+-komo-site\.off-brand\.workers\.dev$/.test(
    location.hostname,
  )
    ? location.origin
    : undefined,
  // These previews and the gateway are owned by us and use the same API.
  sessionDomain: "off-brand.workers.dev",
  sessionEndpoint: "https://komo.offbr.co",
  project: "komo-landing-demo",
  repo: "tjcages/komo",
  autoHideDrawer: false,
  sidebar: "edge",
  drawerContainer: document.querySelector<HTMLElement>("#main") ?? undefined,
  pageRoot: document.querySelector<HTMLElement>("#site-content") ?? undefined,
});
document.querySelectorAll("[data-try-komo]").forEach((button) => {
  button.addEventListener("click", () => {
    const selector = button.getAttribute("data-try-komo");
    const target = document.querySelector(selector || "#try-komo");
    if (!target) return;
    if (!selector)
      target.scrollIntoView({ block: "center", behavior: "instant" });
    review.comment(target);
  });
});

const tryBlock = document.querySelector<HTMLElement>("#try-komo");
if (tryBlock) {
  const cursors = createTryCursors(tryBlock);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let visible = false;
  const syncMotion = () => {
    cursors.setPlaying(visible && !document.hidden && !reduced.matches);
  };
  new IntersectionObserver(([entry]) => {
    visible = !!entry?.isIntersecting;
    syncMotion();
  }).observe(tryBlock);
  document.addEventListener("visibilitychange", syncMotion);
  reduced.addEventListener("change", syncMotion);
  syncMotion();
}
