"use client";

import { useEffect, useRef, type RefCallback } from "react";
import { initKomo } from "./index.js";
import {
  registerInspectableRoot,
  updateInspectableRoot,
  type InspectableComponent,
  type InspectableScalar,
} from "./react-inspector.js";
import { registerDesignTokenSource, type KomoDesignToken } from "./design-tokens.js";
import type { KomoConfig } from "./config.js";
import type { CommentsController } from "./types.js";

export type { KomoConfig } from "./config.js";
export type {
  InspectableComponent,
  InspectableProp,
  InspectableScalar,
} from "./react-inspector.js";
export type { KomoDesignToken, KomoDesignTokenType } from "./design-tokens.js";
/** The built-in token adapter over `useKomoDesignTokens`; compose it into your own adapter to keep both. */
export { cssVariableTokens } from "./design-tokens.js";

function sameConfig(a: KomoConfig, b: KomoConfig): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<
    keyof KomoConfig
  >;
  return [...keys].every((key) => {
    if (key === "shortcuts" || key === "features") {
      const before = (a[key] ?? {}) as Record<string, unknown>;
      const after = (b[key] ?? {}) as Record<string, unknown>;
      return Object.keys({ ...before, ...after }).every((field) =>
        Object.is(before[field], after[field]),
      );
    }
    if (key === "design") {
      // Inline design objects are new each render; compare the adapters inside.
      const before = a.design;
      const after = b.design;
      if (!before || !after) return before === after;
      const themes = before.themes ?? [];
      const nextThemes = after.themes ?? [];
      return (
        before.tokens === after.tokens &&
        before.components === after.components &&
        themes.length === nextThemes.length &&
        themes.every((axis, index) => axis === nextThemes[index])
      );
    }
    if (key !== "onboarding") return Object.is(a[key], b[key]);
    const before = a.onboarding;
    const after = b.onboarding;
    if (!before || !after) return before === after;
    return Object.keys({ ...before, ...after }).every((field) => {
      if (field === "sites")
        return (
          before.sites?.length === after.sites?.length &&
          (before.sites ?? []).every(
            (site, index) => site === after.sites?.[index],
          )
        );
      return Object.is(
        before[field as keyof typeof before],
        after[field as keyof typeof after],
      );
    });
  });
}

/** Mount once near the React app root. Memoize callback options with useCallback. */
export function useKomo(config: KomoConfig): void {
  const mounted = useRef<{
    config: KomoConfig;
    controller: CommentsController;
  } | null>(null);

  useEffect(() => {
    if (mounted.current && sameConfig(mounted.current.config, config)) return;
    mounted.current?.controller.destroy();
    mounted.current = null;
    if (config.enabled === false) return;
    const snapshot = {
      ...config,
      ...(config.onboarding
        ? {
            onboarding: {
              ...config.onboarding,
              ...(config.onboarding.sites
                ? { sites: [...config.onboarding.sites] }
                : {}),
            },
          }
        : {}),
    };
    mounted.current = { config: snapshot, controller: initKomo(snapshot) };
  });

  useEffect(
    () => () => {
      mounted.current?.controller.destroy();
      mounted.current = null;
    },
    [],
  );
}

export interface UseKomoInspectableOptions {
  /** A build-generated manifest entry for this component. */
  component: InspectableComponent;
  /** Only the scalar props listed by the manifest are exposed to the inspector. */
  props: Record<string, InspectableScalar>;
  /** Feed proposed preview values back through the component's React state. */
  onChange(next: Record<string, InspectableScalar>): void;
  /** Keep disabled outside an explicitly enabled development/demo environment. */
  enabled?: boolean;
}

/**
 * Opt one React DOM root into the Design mode prop inspector. The component
 * must provide its own state update callback; Komo's core never reads Fiber internals
 * or writes the host application's source files.
 */
export function useKomoInspectable(
  options: UseKomoInspectableOptions,
): { ref: RefCallback<HTMLElement>; "data-komo-inspectable": string } {
  const root = useRef<HTMLElement | null>(null);
  const ref = useRef<RefCallback<HTMLElement> | null>(null);
  if (!ref.current) ref.current = (element) => { root.current = element; };

  useEffect(() => {
    if (options.enabled !== true || !root.current) return;
    return registerInspectableRoot(
      root.current,
      options.component,
      options.props,
      options.onChange,
    );
  }, [options.enabled, options.component]);

  useEffect(() => {
    if (options.enabled === true)
      updateInspectableRoot(
        root.current,
        options.component,
        options.props,
        options.onChange,
      );
  }, [options.enabled, options.component, options.props, options.onChange]);

  return {
    ref: ref.current,
    "data-komo-inspectable": options.component.id,
  };
}

export interface UseKomoDesignTokensOptions {
  /** Element that owns the explicitly listed CSS custom properties; defaults to document.documentElement after hydration. */
  root?: HTMLElement;
  /** Allowlisted token metadata; Komo never scans arbitrary custom properties. */
  tokens: readonly KomoDesignToken[];
  /** Keep disabled outside an explicitly enabled development/demo environment. */
  enabled?: boolean;
}

/** Register named CSS-variable tokens for temporary Design mode previews. */
export function useKomoDesignTokens(options: UseKomoDesignTokensOptions): void {
  useEffect(() => {
    if (options.enabled !== true) return;
    const root = options.root ?? document.documentElement;
    return registerDesignTokenSource(root, options.tokens);
  }, [options.root, options.tokens, options.enabled]);
}
