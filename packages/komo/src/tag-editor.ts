// Loaded on demand so group tags add nothing to komo's initial bundle.

export const MAX_TAGS = 12;
const TAG = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,31}$/u;

export interface TagEditorOptions {
  tags: readonly string[];
  /** Tags already used in this project, offered while typing. */
  suggestions: readonly string[];
  onAdd(tag: string): void;
  onRemove(tag: string): void;
  /** An existing header action can replace the inline add button. */
  trigger?: HTMLButtonElement;
}

// Matches the dialog's own fields: muted fill, hairline inset, no accent ring.
// The option menu is attached to komo's root so no container can clip it. In
// the composer the tag row grows when the picker opens, instead of spilling over
// the text above it.
// Comments stay out of the string: they would ship in the bundle.
const css = `
.tag-row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; min-width: 0; min-height: 24px; font-size: 12px; }
.tag-row .tag-chip {
  display: inline-flex; align-items: center; gap: 2px; max-width: 160px; height: 22px; padding: 0 2px 0 7px;
  border-radius: 6px; font-weight: 500; line-height: 1; color: var(--accent, #bda6ef);
  background: color-mix(in srgb, var(--accent, #bda6ef) 14%, transparent);
}
.tag-row .tag-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tag-row .tag-chip button, .tag-row .tag-add {
  display: inline-flex; align-items: center; border: 0; padding: 0; color: inherit; background: none; cursor: pointer; font-family: inherit;
}
.tag-row .tag-chip button { justify-content: center; width: 18px; height: 18px; border-radius: 4px; opacity: .6; }
.tag-row .tag-chip button:hover, .tag-row .tag-chip button:focus-visible { opacity: 1; background: color-mix(in srgb, currentColor 16%, transparent); }
.tag-row .tag-add {
  gap: 4px; height: 22px; padding: 0 6px; border-radius: 6px; font-size: 12px; color: #858585;
  transition: color var(--duration-quick, 150ms), background var(--duration-quick, 150ms);
}
.tag-row .tag-add:hover, .tag-row .tag-add:focus-visible { color: #eee; background: #ffffff0d; }
.tag-row .tag-input {
  width: 96px; height: 24px; padding: 0 8px; border: 0; border-radius: 6px; outline: none;
  font-family: inherit; font-size: 12px; color: #eee; background: #ffffff07; box-shadow: inset 0 0 0 1px #ffffff05;
}
.tag-row .tag-input::placeholder { color: #858585; }
.tag-row .tag-input:focus { box-shadow: inset 0 0 0 1px #ffffff20; }
.tag-row .tag-input[aria-invalid="true"] { box-shadow: inset 0 0 0 1px #f28b8299; }
.tag-options {
  position: fixed; z-index: 40; pointer-events: auto; display: grid; gap: 1px; width: 220px; max-height: 220px; overflow: auto;
  padding: 4px; border-radius: 10px; background: #2a2a2a; box-shadow: 0 0 0 1px #ffffff14, 0 12px 32px #0007;
  font-size: 12px;
}
.tag-options:empty { display: none; }
.tag-option {
  display: flex; align-items: center; gap: 6px; min-height: 28px; padding: 0 8px; border-radius: 6px;
  color: #ddd; cursor: pointer; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
}
.tag-option[aria-selected="true"] { background: #ffffff14; color: #fff; }
.tag-option-hint, .tag-option-empty { color: #858585; }
.tag-option-empty { padding: 6px 8px; }
.tag-popover { position: fixed; z-index: 40; pointer-events: auto; width: 252px; box-sizing: border-box; padding: 8px; border-radius: 12px; background: #292929; color: #ddd; box-shadow: 0 0 0 1px #ffffff18, 0 12px 32px #0007; font-family: inherit; font-size: 12px; line-height: 1.4; overflow: auto; }
.tag-popover .tag-input { box-sizing: border-box; width: 100%; height: 32px; padding: 0 9px; border: 1px solid #ffffff18; border-radius: 7px; outline: none; background: #ffffff07; color: #eee; font: inherit; }
.tag-popover .tag-input:focus { border-color: #ffffff50; }
.tag-popover .tag-input:focus-visible { outline: 2px solid var(--accent, #bda6ef); outline-offset: 1px; }
.tag-popover .tag-input[aria-invalid=true] { border-color: #f28b82; }
.tag-popover-choices { display: grid; gap: 2px; max-height: 200px; overflow: auto; margin-top: 6px; }
.tag-popover-choice { display: flex; align-items: center; justify-content: flex-start; gap: 8px; min-height: 32px; width: 100%; box-sizing: border-box; border: 0; padding: 6px 8px; border-radius: 7px; background: none; color: #ddd; font: inherit; text-align: left; cursor: pointer; }
.tag-popover-choice:hover,.tag-popover-choice:focus-visible { background: #ffffff0d; outline: 1px solid #ffffff40; outline-offset: -1px; }
.tag-popover-choice[aria-pressed=true] { color: var(--accent, #bda6ef); }
.tag-popover-choice:disabled { opacity: .4; cursor: default; }
.tag-popover-check { width: 14px; flex: none; }
.tag-popover-label { min-width: 0; overflow-wrap: anywhere; }
.tag-popover-note { color: #aaa; padding: 8px; font-size: 11px; }
.new-comment-composer .draft-body:has(.tag-slot) { grid-template-rows: minmax(28px, auto) minmax(28px, auto); }
.new-comment-composer .draft-body .tag-slot { grid-row: 2; grid-column: 2; align-self: start; min-width: 0; padding-top: 2px; }
.new-comment-composer .draft-body:has(.tag-slot) .send { align-self: start; }
.new-comment-composer .draft-body:not(:has(.avatar)) .tag-slot { grid-column: 1; }
`;

/** Lowercase and validate a typed tag; returns null when it isn't a valid tag. */
export function normalizeTag(value: string): string | null {
  const tag = value.trim().replace(/^#/, "").toLocaleLowerCase("en-US");
  return TAG.test(tag) ? tag : null;
}

/** Render removable tag chips and an inline "Tag" input into `slot`. */
export function tagEditor(slot: HTMLElement, options: TagEditorOptions): void {
  if (options.trigger) return headerTagEditor(slot, options, options.trigger);
  let tags = [...options.tags];
  let typing = false;
  // Replacing the row can blur the old input; that isn't the person leaving the field.
  let swapping = false;
  const swap = (...nodes: Node[]) => {
    swapping = true;
    slot.replaceChildren(...nodes);
    swapping = false;
  };
  const listId = `komo-tags-${Math.random().toString(36).slice(2)}`;
  // The open menu lives at komo's root, outside the slot, and follows the input.
  let floating: HTMLElement | null = null;
  let follow = 0;
  const closeMenu = () => {
    cancelAnimationFrame(follow);
    floating?.remove();
    floating = null;
  };

  function render(focusInput = false) {
    closeMenu();
    slot.hidden = !!options.trigger && !tags.length && !typing;
    if (options.trigger) {
      const label = tags.length ? "Manage tags" : "Add tag";
      options.trigger.title = label;
      options.trigger.setAttribute("aria-label", label);
      options.trigger.setAttribute("aria-expanded", String(typing));
    }
    const style = document.createElement("style");
    style.textContent = css;
    const row = document.createElement("div");
    row.className = "tag-row";
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", "Tags");
    for (const tag of tags) {
      const chip = document.createElement("span");
      chip.className = "tag-chip";
      const label = document.createElement("span");
      label.textContent = `#${tag}`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Remove tag ${tag}`);
      remove.addEventListener("pointerdown", (event) => event.preventDefault());
      remove.addEventListener("click", () => {
        const focused = slot.getRootNode() instanceof ShadowRoot
          ? (slot.getRootNode() as ShadowRoot).activeElement === remove
          : document.activeElement === remove;
        const index = tags.indexOf(tag);
        tags = tags.filter((item) => item !== tag);
        options.onRemove(tag);
        render(typing);
        if (focused && !typing)
          (slot.querySelectorAll<HTMLButtonElement>(".tag-chip button")[Math.min(index, tags.length - 1)]
            ?? options.trigger ?? slot.querySelector<HTMLButtonElement>(".tag-add"))?.focus();
      });
      chip.append(label, remove);
      row.append(chip);
    }
    if (typing) {
      const input = document.createElement("input");
      input.className = "tag-input";
      input.placeholder = "Add tag…";
      input.maxLength = 33;
      input.autocomplete = "off";
      input.setAttribute("role", "combobox");
      input.setAttribute("aria-label", "Add tag");
      input.setAttribute("aria-autocomplete", "list");
      input.setAttribute("aria-controls", listId);
      const list = document.createElement("div");
      list.className = "tag-options";
      list.id = listId;
      list.setAttribute("role", "listbox");
      list.setAttribute("aria-label", "Tags");
      let choices: Array<{ tag: string; create: boolean }> = [];
      let active = -1;

      const choose = (tag: string) => {
        if (!tags.includes(tag) && tags.length < MAX_TAGS) {
          tags = [...tags, tag].sort();
          options.onAdd(tag);
        }
        // Stay open so several tags can be added in a row.
        typing = tags.length < MAX_TAGS;
        render(typing);
        if (!typing) options.trigger?.focus({ preventScroll: true });
      };
      const highlight = (index: number) => {
        active = index;
        list.querySelectorAll<HTMLElement>("[role=option]").forEach((option, i) => {
          option.setAttribute("aria-selected", String(i === index));
          if (i === index) option.scrollIntoView?.({ block: "nearest" });
        });
        if (index >= 0) input.setAttribute("aria-activedescendant", `${listId}-${index}`);
        else input.removeAttribute("aria-activedescendant");
      };
      const update = () => {
        const query = input.value.trim().replace(/^#/, "").toLocaleLowerCase("en-US");
        const typed = normalizeTag(input.value);
        const available = options.suggestions.filter((tag) => !tags.includes(tag));
        // Prefix matches first, then anything containing the text.
        const matches = query
          ? [...available.filter((tag) => tag.startsWith(query)), ...available.filter((tag) => !tag.startsWith(query) && tag.includes(query))]
          : available;
        choices = matches.map((tag) => ({ tag, create: false }));
        if (typed && !tags.includes(typed) && !available.includes(typed)) choices.push({ tag: typed, create: true });
        list.replaceChildren(
          ...choices.map(({ tag, create }, index) => {
            const option = document.createElement("div");
            option.id = `${listId}-${index}`;
            option.className = "tag-option";
            option.setAttribute("role", "option");
            if (create) option.append(Object.assign(document.createElement("span"), { className: "tag-option-hint", textContent: "Create" }));
            option.append(Object.assign(document.createElement("span"), { textContent: `#${tag}` }));
            option.addEventListener("click", () => choose(tag));
            option.addEventListener("pointermove", () => highlight(index));
            return option;
          }),
        );
        if (!choices.length)
          list.append(Object.assign(document.createElement("div"), {
            className: "tag-option-empty",
            textContent: query
              ? tags.includes(typed ?? "") ? "Already added" : "Use letters, numbers, spaces, . _ or -"
              : "Type to create a tag",
          }));
        input.setAttribute("aria-expanded", String(choices.length > 0));
        highlight(query && choices.length ? 0 : -1);
      };
      input.addEventListener("input", update);
      input.addEventListener("keydown", (event) => {
        // Keep Enter from submitting the surrounding comment form.
        event.stopPropagation();
        if (event.isComposing) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          if (!choices.length) return;
          const last = choices.length - 1;
          highlight(event.key === "ArrowDown" ? (active >= last ? 0 : active + 1) : active <= 0 ? last : active - 1);
        } else if (event.key === "Enter" || event.key === ",") {
          event.preventDefault();
          if (active >= 0 && choices[active]) choose(choices[active].tag);
          else if (input.value.trim()) {
            const typed = normalizeTag(input.value);
            if (typed) choose(typed);
            else input.setAttribute("aria-invalid", "true");
          } else {
            typing = false;
            render();
            options.trigger?.focus({ preventScroll: true });
          }
        } else if (event.key === "Escape") {
          event.preventDefault();
          typing = false;
          render();
          options.trigger?.focus({ preventScroll: true });
        } else if (event.key === "Backspace" && !input.value && tags.length) {
          const last = tags.at(-1)!;
          tags = tags.slice(0, -1);
          options.onRemove(last);
          render(true);
        }
      });
      input.addEventListener("input", () => input.removeAttribute("aria-invalid"));
      // Pressing the menu can still blur the input (it sits outside the dialog);
      // keep the menu open so the click lands, and return focus to the field.
      let pressing = false;
      list.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        pressing = true;
      });
      input.addEventListener("blur", () => {
        if (pressing) {
          pressing = false;
          requestAnimationFrame(() => input.isConnected && input.focus({ preventScroll: true }));
          return;
        }
        if (swapping || !input.isConnected || !typing) return;
        typing = false;
        render();
      });
      row.append(input);
      swap(style, row);
      // Attach the menu where it can't be clipped, then keep it beside the input.
      const root = slot.getRootNode();
      (root instanceof ShadowRoot ? root : document.body).append(list);
      floating = list;
      const place = () => {
        if (!input.isConnected) return closeMenu();
        const field = input.getBoundingClientRect();
        const height = list.offsetHeight;
        const below = window.innerHeight - field.bottom - 8;
        // Below the field when it fits; otherwise above, if there's more room there.
        const top = height + 4 <= below || field.top - 8 < below ? field.bottom + 4 : field.top - 4 - height;
        list.style.top = `${Math.max(8, top)}px`;
        list.style.left = `${Math.max(8, Math.min(field.left, window.innerWidth - list.offsetWidth - 8))}px`;
        follow = requestAnimationFrame(place);
      };
      update();
      place();
      if (focusInput || typing) input.focus({ preventScroll: true });
      return;
    }
    if (!options.trigger && tags.length < MAX_TAGS) {
      const add = document.createElement("button");
      add.type = "button";
      add.className = "tag-add";
      add.textContent = tags.length ? "+" : "+ Add tag";
      add.setAttribute("aria-label", "Add tag");
      add.addEventListener("click", () => {
        typing = true;
        render(true);
      });
      row.append(add);
    }
    swap(style, row);
  }
  render();
}

let closeActiveTags: (() => void) | undefined;

function headerTagEditor(slot: HTMLElement, options: TagEditorOptions, trigger: HTMLButtonElement) {
  let tags = [...options.tags];
  let popover: HTMLElement | undefined;
  let follow = 0;
  let listeners: AbortController | undefined;
  const id = `komo-tag-popover-${Math.random().toString(36).slice(2)}`;
  const close = (focus = false) => {
    cancelAnimationFrame(follow);
    listeners?.abort();
    popover?.remove();
    popover = undefined;
    trigger.setAttribute("aria-expanded", "false");
    if (closeActiveTags === dismiss) closeActiveTags = undefined;
    if (focus && trigger.isConnected) trigger.focus({ preventScroll: true });
  };
  const dismiss = () => close();
  const renderChips = () => {
    const style = document.createElement("style");
    style.textContent = css;
    const row = document.createElement("div");
    row.className = "tag-row";
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", "Tags");
    for (const tag of tags) {
      const chip = document.createElement("span");
      chip.className = "tag-chip";
      chip.title = tag;
      chip.append(Object.assign(document.createElement("span"), { textContent: `#${tag}` }));
      row.append(chip);
    }
    slot.replaceChildren(style, row);
    slot.hidden = !tags.length;
    const label = tags.length ? "Manage tags" : "Add tag";
    trigger.title = label;
    trigger.setAttribute("aria-label", label);
  };
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-controls", id);
  trigger.setAttribute("aria-expanded", "false");
  trigger.onclick = () => {
    if (popover) return close(true);
    const root = slot.getRootNode();
    const owner = root instanceof ShadowRoot ? root : document.body;
    closeActiveTags?.();
    closeActiveTags = dismiss;
    listeners = new AbortController();
    const signal = listeners.signal;
    popover = document.createElement("div");
    popover.className = "tag-popover";
    popover.id = id;
    popover.setAttribute("role", "dialog");
    popover.setAttribute("aria-label", "Manage tags");
    const input = document.createElement("input");
    input.className = "tag-input";
    input.type = "search";
    input.placeholder = "Search or create tag…";
    input.maxLength = 33;
    input.autocomplete = "off";
    input.setAttribute("aria-label", "Search or create tag");
    const choices = document.createElement("div");
    choices.className = "tag-popover-choices";
    choices.setAttribute("role", "group");
    choices.setAttribute("aria-label", "Tag choices");
    const note = document.createElement("div");
    note.className = "tag-popover-note";
    note.setAttribute("role", "status");
    popover.append(input, choices, note);
    owner.append(popover);
    trigger.setAttribute("aria-expanded", "true");
    const choose = (tag: string, create = false) => {
      if (tags.includes(tag)) { tags = tags.filter(t => t !== tag); options.onRemove(tag); }
      else if (tags.length < MAX_TAGS) { tags = [...tags, tag].sort(); options.onAdd(tag); }
      else return;
      if (create) input.value = "";
      renderChips(); update(tag);
      if (create) input.focus({ preventScroll: true });
    };
    const update = (focusedTag?: string) => {
      const query = input.value.trim().replace(/^#/, "").toLocaleLowerCase("en-US");
      const typed = normalizeTag(input.value);
      const all = [...new Set([...tags, ...options.suggestions])];
      const matches = all.filter(tag => tag.includes(query)).sort((a, b) => Number(tags.includes(b)) - Number(tags.includes(a)) || Number(b.startsWith(query)) - Number(a.startsWith(query)) || a.localeCompare(b));
      choices.replaceChildren();
      const addChoice = (tag: string, create: boolean) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "tag-popover-choice";
        button.dataset.tag = tag;
        button.setAttribute("aria-pressed", String(tags.includes(tag)));
        button.disabled = !tags.includes(tag) && tags.length >= MAX_TAGS;
        button.append(Object.assign(document.createElement("span"), { className: "tag-popover-check", textContent: tags.includes(tag) ? "✓" : create ? "+" : "" }), Object.assign(document.createElement("span"), { className: "tag-popover-label", textContent: `${create ? "Create " : ""}#${tag}` }));
        button.addEventListener("click", () => choose(tag, create));
        choices.append(button);
        if (focusedTag === tag) button.focus({ preventScroll: true });
      };
      matches.forEach(tag => addChoice(tag, false));
      if (typed && !all.includes(typed)) addChoice(typed, true);
      note.textContent = tags.length >= MAX_TAGS ? `Maximum ${MAX_TAGS} tags. Remove one to add another.` : !choices.children.length ? query ? "Use letters, numbers, spaces, . _ or -" : "Type to create a tag" : `${tags.length} of ${MAX_TAGS} tags selected`;
    };
    input.addEventListener("input", () => { input.removeAttribute("aria-invalid"); update(); });
    popover.addEventListener("keydown", event => {
      event.stopPropagation();
      if (event.isComposing) return;
      const buttons = [...choices.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      const active = root instanceof ShadowRoot ? root.activeElement : document.activeElement;
      if (event.key === "Escape") { event.preventDefault(); close(true); }
      else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const index = buttons.indexOf(active as HTMLButtonElement);
        (event.key === "ArrowDown" ? buttons[index + 1] ?? input : index > 0 ? buttons[index - 1] : input)?.focus({ preventScroll: true });
      } else if (event.key === "Enter" && event.target === input) {
        event.preventDefault();
        const tag = normalizeTag(input.value);
        if (tag && !tags.includes(tag)) choose(tag, true);
        else if (input.value.trim() && !tag) input.setAttribute("aria-invalid", "true");
      }
    });
    const outside = (event: Event) => {
      const path = event.composedPath();
      if (!path.includes(popover!) && !path.includes(trigger)) close();
    };
    document.addEventListener("pointerdown", outside, { capture: true, signal });
    document.addEventListener("focusin", outside, { signal });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
    }, { capture: true, signal });
    const place = () => {
      if (!trigger.isConnected || !slot.isConnected) return close();
      const anchor = trigger.getBoundingClientRect();
      if (anchor.bottom < 0 || anchor.top > innerHeight) return close();
      const bounds = trigger.closest(".dialog")?.getBoundingClientRect();
      const leftEdge = Math.max(8, (bounds?.left ?? 0) + 8);
      const rightEdge = Math.min(innerWidth - 8, (bounds?.right ?? innerWidth) - 8);
      const width = Math.max(0, Math.min(252, rightEdge - leftEdge));
      popover!.style.width = `${width}px`;
      popover!.style.maxHeight = `${Math.max(80, innerHeight - 16)}px`;
      const height = popover!.offsetHeight;
      const below = innerHeight - anchor.bottom - 8;
      const top = height + 6 <= below || anchor.top < below ? anchor.bottom + 6 : anchor.top - height - 6;
      popover!.style.left = `${Math.max(leftEdge, Math.min(anchor.right - width, rightEdge - width))}px`;
      popover!.style.top = `${Math.max(8, Math.min(top, innerHeight - height - 8))}px`;
      follow = requestAnimationFrame(place);
    };
    update(); place(); input.focus({ preventScroll: true });
  };
  renderChips();
}
