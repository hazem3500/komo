// Loaded on demand so group tags add nothing to komo's initial bundle.

export const MAX_TAGS = 12;
const TAG = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,31}$/u;

export interface TagEditorOptions {
  tags: readonly string[];
  /** Tags already used in this project, offered while typing. */
  suggestions: readonly string[];
  onAdd(tag: string): void;
  onRemove(tag: string): void;
}

// Matches the dialog's own fields: muted fill, hairline inset, no accent ring.
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
.tag-row .tag-options {
  flex-basis: 100%; display: grid; gap: 1px; max-height: 172px; overflow: auto; padding: 4px; border-radius: 8px;
  background: #ffffff07; box-shadow: inset 0 0 0 1px #ffffff0a;
}
.tag-row .tag-options:empty { display: none; }
.tag-row .tag-option {
  display: flex; align-items: center; gap: 6px; min-height: 26px; padding: 0 8px; border-radius: 5px;
  color: #ddd; cursor: pointer; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
}
.tag-row .tag-option[aria-selected="true"] { background: #ffffff12; color: #fff; }
.tag-row .tag-option-hint, .tag-row .tag-option-empty { color: #858585; }
.tag-row .tag-option-empty { padding: 5px 8px; }
.new-comment-composer .draft-body .tag-slot { grid-row: 2; grid-column: 2; align-self: center; min-width: 0; }
.new-comment-composer .draft-body:not(:has(.avatar)) .tag-slot { grid-column: 1; }
/* Line up with message text: 16px gutter plus the 24px avatar and 8px gap. */
.thread-tags { padding: 0 16px 12px 48px; margin-top: -6px; }
`;

/** Lowercase and validate a typed tag; returns null when it isn't a valid tag. */
export function normalizeTag(value: string): string | null {
  const tag = value.trim().replace(/^#/, "").toLocaleLowerCase("en-US");
  return TAG.test(tag) ? tag : null;
}

/** Render removable tag chips and an inline "Tag" input into `slot`. */
export function tagEditor(slot: HTMLElement, options: TagEditorOptions): void {
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

  function render(focusInput = false) {
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
      remove.addEventListener("click", () => {
        tags = tags.filter((item) => item !== tag);
        options.onRemove(tag);
        render();
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
            // Keep focus in the input so blur doesn't close the list first.
            option.addEventListener("pointerdown", (event) => event.preventDefault());
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
          }
        } else if (event.key === "Escape") {
          event.preventDefault();
          typing = false;
          render();
        } else if (event.key === "Backspace" && !input.value && tags.length) {
          const last = tags.at(-1)!;
          tags = tags.slice(0, -1);
          options.onRemove(last);
          render(true);
        }
      });
      input.addEventListener("input", () => input.removeAttribute("aria-invalid"));
      input.addEventListener("blur", () => {
        if (swapping || !input.isConnected || !typing) return;
        typing = false;
        render();
      });
      row.append(input, list);
      swap(style, row);
      update();
      if (focusInput || typing) input.focus({ preventScroll: true });
      return;
    }
    if (tags.length < MAX_TAGS) {
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
