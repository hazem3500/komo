# React props inspector fixture

This opt-in fixture demonstrates Komo's React-aware Design mode inspector. The
TypeScript compiler generates the prop manifest at build time from the marked
component. Only string, number, boolean, and literal-union scalar props are
editable. Function, `ReactNode`, object, generic, nullable-union, and other
complex types are read-only. The generator currently targets explicitly marked
exported function components with a named props declaration; it does not claim
coverage for every React component form or interpret `defaultProps`. The
component supplies a state callback, so the preview uses React's normal rerender
path. Komo never reads React Fiber internals or rewrites source files.

The fixture's heading registers `textProp: "text"` for one leaf `<h2>`. This
opt-in mapping lets Design mode edit that prop through the app's state callback
and include its before/after value in a proposed comment. Other registered
components and nested/rich text remain read-only for inline editing unless the
host maps a separate leaf component explicitly.

The same fixture registers a short, explicit CSS-variable token allowlist. The
token names and scalar types follow the Design Tokens Format Module 2025.10,
with CSS-variable bindings and impact selectors supplied by the host. Each
style control reports the token the card's own CSS references, accepts a custom
override (keeping the original token as provenance), or rebinds to another
`var(--token)` in a local preview. You can also explicitly preview a shared
theme value and see the registered selector's match count. Both actions are temporary; the shared edit resets on refresh,
widget destruction, or Reset. Matching selectors are an estimate of scope, not
a discovery of all CSS consumers. Komo does not import arbitrary DTCG files,
persist tokens, or write application source.

Add `?tokens=classes` for a class-based token adapter and `?theme` for a
light/dark theme axis. With `?theme`, the top of the Design panel switches the
page between light and dark; the token chips follow, and leaving Design mode
puts the original theme back.

The demo uses React 19. The adapter uses public hooks, ref callbacks, and state
updates compatible with the package's React 18.2+ / 19 peer range, but React 18
has not been exercised in this prototype. In SSR frameworks, call the hook from
a client component after hydration; server-rendered props are never exposed by
the inspector.

Build locally with:

```sh
cd packages/komo
node examples/react-props/build.mjs
```

The generated `.generated/` bundle is ignored and should not be committed.
The fixture uses the normal Komo comments API configuration; use a disposable
project/database for any live comment testing.

## Design choice

React Developer Tools is the right reference for component/prop inspection, but
its browser DevTools integration is not a small embeddable API for Komo. Komo
therefore uses an explicit host registration marker and a TypeScript-generated
allowlist. TypeScript's Compiler API can resolve declaration types before they
are erased from JavaScript. React state remains owned by the application and is
updated through its callback. The prototype intentionally does not promise
complete runtime discovery, source editing, or support for arbitrary values.

Primary references:

- React Developer Tools: https://react.dev/learn/react-developer-tools
- React props and state: https://react.dev/learn/passing-props-to-a-component
- React render and commit: https://react.dev/learn/render-and-commit
- TypeScript Compiler API: https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API
- react-docgen: https://github.com/reactjs/react-docgen
