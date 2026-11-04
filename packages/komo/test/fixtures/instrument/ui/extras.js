// A subpath entry (@fixture/ui/extras) with a compound that checks its children's type.
import { Children, createElement as h, isValidElement } from "react";

export function Chip({ tone = "plain", label = "Chip" }) { return h("span", { className: "ui-chip", "data-tone": tone }, label); }

export function ListItem({ emphasis = "normal", children }) { return h("li", { className: "ui-list-item", "data-emphasis": emphasis }, children); }

// Keeps only ListItem children, as compound components often do.
export function List({ density = "comfortable", children }) {
  const items = Children.toArray(children).filter((child) => isValidElement(child) && child.type === ListItem);
  return h("ul", { className: "ui-list", "data-density": density, "data-count": String(items.length) }, items);
}
