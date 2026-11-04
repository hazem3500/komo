import type { ReactNode } from "react";
import { usePaletteInspectable, type InspectableComponent, type InspectableScalar } from "../../../src/react.js";

export interface PromoCardProps {
  title: string;
  marker: "only";
  maybe: string | null;
  tone: "calm" | "bold" | "quiet";
  compact?: boolean;
  visits: number;
  /** @paletteStyle color */
  brandColor: string;
  children: ReactNode;
  details: { featured: boolean };
  onActivate: (source: string) => void;
}

/** @paletteInspectable @paletteProps PromoCardProps */
export function PromoCard({
  title,
  marker,
  tone,
  compact,
  visits,
  brandColor,
  children,
  details,
  onActivate,
  component,
  onPropsChange,
}: PromoCardProps & {
  component: InspectableComponent;
  onPropsChange(next: Record<string, InspectableScalar>): void;
}) {
  const inspectable = usePaletteInspectable({
    component,
    props: { title, marker, tone, compact, visits, brandColor },
    onChange: onPropsChange,
    enabled: true,
  });
  return (
    <article
      {...inspectable}
      className="promo-card"
      data-tone={tone}
      data-compact={String(compact ?? false)}
      data-featured={String(details.featured)}
      style={{ color: brandColor }}
    >
      <span className="eyebrow">Registered React component</span>
      <h2>{title}</h2>
      <p>{children}</p>
      <p>Preview interactions: {visits}</p>
      <button type="button" onClick={() => onActivate("demo action")}>
        Try component action
      </button>
    </article>
  );
}
