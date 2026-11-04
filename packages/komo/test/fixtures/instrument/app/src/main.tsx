import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import Quote, { Avatar, Tag, Badge, Button, Counter, Pair, Panel, Popover, Tabs, TextField, ThemeProvider, colors, cx, useToggle } from "@fixture/ui";
import { ProjectCard, ProjectList } from "./ProjectCard";
import Summary from "@views/summary";

declare global { interface Window { qa: Record<string, any> } }
const qa = (window.qa = { tagRenders: () => (Tag as { renders?: number }).renders ?? 0, renders: 0, refs: [] as unknown[], colors, cx: cx("a", false, "b"), tab: typeof Tabs.Tab });

function App() {
  const [text, setText] = useState("Hello");
  const [tick, setTick] = useState(0);
  const [shown, setShown] = useState(true);
  const [open, toggle] = useToggle(true);
  const ref = useRef<HTMLButtonElement>(null);
  qa.renders++;
  useEffect(() => {
    qa.rerender = () => setTick((value) => value + 1);
    qa.toggleShown = () => setShown((value) => !value);
    qa.setText = setText;
    qa.togglePopover = toggle;
    qa.ref = () => ref.current?.className;
  });
  const onValueChange = useCallback((value: string) => setText(value), []);
  return (
    <ThemeProvider theme="dark">
      <Button ref={ref} id="primary" variant="primary">Save</Button>
      {shown ? <Button id="transient" variant="secondary" size="sm">Transient</Button> : null}
      <TextField label="Name" value={text} onValueChange={onValueChange} />
      <output id="text">{text}</output>
      <Counter />
      <Badge tone="success">Badge {tick % 2}</Badge>
      <Popover open={open} label="Floating" />
      <Pair first="Left" second="Right" />
      <Panel elevation={1}><span id="inside-panel">Inside panel</span></Panel>
      <Tabs selected="one"><Tabs.Tab id="one">One</Tabs.Tab></Tabs>
      <ProjectList>
        <ProjectCard title="Ship the beta" status="on-track" progress={40} owner={{ name: "Sam" }} />
      </ProjectList>
      <Avatar src={null} size="sm" caption={"x".repeat(600)} author="Sam" />
      <Tag tone="calm" note={String(tick)} />
      <Quote />
      <Summary tone="plain" />
      <output id="tick">{tick}</output>
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);

// Design mode loads only in review builds, and only when the test asks for it.
if (import.meta.env.VITE_REVIEW === "1") qa.startKomo = async (viewport = false) => {
  const { initKomo } = await import("@hazem3500/komo");
  window.fetch = async () => Response.json({ threads: [], guests: true });
  qa.komo = initKomo({
    endpoint: location.origin, project: "instrument", repo: "example/review", branch: "fixture", restoreOpen: false,
    // Viewport: Frame shows the app in an iframe, its own realm with its own React and instances.
    ...(viewport ? { sidebar: "background", pageRoot: document.querySelector("main")!, frame: { mode: "iframe" } } : { sidebar: "edge" }),
  } as never);
};
