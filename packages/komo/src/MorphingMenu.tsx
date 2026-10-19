"use client";

import { ChevronSelectorVertical } from "@untitledui/icons/ChevronSelectorVertical";
import { XClose } from "@untitledui/icons/XClose";
import { ArrowLeft } from "@untitledui/icons/ArrowLeft";
import { ChevronRight } from "@untitledui/icons/ChevronRight";
// Adapted directly from Danny Williams’s published MorphingMenu.tsx.
// https://dannyjpwilliams.com/playground/morphing-menu/

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { onPage } from "./dom.js";
import { animate } from "motion";
import { useReducedMotion } from "motion/react";
import {
  drawerCollapse,
  drawerExpandCompress as compress,
  drawerExpandSpring as spring,
} from "./drawer-expand-motion.js";
// Styles are installed in the comments ShadowRoot by the host.

export type MenuAction = {
  id: string;
  label: string;
  icon: ReactNode;
  activeIcon?: ReactNode;
  href?: string;
  onSelect?: () => void;
  keepOpenOnSelect?: boolean;
  expandedOrder?: number;
};

// One level of children keeps the component small and the navigation predictable.
export type MenuItem = MenuAction & {
  children?: readonly MenuAction[];
  /** Set false to keep this item in More without adding a dock shortcut. */
  showInBar?: boolean;
};

export type MorphingMenuProps = {
  items: readonly MenuItem[];
  defaultActiveId?: string;
  activeId?: string;
  alignEnd?: boolean;
  edge?: "top" | "bottom" | "left" | "right";
  onActiveChange?: (id: string) => void;
  label?: string;
  moreLabel?: string;
  backLabel?: string;
  className?: string;
  style?: CSSProperties;
};

type View =
  | { kind: "collapsed" }
  | { kind: "main" }
  | { kind: "group"; id: string };
const HOVER_DELAY = 400;
const HOVER_GRACE_PERIOD = 300;

export function MorphingMenu({
  items,
  defaultActiveId,
  activeId,
  edge = "bottom",
  alignEnd = false,
  onActiveChange,
  label = "App navigation",
  moreLabel = "More",
  backLabel = "Back",
  className = "",
  style,
}: MorphingMenuProps) {
  const id = useId();
  const [view, setView] = useState<View>({ kind: "collapsed" });
  const [selection, setSelection] = useState(defaultActiveId ?? items[0]?.id);
  const [tooltip, setTooltip] = useState<{
    label: string;
    x: number;
    y: number;
  } | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const previousEdge = useRef(edge);
  const vertical = edge === "left" || edge === "right";
  useLayoutEffect(() => {
    const tip = tooltipRef.current;
    if (!tip || !tooltip) return;
    // Clamp to what is actually visible: the viewport without its scrollbar,
    // cut by clipping ancestors such as the docked sidebar.
    let left = 0;
    let top = 0;
    let right = document.documentElement.clientWidth;
    let bottom = window.innerHeight;
    for (
      let node: Node | null = tip.parentNode;
      node instanceof Element && node !== document.body;
      node =
        node.parentNode instanceof ShadowRoot
          ? node.parentNode.host
          : node.parentNode
    ) {
      const style = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      if (style.overflowX !== "visible") {
        left = Math.max(left, box.left);
        right = Math.min(right, box.right);
      }
      if (style.overflowY !== "visible") {
        top = Math.max(top, box.top);
        bottom = Math.min(bottom, box.bottom);
      }
    }
    tip.style.maxWidth = `${Math.max(0, right - left - 16)}px`;
    tip.style.left = `${tooltip.x}px`;
    tip.style.top = `${tooltip.y}px`;
    const rect = tip.getBoundingClientRect();
    const dx = Math.max(
      left + 8 - rect.left,
      Math.min(0, right - 8 - rect.right),
    );
    const dy = Math.max(
      top + 8 - rect.top,
      Math.min(0, bottom - 8 - rect.bottom),
    );
    tip.style.left = `${tooltip.x + dx}px`;
    tip.style.top = `${tooltip.y + dy}px`;
  }, [tooltip]);
  const shellRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const previousView = useRef<View>(view);
  const returnTarget = useRef("more");
  const openedWithKeyboard = useRef(false);
  const restoringFocus = useRef(false);
  const suppressHoverUntilMove = useRef(false);
  const focusNext = useRef<string | null>(null);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const tooltipResetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const hintsRevealed = useRef(false);
  const barHovered = useRef(false);
  const reducedMotion = useReducedMotion();
  const selected = activeId ?? selection;
  const expanded = view.kind !== "collapsed";
  const barItems = items.filter((item) => item.showInBar !== false);
  const dismissItem = barItems.find((item) => item.id === "dismiss");
  const primaryBarItems = barItems.filter((item) => item.id !== "dismiss");
  const groups = items.filter((item) => item.children?.length);
  const barPositions = useRef(new Map<string, [number, number]>());
  const barMotion = useRef(new Map<string, ReturnType<typeof animate>>());
  const barKey = barItems.map((item) => item.id).join("|");
  useLayoutEffect(() => {
    const next = new Map<string, [number, number]>();
    const moves = [...(barRef.current?.querySelectorAll<HTMLElement>("[data-menu-item]") ?? [])].map((node) => {
      const id = node.dataset.menuItem!;
      const position: [number, number] = [node.offsetLeft, node.offsetTop];
      next.set(id, position);
      return { node, id, position, before: barPositions.current.get(id) };
    });
    for (const { node, id, position, before } of moves) {
      if (reducedMotion || openedWithKeyboard.current) {
        barMotion.current.get(id)?.complete();
        barMotion.current.delete(id);
      } else if (before && (before[0] !== position[0] || before[1] !== position[1])) {
        barMotion.current.get(id)?.complete();
        barMotion.current.set(
          id,
          animate(node, {
            x: [before[0] - position[0], 0],
            y: [before[1] - position[1], 0],
          }, spring),
        );
      }
    }
    for (const [id, motion] of barMotion.current)
      if (!next.has(id)) {
        motion.stop();
        barMotion.current.delete(id);
      }
    barPositions.current = next;
  }, [barKey, edge, view, reducedMotion]);
  useEffect(() => () => {
    for (const motion of barMotion.current.values()) motion.stop();
  }, []);

  function hideTooltip() {
    clearTimeout(tooltipTimer.current);
    setTooltip(null);
  }

  function dismissTooltip() {
    hideTooltip();
    clearTimeout(tooltipResetTimer.current);
    hintsRevealed.current = false;
  }

  function showTooltip(element: HTMLElement, text: string, immediate = false) {
    clearTimeout(tooltipTimer.current);
    const root = rootRef.current;
    const bar = barRef.current;
    if (!root || !bar || expanded || restoringFocus.current) return;
    if (suppressHoverUntilMove.current && !immediate) return;
    const bounds = root.getBoundingClientRect();
    const target = element.getBoundingClientRect();
    const next = {
      label: text,
      x:
        edge === "left"
          ? bounds.width + 8
          : edge === "right"
            ? -8
            : target.left - bounds.left + target.width / 2,
      y:
        edge === "top"
          ? bounds.height + 8
          : edge === "bottom"
            ? -8
            : target.top - bounds.top + target.height / 2,
    };
    clearTimeout(tooltipResetTimer.current);
    const reveal = () => {
      hintsRevealed.current = true;
      setTooltip(next);
    };
    if (immediate || hintsRevealed.current) reveal();
    else tooltipTimer.current = setTimeout(reveal, HOVER_DELAY);
  }

  function open(next: View, origin: string, keyboard: boolean) {
    dismissTooltip();
    if (!expanded) {
      returnTarget.current = origin;
      openedWithKeyboard.current = keyboard;
    }
    focusNext.current = "first";
    setView(next);
  }

  function close(restoreFocus = true, target = returnTarget.current) {
    dismissTooltip();
    suppressHoverUntilMove.current = true;
    focusNext.current =
      restoreFocus && openedWithKeyboard.current ? target : null;
    setView({ kind: "collapsed" });
  }

  function back() {
    if (view.kind !== "group") return;
    focusNext.current = view.id;
    setView({ kind: "main" });
  }

  function select(item: MenuAction) {
    setSelection(item.id);
    onActiveChange?.(item.id);
    if (expanded && !item.keepOpenOnSelect)
      close(true, view.kind === "group" ? view.id : item.id);
    else dismissTooltip();
    item.onSelect?.();
  }

  // The shell stays mounted. Interrupting an animation cancels its next phase,
  // then the next transition starts from the currently rendered geometry.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const shell = shellRef.current;
    const bar = barRef.current;
    if (!root || !shell || !bar) return;
    const edgeChanged = previousEdge.current !== edge;
    previousEdge.current = edge;
    const old = previousView.current;
    previousView.current = view;
    const panels = [
      ...root.querySelectorAll<HTMLElement>(".morphing-menu__panel"),
    ];
    const panel = panels.find(
      (element) => element.getAttribute("aria-hidden") === "false",
    );
    const running: ReturnType<typeof animate>[] = [];
    let cancelled = false;
    const track = (animation: ReturnType<typeof animate>) => {
      running.push(animation);
      return animation;
    };
    const targetSize = () => ({
      width: panel?.offsetWidth ?? bar.offsetWidth,
      height: panel?.offsetHeight ?? bar.offsetHeight,
    });
    const setSize = () => {
      const size = targetSize();
      shell.style.width = `${size.width}px`;
      shell.style.height = `${size.height}px`;
    };
    const changed =
      edgeChanged ||
      old.kind !== view.kind ||
      (old.kind === "group" && view.kind === "group" && old.id !== view.id);
    const crossingBar =
      (old.kind === "collapsed") !== (view.kind === "collapsed");
    const snap = reducedMotion || !changed;

    if (snap) setSize();
    else if (crossingBar && !expanded) {
      track(animate(shell, targetSize(), drawerCollapse));
    } else if (crossingBar) {
      const width = Math.min(
        bar.offsetWidth,
        bar.offsetWidth > 250 ? 280 : 200,
      );
      const compression = track(
        animate(
          shell,
          { width, height: bar.offsetHeight > 52 ? 32 : 28 },
          compress,
        ),
      );
      void compression.finished
        .then(() => {
          if (!cancelled)
            track(
              animate(shell, targetSize(), {
                ...spring,
                bounce: expanded ? 0.24 : 0.15,
              }),
            );
        })
        .catch(() => {}); // A stopped transition must never resume its second phase.
    } else {
      track(
        animate(shell, targetSize(), {
          ...spring,
          duration: 0.25,
          bounce: 0.1,
        }),
      );
    }

    track(
      animate(
        bar,
        {
          opacity: expanded ? 0 : 1,
          scale: expanded && !reducedMotion ? 0.8 : 1,
          filter: expanded && !reducedMotion ? "blur(8px)" : "blur(0px)",
        },
        {
          duration: snap ? 0 : expanded ? 0.15 : 0.22,
          delay: !snap && !expanded ? 0.08 : 0,
          ...(!expanded ? { ease: "easeOut" as const } : {}),
        },
      ),
    );

    for (const layer of panels) {
      const visible = layer === panel;
      for (const [index, row] of [
        ...layer.querySelectorAll<HTMLElement>(".morphing-menu__row"),
      ].entries()) {
        if (visible && crossingBar && !snap) {
          Object.assign(row.style, {
            opacity: "0",
            transform: "translateY(48px)",
            filter: "blur(4px)",
          });
        }
        track(
          animate(
            row,
            {
              opacity: visible ? 1 : 0,
              y: visible || reducedMotion ? 0 : 16,
              filter: visible || reducedMotion ? "blur(0px)" : "blur(2px)",
            },
            {
              ...spring,
              duration: snap ? 0 : visible ? (crossingBar ? 0.4 : 0.25) : 0.12,
              bounce: crossingBar ? 0.3 : 0,
              delay:
                !snap && visible ? (crossingBar ? 0.2 : 0) + index * 0.02 : 0,
            },
          ),
        );
      }
    }

    const destination = expanded ? panel : bar;
    const controls = [
      ...(destination?.querySelectorAll<HTMLElement>("[data-menu-item]") ?? []),
    ];
    const focus = focusNext.current;
    focusNext.current = null;
    if (focus) {
      // Restoring navigation position is not a fresh request to show a hint.
      restoringFocus.current = true;
      const target =
        focus === "first"
          ? controls[0]
          : controls.find((element) => element.dataset.menuItem === focus);
      // Items shown only in More have no collapsed shortcut to return to.
      (
        target ??
        (!expanded
          ? controls.find((element) => element.dataset.menuItem === "more")
          : undefined)
      )?.focus({ preventScroll: true });
      restoringFocus.current = false;
    }

    // Geometry is measured from CSS, including the larger touch target tier.
    const resize = () => setView((current) => ({ ...current }));
    window.addEventListener("resize", resize);
    return () => {
      cancelled = true;
      running.forEach((animation) => animation.stop());
      window.removeEventListener("resize", resize);
    };
  }, [view, reducedMotion, edge, items.length, barItems.length]);

  useEffect(() => {
    if (!expanded) return;
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !event.composedPath().includes(rootRef.current!)
      )
        close(false);
    };
    const listening = new AbortController();
    onPage(rootRef.current!, "pointerdown", outside, { signal: listening.signal });
    return () => listening.abort();
  }, [expanded]);

  useEffect(
    () => () => {
      clearTimeout(tooltipTimer.current);
      clearTimeout(tooltipResetTimer.current);
    },
    [],
  );

  function control(item: MenuItem, inBar: boolean) {
    const hasChildren = Boolean(item.children?.length);
    // Store only the destination; its parent reflects selection without owning state.
    const active =
      selected === item.id ||
      Boolean(item.children?.some((child) => child.id === selected));
    const swapping = !inBar && item.keepOpenOnSelect;
    const swap = (content: ReactNode, icon = false) => (
      <SwappingLabel label={item.label} icon={icon} reduced={!!reducedMotion}>
        {content}
      </SwappingLabel>
    );
    const glyph = active && item.activeIcon ? item.activeIcon : item.icon;
    const content = (
      <>
        <span
          className="morphing-menu__icon"
          aria-hidden="true"
          style={swapping ? { display: "grid" } : undefined}
        >
          {swapping ? swap(glyph, true) : glyph}
        </span>
        {!inBar && (
          <span
            className="morphing-menu__label"
            style={swapping ? { display: "grid" } : undefined}
          >
            {swapping ? swap(item.label) : item.label}
          </span>
        )}
        {!inBar && hasChildren && <Chevron />}
      </>
    );
    const props = {
      className: inBar ? "morphing-menu__shortcut" : "morphing-menu__row",
      "data-menu-item": item.id,
      "aria-label": item.label,
      "aria-current": active
        ? hasChildren
          ? ("true" as const)
          : ("page" as const)
        : undefined,
      "aria-expanded": hasChildren
        ? view.kind === "group" && view.id === item.id
        : undefined,
      "aria-controls": hasChildren ? `${id}-group-${item.id}` : undefined,
      onClick: (event: React.MouseEvent<HTMLElement>) =>
        hasChildren
          ? open({ kind: "group", id: item.id }, item.id, event.detail === 0)
          : select(item),
      onPointerEnter: (event: React.PointerEvent<HTMLElement>) => {
        if (inBar && event.pointerType === "mouse")
          showTooltip(event.currentTarget, item.label);
      },
      onPointerLeave: hideTooltip,
      onPointerDown: dismissTooltip,
      onFocus: (event: React.FocusEvent<HTMLElement>) => {
        if (inBar && event.currentTarget.matches(":focus-visible"))
          showTooltip(event.currentTarget, item.label, true);
      },
      onBlur: hideTooltip,
    };
    return item.href && !hasChildren ? (
      <a key={item.id} href={item.href} {...props}>
        {content}
      </a>
    ) : (
      <button key={item.id} type="button" {...props}>
        {content}
      </button>
    );
  }

  const closeControl = (
    <button
      type="button"
      className="morphing-menu__row"
      data-menu-item="close"
      onClick={() => close(true, "more")}
    >
      <XClose aria-hidden="true" />
      <span className="morphing-menu__label">Close drawer</span>
    </button>
  );

  return (
    <nav
      ref={rootRef}
      aria-label={label}
      className={["morphing-menu", className].filter(Boolean).join(" ")}
      data-view={view.kind}
      data-edge={edge}
      data-vertical={vertical}
      data-align-end={alignEnd}
      style={{ "--mm-count": barItems.length + 1, ...style } as CSSProperties}
      onPointerMove={(event) => {
        // A collapsing bar can move under a stationary cursor and fire enter.
        // Only an actual pointer movement should revive a dismissed hover hint.
        if (
          !suppressHoverUntilMove.current ||
          event.pointerType !== "mouse" ||
          (!event.movementX && !event.movementY)
        )
          return;
        suppressHoverUntilMove.current = false;
        const shortcut =
          event.target instanceof Element
            ? event.target.closest<HTMLElement>(".morphing-menu__shortcut")
            : null;
        if (shortcut)
          showTooltip(shortcut, shortcut.getAttribute("aria-label") ?? "");
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        suppressHoverUntilMove.current = true;
        dismissTooltip();
        if (!expanded) return;
        event.preventDefault();
        event.stopPropagation();
        if (view.kind === "group") back();
        else close();
      }}
      onBlur={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        )
          return;
        if (expanded) {
          if (event.relatedTarget instanceof Node) close(false);
        }
        // Keyboard-only visits have no pointer-leave event to expire the session.
        else if (!barHovered.current) dismissTooltip();
      }}
    >
      <div ref={shellRef} className="morphing-menu__shell">
        <div
          ref={barRef}
          className="morphing-menu__bar"
          aria-hidden={expanded}
          inert={expanded}
          onPointerEnter={(event) => {
            if (event.pointerType !== "mouse") return;
            barHovered.current = true;
            clearTimeout(tooltipResetTimer.current);
          }}
          onPointerLeave={(event) => {
            if (event.pointerType !== "mouse") return;
            barHovered.current = false;
            hideTooltip();
            clearTimeout(tooltipResetTimer.current);
            // Padding keeps hints ready; only leaving the whole bar starts grace.
            tooltipResetTimer.current = setTimeout(() => {
              hintsRevealed.current = false;
            }, HOVER_GRACE_PERIOD);
          }}
        >
          {primaryBarItems.map((item) => control(item, true))}
          <button
            type="button"
            className="morphing-menu__shortcut"
            data-menu-item="more"
            aria-label={moreLabel}
            aria-expanded={expanded}
            aria-controls={`${id}-main`}
            onClick={(event) =>
              open({ kind: "main" }, "more", event.detail === 0)
            }
            onPointerEnter={(event) => {
              if (event.pointerType === "mouse")
                showTooltip(event.currentTarget, moreLabel);
            }}
            onPointerLeave={hideTooltip}
            onPointerDown={dismissTooltip}
            onBlur={hideTooltip}
            onFocus={(event) => {
              if (event.currentTarget.matches(":focus-visible"))
                showTooltip(event.currentTarget, moreLabel, true);
            }}
          >
            <ChevronSelectorVertical aria-hidden="true" />
          </button>
          {dismissItem && control(dismissItem, true)}
        </div>
        <div
          id={`${id}-main`}
          className="morphing-menu__panel"
          aria-hidden={view.kind !== "main"}
          inert={view.kind !== "main"}
        >
          {[...items]
            .sort((a, b) => (a.expandedOrder ?? 0) - (b.expandedOrder ?? 0))
            .map((item) => control(item, false))}
          {closeControl}
        </div>
        {groups.map((group) => {
          const visible = view.kind === "group" && view.id === group.id;
          return (
            <div
              key={group.id}
              id={`${id}-group-${group.id}`}
              className="morphing-menu__panel"
              aria-label={group.label}
              aria-hidden={!visible}
              inert={!visible}
            >
              <button
                type="button"
                className="morphing-menu__row"
                data-menu-item="back"
                onClick={back}
              >
                <ArrowLeft aria-hidden="true" />
                <span>{backLabel}</span>
              </button>
              {group.children!.map((item) => control(item, false))}
              {closeControl}
            </div>
          );
        })}
      </div>
      {tooltip && !expanded && (
        <div
          ref={tooltipRef}
          className="morphing-menu__tooltip"
          aria-hidden="true"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          {tooltip.label}
        </div>
      )}
    </nav>
  );
}

function Chevron() {
  return <ChevronRight className="morphing-menu__chevron" aria-hidden="true" />;
}

// Keep the existing label crossfade without mounting a presence tree per row.
function SwappingLabel({
  label,
  icon,
  reduced,
  children,
}: {
  label: string;
  icon: boolean;
  reduced: boolean;
  children: ReactNode;
}) {
  const root = useRef<HTMLSpanElement>(null);
  const previous = useRef<{ label: string; node: HTMLElement } | null>(null);
  useLayoutEffect(() => {
    const node = root.current!;
    const prior = previous.current;
    previous.current = { label, node: node.cloneNode(true) as HTMLElement };
    if (!prior || prior.label === label || reduced) return;
    const outgoing = prior.node;
    outgoing.setAttribute("aria-hidden", "true");
    node.parentElement!.append(outgoing);
    const options = { duration: 200, easing: "cubic-bezier(.22,1,.36,1)" };
    const entering = node.animate(
      [
        {
          opacity: 0,
          transform: icon ? "scale(.7)" : "translateY(4px)",
          filter: "blur(2px)",
        },
        { opacity: 1, transform: "none", filter: "blur(0px)" },
      ],
      options,
    );
    const leaving = outgoing.animate(
      [
        { opacity: 1, transform: "none", filter: "blur(0px)" },
        {
          opacity: 0,
          transform: icon ? "scale(.7)" : "translateY(-4px)",
          filter: "blur(2px)",
        },
      ],
      options,
    );
    void leaving.finished.then(() => outgoing.remove()).catch(() => {});
    return () => {
      entering.cancel();
      leaving.cancel();
      outgoing.remove();
    };
  }, [label, icon, reduced]);
  return (
    <span
      ref={root}
      style={{ gridArea: "1 / 1", display: "flex", alignItems: "center" }}
    >
      {children}
    </span>
  );
}
