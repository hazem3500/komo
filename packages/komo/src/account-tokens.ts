import { ApiError, type CommentsApi } from "./api.js";
import { button, el, icon, reducedMotion } from "./dom.js";

/** A personal access token as GET /account/tokens lists it. The secret is never part of it. */
export type ApiToken = {
  id: string;
  name: string;
  prefix: string;
  last4: string;
  scopes: string[];
  projects: string[] | null;
  createdAt: number;
  expiresAt: number | null;
  lastUsedAt: number | null;
  expired: boolean;
};
type TokenList = { tokens: ApiToken[]; projects: string[]; scopes: string[] };

const DAY = 864e5;
const EXPIRY: [string, number | null][] = [["7 days", 7], ["30 days", 30], ["90 days", 90], ["1 year", 365], ["Never", null]];
const SCOPE_LABEL: Record<string, string> = { "comments:read": "Read", "comments:write": "Write" };
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [["year", 365 * DAY], ["month", 30 * DAY], ["week", 7 * DAY], ["day", DAY], ["hour", 36e5], ["minute", 6e4]];

/** "3 days ago", "in 2 wk." — the exact time is in the tooltip and for screen readers. */
export function relativeTime(time: number, now = Date.now()) {
  const diff = time - now;
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "short" });
  for (const [unit, size] of UNITS)
    if (Math.abs(diff) >= size) return format.format(Math.round(diff / size), unit);
  return "just now";
}
const exactTime = (time: number) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(time);

const styles = `.account-layer .account.account-tokens{padding-top:16px;gap:16px}
.api-tokens-head{display:flex;align-items:center;gap:6px;margin-right:36px;min-height:30px}
.api-tokens-head h2{margin:0;font-size:15px;font-weight:500;letter-spacing:-.01em}
.api-tokens-head h2:focus{outline:none}
.account-layer .account .api-tokens-back{border-radius:8px;color:#bbb}
.api-tokens-back svg{rotate:90deg;width:16px;height:16px}
.api-tokens-back:hover{background:color-mix(in oklab,var(--mm-ink) 7%,transparent);color:var(--mm-ink)}
.api-tokens-lede,.api-tokens-note{margin:0;font-size:12px;line-height:1.5;color:#999}
.api-tokens-note code,.api-token-id{font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#aaa;overflow-wrap:anywhere}
.api-tokens-list{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.api-token,.api-tokens-sheet,.api-tokens-empty{display:grid;gap:8px;padding:14px;border-radius:14px;background:#ffffff05;box-shadow:inset 0 0 0 1px #ffffff09;font-size:12px;color:#ddd}
.api-tokens-empty{gap:4px;color:#999;text-align:center;padding:20px 14px}
.api-tokens-empty strong{color:#ddd;font-weight:500}
.api-token-row{display:flex;align-items:center;gap:8px;min-width:0}
.api-token-row strong{font-weight:500;color:#eee;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.api-token-chips{display:flex;flex-wrap:wrap;gap:4px}
.api-token-chip{padding:0 6px;border-radius:5px;background:color-mix(in oklab,var(--mm-ink) 9%,transparent);color:color-mix(in oklab,var(--mm-ink) 78%,transparent);font-size:10px;font-weight:500;line-height:18px;white-space:nowrap}
.api-token-chip[data-tone=warn]{background:#f1b77d1f;color:#f1b77d}
.api-token-meta{display:flex;flex-wrap:wrap;gap:2px 10px;margin:0;color:#909090;font-size:11px}
.api-token-meta div{display:flex;gap:4px}
.api-token-meta dd{margin:0;color:#bbb}
.api-token-meta time{cursor:default}
.account-layer .account .api-token-revoke{margin-left:auto;padding:4px 8px;min-height:26px;border-radius:7px;font-size:11px;background:transparent;color:#fda29b}
.api-token-revoke:hover,.api-tokens-actions .api-tokens-danger:hover{background:#fda29b14}
.api-token-confirm{display:grid;gap:8px;padding-top:8px;box-shadow:0 -1px #ffffff0b}
.api-token-confirm p,.api-tokens-sheet p{margin:0;line-height:1.5;color:#bbb}
.api-tokens-actions{display:flex;justify-content:flex-end;gap:8px}
.account-layer .account .api-tokens-actions button{width:auto;min-height:32px;padding:6px 12px;border-radius:9px;font-size:12px}
.account-layer .account .api-tokens-actions .api-tokens-danger{background:#fda29b1a;color:#fda29b}
.api-tokens-sheet{gap:14px;padding:16px}
.api-tokens-sheet h3{margin:0;font-size:13px;font-weight:500;color:#eee}
.api-tokens-sheet fieldset{border:0;margin:0;padding:0;display:grid;gap:8px;min-width:0}
.api-tokens-sheet legend{padding:0;margin-bottom:8px;font-size:12px;color:#999}
.account-layer .account .api-tokens-sheet input[type=text]{min-height:38px;padding:8px 10px;font-size:13px;border-radius:10px}
.api-tokens-choices{display:flex;flex-wrap:wrap;gap:6px}
.api-tokens-choice{position:relative;display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:9px;background:#ffffff06;box-shadow:inset 0 0 0 1px #ffffff0b;color:#bbb;cursor:pointer;font-size:12px;line-height:16px}
.api-tokens-choice:hover{color:#eee}
.account-layer .account .api-tokens-choice input{position:absolute;inset:0;width:100%;height:100%;min-height:0;margin:0;opacity:0;cursor:pointer}
.api-tokens-choice:has(input:checked){background:#bda6ef24;box-shadow:inset 0 0 0 1px #bda6ef80;color:#eee}
.api-tokens-choice:has(input:focus-visible){outline:2px solid #bda6ef;outline-offset:2px}
.api-tokens-choice small{color:#888;font-size:10px}
.api-tokens-sheet p.api-tokens-error,.api-tokens-error{margin:0;color:#fda29b;font-size:12px;line-height:1.5}
.api-tokens-error:empty{display:none}
.api-tokens-secret{display:flex;gap:8px;align-items:center}
.api-tokens-secret code{flex:1;min-width:0;padding:8px 10px;border-radius:10px;background:#00000040;box-shadow:inset 0 0 0 1px #ffffff0b;font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#eee;overflow-wrap:anywhere;user-select:all}
.account-layer .account .api-tokens-secret button{width:auto;min-height:34px;padding:0 12px;font-size:12px}
.api-tokens-secret svg{width:14px;height:14px}
.api-tokens-warning{display:flex;gap:7px;align-items:flex-start}
.api-tokens-warning svg{flex:none;width:13px;height:13px;margin-top:2px;color:#f1b77d}
.api-tokens-skeleton{height:84px;border-radius:14px;background:linear-gradient(90deg,#ffffff05,#ffffff0d,#ffffff05) 0 0/200% 100%;animation:api-tokens-shimmer 1.4s linear infinite}
@keyframes api-tokens-shimmer{to{background-position:-200% 0}}
@media (prefers-reduced-motion:reduce){.api-tokens-skeleton{animation:none}}`;

let views = 0;
export type TokenView = HTMLElement & { focusStart(): void; dispose(): void };

/**
 * The Account panel's API tokens view: list, create with a one-time reveal, and revoke.
 * Its node keeps its state across account re-renders; drop it to discard a shown secret.
 */
export function accountTokens(api: CommentsApi, project: string, back: () => void): TokenView {
  const root = el("div", "account account-tokens") as unknown as TokenView;
  root.setAttribute("role", "region");
  const style = el("style");
  style.textContent = styles;
  const head = el("div", "api-tokens-head");
  const backButton = button("Back to account", () => leave(), "icon api-tokens-back", "chevron");
  const title = el("h2", "", "API tokens");
  title.id = `api-tokens-${++views}`;
  title.tabIndex = -1;
  title.dataset.focusKey = "api-tokens-title";
  root.setAttribute("aria-labelledby", title.id);
  head.append(backButton, title);
  const lede = el("p", "api-tokens-lede", "Let bots and CI read or write comments as you. Treat tokens like passwords.");
  const live = el("p", "sr-only");
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  const top = el("div");
  const body = el("div");
  const tip = el("div", "morphing-menu__tooltip sidebar-tooltip");
  tip.setAttribute("aria-hidden", "true");
  root.append(style, head, lede, top, body, live, tip);
  backButton.dataset.focusKey = "api-tokens-back";

  let data: TokenList | null = null;
  let failure: ApiError | Error | null = null;
  let creating = false;
  let busy = false;
  let confirming = "";
  let secret: { token: string; item: ApiToken } | null = null;
  const rowErrors = new Map<string, string>();
  const announce = (text: string) => {
    live.textContent = "";
    setTimeout(() => (live.textContent = text), 30);
  };
  // Web Animations, like the account dialog's own entrance: nothing here needs Motion.
  const enter = (node: HTMLElement) => {
    if (!reducedMotion())
      node.animate([{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }], { duration: 250, easing: "cubic-bezier(.22,1,.36,1)" });
  };
  const focus = (key: string) =>
    requestAnimationFrame(() => root.querySelector<HTMLElement>(`[data-focus-key="${key}"]`)?.focus());
  const message = (error: unknown) =>
    error instanceof ApiError && error.status === 404
      ? "This komo server doesn’t support API tokens."
      : error instanceof Error
        ? error.message
        : "Something went wrong. Try again.";

  root.focusStart = () => focus("api-tokens-title");
  root.dispose = () => {
    hideTip();
    tip.remove();
  };
  const leave = () => {
    root.dispose();
    back();
  };
  root.addEventListener("keydown", (event) => {
    // komo's host isolation already marks Escape handled, so only its target matters here.
    if (event.key !== "Escape") return;
    event.stopPropagation();
    event.preventDefault();
    if (confirming) {
      const id = confirming;
      confirming = "";
      render();
      focus(`api-tokens-revoke-${id}`);
    } else if (secret) focus("api-tokens-done");
    else if (creating) closeForm();
    else leave();
  });

  // Exact times use the toolbar's tooltip surface; it lives at the shadow root.
  let tipTimer = 0;
  const hideTip = () => {
    clearTimeout(tipTimer);
    delete tip.dataset.open;
  };
  root.addEventListener("pointerover", (event) => {
    const target = (event.target as Element).closest?.<HTMLElement>("[data-tip]");
    if (!target) return hideTip();
    clearTimeout(tipTimer);
    tipTimer = window.setTimeout(() => {
      if (!target.isConnected) return;
      const rootNode = root.getRootNode();
      if (tip.parentNode !== rootNode && rootNode instanceof ShadowRoot) rootNode.append(tip);
      const box = target.getBoundingClientRect();
      tip.textContent = target.dataset.tip ?? "";
      const half = tip.offsetWidth / 2;
      tip.style.left = `${Math.max(8 + half, Math.min(document.documentElement.clientWidth - 8 - half, box.left + box.width / 2))}px`;
      tip.style.top = `${box.top - 8 - tip.offsetHeight}px`;
      tip.dataset.open = "true";
    }, tip.dataset.open ? 0 : 400);
  });
  root.addEventListener("pointerleave", root.dispose);
  root.addEventListener("pointerdown", root.dispose);

  const time = (label: string, value: number | null, empty: string) => {
    const item = el("div");
    const dd = el("dd");
    if (value === null) dd.textContent = empty;
    else {
      const node = el("time", "", relativeTime(value));
      node.dateTime = new Date(value).toISOString();
      node.dataset.tip = exactTime(value);
      dd.append(node, el("span", "sr-only", ` (${exactTime(value)})`));
    }
    item.append(el("dt", "", label), dd);
    return item;
  };
  const chip = (text: string, tone?: string, tipText?: string) => {
    const node = el("span", "api-token-chip", text);
    if (tone) node.dataset.tone = tone;
    if (tipText) node.dataset.tip = tipText;
    return node;
  };
  const projectLabel = (projects: string[] | null) =>
    !projects ? "All projects" : projects.length === 1 && projects[0] === project ? "This project" : projects.length === 1 ? projects[0] : `${projects.length} projects`;

  function renderToken(token: ApiToken) {
    const item = el("li", "api-token");
    item.dataset.token = token.id;
    const row = el("div", "api-token-row");
    const name = el("strong", "", token.name);
    name.id = `api-token-${token.id}-${title.id}`;
    item.setAttribute("aria-labelledby", name.id);
    row.append(name);
    if (token.expired) row.append(chip("Expired", "warn"));
    const revoke = button(`Revoke ${token.name}`, () => {
      confirming = token.id;
      rowErrors.delete(token.id);
      render();
      focus(`api-tokens-keep-${token.id}`);
    }, "api-token-revoke");
    revoke.textContent = "Revoke";
    revoke.removeAttribute("title");
    revoke.dataset.focusKey = `api-tokens-revoke-${token.id}`;
    revoke.disabled = confirming === token.id;
    row.append(revoke);
    const chips = el("div", "api-token-chips");
    for (const scope of token.scopes) chips.append(chip(SCOPE_LABEL[scope] ?? scope, "", scope));
    chips.append(chip(projectLabel(token.projects), "", token.projects?.join(", ") ?? "Every project you can access"));
    const meta = el("dl", "api-token-meta");
    meta.append(
      time("Created", token.createdAt, ""),
      time("Last used", token.lastUsedAt, "Never"),
      time(token.expired ? "Expired" : "Expires", token.expiresAt, "Never"),
    );
    item.append(row, el("code", "api-token-id", `${token.prefix}…${token.last4}`), chips, meta);
    const error = rowErrors.get(token.id);
    if (error) {
      const alert = el("p", "api-tokens-error", error);
      alert.setAttribute("role", "alert");
      item.append(alert);
    }
    if (confirming === token.id) {
      const confirm = el("div", "api-token-confirm");
      confirm.setAttribute("role", "group");
      confirm.setAttribute("aria-label", `Revoke ${token.name}`);
      const actions = el("div", "api-tokens-actions");
      const keep = button("Keep token", () => {
        confirming = "";
        render();
        focus(`api-tokens-revoke-${token.id}`);
      }, "secondary");
      keep.dataset.focusKey = `api-tokens-keep-${token.id}`;
      const remove = button("Revoke token", () => void revokeToken(token), "secondary api-tokens-danger");
      remove.dataset.focusKey = `api-tokens-confirm-${token.id}`;
      actions.append(keep, remove);
      confirm.append(el("p", "", "Anything using this token stops working right away. This can’t be undone."), actions);
      item.append(confirm);
      enter(confirm);
    }
    return item;
  }

  async function revokeToken(token: ApiToken) {
    if (!data) return;
    const list = data;
    const index = list.tokens.findIndex((item) => item.id === token.id);
    if (index < 0) return;
    // Optimistic: the row leaves now and returns if the server refuses.
    list.tokens.splice(index, 1);
    confirming = "";
    render();
    const next = list.tokens[index] ?? list.tokens[index - 1];
    focus(next ? `api-tokens-revoke-${next.id}` : "api-tokens-new");
    try {
      await api.request(`account/tokens/${encodeURIComponent(token.id)}`, "DELETE");
      announce(`Revoked ${token.name}.`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        announce(`Revoked ${token.name}.`);
        return;
      }
      if (data !== list) return;
      list.tokens.splice(Math.min(index, list.tokens.length), 0, token);
      rowErrors.set(token.id, `Couldn’t revoke: ${message(error)}`);
      render();
      announce(`Couldn’t revoke ${token.name}.`);
      focus(`api-tokens-revoke-${token.id}`);
    }
  }

  function closeForm() {
    creating = false;
    render();
    focus("api-tokens-new");
  }

  function renderForm(list: TokenList) {
    const form = el("form", "api-tokens-sheet");
    form.noValidate = true;
    form.setAttribute("aria-labelledby", `${title.id}-new`);
    const heading = el("h3", "", "New token");
    heading.id = `${title.id}-new`;
    const nameLabel = el("label", "account-name-label", "Name");
    const name = el("input");
    name.type = "text";
    name.maxLength = 60;
    name.required = true;
    name.autocomplete = "off";
    name.placeholder = "e.g. Deploy bot";
    name.dataset.focusKey = "api-tokens-name";
    nameLabel.append(name);
    const group = (legend: string, type: "checkbox" | "radio", key: string, options: [string, string, boolean, string?][]) => {
      const set = el("fieldset");
      const choices = el("div", "api-tokens-choices");
      for (const [value, label, checked, hint] of options) {
        const choice = el("label", "api-tokens-choice", label);
        const input = el("input");
        input.type = type;
        input.name = key;
        input.value = value;
        input.checked = checked;
        input.dataset.focusKey = `api-tokens-${key}-${value}`;
        if (hint) choice.append(el("small", "", hint));
        choice.prepend(input);
        choices.append(choice);
      }
      set.append(el("legend", "", legend), choices);
      return set;
    };
    const scopes = group("Access", "checkbox", "scope", list.scopes.map((scope) => [scope, SCOPE_LABEL[scope] ? `${SCOPE_LABEL[scope]} comments` : scope, scope === "comments:read"]));
    const local = list.projects.includes(project);
    const projects = group("Projects", "radio", "projects", [
      ...(local ? ([["this", "This project", true]] as [string, string, boolean][]) : []),
      ["all", "All your projects", !local],
    ]);
    const expiry = group("Expires", "radio", "expiry", EXPIRY.map(([label, days]) => [String(days), label, days === 30]));
    const error = el("p", "api-tokens-error");
    error.setAttribute("role", "alert");
    const actions = el("div", "api-tokens-actions");
    const cancel = button("Cancel", closeForm, "secondary");
    cancel.dataset.focusKey = "api-tokens-cancel";
    const submit = button("Create token", () => {}, "primary");
    submit.type = "submit";
    submit.dataset.focusKey = "api-tokens-create";
    actions.append(cancel, submit);
    form.append(heading, nameLabel, scopes, projects, expiry, error, actions);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy) return;
      const chosen = [...form.querySelectorAll<HTMLInputElement>("input[name=scope]:checked")].map((input) => input.value);
      const days = form.querySelector<HTMLInputElement>("input[name=expiry]:checked")?.value;
      const field = !name.value.trim() ? name : !chosen.length ? scopes.querySelector("input") : null;
      error.textContent = !name.value.trim() ? "Name your token." : !chosen.length ? "Choose read, write, or both." : "";
      if (field) {
        field.focus();
        return;
      }
      busy = true;
      submit.disabled = cancel.disabled = true;
      submit.setAttribute("aria-busy", "true");
      try {
        const created = await api.request<{ token: string; item: ApiToken }>("account/tokens", "POST", {
          name: name.value.trim(),
          scopes: chosen,
          expiresInDays: days && days !== "null" ? Number(days) : null,
          projects: form.querySelector<HTMLInputElement>("input[name=projects]:checked")?.value === "this" ? [project] : [],
        });
        if (data !== list) return;
        list.tokens.unshift(created.item);
        creating = false;
        secret = created;
        render();
        announce("Token created. Copy it now. You won’t see it again.");
        focus("api-tokens-copy");
      } catch (reason) {
        error.textContent =
          reason instanceof ApiError && reason.status === 429
            ? "You’ve created several tokens recently. Try again later."
            : message(reason);
        submit.focus();
      } finally {
        busy = false;
        submit.disabled = cancel.disabled = false;
        submit.removeAttribute("aria-busy");
      }
    });
    return form;
  }

  function renderSecret(value: { token: string; item: ApiToken }) {
    const sheet = el("section", "api-tokens-sheet");
    sheet.setAttribute("aria-labelledby", `${title.id}-secret`);
    const heading = el("h3", "", `Copy “${value.item.name}”`);
    heading.id = `${title.id}-secret`;
    const warning = el("p", "api-tokens-warning");
    warning.append(icon("info"), el("span", "", "You won’t see this token again. Store it in a secret manager, never in source control."));
    const row = el("div", "api-tokens-secret");
    const code = el("code", "", value.token);
    code.setAttribute("aria-label", "New API token");
    code.tabIndex = 0;
    code.dataset.focusKey = "api-tokens-secret";
    const copy = button("Copy token", async () => {
      try {
        await navigator.clipboard.writeText(value.token);
        copy.replaceChildren(icon("check"), document.createTextNode("Copied"));
        announce("Token copied to the clipboard.");
      } catch {
        getSelection()?.selectAllChildren(code);
        announce("Couldn’t copy. The token is selected; copy it with your keyboard.");
      }
    }, "primary");
    copy.replaceChildren(icon("copy"), document.createTextNode("Copy"));
    copy.removeAttribute("title");
    copy.dataset.focusKey = "api-tokens-copy";
    row.append(code, copy);
    const actions = el("div", "api-tokens-actions");
    const done = button("Done", () => {
      secret = null;
      render();
      focus("api-tokens-new");
    }, "secondary");
    done.dataset.focusKey = "api-tokens-done";
    actions.append(done);
    sheet.append(heading, warning, row, actions);
    return sheet;
  }

  let shown = "";
  function render() {
    hideTip();
    const state = !data ? (failure ? "error" : "loading") : secret ? "secret" : creating ? "form" : "list";
    const next: HTMLElement[] = [];
    if (data && state === "list") {
      const create = button("New token", () => {
        creating = true;
        render();
        focus("api-tokens-name");
      }, "secondary");
      create.replaceChildren(icon("plus"), document.createTextNode("New token"));
      create.removeAttribute("title");
      create.dataset.focusKey = "api-tokens-new";
      next.push(create);
    } else if (data && state === "form") next.push(renderForm(data));
    else if (secret) next.push(renderSecret(secret));
    if (state !== shown && next[0]) enter(next[0]);
    shown = state;
    top.replaceChildren(...next);
    body.setAttribute("aria-busy", String(!data && !failure));
    if (!data) {
      if (failure) {
        const alert = el("p", "api-tokens-error", message(failure));
        alert.setAttribute("role", "alert");
        const unsupported = failure instanceof ApiError && [403, 404].includes(failure.status);
        const retry = button("Try again", () => void load(), "secondary");
        retry.dataset.focusKey = "api-tokens-retry";
        body.replaceChildren(alert, ...(unsupported ? [] : [retry]));
      } else {
        const skeleton = el("div", "api-tokens-list");
        skeleton.setAttribute("aria-hidden", "true");
        skeleton.append(el("div", "api-tokens-skeleton"), el("div", "api-tokens-skeleton"));
        const status = el("span", "sr-only", "Loading API tokens");
        status.setAttribute("role", "status");
        body.replaceChildren(skeleton, status);
      }
      return;
    }
    if (!data.tokens.length) {
      const empty = el("p", "api-tokens-empty");
      empty.append(el("strong", "", "No tokens yet"), el("span", "", "Create one for a bot, a script, or a CI job."));
      body.replaceChildren(empty);
      return;
    }
    const list = el("ul", "api-tokens-list");
    list.setAttribute("aria-label", "Your API tokens");
    list.append(...data.tokens.map(renderToken));
    const note = el("p", "api-tokens-note");
    note.append(document.createTextNode("Use a token as "), el("code", "", "KOMO_TOKEN"), document.createTextNode(" with the komo CLI."));
    body.replaceChildren(list, note);
  }

  async function load() {
    failure = null;
    data = null;
    render();
    try {
      const result = await api.request<TokenList>("account/tokens");
      if (!Array.isArray(result.tokens) || !Array.isArray(result.projects)) throw new ApiError(0, "Couldn’t read your tokens. Try again.");
      data = { tokens: result.tokens, projects: result.projects, scopes: Array.isArray(result.scopes) ? result.scopes : ["comments:read", "comments:write"] };
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
    }
    render();
  }
  void load();
  return root;
}
