import { isEmoji } from "./emoji-sequence.js";
import { button, el, onPage } from "./dom.js";

import { emojiHistory, rankedEmoji } from "./emoji-history.js";

export function reactionPicker(
  root: ShadowRoot,
  trigger: HTMLButtonElement,
  onSelect: (emoji: string) => void,
  selected?: string,
  historyKey = "branch-comments:emoji:guest",
  emojiDataSource = "https://cdn.jsdelivr.net/npm/emoji-picker-element-data@1.8.0/en/emojibase/data.json",
) {
  const menu = el("div", "emoji-menu t-dropdown");
  menu.dataset.origin = "top-left";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Reactions");
  const abort = new AbortController();
  let closing = false;
  let customPanel: HTMLElement | null = null;
  const closeKeyboard = (immediate = false) => {
    const panel = customPanel;
    customPanel = null;
    if (!panel) return;
    panel.classList.remove("is-open");
    panel.classList.add("is-closing");
    if (immediate) panel.remove();
    else window.setTimeout(() => panel.remove(), 150);
  };
  const close = (immediate = false) => {
    if (closing && !immediate) return;
    closing = true;
    abort.abort();
    trigger.setAttribute("aria-expanded", "false");
    menu.classList.remove("is-open");
    menu.classList.add("is-closing");
    const duration =
      parseFloat(
        getComputedStyle(menu).getPropertyValue("--dropdown-close-dur")
      ) || 150;
    closeKeyboard(immediate);
    if (immediate) menu.remove();
    else window.setTimeout(() => menu.remove(), duration);
  };
  const items = rankedEmoji(emojiHistory(historyKey), selected).map(
    (emoji, index) => {
      const item = button(
        emoji,
        () => {
          close();
          onSelect(emoji);
        },
        "emoji-choice"
      );
      item.setAttribute("role", "menuitemradio");
      item.setAttribute("aria-checked", String(emoji === selected));
      item.style.setProperty("--emoji-index", String(index));
      menu.append(item);
      return item;
    }
  );
  const custom = button(
    "Choose another emoji",
    async () => {
      if (customPanel) return;
      const panel = (customPanel = el("div", "emoji-keyboard t-dropdown"));
      customPanel.setAttribute("role", "dialog");
      customPanel.setAttribute("aria-label", "Choose an emoji");
      const dismiss = button(
        "Close emoji keyboard",
        () => {
          closeKeyboard();
          custom.focus();
        },
        "icon emoji-keyboard-close",
        "close"
      );
      const status = el("span", "emoji-keyboard-status", "Loading…");
      customPanel.append(dismiss, status);
      root.append(customPanel);
      dismiss.focus({ preventScroll: true });
      const place = () => {
        if (!customPanel) return;
        const anchor = menu.getBoundingClientRect();
        customPanel.style.left = `${Math.max(8, Math.min(anchor.right - customPanel.offsetWidth, innerWidth - customPanel.offsetWidth - 8))}px`;
        customPanel.style.top = `${Math.max(8, Math.min(anchor.bottom + 8, innerHeight - customPanel.offsetHeight - 8))}px`;
      };
      place();
      customPanel.classList.add("is-open");
      try {
        const { default: Picker } =
          await import("emoji-picker-element/picker.js");
        if (closing || customPanel !== panel) return;
        const picker = new Picker({ dataSource: emojiDataSource });
        picker.i18n = {
          ...picker.i18n,
          networkErrorMessage: "Couldn’t load emojis. Close and try again.",
        };
        picker.classList.add("dark");
        picker.addEventListener("emoji-click", (event) => {
          const emoji = event.detail.unicode;
          if (!isEmoji(emoji)) return;
          close();
          onSelect(emoji);
        });
        status.replaceWith(picker);
        const styles = document.createElement("style");
        styles.textContent = `
          .pad-top, .skintone-button-wrapper, .skintone-list, .favorites, .indicator-wrapper { display: none !important; }
          .search-row { padding: 10px 44px 10px 10px; flex: none; }
          input.search { height: 30px; padding: 5px 9px; font-size: 12px; background: #ffffff08; }
          input.search::-webkit-search-cancel-button { display: none; }
          .category { font-size: 11px; padding: 6px 10px; color: #999; }
          .nav { order: 10; flex: none; padding: 6px; box-shadow: 0 -1px #ffffff0d; }
          .nav-button { position: relative; border-radius: 6px; }
          .nav-button + .nav-button::before { content: ""; position: absolute; left: 0; top: 8px; bottom: 8px; width: 1px; background: #ffffff0d; }
          .nav-button[aria-selected="true"] { background: #ffffff10; }
          .tabpanel { padding: 0 4px 6px; }
        `;
        picker.shadowRoot?.append(styles);
        place();
      } catch {
        status.textContent = "Couldn’t load emojis. Close and try again.";
      }
    },
    "emoji-choice",
    "plus"
  );
  custom.setAttribute("role", "menuitem");
  custom.setAttribute("aria-haspopup", "dialog");
  custom.style.setProperty("--emoji-index", String(items.length));
  menu.append(custom);
  items.push(custom);
  root.addEventListener(
    "keydown",
    (event) => {
      if (
        event instanceof KeyboardEvent &&
        event.key === "Escape" &&
        customPanel
      ) {
        event.preventDefault();
        event.stopPropagation();
        closeKeyboard();
        custom.focus();
      }
    },
    { signal: abort.signal }
  );
  root.append(menu);
  const rect = trigger.getBoundingClientRect();
  menu.dataset.placement =
    rect.right + 6 + menu.offsetWidth > innerWidth - 8 ? "below" : "right";
  menu.style.left = `${Math.max(8, Math.min(rect.right + 6, innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(innerHeight - menu.offsetHeight - 8, rect.right + 6 + menu.offsetWidth > innerWidth - 8 ? rect.bottom + 6 : rect.top - 4))}px`;
  trigger.setAttribute("aria-expanded", "true");
  void menu.offsetWidth;
  menu.classList.add("is-open");
  (
    items.find((item) => item.getAttribute("aria-checked") === "true") ??
    items[0]
  )?.focus({ preventScroll: true });
  onPage(
    menu,
    "pointerdown",
    (event) => {
      if (
        !event.composedPath().includes(menu) &&
        !(customPanel && event.composedPath().includes(customPanel))
      )
        close();
    },
    { signal: abort.signal }
  );
  document.addEventListener(
    "scroll",
    (event) => {
      if (!(customPanel && event.composedPath().includes(customPanel))) close();
    },
    {
      capture: true,
      signal: abort.signal,
    }
  );
  menu.addEventListener("keydown", (event) => {
    if (event.key === "Escape" || event.key === "Tab") {
      close();
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        trigger.focus();
      }
    }
    const index = items.indexOf(event.target as HTMLButtonElement);
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % items.length
        : event.key === "ArrowLeft"
          ? (index + items.length - 1) % items.length
          : -1;
    if (next >= 0) {
      event.preventDefault();
      items[next]?.focus();
    }
  });
  return close;
}
