// A compiled design-system package: plain JS, no JSX, types in index.d.ts.
import { createContext, createElement as h, forwardRef, Fragment, memo, useContext, useState, Component } from "react";
import { createPortal } from "react-dom";

const Theme = createContext("light");
export const colors = { accent: "#5b4bd5", danger: "#c42b1c" };
export const cx = (...names) => names.filter(Boolean).join(" ");
export function useToggle(initial = false) { const [on, set] = useState(initial); return [on, () => set((value) => !value)]; }
export function ThemeProvider({ theme = "light", children }) { return h(Theme.Provider, { value: theme }, children); }
export function CheckIcon({ size = 16 }) { return h("svg", { width: size, height: size, "data-icon": "check" }); }

export const Button = forwardRef(function Button({ variant = "primary", size = "md", disabled = false, label, children, className, ...rest }, ref) {
  const theme = useContext(Theme);
  return h("button", { ...rest, ref, type: "button", disabled, className: cx("ui-button", `ui-${variant}`, `ui-${size}`, className),
    "data-variant": variant, "data-size": size, "data-has-size": String(arguments[0] && "size" in arguments[0]), "data-theme": theme }, label ?? children);
});

// Controlled: the value lives in the app; typing calls onValueChange.
export function TextField({ label, value, onValueChange, invalid = false }) {
  return h("label", { className: cx("ui-field", invalid && "ui-invalid"), "data-invalid": String(invalid) },
    h("span", null, label), h("input", { value, onChange: (event) => onValueChange?.(event.target.value) }));
}

// Stateful: its own count survives prop previews.
export function Counter({ tone = "calm", step = 1 }) {
  const [count, setCount] = useState(0);
  return h("button", { type: "button", className: "ui-counter", "data-tone": tone, onClick: () => setCount((value) => value + step) }, `Count ${count}`);
}

export const Badge = memo(function Badge({ tone = "neutral", children }) {
  Badge.renders = (Badge.renders ?? 0) + 1;
  return h("span", { className: "ui-badge", "data-tone": tone }, children);
});

export function Popover({ open = false, placement = "bottom", label = "Popover" }) {
  return open ? createPortal(h("div", { className: "ui-popover", role: "dialog", "data-placement": placement }, label), document.body) : null;
}

// Two roots, no wrapper element.
export function Pair({ first = "One", second = "Two" }) {
  return h(Fragment, null, h("span", { className: "ui-pair-first" }, first), h("span", { className: "ui-pair-second" }, second));
}

export class Panel extends Component {
  render() { return h("section", { className: "ui-panel", "data-elevation": String(this.props.elevation ?? 0) }, this.props.children); }
}

export function Tabs({ selected = "one", children }) { return h("div", { className: "ui-tabs", "data-selected": selected }, children); }
Tabs.Tab = function Tab({ id, children }) { return h("button", { type: "button", "data-tab": id }, children); };

// A required prop that may be null, and a caption too long for a text control.
export function Avatar({ src, size = "md", caption = "", author = "" }) {
  return h("span", { className: "ui-avatar", "data-src": String(src), "data-size": size, "data-caption-length": String(caption.length), "data-author": author });
}

// memo with its own compare: only tone matters.
export const Tag = memo(function Tag({ tone = "calm", note }) {
  Tag.renders = (Tag.renders ?? 0) + 1;
  return h("span", { className: "ui-tag", "data-tone": tone }, note);
}, (before, after) => before.tone === after.tone);

function Quote({ author = "Anonymous" }) { return h("blockquote", { className: "ui-quote" }, author); }
export { Quote as default };
