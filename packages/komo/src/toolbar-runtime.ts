import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { createElement } from "react";
import { MorphingMenu } from "./MorphingMenu.js";
import type { ToolbarProps, ToolbarIcon } from "./lazy-toolbar.js";
import { avatarSrc, icons, initials } from "./dom.js";

function glyph(value: ToolbarIcon): ReturnType<typeof createElement> {
  if ("glyph" in value)
    return createElement("span", {
      style: { display: "contents" },
      dangerouslySetInnerHTML: { __html: icons[value.glyph] },
    });
  const { user } = value;
  const src = user && avatarSrc(user);
  // The photo covers the initial; a failed load hides it so the initial shows.
  return createElement(
    "span",
    { className: "review-avatar" },
    user ? initials(user.name) : glyph({ glyph: "person" }),
    src &&
      createElement("img", {
        key: src,
        src,
        alt: "",
        referrerPolicy: "no-referrer",
        decoding: "async",
        onError: (event: { currentTarget: HTMLImageElement }) => {
          event.currentTarget.hidden = true;
        },
      }),
  );
}
const view = (props: ToolbarProps) =>
  createElement(MorphingMenu, {
    ...props,
    items: props.items.map((item) => ({ ...item, icon: glyph(item.icon) })),
  });
export function mountToolbar(element: HTMLElement, props: ToolbarProps) {
  element.replaceChildren();
  const root = createRoot(element);
  flushSync(() => root.render(view(props)));
  return {
    render: (next: ToolbarProps) => root.render(view(next)),
    unmount: () => root.unmount(),
  };
}
