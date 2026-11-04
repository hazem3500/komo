export function mountConnectScene() {
  const scene = document.querySelector<HTMLElement>(".connect-example");
  if (!scene) return;
  const root = scene;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const play = scene.querySelector<HTMLButtonElement>("[data-example-play]")!;
  const pauseIcon = play.innerHTML;
  const playIcon =
    document.querySelector<HTMLTemplateElement>("#play-icon")!.innerHTML;
  const approved = scene.querySelector<HTMLElement>(".connect-approved")!;
  const signin = scene.querySelector<HTMLElement>(".connect-signin-window")!;
  const phases = [
    "Choose Connect Palette in your app’s sidebar.",
    "Connect Palette opens a setup form for your sites.",
    "Review the detected production and preview addresses.",
    "Sign in with Google in the separate window.",
    "Palette is connected. Commenting is open on your site.",
  ];
  const durations = [2000, 700, 1000, 2000, 2800];
  // The active workflow step for each loop phase.
  const range = [0, 0, 2, 3, 3];
  let step = reduced.matches ? phases.length - 1 : 0;
  let paused = reduced.matches;
  let visible = false;
  let timer = 0;
  function render() {
    root.dataset.step = String(step);
    root.dataset.paused = String(paused || !visible || document.hidden);
    root.querySelectorAll<HTMLElement>("[data-reveal]").forEach((node) => {
      const shown = step >= Number(node.dataset.reveal);
      node.dataset.shown = String(shown);
      node.setAttribute("aria-hidden", String(!shown));
    });
    approved.setAttribute("aria-hidden", String(step !== 4));
    signin.setAttribute("aria-hidden", String(step !== 3));
    root
      .querySelectorAll<HTMLButtonElement>("[data-example-step]")
      .forEach((button) => {
        button.setAttribute(
          "aria-pressed",
          String(range[step] === Number(button.dataset.exampleStep)),
        );
      });
    play.innerHTML = paused ? playIcon : pauseIcon;
    play.setAttribute(
      "aria-label",
      `${paused ? "Play" : "Pause"} connect example`,
    );
  }
  function schedule() {
    clearTimeout(timer);
    render();
    if (paused || !visible || document.hidden) return;
    timer = window.setTimeout(() => {
      step = (step + 1) % phases.length;
      schedule();
    }, durations[step]);
  }
  play.addEventListener("click", () => {
    paused = !paused;
    schedule();
  });
  scene
    .querySelector("[data-example-replay]")!
    .addEventListener("click", () => {
      step = reduced.matches ? phases.length - 1 : 0;
      paused = reduced.matches;
      schedule();
    });
  scene
    .querySelectorAll<HTMLButtonElement>("[data-example-step]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        step = Number(button.dataset.exampleStep);
        paused = true;
        schedule();
      });
    });
  new IntersectionObserver(
    ([entry]) => {
      visible = !!entry?.isIntersecting;
      schedule();
    },
    { threshold: 0.2 },
  ).observe(scene);
  document.addEventListener("visibilitychange", schedule);
  reduced.addEventListener("change", () => {
    paused = reduced.matches;
    if (paused) step = phases.length - 1;
    schedule();
  });
  render();
  schedule();
}