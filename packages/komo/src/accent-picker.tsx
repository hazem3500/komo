import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createRoot } from "react-dom/client";
import { HexColorInput, HexColorPicker } from "react-colorful";
import { Plus } from "@untitledui/icons/Plus";
import { el, onPage } from "./dom.js";

const PRESETS = [
  ["Lavender", "#c8b5f4"],
  ["Blue", "#85b5ff"],
  ["Mint", "#84d9bb"],
  ["Yellow", "#f4d779"],
  ["Peach", "#f5af87"],
  ["Pink", "#efa5c6"],
] as const;

function AccentPicker({
  initial,
  onChange,
}: {
  initial: string;
  onChange: (color: string) => void;
}) {
  const [color, setColor] = useState(initial);
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const custom = !PRESETS.some(([, value]) => value === color);
  const select = (value: string) => {
    if (!/^#[0-9a-f]{6}$/i.test(value)) return;
    const next = value.toLowerCase();
    setColor(next);
    onChange(next);
  };
  useLayoutEffect(() => {
    const node = panel.current;
    if (!node) return;
    if (!open) {
      const timer = window.setTimeout(() => node.hidePopover(), 150);
      return () => clearTimeout(timer);
    }
    node.showPopover();
    const place = () => {
      const rect = trigger.current!.getBoundingClientRect();
      node.style.left = `${Math.max(8, Math.min(rect.right - node.offsetWidth, innerWidth - node.offsetWidth - 8))}px`;
      node.style.top = `${Math.max(8, rect.top - node.offsetHeight - 8)}px`;
    };
    place();
    node
      .querySelector<HTMLElement>('[role="slider"]')
      ?.focus({ preventScroll: true });
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        !event.composedPath().includes(panel.current!) &&
        !event.composedPath().includes(trigger.current!)
      )
        setOpen(false);
    };
    const listening = new AbortController();
    onPage(trigger.current!, "pointerdown", outside, { signal: listening.signal });
    return () => listening.abort();
  }, [open]);
  return (
    <div className="account-accent">
      <span className="account-accent-label">Accent color</span>
      <div className="accent-swatches" role="group" aria-label="Accent color">
        {PRESETS.map(([name, value]) => (
          <button
            key={name}
            type="button"
            className="accent-swatch"
            aria-label={name}
            title={name}
            aria-pressed={color === value}
            style={{ "--swatch": value } as CSSProperties}
            onClick={() => {
              select(value);
              setOpen(false);
            }}
          />
        ))}
        <button
          ref={trigger}
          type="button"
          className="accent-swatch accent-custom"
          aria-label="Custom accent color"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-pressed={custom}
          onClick={() => setOpen(!open)}
        >
          <Plus aria-hidden="true" />
        </button>
      </div>
      <div
        ref={panel}
        popover="manual"
        role="dialog"
        aria-label="Custom accent color"
        className={
          open
            ? "accent-popover t-dropdown is-open"
            : "accent-popover t-dropdown is-closing"
        }
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
            trigger.current?.focus();
          }
        }}
      >
        <div className="accent-popover-head">
          <span>Color</span>
          <span>{color}</span>
        </div>
        <div className="accent-picker-body">
          <HexColorPicker color={color} onChange={select} />
          <HexColorInput
            aria-label="Hex accent color"
            className="accent-hex"
            color={color}
            onChange={select}
            prefixed
          />
        </div>
      </div>
    </div>
  );
}

export function accentPicker(
  initial: string,
  onChange: (color: string) => void
) {
  const element = el("div", "account-accent-mount");
  const root = createRoot(element);
  root.render(<AccentPicker initial={initial} onChange={onChange} />);
  return { element, destroy: () => root.unmount() };
}
