// Runs under NODE_ENV=production in a child process: argv = [adapter bundle, package.json of the React install].
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");
const { JSDOM } = require("jsdom");
const dom = new JSDOM("<!doctype html><div id=app></div>");
Object.assign(globalThis, { window: dom.window, document: dom.window.document, Node: dom.window.Node, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement });
globalThis.IS_REACT_ACT_ENVIRONMENT = false;
const load = createRequire(process.argv[3]);
const React = load("react");
const { createRoot } = load("react-dom/client");
const { flushSync } = load("react-dom");
(async () => {
  const { discoverReactComponents } = await import(pathToFileURL(process.argv[2]).href);
  function ProdCard(props) { return React.createElement("section", null, React.createElement("h2", null, props.title)); }
  // What a minifier does to component names.
  const t = (props) => React.createElement("p", null, props.x);
  Object.defineProperty(t, "name", { value: "t" });
  const container = document.getElementById("app");
  flushSync(() => createRoot(container).render(React.createElement("div", null, React.createElement(ProdCard, { title: "Hi", token: "abc" }), React.createElement(t, { x: 1 }))));
  const adapter = discoverReactComponents();
  const found = adapter.identify(container.querySelector("h2"));
  const panel = adapter.panel(found);
  console.log(JSON.stringify({
    mode: process.env.NODE_ENV,
    version: React.version,
    name: found && found.name,
    props: found && found.props,
    source: found && found.source,
    panel: panel && panel.textContent,
    fields: panel && Object.fromEntries([...panel.querySelectorAll("label")].map((label) => [label.querySelector("span").textContent, label.querySelector("input").value])),
    minified: adapter.identify(container.querySelector("p")),
  }));
})().catch((error) => { console.log(JSON.stringify({ error: String(error) })); process.exit(1); });
