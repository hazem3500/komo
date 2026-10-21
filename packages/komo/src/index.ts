import { readablePageLabel } from "./page-label.js";
import {
  connectProject,
  rememberProject,
  resumeProject,
  setupSites,
} from "./connect-project.js";
import { resolveConfig, type KomoConfig } from "./config.js";
export type { KomoConfig } from "./config.js";
import { adaptivePolling } from "./polling.js";
import { pinDirection } from "./pin-direction.js";
import { byAge, collisions, hitArea, pinStacks, stackWidth } from "./pin-stacks.js";
import type { PinUnit } from "./pin-groups.js";
import { drawHighlight, watchHighlight } from "./highlight.js";
import { createFramePortals, preserveFrameStyles } from "./frame-portals.js";
import { createFrameViewport } from "./frame-viewport.js";
import {
  clientPoint,
  counterpart,
  framedByKomo,
  isElement,
  onFrame,
  pageDocument,
  pageElementsAt,
  pageFrame,
  screenRect,
} from "./frame-target.js";
import type { FrameViewport } from "./frame-iframe.js";
import { OptimisticQueue } from "./optimistic.js";
import { agentPrompt } from "./agent-prompt.js";
import { accentPicker } from "./lazy-accent-picker.js";
import { applyAccent, DEFAULT_ACCENT } from "./accent.js";
import { cardMotion } from "./card-motion.js";
import { drawerPresence } from "./drawer-presence.js";
import { floatingDrag, constrain, type Placement } from "./floating-drag.js";
import {
  EDGE_MARGIN,
  EDGE_SIDEBAR_MAX_HEIGHT,
  EDGE_SIDEBAR_MIN_HEIGHT,
  EDGE_SIDEBAR_MIN_WIDTH,
  EDGE_SIDEBAR_WIDTH,
  edgeSidebarOffsets,
  edgeSidebarPlacement,
  resizeEdgeBox,
  type EdgeResizeDir,
} from "./edge-sidebar.js";
import {
  boxFromAnchor,
  compressedDrawerSize,
  drawerCollapse,
  drawerExpandCompress,
  drawerExpandSpring,
  drawerRowEnter,
  drawerRowEnterDelay,
  drawerRowExit,
  drawerRowStagger,
} from "./drawer-expand-motion.js";
import { recordEmoji } from "./emoji-history.js";
import { reactionPicker } from "./reaction-picker.js";
import { appendMessageLinks } from "./message-links.js";
import { animate, loadMotion } from "./lazy-motion.js";
import { actionMenu, selectionMenu } from "./action-menu.js";
import {
  frameView,
  isCompactReview,
  mobileComposerPosition,
  pinBox,
  placeCard,
  reviewLayout,
} from "./review-layout.js";
import type { FrameSizeControls } from "./frame-size.js";
import { createToolbar, type ToolbarMenuItem } from "./lazy-toolbar.js";
import { defaultToolbarItems, normalizeToolbarItems, toolbarLayout } from "./toolbar-items.js";
import { canonicalPage } from "./page.js";
import { allPages as everyPage, inPersistentRegion, threadOnPage } from "./thread-scope.js";
import { openState } from "./open-state.js";
import { ApiError, CommentsApi } from "./api.js";
import { connectionIssue, type ConnectionIssue } from "./connection-issue.js";
import {
  captureAnchor,
  commentAnchorTarget,
  anchorPass,
  resolveAnchor,
  locateAnchor as measureAnchor,
} from "./anchors.js";
import {
  age,
  avatar,
  button,
  textEntry,
  el,
  googleLogo,
  icon,
  icons,
  initials,
  isolated,
  isolatedEvents,
  isolateEscape,
  onPage,
  reducedMotion,
  setAvatarResolver,
} from "./dom.js";
import { matchesShortcut, resolveDesignKeys, resolveShortcuts, type Shortcut } from "./shortcuts.js";
import { isMac, renderKbd } from "./kbd.js";
import { styles } from "./styles.js";
import type {
  Anchor,
  Comment,
  CommentsController,
  CommentsOptions,
  PinSize,
  Thread,
} from "./types.js";
export type * from "./types.js";

const pinSizes: readonly PinSize[] = ["full", "compact", "dot", "auto"];
const pinSizeNames: Record<PinSize, string> = { full: "Full", compact: "Compact", dot: "Dot", auto: "Auto" };

const instances = new WeakMap<
  Document,
  { scope: string; controller: CommentsController }
>();

/** Initialize from inline public project settings. */
export function initKomo(config: KomoConfig): CommentsController {
  return initComments(resolveConfig(config));
}

/** Mount once on the client. The returned destroy() restores the host page. */
export function initComments(options: CommentsOptions): CommentsController {
  const noop: CommentsController = {
    destroy() {},
    open() {},
    close() {},
    comment() {},
    async refresh() {},
  };
  if (typeof document === "undefined" || options.enabled === false || framedByKomo()) return noop;
  if (!options.endpoint || !options.repo || !options.branch || !options.project)
    throw new Error("Comments require endpoint, repo, branch, and project.");
  if (
    options.pageRoot &&
    (options.pageRoot === document.body ||
      !document.body.contains(options.pageRoot))
  )
    throw new Error("pageRoot must be mounted inside body.");
  const endpoint = new URL(options.endpoint);
  if (
    endpoint.username ||
    endpoint.password ||
    (endpoint.protocol !== "https:" &&
      !(
        endpoint.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)
      ))
  )
    throw new Error(
      "Use an HTTPS API endpoint without credentials; HTTP is allowed on localhost.",
    );
  setAvatarResolver(options.avatar);
  const shortcuts = resolveShortcuts(options.shortcuts);
  const designKeys = resolveDesignKeys(options.shortcuts);
  const hostPinSize = options.pins?.size ?? "full";
  if (!pinSizes.includes(hostPinSize))
    throw new Error(`Invalid komo pins.size: "${hostPinSize}".`);
  const designEnabled = options.features?.designMode !== false;
  // The toolbar's latest commands, for shortcut help.
  let helpItems: ToolbarMenuItem[] = [];
  const toolbarItems = normalizeToolbarItems(options.toolbar?.items);
  const tagsEnabled = options.features?.tags !== false;
  const scope = JSON.stringify([
    endpoint.href,
    options.project,
    options.repo,
    options.branch,
  ]);
  const current = instances.get(document);
  if (current) {
    if (current.scope !== scope)
      throw new Error(
        "Destroy the current komo instance before changing projects or branches.",
      );
    return current.controller;
  }
  options = { ...resumeProject(options) };
  const roots = [...document.body.childNodes].filter((node) =>
    node instanceof Element
      ? !node.matches("script,style,link,meta,template,noscript")
      : node.nodeType === 3 && node.textContent?.trim(),
  );
  const root =
    options.pageRoot ??
    (roots.length === 1 && roots[0] instanceof HTMLElement
      ? roots[0]
      : document.body);
  const surface =
    getComputedStyle(root).display === "contents" ? document.body : root;
  const canFrame = surface !== document.body;
  const sidebarModeKey = `branch-comments:sidebar-mode:${options.project}:${options.repo}`;
  let sidebarMode: "background" | "edge" = (() => {
    if (!canFrame) return "edge";
    try {
      const stored = localStorage.getItem(sidebarModeKey);
      if (stored === "edge" || stored === "background") return stored;
    } catch {
      /* Fall back to the configured mode when storage is blocked. */
    }
    return options.sidebar === "background" ? "background" : "edge";
  })();
  // A reviewer's pin size wins over the host default, like the sidebar mode.
  const pinSizeKey = `branch-comments:pin-size:${options.project}:${options.repo}`;
  let pinSize = hostPinSize;
  try {
    const stored = localStorage.getItem(pinSizeKey) as PinSize | null;
    if (stored && pinSizes.includes(stored)) pinSize = stored;
  } catch {
    /* Use the host default when storage is blocked. */
  }
  // Dots are filled until this browser has opened the thread's latest comment.
  const readKey = `branch-comments:read:${options.project}:${options.repo}`;
  let readAt: Record<string, number> = {};
  try {
    const stored = JSON.parse(localStorage.getItem(readKey) ?? "{}");
    if (stored && typeof stored === "object") readAt = stored;
  } catch {
    /* Every thread reads as unread when storage is blocked. */
  }
  const unread = (thread: Thread) => {
    const last = thread.comments.at(-1);
    return !!last && last.author.id !== api.user?.id && !(readAt[thread.id]! >= last.createdAt);
  };
  function markRead(thread: Thread) {
    const last = thread.comments.at(-1)?.createdAt ?? 0;
    if (readAt[thread.id]! >= last) return;
    delete readAt[thread.id];
    readAt[thread.id] = last;
    const ids = Object.keys(readAt);
    for (const id of ids.slice(0, Math.max(0, ids.length - 500))) delete readAt[id];
    try {
      localStorage.setItem(readKey, JSON.stringify(readAt));
    } catch {
      /* Read state lasts for this page when storage is blocked. */
    }
  }
  let compactSidebar = isCompactReview(window.innerWidth, window.innerHeight);
  let edgeSidebar = !compactSidebar && sidebarMode === "edge";
  // Set while Design mode has temporarily framed a floating sidebar, moved it
  // off its target, or the user has dragged it this session.
  let designFrame = false,
    designMoved = false,
    designDragged = false;
  // Development comments use a separate server-backed channel.
  const localSite = ["localhost", "127.0.0.1", "[::1]"].includes(
    location.hostname,
  );
  const sharedBranch = options.branch;
  const channelKey = `branch-comments:channel:${options.project}:${options.repo}`;
  let channel: "local" | "shared" = "local";
  try {
    if (localStorage.getItem(channelKey) === "shared") channel = "shared";
  } catch {
    /* Default to the local channel when storage is blocked. */
  }
  if (localSite && channel === "local")
    options = { ...options, branch: "local" };
  let api = new CommentsApi(options);
  const abort = new AbortController();
  let destroyed = false,
    expanded = !!options.onboarding,
    mode = false,
    commentMode = false,
    hidden = options.showToolbar === false,
    toolbarDismissed = options.showToolbar === false,
    designActive = false,
    designReturnToComments = false,
    designReturnScrollTop = 0,
    account = !!options.onboarding,
    pending = false,
    refreshing = false,
    knownThreads = !!options.onboarding,
    sessionRevision = 0;
  let designReturnExpanded: boolean | null = null;
  let threads: Thread[] = [],
    selected: string | null = null,
    draft: Anchor | null = null;
  type ThreadRequest = { id: string; inspect: boolean; pending: boolean; rejected: boolean; opened?: boolean };
  let threadRequest: ThreadRequest | null = null;
  const cancelledLinks = new Set<string>();
  function cancelThreadRequest() {
    if (threadRequest && !threadRequest.opened) cancelledLinks.add(threadRequest.id);
    threadRequest = null;
  }
  // Made on this page, or shown on all pages with its anchor present here.
  const here = (thread: Thread, resolve: (anchor: Anchor) => unknown = resolveAnchor, current = page()) =>
    threadOnPage(thread, current, resolve);
  function onThreadPage(thread: Thread) {
    return here(thread) && !(threadRequest?.id === thread.id && (threadRequest.pending || threadRequest.rejected));
  }
  type DesignController = ReturnType<typeof import("./design-mode.js").createDesignMode>;
  let designController: DesignController | null = null;
  let designControllerPromise: Promise<DesignController | null> | null = null;
  const optimistic = new OptimisticQueue<Thread[]>(
    [],
    (next) => {
      if (destroyed) return;
      if (selected) {
        const id = optimistic.id(selected);
        if (id !== selected) {
          if (replies.has(selected)) {
            replies.set(id, replies.get(selected)!);
            replies.delete(selected);
          }
          if (dialogKey === selected) dialogKey = id;
          selected = id;
        }
      }
      if (editing) editing = optimistic.id(editing);
      threads = next;
      pinSnapshot = "";
      renderPins();
      renderList();
      renderToolbar();
      if (!account) renderDialog();
    },
    (next, id) =>
      next.map((thread) => ({
        ...thread,
        id: id(thread.id),
        comments: thread.comments.map((comment) => ({
          ...comment,
          id: id(comment.id),
        })),
      })),
  );
  function changeThread(id: string, change: (thread: Thread) => Thread | null) {
    return (items: Thread[], resolve: (id: string) => string) =>
      items.flatMap((thread) => {
        if (thread.id !== resolve(id)) return [thread];
        const next = change(thread);
        return next ? [next] : [];
      });
  }
  async function saveOptimistic(
    change: Parameters<typeof optimistic.submit>[0],
    save: Parameters<typeof optimistic.submit>[1],
    rollback?: () => void,
  ) {
    const client = api;
    const token = api.token;
    const session = sessionRevision;
    const obsolete = () =>
      destroyed ||
      api !== client ||
      session !== sessionRevision ||
      api.token !== token;
    try {
      await optimistic.submit(change, async (resolve) => {
        if (obsolete()) throw new DOMException("Session changed", "AbortError");
        return save(resolve);
      });
    } catch (reason) {
      if (obsolete()) throw new DOMException("Session changed", "AbortError");
      rollback?.();
      render();
      throw new Error(
        `Couldn't save. Your change was reverted. ${reason instanceof Error ? reason.message : "Try again."}`,
        { cause: reason },
      );
    }
    if (obsolete()) throw new DOMException("Session changed", "AbortError");
    if (!optimistic.busy) run(refresh);
  }
  let filter: "open" | "resolved" | "all" = "open",
    tagFilter = "",
    allPages = true,
    search = "",
    connection = "Connecting",
    error = "";
  let profileDraft: {
    name: string;
    avatarUrl: string;
    accentColor: string;
  } | null = null;
  let disposeAccentPicker: (() => void) | undefined;
  let profileSaveTimer = 0;
  let profileRevision = 0;
  let confirmedProfile: import("./types.js").Identity | null = null;
  let profileSaveQueue = Promise.resolve();
  let queuedProfile: {
    name: string;
    avatarUrl: string;
    accentColor: string;
    token: string;
    revision: number;
  } | null = null;
  function saveProfile() {
    clearTimeout(profileSaveTimer);
    const next = queuedProfile;
    queuedProfile = null;
    if (!next) return profileSaveQueue;
    profileSaveQueue = profileSaveQueue
      .catch(() => {})
      .then(async () => {
        if (api.token !== next.token) return;
        try {
          const result = await api.request<{
            user: import("./types.js").Identity;
          }>("me", "PATCH", {
            name: next.name,
            avatarUrl: next.avatarUrl,
            accentColor: next.accentColor,
          });
          if (api.token !== next.token) return;
          confirmedProfile = result.user;
          if (profileRevision === next.revision)
            api.save({ token: next.token, user: result.user });
          if (!destroyed) {
            renderToolbar();
            run(refresh);
          }
        } catch (error) {
          if (api.token === next.token && profileRevision === next.revision) {
            api.user = confirmedProfile;
            profileDraft = null;
            render();
          }
          throw new Error(
            `Couldn't save your profile. ${error instanceof Error ? error.message : "Try again."}`,
            { cause: error },
          );
        }
      });
    return profileSaveQueue;
  }
  function queueProfileSave(
    profile: { name: string; avatarUrl: string; accentColor: string },
    immediate = false,
  ) {
    if (!api.token || !profile.name.trim()) return;
    if (!confirmedProfile || confirmedProfile.id !== api.user?.id)
      confirmedProfile = api.user ? { ...api.user } : null;
    queuedProfile = {
      ...profile,
      name: profile.name.trim(),
      token: api.token,
      revision: ++profileRevision,
    };
    if (api.user)
      api.user = { ...api.user, ...profile, name: profile.name.trim() };
    renderToolbar();
    clearTimeout(profileSaveTimer);
    if (immediate) run(saveProfile);
    else profileSaveTimer = window.setTimeout(() => run(saveProfile), 500);
  }
  function googleSignIn() {
    const control = button(
      "Continue with Google",
      () => run(() => githubLogin("google")),
      "google-signin secondary",
    );
    control.prepend(googleLogo());
    return control;
  }
  let accessError = "";
  let issue: ConnectionIssue | null = null;
  let projectLoaded = false;
  let privateProject = false;
  let connectingProject = false;
  let setupSiteDraft =
    options.onboarding?.sites
      ?.filter(
        (site) => site.startsWith("https://") && site !== location.origin,
      )
      .join("\n") ?? "";
  let google = false;
  let movingThread: string | null = null;
  let pinMove: ReturnType<typeof import("./pin-move.js").startPinMove> | null = null;
  let pinMoveRevision = 0;
  let github = false,
    guests = false,
    guestResolve = false,
    apiTokens = false;
  // The Account panel's API tokens view keeps its node (and a shown secret) until left.
  let tokenView: import("./account-tokens.js").TokenView | undefined;
  let tokenLoad: Promise<HTMLElement> | undefined;
  let tokenApi: CommentsApi | undefined;
  let parkedDraft: { anchor: Anchor; text: string } | null = null;
  const recoveredDrafts: { anchor: Anchor; text: string }[] = [];
  let dialogKey: string | null = null;
  // The open card whose anchor was last seen on the page.
  let attachedKey: string | null = null;
  const cardPlacements = new Map<string, Placement>();
  const cardFollow = cardMotion(() => positionNotice());
  let draggedPin: { id: string; x: number; y: number } | null = null;
  let toolbarPlacement: Placement | undefined;
  const placementKey = `branch-comments:drawer:${options.project}:${options.repo}`;
  let savedToolbarPlacement: Placement | undefined;
  try {
    const stored = JSON.parse(localStorage.getItem(placementKey) ?? "null");
    if (stored && Number.isFinite(stored.x) && Number.isFinite(stored.y)) {
      savedToolbarPlacement = {
        x: stored.x,
        y: stored.y,
        edgeX: ["left", "right"].includes(stored.edgeX)
          ? stored.edgeX
          : undefined,
        edgeY: ["top", "bottom"].includes(stored.edgeY)
          ? stored.edgeY
          : undefined,
      };
      toolbarPlacement = savedToolbarPlacement;
    }
  } catch {
    /* Storage may be unavailable on embedded previews. */
  }
  const sidebarPlacementKey = `branch-comments:sidebar:${options.project}:${options.repo}`;
  let savedSidebarPlacement: Placement | undefined;
  let sidebarPlacement: Placement | undefined;
  let sidebarPeek = false;
  let sidebarWidth = EDGE_SIDEBAR_WIDTH;
  let sidebarHeight: number | null = null;
  try {
    const stored = JSON.parse(
      localStorage.getItem(sidebarPlacementKey) ?? "null",
    );
    if (Number.isFinite(stored?.width)) sidebarWidth = stored.width;
    if (Number.isFinite(stored?.height)) sidebarHeight = stored.height;
    if (stored && Number.isFinite(stored.x) && Number.isFinite(stored.y)) {
      savedSidebarPlacement = {
        x: stored.x,
        y: stored.y,
        edgeX: ["left", "right"].includes(stored.edgeX)
          ? stored.edgeX
          : undefined,
        edgeY: ["top", "bottom"].includes(stored.edgeY)
          ? stored.edgeY
          : undefined,
      };
      sidebarPlacement = savedSidebarPlacement;
    }
  } catch {
    /* Storage may be unavailable on embedded previews. */
  }
  const exitingDialogs = new Map<HTMLElement, (() => void) | undefined>();
  // Design mode proposals render as change cards; the module loads on first use.
  const designProposal = /^Proposed .+ \(preview only\)$/m;
  let designComments: Promise<typeof import("./design-comment.js")> | undefined;
  let summarizeDesign: ((body: string) => string) | undefined;
  // Once loaded, redraws render synchronously so dialogs don't change height.
  let designModule: typeof import("./design-comment.js") | undefined;
  const loadDesignComments = () =>
    (designComments ??= import("./design-comment.js").then((module) => {
      designModule = module;
      summarizeDesign = module.summarizeDesignComment;
      // Pin labels were drawn with the placeholder; refresh them with summaries.
      if (!destroyed) {
        pinSnapshot = "";
        renderPins(true);
      }
      return module;
    }));
  /**
   * Element a design change targets. The comment's anchor (scoped path, text,
   * context) wins when the recorded selector agrees or is ambiguous, as older
   * class-only selectors are; an exact selector wins if the pin has moved.
   */
  const designTarget = (anchor: Anchor) => (selector?: string) => {
    const anchored = resolveAnchor(anchor);
    let found: Element[] = [];
    try {
      if (selector) found = [...document.querySelectorAll(selector)];
    } catch {
      /* Not a valid selector; use the anchor. */
    }
    return found.length !== 1 || (anchored && found.includes(anchored)) ? (anchored ?? found[0] ?? null) : found[0];
  };
  /** Short text for pins and previews; design proposals read as a summary, not raw text. */
  const commentText = (body: string) =>
    designProposal.test(body)
      ? (summarizeDesign?.(body) ?? (void loadDesignComments(), "Design change"))
      : body;
  const firstLine = (body: string) => commentText(body).trim().split("\n")[0]!.slice(0, 100);
  let draftText = "",
    // A Design mode proposal attached to the new comment, shown as a change card.
    draftProposal = "",
    draftTags: string[] = [],
    guestName = "",
    editing: string | null = null,
    editText = "";
  let closePicker: ((immediate?: boolean) => void) | undefined;
  let submitAfterIdentity: (() => Promise<void>) | null = null;
  let focusBack = false;
  let lastPage = page(),
    toastTimer = 0,
    listScrollTimer = 0,
    frame = 0,
    githubTimer = 0;
  const replies = new Map<string, string>();
  const replySelections = new Map<string, [number, number, "forward" | "backward" | "none"]>();
  const host = el("div");
  // Names the project, so per-project preferences (recent colors) need no extra wiring.
  host.dataset.branchComments = options.project;
  host.dataset.sidebar = compactSidebar
    ? "mobile"
    : edgeSidebar
      ? "edge"
      : "background";
  Object.assign(host.style, {
    position: "fixed",
    inset: "0",
    pointerEvents: "none",
    zIndex: "2147483647",
    isolation: "isolate",
  });
  const shadow = host.attachShadow({ mode: "open" });
  const style = el("style");
  style.textContent = styles;
  const catcher = el("div", "catch");
  catcher.hidden = true;
  const pins = el("div", "pins"),
    dialogs = el("div"),
    toolbar = el("div", "toolbar"),
    sidebar = el("div"),
    hints = el("div");
  sidebar.tabIndex = -1;
  if (edgeSidebar) sidebar.classList.add("edge-sidebar");
  const edgeSensor = el("div", "edge-sidebar-sensor");
  edgeSensor.hidden = true;
  Object.assign(pins.style, { position: "fixed", inset: "0" });
  const pinPreview = el("div", "pin-preview");
  pinPreview.hidden = true;
  let previewTimer = 0;
  let previewSuppressed = false;
  let previewClosing = false;
  let previewThread: string | null = null;
  let previewMotion: Animation | null = null;
  let openingPreview: DOMRect | null = null;
  let hoverPreviewKey = "";
  const hidePreview = (immediate = false) => {
    window.clearTimeout(previewTimer);
    if (pinPreview.hidden || (previewClosing && !immediate)) return;
    // Undo a Before/After preview started from the hover card, keeping the open comment's.
    designModule?.resetDesignPreviews(
      new Set([...(threads.find((item) => item.id === selected && onThreadPage(item))?.comments.map((item) => item.id) ?? []), "draft"]),
    );
    previewClosing = true;
    previewMotion?.cancel();
    if (immediate || reducedMotion()) {
      pinPreview.hidden = true;
      previewThread = null;
      return;
    }
    const motion = pinPreview.animate(
      [
        { opacity: 1, transform: "scale(1)" },
        { opacity: 0, transform: "translateY(3px) scale(.99)" },
      ],
      { duration: 150, easing: "cubic-bezier(.22,1,.36,1)", fill: "forwards" },
    );
    previewMotion = motion;
    void motion.finished
      .then(() => {
        if (previewMotion === motion) {
          pinPreview.hidden = true;
          previewThread = null;
        }
      })
      .catch(() => {});
  };
  pinPreview.addEventListener("pointerenter", () => {
    if (previewSuppressed || movingThread || draggedPin) return;
    previewClosing = false;
    window.clearTimeout(previewTimer);
    previewMotion?.cancel();
  });
  pinPreview.addEventListener("pointerleave", () => hidePreview());
  const hoverOutline = el("div", "component-hover");
  hoverOutline.setAttribute("aria-hidden", "true");
  let hoverTarget: Element | null = null;
  let hoverPoint: { x: number; y: number } | null = null;
  let hoverFrame = 0;
  const live = el("div", "sr-only");
  live.setAttribute("aria-live", "polite");
  const toolbarRoot = createToolbar(toolbar, (id) => {
    if (id === "account") {
      if (!api.user) return icon("person");
      const portrait = avatar(api.user);
      portrait.classList.add("review-avatar");
      return portrait;
    }
    return icon(id as keyof typeof icons);
  });
  shadow.append(
    style,
    catcher,
    hoverOutline,
    pins,
    sidebar,
    edgeSensor,
    dialogs,
    pinPreview,
    hints,
    toolbar,
    live,
  );
  document.body.append(host);
  // Modal libraries hide every body sibling from assistive tech; komo stays
  // reachable. A capped rate yields to a library that keeps re-applying.
  let unhidden = 0,
    unhiddenAt = 0;
  const hostGuard = new MutationObserver((records) => {
    if (Date.now() - unhiddenAt > 1e3) [unhidden, unhiddenAt] = [0, Date.now()];
    if (++unhidden < 20)
      for (const record of records) host.removeAttribute(record.attributeName!);
  });
  hostGuard.observe(host, { attributeFilter: ["aria-hidden", "inert"] });
  const html = document.documentElement;
  function rememberStyles<K extends keyof CSSStyleDeclaration>(element: HTMLElement, keys: K[]): Pick<CSSStyleDeclaration, K> {
    return Object.fromEntries(keys.map((key) => [key, element.style[key]])) as Pick<CSSStyleDeclaration, K>;
  }
  const savedStyle = rememberStyles(surface, [
    "width", "boxSizing", "zoom", "transformOrigin", "transform", "position", "left", "top",
    "height", "minHeight", "paddingBottom", "overflow", "borderRadius", "background",
    "borderRight", "borderBottom", "clipPath",
  ]);
  const surfaceProperties = Object.keys(savedStyle).map((key) => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`));
  const restoreSurface = preserveFrameStyles(surface, surfaceProperties);
  const savedBody = rememberStyles(document.body, ["overflow", "background"]);
  const restoreBody = preserveFrameStyles(document.body, ["overflow", "background"]);
  const restoreHtml = preserveFrameStyles(html, ["overflow", "background"]);
  const fixedHeaders = new Map<HTMLElement, () => void>();
  const savedHtmlBackground = html.style.background;
  const portalFrame = createFramePortals(surface, host, options.frame?.include, geometry);
  // Reflow makes the frame the page's viewport, so viewport units follow it too.
  const frameViewport = createFrameViewport(host);
  // The visual frame in page CSS pixels, before any panning scroll.
  let frameBox = { left: 0, top: 0, width: 0, height: 0, logical: [0, 0], pan: false };
  // Size controls own a chosen logical viewport; until they load, it is the window at Fit.
  const frameSizeKey = `branch-comments:frame-size:${options.project}:${options.repo}`;
  let frameControls: FrameSizeControls | undefined;
  let frameControlsLoading = false;
  let frameArea: { left: number; top: number; width: number; height: number } | null = null;
  // Viewport mode (frame.mode "iframe"): the page in its own same-origin iframe.
  const viewportEnabled = options.frame?.mode === "iframe" && options.frame.scale !== true;
  let viewport: FrameViewport | undefined;
  let viewportOpening = false;
  // The iframe shows a same-origin page and komo reads the page through it.
  let viewportShown = false;
  // The last layout used the iframe, so this page was left untouched beneath it.
  let laidViewport = false;
  let viewportFailed = "";
  let storedInPlace = options.frame?.defaultMode === "transform";
  try {
    // Versioned like frame-size.ts's record; older entries mean the default.
    const stored = JSON.parse(localStorage.getItem(frameSizeKey) ?? "{}");
    storedInPlace = stored.v === 2 && typeof stored.inPlace === "boolean" ? stored.inPlace : options.frame?.defaultMode === "transform";
  } catch {
    /* Storage is blocked: viewport mode is the default. */
  }
  const wantsViewport = () =>
    viewportEnabled && !viewportFailed && (frameControls ? frameControls.separate : !storedInPlace);
  function closeViewport() {
    if (!viewport) return;
    viewport.destroy();
    viewport = undefined;
    viewportShown = false;
    // In place again: the bar's note, the stage pan and its scrollbars come back.
    frameControls?.status({ active: false });
    followSelection();
  }
  // Design mode's selection moves to the same element in the page now shown.
  function followSelection() {
    const previous = designController?.selected;
    if (!previous || previous.ownerDocument === pageDocument()) return;
    const next = counterpart(previous, pageDocument());
    designController!.clearSelection();
    if (next) designController!.select(next);
  }
  const relayout = () => {
    appliedViewport = "";
    scalePage();
    checkPage();
    geometry();
  };
  function openViewport() {
    if (viewport || viewportOpening) return;
    viewportOpening = true;
    frameControls?.status({ active: false, loading: true });
    // Where the reviewer was reading, before Frame moves this page.
    const scroll = framed && !laidViewport ? surface.scrollTop : window.scrollY / htmlZoom();
    void import("./frame-iframe.js").then(({ openFrameViewport }) => {
      viewportOpening = false;
      if (destroyed || !framed || viewport || !wantsViewport()) return;
      const opened: FrameViewport = (viewport = openFrameViewport({
        parent: shadow,
        before: catcher,
        url: options.frame?.iframeUrl?.(location) ?? location.href,
        background: pageBackground,
        scroll,
        ready() {
          if (viewport !== opened) return;
          viewportShown = true;
          followSelection();
          frameControls?.status({ active: true });
          relayout();
        },
        failed(reason) {
          if (viewport !== opened) return;
          viewportFailed = reason;
          closeViewport();
          frameControls?.status({ active: false, reason });
          relayout();
        },
        changed() {
          checkPage();
          geometry();
        },
      }));
      relayout();
    });
  }
  /** The visible frame: the viewport iframe's port, else the page root. */
  const frameRect = () => (viewportShown && viewport ? viewport.port : surface).getBoundingClientRect();
  /** True for page elements shown inside the frame. */
  const inFramePage = (element: Element) =>
    viewportShown ? element.ownerDocument === pageDocument() : surface.contains(element);
  // pageRoot's counterpart in the viewport iframe.
  const framedRoot = (): Element => {
    const page = pageDocument();
    return page === document ? surface : (canFrame && counterpart(surface, page)) || page.body;
  };
  function loadFrameControls() {
    if (frameControlsLoading) return;
    frameControlsLoading = true;
    void import("./frame-size.js").then(({ mountFrameSize }) => {
      if (destroyed) return;
      frameControls = mountFrameSize(shadow, () => (viewportShown && viewport ? viewport.port : surface), frameSizeKey, (toggled) => {
        // Choosing Viewport again retries one that couldn't load.
        if (toggled) viewportFailed = "";
        appliedViewport = "";
        scalePage();
        geometry();
      }, frameView, viewportEnabled && (options.frame?.defaultMode === "transform" ? "transform" : "iframe"), {
        pan: schedulePan,
        // Switching to 100% keeps the open comment's target in view.
        anchor() {
          const thread = threads.find((item) => item.id === selected);
          const anchor = draft ?? (thread && onThreadPage(thread) ? thread.anchor : null);
          const spot = anchor && locateAnchor(anchor);
          return spot && spot.attached ? { x: spot.x / htmlZoom(), y: spot.y / htmlZoom() } : null;
        },
      });
      frameControls.status(viewportShown ? { active: true } : viewportFailed ? { active: false, reason: viewportFailed } : { active: false, loading: !!viewport || viewportOpening });
      // Re-layout only for a remembered size; the default keeps Frame's entrance motion.
      if (frameControls.sized) {
        appliedViewport = "";
        scalePage();
      } else frameControls.update(frameArea, htmlZoom());
    });
  }
  try {
    // Load a remembered size before Frame opens, so the page does not reflow twice.
    if (localStorage.getItem(frameSizeKey)) loadFrameControls();
  } catch {
    /* Storage is blocked: the default needs no controls until Frame opens. */
  }
  // A 100% frame larger than its stage pans by moving the page root; everything that
  // follows the frame moves in the same frame. Scroll events let Design mode, geometry
  // handles and the app's own floating UI re-measure: once on input, so their animation
  // frames run after this one, and once after the move, for those that measure at once.
  let panFrameId = 0;
  let panEvent = false;
  const panScroll = () => {
    panEvent = true;
    document.dispatchEvent(new Event("scroll", { bubbles: true }));
    panEvent = false;
  };
  function schedulePan() {
    if (panFrameId) return;
    panFrameId = requestAnimationFrame(panFrame);
    panScroll();
  }
  function panFrame() {
    panFrameId = 0;
    if (!framed || !frameArea || !frameControls || destroyed || laidViewport) return;
    const zoom = htmlZoom();
    const view = frameControls.view(
      { left: frameArea.left / zoom, top: frameArea.top / zoom, width: frameArea.width / zoom, height: frameArea.height / zoom },
      [window.innerWidth / zoom, window.innerHeight / zoom],
    );
    frameBox.left = view.left;
    frameBox.top = view.top;
    surface.style.left = `${view.left}px`;
    surface.style.top = `${view.top}px`;
    framePortals();
    frameControls.update(frameArea, zoom);
    renderPins(true);
    positionDialog();
    positionNotice();
    updateHover();
    panScroll();
  }
  function framePortals() {
    const zoom = htmlZoom();
    const left = frameBox.left;
    const top = frameBox.top;
    const { width, height } = frameBox;
    // The viewport iframe lays out its own portals and units; this page stays as it was.
    const active = framed && !destroyed && !laidViewport;
    const reflow = active && options.frame?.scale !== true;
    if (reflow) frameViewport.update(frameBox.logical);
    portalFrame.update(active ? {
      scale: appliedScale, left, top, zoom,
      bounds: { left, top, right: left + width, bottom: top + height, width, height },
    } : null);
    if (!reflow) frameViewport.update(null);
  }
  // The frame paints the page's own background; re-read it when a theme changes.
  // Frame's dark backdrop sits inline on body and html, so lift it while reading.
  function readPageBackground() {
    const backdrop = framed || pageTransitioning;
    const inline = [document.body.style.background, html.style.background];
    if (backdrop) {
      document.body.style.background = savedBody.background;
      html.style.background = savedHtmlBackground;
    }
    const color =
      [document.body, html]
        .map((node) => getComputedStyle(node).backgroundColor)
        .find((color) => color !== "rgba(0, 0, 0, 0)") ?? "#fff";
    if (backdrop) {
      [document.body.style.background, html.style.background] = inline;
      themeWatch.takeRecords();
    }
    return color;
  }
  let themeFrame = 0;
  const themeWatch = new MutationObserver(() => {
    themeFrame ||= requestAnimationFrame(() => {
      themeFrame = 0;
      pageBackground = readPageBackground();
      markPageTone();
      if (framed || pageTransitioning) surface.style.background = pageBackground;
    });
  });
  // Pin rings take the page's tone, so collapsed pins sit on light and dark sites.
  function markPageTone() {
    const [r, g, b] = /^rgb/.test(pageBackground) ? pageBackground.match(/[\d.]+/g)!.map(Number) : [255, 255, 255];
    pins.dataset.page = 0.2126 * r! + 0.7152 * g! + 0.0722 * b! < 128 ? "dark" : "light";
  }
  let framed = false;
  let pageTransitioning = false;
  let pageBackground = readPageBackground();
  markPageTone();
  for (const node of [html, document.body])
    themeWatch.observe(node, { attributes: true });
  let accountOpenTimer = 0;
  let pageMotion: Animation | undefined;
  function fadePage() {
    const opacity = Number(getComputedStyle(surface).opacity);
    // Reflow preserves native input coordinates and fixed descendants; fade without a transform.
    return surface.animate([{ opacity: opacity * 0.94 }, { opacity }], {
      duration: 250,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
    });
  }
  // True while reopening a remembered sidebar on load: skip the open motion.
  let restoring = false;
  const openStore = openState(
    `branch-comments:open:${options.project}:${options.repo}`,
    options.restoreOpen,
  );
  const toolbarDismissKey = `branch-comments:toolbar-dismissed:${options.project}:${options.repo}`;
  try {
    if (sessionStorage.getItem(toolbarDismissKey) === "1") {
      toolbarDismissed = true;
      hidden = true;
    }
  } catch {
    /* Keep the dismissal in memory when session storage is blocked. */
  }
  // Hide comments keeps review running for this tab: pins, cards and the open
  // layout step aside while drafts, selection and list state wait in memory.
  const visibilityKey = `branch-comments:comments-hidden:${options.project}:${options.repo}`;
  let commentsHidden = false,
    revealExpanded = false,
    revealScroll = 0;
  try {
    commentsHidden = !options.onboarding && sessionStorage.getItem(visibilityKey) === "1";
  } catch {
    /* Comments start shown when session storage is blocked. */
  }
  let searchOpen = false;
  let dockMotion: ReturnType<typeof animate> | undefined;
  let edgeMotions: ReturnType<typeof animate>[] = [];
  let edgeMorphGeneration = 0;
  let edgeMorphing = false;
  let drawerHome: {
    left: number;
    top: number;
    width: number;
    height: number;
  } | null = null;
  let dockCenter: number | undefined;
  let drawerContainerCenter: number | undefined;

  function placeToolbar(p: Placement) {
    // React mounts the drawer after its host; retain the saved coordinates until it has a size.
    if (!toolbar.offsetWidth || !toolbar.offsetHeight) return;
    toolbarPlacement = constrain(
      p,
      toolbar.offsetWidth,
      toolbar.offsetHeight,
      html.clientWidth,
      window.innerHeight,
    );
    toolbar.style.left = `${toolbarPlacement.x + toolbar.offsetWidth / 2}px`;
    if (toolbarPlacement.edgeY === "bottom" && !compactSidebar) {
      toolbar.style.top = "auto";
      toolbar.style.bottom = "calc(16px + env(safe-area-inset-bottom,0px))";
    } else {
      toolbar.style.top = `${toolbarPlacement.y}px`;
      toolbar.style.bottom = "auto";
    }
  }
  function placeSidebar(p: Placement) {
    if (sidebar.dataset.dragging === "true") {
      // Pointer moves already arrive constrained from floatingDrag. Avoid the
      // size reads and tip layout in positionSidebar on every touch event.
      sidebarPlacement = p;
      sidebar.style.left = `${p.x}px`;
      sidebar.style.top = `${p.y}px`;
      return;
    }
    if (!sidebar.offsetWidth) return;
    sidebarPlacement = constrain(
      p,
      sidebar.offsetWidth,
      sidebar.offsetHeight,
      html.clientWidth,
      window.innerHeight,
    );
    positionSidebar();
  }
  function applySidebarSize() {
    sidebar.style.width = `${sidebarWidth}px`;
    sidebar.style.height = sidebarHeight == null ? "" : `${sidebarHeight}px`;
    pointTips();
  }
  function persistSidebarPlacement() {
    savedSidebarPlacement = sidebarPlacement;
    try {
      localStorage.setItem(
        sidebarPlacementKey,
        JSON.stringify({
          ...savedSidebarPlacement,
          width: sidebarWidth,
          height: sidebarHeight,
        }),
      );
    } catch {
      /* Keep the placement in memory when storage is blocked. */
    }
  }
  function clampSidebarSize() {
    const vw = html.clientWidth;
    const vh = window.innerHeight;
    sidebarWidth = Math.min(
      Math.max(sidebarWidth, EDGE_SIDEBAR_MIN_WIDTH),
      Math.max(EDGE_SIDEBAR_MIN_WIDTH, vw - 2 * EDGE_MARGIN),
    );
    if (sidebarHeight != null)
      sidebarHeight = Math.min(
        Math.max(sidebarHeight, EDGE_SIDEBAR_MIN_HEIGHT),
        Math.max(
          EDGE_SIDEBAR_MIN_HEIGHT,
          Math.min(vh - 2 * EDGE_MARGIN, EDGE_SIDEBAR_MAX_HEIGHT),
        ),
      );
    applySidebarSize();
  }
  function positionSidebar() {
    if (compactSidebar || !edgeSidebar) return;
    // A size saved on a larger screen must not push the sidebar off this one.
    clampSidebarSize();
    const height =
      sidebar.offsetHeight ||
      Math.min(window.innerHeight - 2 * EDGE_MARGIN, EDGE_SIDEBAR_MAX_HEIGHT);
    const geometry = edgeSidebarPlacement(
      sidebarPlacement,
      sidebarWidth,
      height,
      html.clientWidth,
      window.innerHeight,
    );
    const offsets = edgeSidebarOffsets(
      geometry,
      html.clientWidth,
    );
    sidebar.style.left = `${geometry.x}px`;
    sidebar.style.top = `${geometry.y}px`;
    sidebar.style.setProperty(
      "--edge-account-max-height",
      `${Math.max(0, window.innerHeight - geometry.y - 28)}px`,
    );
    sidebar.style.right = "auto";
    sidebar.style.bottom = "auto";
    sidebar.style.transformOrigin =
      geometry.side === "left" ? "left center" : "right center";
    sidebar.style.setProperty("--edge-park-x", `${offsets.parked}px`);
    sidebar.style.setProperty("--edge-peek-x", `${offsets.peek}px`);
    edgeSensor.style.left = geometry.side === "left" ? "0px" : "";
    edgeSensor.style.right = geometry.side === "right" ? "0px" : "";
    if (expanded) {
      delete sidebar.dataset.collapsed;
      delete sidebar.dataset.peek;
      edgeSensor.hidden = true;
    } else {
      sidebar.dataset.collapsed = "true";
      if (sidebarPeek) sidebar.dataset.peek = "true";
      else delete sidebar.dataset.peek;
      edgeSensor.hidden = false;
    }
  }
  function syncEdgeMode() {
    host.dataset.sidebar = compactSidebar
      ? "mobile"
      : edgeSidebar
        ? "edge"
        : "background";
    sidebar.classList.toggle("edge-sidebar", edgeSidebar);
    sidebar.style.transition = "none";
    // Clear, don't zero: any translate makes the sidebar the containing block
    // for the fixed Frame panel and collapses it to zero height.
    sidebar.style.translate = "";
    sidebar.style.opacity = "";
    stopEdgeMotion(true);
    if (edgeSidebar) {
      if (!grip.isConnected) sidebar.prepend(grip);
    } else {
      grip.remove();
      delete sidebar.dataset.collapsed;
      delete sidebar.dataset.peek;
      edgeSensor.hidden = true;
    }
    void sidebar.offsetWidth;
    sidebar.style.transition = "";
  }
  let layoutMotions: Animation[] = [];
  let switchingSidebar = false;
  function stopLayoutMotion() {
    for (const motion of layoutMotions) motion.cancel();
    layoutMotions = [];
    pageTransitioning = false;
    pins.style.opacity = "";
  }
  function setSidebarMode(mode: "background" | "edge", temporary?: boolean) {
    if (
      compactSidebar ||
      mode === sidebarMode ||
      destroyed ||
      (!canFrame && mode === "background")
    )
      return;
    // Read the visible, possibly interrupted positions before settling layout.
    const nodes = () => [
      surface,
      sidebar.querySelector<HTMLElement>(".panel"),
      toolbar,
      dialogs.querySelector<HTMLElement>(".account-dialog"),
    ];
    const before = nodes().map((node) => node?.getBoundingClientRect());
    stopLayoutMotion();
    pageMotion?.cancel();
    pageMotion = undefined;
    dockMotion?.stop();
    dockMotion = undefined;
    stopEdgeMotion(true);
    clearEdgeRows();
    undockEdgeTabs();
    toolbar.style.translate = "";
    dockCenter = undefined;
    switchingSidebar = true;
    sidebarMode = mode;
    edgeSidebar = mode === "edge";
    if (!temporary) {
      designFrame = false;
      options = { ...options, sidebar: mode };
      try {
        localStorage.setItem(sidebarModeKey, mode);
      } catch {
        /* Keep the preference in memory when storage is blocked. */
      }
    }
    syncEdgeMode();
    scalePage();
    render();
    switchingSidebar = false;
    if (reducedMotion()) return;
    nodes().forEach((node, index) => {
      const from = before[index];
      if (!node?.isConnected || !from?.width) return;
      if (node === surface && options.frame?.scale !== true) {
        layoutMotions.push(fadePage());
        return;
      }
      if (node !== surface)
        node.getAnimations().forEach((motion) => motion.cancel());
      const to = node.getBoundingClientRect();
      if (!to.width) return;
      const zoom = to.width / node.offsetWidth;
      const end = getComputedStyle(node).transform;
      layoutMotions.push(
        node.animate(
          [
            {
              transform: `${end === "none" ? "" : end} translate(${(from.left - to.left) / zoom}px, ${(from.top - to.top) / zoom}px) scale(${from.width / to.width})`,
              transformOrigin: "top left",
            },
            { transform: end, transformOrigin: "top left" },
          ],
          { duration: 250, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
        ),
      );
    });
    const motions = layoutMotions;
    pageTransitioning = true;
    pins.style.opacity = "0";
    void Promise.all(motions.map((motion) => motion.finished))
      .then(() => {
        if (destroyed || motions !== layoutMotions) return;
        layoutMotions = [];
        pageTransitioning = false;
        pins.style.opacity = "";
        framePortals();
        portalFrame.reposition();
        geometry();
      })
      .catch(() => {});
  }
  function selectSetting<T extends string>(
    name: string,
    labelText: string,
    choices: Array<[T, string]>,
    value: T,
    onChange: (value: T) => void,
  ) {
    const field = el("div", "account-setting");
    const label = el("span", "account-setting-label", labelText);
    const select = selectionMenu(labelText, choices, value, (next) =>
      onChange(next as T),
    );
    select.querySelector("summary")!.dataset.focusKey = `setting-${name}`;
    field.append(label, select);
    return field;
  }
  function sidebarSetting() {
    if (compactSidebar)
      return selectSetting(
        "sidebar",
        "Sidebar",
        [["mobile", "Floating sidebar"]],
        "mobile",
        () => {},
      );
    if (!canFrame)
      return el("p", "muted", "Floating sidebar · Set pageRoot for Frame.");
    return selectSetting(
      "sidebar",
      "Sidebar",
      [
        ["edge", "Floating"],
        ["background", "Frame"],
      ],
      sidebarMode,
      setSidebarMode,
    );
  }
  function channelSetting() {
    const setting = selectSetting(
      "channel",
      "Comments",
      [
        ["local", "Local development"],
        ["shared", "Site comments"],
      ],
      channel,
      setChannel,
    );
    setting.append(
      el("p", "muted", "Separate channels, both saved to this project."),
    );
    return setting;
  }
  function setChannel(value: "local" | "shared") {
    if (value === channel || destroyed) return;
    if (pending || optimistic.busy) {
      notify("Wait for your changes to save.");
      return;
    }
    channel = value;
    try {
      localStorage.setItem(channelKey, value);
    } catch {
      /* Keep the choice in memory when storage is blocked. */
    }
    options = {
      ...options,
      branch: value === "local" ? "local" : sharedBranch,
    };
    api.cancelReads();
    api = new CommentsApi(options);
    refreshing = projectLoaded = false;
    lastRefresh = undefined;
    accessError = "";
    issue = null;
    connection = "Connecting";
    google = github = guests = guestResolve = privateProject = apiTokens = false;
    selected = null;
    draft = null;
    parkedDraft = null;
    hydrateThreads();
    render();
    retryConnection();
  }
  function hydrateThreads() {
    cancelThreadRequest();
    sessionRevision++;
    refreshing = false;
    accessError = "";
    selected = null;
    lastRefresh = undefined;
    const cached = api.cached();
    knownThreads = cached !== null;
    optimistic.reset(visibleThreads(cached ?? []));
  }
  const grip = el("div", "edge-sidebar-grip");
  grip.setAttribute("aria-hidden", "true");
  // The grip and Design mode's inspector heading both move the floating sidebar.
  const dragSidebar = (handle: HTMLElement) =>
    floatingDrag(
      sidebar,
      handle,
      placeSidebar,
      abort.signal,
      () => {
        // A manual move wins: Design mode stops avoiding until it reopens.
        designMoved = false;
        designDragged = true;
        presence.show();
      },
      () => {
        persistSidebarPlacement();
        presence.update();
      },
      () => expanded && edgeSidebar && !edgeMorphing,
    );
  dragSidebar(grip);
  sidebar.prepend(grip);
  const resizeDirs: EdgeResizeDir[] = [
    "n",
    "s",
    "e",
    "w",
    "ne",
    "nw",
    "se",
    "sw",
  ];
  for (const dir of resizeDirs) {
    const handle = el("div", `edge-sidebar-resize edge-sidebar-resize-${dir}`);
    handle.addEventListener(
      "pointerdown",
      (event) => {
        if (event.button !== 0 || !expanded || !edgeSidebar || edgeMorphing)
          return;
        event.preventDefault();
        event.stopPropagation();
        for (const animation of sidebar.getAnimations()) animation.cancel();
        sidebar.style.transition = "none";
        const start = sidebar.getBoundingClientRect();
        const startX = event.clientX;
        const startY = event.clientY;
        const move = (e: PointerEvent) => {
          if (e.pointerId !== event.pointerId) return;
          const next = resizeEdgeBox(
            dir,
            start,
            e.clientX - startX,
            e.clientY - startY,
            html.clientWidth,
            window.innerHeight,
          );
          sidebarWidth = next.width;
          if (dir.includes("n") || dir.includes("s"))
            sidebarHeight = next.height;
          sidebarPlacement = { x: next.left, y: next.top };
          sidebar.style.left = `${next.left}px`;
          sidebar.style.top = `${next.top}px`;
          applySidebarSize();
        };
        const end = (e: PointerEvent) => {
          if (e.pointerId !== event.pointerId) return;
          window.removeEventListener("pointermove", move, true);
          window.removeEventListener("pointerup", end, true);
          window.removeEventListener("pointercancel", end, true);
          sidebar.style.transition = "";
          persistSidebarPlacement();
          positionSidebar();
        };
        window.addEventListener("pointermove", move, {
          capture: true,
          passive: false,
        });
        window.addEventListener("pointerup", end, true);
        window.addEventListener("pointercancel", end, true);
      },
      { signal: abort.signal },
    );
    sidebar.append(handle);
  }
  for (const hint of ["left", "right", "top", "bottom"])
    sidebar.append(el("div", `edge-sidebar-snap edge-sidebar-snap-${hint}`));
  const peek = (value: boolean) => {
    sidebarPeek = value;
    if (!expanded && edgeSidebar && !edgeMorphing) positionSidebar();
  };
  edgeSensor.addEventListener("pointerenter", () => peek(true));
  edgeSensor.addEventListener("pointerleave", () => peek(false));
  edgeSensor.addEventListener("pointerup", (event) => {
    if (event.button === 0 && !expanded) toggleExpanded(true);
  });
  sidebar.addEventListener("pointerenter", () => peek(true));
  sidebar.addEventListener("pointerleave", () => peek(false));
  window.addEventListener(
    "resize",
    () => {
      if (destroyed || !edgeSidebar || edgeMorphing) return;
      clampSidebarSize();
      positionSidebar();
    },
    { signal: abort.signal, passive: true },
  );
  syncEdgeMode();
  const presence = drawerPresence(
    toolbar,
    () => expanded || mode || account || !!draft || !!selected,
    abort.signal,
    options.autoHideDrawer,
  );
  floatingDrag(
    toolbar,
    toolbar,
    placeToolbar,
    abort.signal,
    () => {
      presence.show();
      dockMotion?.stop();
      toolbar.style.translate = "0px 0px";
    },
    () => {
      savedToolbarPlacement = toolbarPlacement;
      try {
        localStorage.setItem(
          placementKey,
          JSON.stringify(savedToolbarPlacement),
        );
      } catch {
        /* Keep the placement in memory when storage is blocked. */
      }
      renderToolbar();
      presence.update();
    },
    () => !expanded,
    (target) => !!target.closest(".morphing-menu__shortcut"),
  );

  const toolbarSize = new ResizeObserver(() => {
    if (toolbar.dataset.edgeTabs === "true") return;
    if (toolbarPlacement) placeToolbar(toolbarPlacement);
    else if (options.drawerContainer) renderToolbar();
  });
  toolbarSize.observe(toolbar);
  if (options.drawerContainer) toolbarSize.observe(options.drawerContainer);

  const htmlZoom = () =>
    (html as HTMLElement & { currentCSSZoom?: number })
      .currentCSSZoom ?? 1;
  function page() {
    const current = (pageFrame()?.contentWindow?.location as Location | undefined) ?? location;
    return canonicalPage(options.page?.(current) ?? current.pathname);
  }
  type NoticePosition = {
    cardKey: string | null;
    left: number;
    top: number;
    anchor?: Anchor;
    offsetX: number;
    offsetY: number;
    scrollX: number;
    scrollY: number;
  };
  const noticePositions = new WeakMap<HTMLElement, NoticePosition>();
  let activeNotice: HTMLElement | null = null;
  let noticeFrame = 0;
  const noticeMoves = new WeakMap<
    HTMLElement,
    { animation: Animation; left: number; top: number }
  >();
  function followNotices() {
    cancelAnimationFrame(noticeFrame);
    if (destroyed || !shadow.querySelector(".floating-notice")) return;
    positionNotice();
    noticeFrame = requestAnimationFrame(followNotices);
  }
  function captureNoticePosition(
    anchor = draft ?? threads.find((t) => t.id === selected)?.anchor,
  ): NoticePosition | undefined {
    const rect = dialogs.firstElementChild?.getBoundingClientRect();
    if (!rect || account) return;
    const target = anchor ? locateAnchor(anchor) : null;
    return {
      cardKey: dialogKey,
      left: rect.left,
      top: rect.top,
      anchor,
      offsetX: rect.left - (target?.x ?? 0),
      offsetY: rect.top - (target?.y ?? 0),
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    };
  }
  function dismissNotice(toast: HTMLElement) {
    if (toast.dataset.closing) return;
    toast.dataset.closing = "true";
    toast.inert = true;
    toast.setAttribute("aria-hidden", "true");
    if (activeNotice === toast) {
      activeNotice = null;
      clearTimeout(toastTimer);
    }
    if (reducedMotion()) {
      toast.remove();
      return;
    }
    const exit = toast.animate(
      [
        {
          opacity: getComputedStyle(toast).opacity,
          translate: "0px 0px",
          scale: 1,
        },
        {
          opacity: 0,
          translate:
            toast.dataset.attached === "true"
              ? `0px ${(toast.dataset.placement === "above" ? 1 : -1) * (toast.offsetHeight / 2 + 10)}px`
              : "0px 3px",
          scale: toast.dataset.attached === "true" ? 0.94 : 0.99,
        },
      ],
      { duration: 150, easing: "cubic-bezier(.22,1,.36,1)", fill: "forwards" },
    );
    void exit.finished.catch(() => {}).finally(() => toast.remove());
  }
  function notify(
    text: string,
    action?: { label: string; run: () => void },
    position = captureNoticePosition(),
  ) {
    live.textContent = text;
    if (activeNotice) dismissNotice(activeNotice);
    const toast = el("div", "toast floating-notice");
    activeNotice = toast;
    if (position) noticePositions.set(toast, position);
    toast.setAttribute("role", action ? "alertdialog" : "status");
    toast.setAttribute("aria-label", text);
    toast.append(icon("info"), el("span", "", text));
    if (action)
      toast.append(
        button(
          action.label,
          () => {
            dismissNotice(toast);
            action.run();
          },
          "notice-action",
        ),
      );
    toast.append(
      button("Dismiss notice", () => dismissNotice(toast), "icon", "close"),
    );
    shadow.append(toast);
    positionNotice();
    followNotices();
    if (!reducedMotion())
      toast.animate(
        [
          {
            opacity: 0,
            translate:
              toast.dataset.attached === "true"
                ? `0px ${(toast.dataset.placement === "above" ? 1 : -1) * (toast.offsetHeight / 2 + 10)}px`
                : "0px 6px",
            scale: toast.dataset.attached === "true" ? 0.94 : 0.97,
          },
          { opacity: 1, translate: "0px 0px", scale: 1 },
        ],
        { duration: 250, easing: "cubic-bezier(.22,1,.36,1)" },
      );
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => dismissNotice(toast), 5000);
  }
  function positionNotice() {
    for (const toast of shadow.querySelectorAll<HTMLElement>(
      ".floating-notice",
    )) {
      const p = noticePositions.get(toast);
      if (!p) continue;
      const target = p.anchor ? locateAnchor(p.anchor) : null;
      const card =
        !account && dialogKey === p.cardKey ? dialogs.firstElementChild : null;
      const rect = card?.getBoundingClientRect();
      if (rect) {
        toast.style.maxWidth = `${Math.min(360, rect.width, innerWidth - 24)}px`;
        p.left = rect.left;
        p.top = rect.top;
        p.offsetX = rect.left - (target?.x ?? 0);
        p.offsetY = rect.top - (target?.y ?? 0);
        p.scrollX = window.scrollX;
        p.scrollY = window.scrollY;
      }
      const left = rect
        ? rect.left + (rect.width - toast.offsetWidth) / 2
        : target
          ? target.x + p.offsetX
          : p.left + p.scrollX - window.scrollX;
      const above =
        !!rect && rect.bottom + 10 + toast.offsetHeight > innerHeight - 12;
      toast.dataset.placement = above ? "above" : "below";
      const top = rect
        ? above
          ? rect.top - toast.offsetHeight - 10
          : rect.bottom + 10
        : target
          ? target.y + p.offsetY
          : p.top + p.scrollY - window.scrollY;
      const attached = String(!!rect);
      const changed =
        toast.dataset.attached !== undefined &&
        toast.dataset.attached !== attached;
      const previous = changed ? toast.getBoundingClientRect() : null;
      const move = noticeMoves.get(toast);
      if (
        move &&
        (changed ||
          Math.abs(move.left - left) > 0.5 ||
          Math.abs(move.top - top) > 0.5)
      ) {
        move.animation.cancel();
        noticeMoves.delete(toast);
      }
      toast.dataset.attached = attached;
      Object.assign(toast.style, {
        left: `${left}px`,
        top: `${top}px`,
        bottom: "auto",
        transform: "none",
        transformOrigin: rect ? (above ? "50% 100%" : "50% 0%") : "0% 0%",
      });
      if (
        previous &&
        !toast.dataset.closing &&
        !reducedMotion()
      ) {
        const animation = toast.animate(
          [
            { left: `${previous.left}px`, top: `${previous.top}px` },
            { left: `${left}px`, top: `${top}px` },
          ],
          { duration: 250, easing: "cubic-bezier(.22,1,.36,1)" },
        );
        noticeMoves.set(toast, { animation, left, top });
      }
    }
  }
  function fail(reason: unknown) {
    if (
      destroyed ||
      (reason instanceof DOMException && reason.name === "AbortError")
    )
      return;
    error =
      reason instanceof Error
        ? reason.message
        : "Something went wrong. Try again.";
    notify(error);
  }
  function run(action: () => Promise<unknown>) {
    void action().catch(fail);
  }
  // Account panels load with the dialog, keeping them out of the first bundle.
  function later(slot: HTMLElement, panel: Promise<HTMLElement>) {
    void panel
      .then((node) => {
        if (slot.isConnected) slot.replaceWith(node);
      })
      .catch(fail);
    return slot;
  }
  const tokensAllowed = () =>
    account && apiTokens && !options.onboarding && !!api.user?.verified && api.user.id.startsWith("google:");
  function closeTokens() {
    tokenView?.dispose();
    tokenView = tokenLoad = tokenApi = undefined;
  }
  function openTokens() {
    tokenApi = api;
    renderDialog();
    dialogs.querySelector(".account-dialog")!.scrollTop = 0;
  }
  // API tokens load as their own chunk the first time the view opens.
  function tokensPanel() {
    if (tokenView) return tokenView;
    const client = api;
    tokenLoad ??= import("./account-tokens.js").then(
      ({ accountTokens }) => {
        if (tokenApi !== client) return el("div");
        tokenView = accountTokens(client, options.project, () => {
          closeTokens();
          renderDialog();
          dialogs.querySelector<HTMLElement>('[data-focus-key="account-tokens"]')?.focus();
        });
        tokenView.focusStart();
        return tokenView;
      },
      (reason) => {
        tokenLoad = tokenApi = undefined;
        renderDialog();
        throw reason;
      },
    );
    return later(el("p", "account account-usage-status", "Loading API tokens…"), tokenLoad);
  }
  function usagePanel(path?: string) {
    return later(
      el("section", "account-usage"),
      import("./onboarding.js").then(({ accountUsage }) =>
        accountUsage(api, path, true, localSite && channel === "local"),
      ),
    );
  }
  // Retry from the start if the project config never loaded.
  function retryConnection() {
    run(projectLoaded ? refresh : loadProject);
  }
  async function mutate(action: () => Promise<void>) {
    if (pending) return;
    pending = true;
    error = "";
    renderDialog();
    try {
      await action();
      while (refreshing && !destroyed)
        await new Promise((resolve) => setTimeout(resolve, 20));
      await refresh();
    } finally {
      pending = false;
      render();
    }
  }
  const visibleThreads = (items: Thread[]) =>
    items
      .map((thread) => ({
        ...thread,
        comments: thread.comments.filter(
          (comment) => comment.body !== "[Comment deleted]",
        ),
      }))
      .filter((thread) => thread.comments.length > 0);
  let polling: ReturnType<typeof adaptivePolling> | undefined;
  let lastRefresh: Thread[] | undefined;
  let lastRefreshRevision = -1;
  async function refresh() {
    if (destroyed || refreshing || optimistic.busy || options.onboarding)
      return;
    const revision = optimistic.revision;
    const client = api;
    const token = client.token;
    const session = sessionRevision;
    refreshing = true;
    try {
      const response = await client.list();
      if (
        destroyed ||
        client !== api ||
        session !== sessionRevision ||
        token !== client.token ||
        optimistic.busy ||
        revision !== optimistic.revision
      )
        return;
      if (
        response === lastRefresh &&
        revision === lastRefreshRevision &&
        connection === "Live"
      )
        return false;
      lastRefresh = response;
      lastRefreshRevision = revision;
      knownThreads = true;
      const next = visibleThreads(response);
      const changed = JSON.stringify(next) !== JSON.stringify(threads);
      const recovered = connection !== "Live";
      accessError = "";
      if (projectLoaded) issue = null;
      connection = issue ? "Offline" : "Live";
      if (selected && !next.some((thread) => thread.id === selected))
        selected = null;
      if (changed) optimistic.replace(next, revision);
      else if (recovered) {
        renderList();
        renderToolbar();
      }
      return changed;
    } catch (reason) {
      if (
        destroyed ||
        client !== api ||
        session !== sessionRevision ||
        (reason instanceof DOMException && reason.name === "AbortError")
      )
        return;
      if (token !== client.token) hydrateThreads();
      if (
        reason instanceof ApiError &&
        (reason.status === 401 || reason.status === 403) &&
        reason.code !== "site_not_approved"
      ) {
        accessError = reason.message;
        selected = null;
        lastRefresh = undefined;
        optimistic.replace([], revision);
      }
      issue = accessError ? null : connectionIssue(reason);
      connection = "Offline";
      renderList();
      renderToolbar();
      throw reason;
    } finally {
      if (client === api && session === sessionRevision) refreshing = false;
    }
  }
  // Design mode frames the page beside the inspector so the panel never covers
  // what you pick. The floating layout returns on exit and isn't saved.
  function syncDesignFrame() {
    if (!designActive && designMoved) {
      designMoved = false;
      sidebarPlacement = savedSidebarPlacement;
      positionSidebar();
    }
    if (designFrame === designActive || (designActive && (!canFrame || compactSidebar || sidebarMode !== "edge"))) return;
    designFrame = designActive;
    if (compactSidebar) sidebarMode = "edge";
    else setSidebarMode(designActive ? "background" : "edge", true);
  }
  // Frame view lives on the open sidebar. Commenting keeps it; the floating
  // sidebar (or one Design mode framed for a moment) still steps aside.
  const inFrame = () => expanded && !edgeSidebar && !compactSidebar && !designFrame;
  function setMode(value: boolean) {
    cancelThreadRequest();
    cancelPinMove();
    if (options.onboarding) return;
    if (designActive) {
      designActive = false;
      designController?.setActive(false);
      syncDesignFrame();
    }
    commentMode = value;
    if (value) revealComments();
    if (expanded && !inFrame()) toggleExpanded(false);
    const restore = value ? (parkedDraft ?? recoveredDrafts.shift()) : null;
    if (restore) {
      draft = restore.anchor;
      draftText = restore.text;
      parkedDraft = null;
      selected = null;
      account = false;
      mode = false;
      render();
      dialogs.querySelector<HTMLTextAreaElement>("textarea")?.focus();
      return;
    }
    mode = value;
    polling?.wake(false);
    hidden = false;
    account = false;
    if (value) {
      selected = null;
      draft = null;
    }
    render();
  }
  function restoreCommentsAfterDesign() {
    if (!designReturnToComments) return;
    designReturnToComments = false;
    toggleExpanded(designReturnExpanded ?? true);
    designReturnExpanded = null;
    requestAnimationFrame(() => {
      const list = sidebar.querySelector<HTMLElement>(".list");
      if (list) list.scrollTop = designReturnScrollTop;
      (shadow.querySelector<HTMLElement>('.dialog [aria-label="Comment actions"]') ?? shadow.querySelector<HTMLElement>('[data-menu-item="design"]'))?.focus({ preventScroll: true });
    });
  }
  function setDesignMode(value: boolean) {
    if (options.onboarding || !!draft || (value && !designEnabled)) return;
    if (value) {
      designReturnExpanded = null;
      if (!selected) designController?.setReturnAction(null);
      // Keep the shared sidebar open. Its existing drawer morph is the outer
      // surface transition for both Comments and Design; only the content view
      // changes while the comment list and selection context stay mounted.
      designReturnToComments = true;
      if (expanded)
        designReturnScrollTop = sidebar.querySelector<HTMLElement>(".list")?.scrollTop ?? 0;
      setMode(false);
      designActive = true;
      designDragged = false;
      syncDesignFrame();
      if (!expanded) toggleExpanded(true);
      account = false;
      // Move focus out of the Comments view before render marks it hidden.
      // The Design controller will move focus to its close control once its
      // optional chunk has loaded.
      if (sidebar.querySelector(".panel")?.contains(shadow.activeElement)) {
        sidebar.focus({ preventScroll: true });
      }
    }
    designActive = value;
    if (value) {
      void ensureDesignController().then((controller) => controller?.setActive(designActive));
    } else {
      designController?.setActive(false);
      syncDesignFrame();
      restoreCommentsAfterDesign();
    }
    render();
  }
  let mobileEnterFrame = 0;
  function syncResponsiveSidebar() {
    const next = isCompactReview(window.innerWidth, window.innerHeight);
    if (next === compactSidebar) return;
    shadow.append(sidebar);
    stopLayoutMotion();
    stopEdgeMotion(true);
    clearEdgeRows();
    undockEdgeTabs();
    compactSidebar = next;
    if (!next) {
      toolbar.style.translate = "";
      if (!toolbarPlacement) toolbar.style.bottom = "";
    }
    edgeSidebar = !next && sidebarMode === "edge";
    sidebar.removeAttribute("style");
    syncEdgeMode();
    appliedViewport = "";
    render();
  }
  let appliedScale = 1;
  let appliedViewport = "";
  const mobileViewportBottom = () =>
    (window.visualViewport?.offsetTop ?? 0) +
    Math.min(window.innerHeight, window.visualViewport?.height ?? window.innerHeight) -
    window.innerHeight;
  function setMobilePanelOrigin() {
    const panelHeight = Math.max(1, Math.min(window.innerHeight, window.visualViewport?.height ?? window.innerHeight) * 0.9);
    const bottom = mobileViewportBottom();
    const pill = drawerShell().getBoundingClientRect();
    host.style.setProperty("--mobile-pill-x", `${pill.left + pill.width / 2 - window.innerWidth / 2}px`);
    host.style.setProperty("--mobile-pill-y", `${pill.bottom - (window.innerHeight + bottom - 6)}px`);
    host.style.setProperty("--mobile-pill-scale-x", String(Math.max(0.01, pill.width / Math.max(1, window.innerWidth - 24))));
    host.style.setProperty("--mobile-pill-scale-y", String(Math.max(0.01, pill.height / panelHeight)));
  }
  function restorePage() {
    for (const restore of fixedHeaders.values()) restore();
    fixedHeaders.clear();
    restoreSurface();
    restoreBody();
    restoreHtml();
  }
  function scalePage() {
    const zoom = htmlZoom();
    const viewportHeight = isCompactReview(
      window.innerWidth,
      window.innerHeight,
    )
      ? Math.min(
          window.innerHeight,
          window.visualViewport?.height ?? window.innerHeight,
        )
      : window.innerHeight;
    const viewportKey = `${window.innerWidth}:${window.innerHeight}:${viewportHeight}:${zoom}:${expanded}:${account}:${sidebarMode}:${designActive}:${window.visualViewport?.offsetTop ?? 0}`;
    if (appliedViewport === viewportKey) return;
    if (!compactSidebar) stopLayoutMotion();
    appliedViewport = viewportKey;
    host.style.zoom = String(1 / zoom);
    host.style.width = `${window.innerWidth}px`;
    pins.style.opacity = "";
    if (edgeSidebar || compactSidebar) {
      // The edge sidebar floats over the live page: never frame or zoom it.
      pageMotion?.cancel();
      pageTransitioning = false;
      const scroll = framed ? surface.scrollTop * zoom : null;
      if (framed) {
        restorePage();
        appliedScale = 1;
      }
      if (scroll !== null)
        window.scrollTo({ top: scroll, behavior: "instant" });
      // Preserve the fixed bottom inset when Safari's top chrome resizes.
      host.style.height = compactSidebar ? `${window.innerHeight}px` : "";
      host.style.top = compactSidebar ? "" : "0px";
      if (compactSidebar) {
        const bottom = mobileViewportBottom();
        toolbar.style.translate = `0 ${bottom}px`;
        host.style.setProperty("--mobile-panel-height", `${Math.max(1, viewportHeight * 0.9)}px`);
        host.style.setProperty("--mobile-panel-bottom", `${-bottom}px`);
      }
      host.classList.toggle("review-open", expanded);
      framed = false;
      framePortals();
      frameControls?.update(null);
      pins.style.clipPath = "";
      Object.assign(catcher.style, {
        left: "",
        top: "",
        width: "",
        height: "",
      });
      return;
    }
    const scroll = framed && !laidViewport
      ? surface.scrollTop
      : window.scrollY / (zoom * appliedScale);
    const wasFramed = framed;
    const before = framed
      ? surface.getBoundingClientRect()
      : { left: 0, top: 0, width: window.innerWidth };
    pageMotion?.cancel();
    pageTransitioning = false;
    const layout = reviewLayout(
      window.innerWidth,
      viewportHeight,
      expanded,
      window.innerHeight,
      account,
      // Always fit the whole page beside the sidebar; app shells sized to the
      // viewport otherwise lose their left edge (navigation) off-screen.
      true,
      options.frame?.scale === true,
    );
    const useFrame = layout.framed;
    const scaled = options.frame?.scale === true;
    const area = { left: layout.left, top: layout.top, width: layout.visibleWidth, height: layout.height };
    const box = { left: area.left / zoom, top: area.top / zoom, width: area.width / zoom, height: area.height / zoom };
    // Frame opens on the browser window's own size at Fit, so the page keeps its real layout.
    const windowSize = [window.innerWidth / zoom, window.innerHeight / zoom];
    const view = scaled
      ? { ...box, scale: 1, pan: false }
      : (frameControls?.view(box, windowSize) ?? frameView(box, windowSize, false));
    if (useFrame && !scaled && wantsViewport()) openViewport();
    else if (viewport) closeViewport();
    const inViewport = useFrame && !scaled && viewportShown;
    // The viewport iframe pans inside its own port, never the document.
    const pan = useFrame && !scaled && view.pan && !inViewport;
    frameArea = useFrame && !scaled ? area : null;
    host.style.setProperty("--review-viewport-height", `${viewportHeight}px`);
    host.style.height = `${viewportHeight}px`;
    host.style.top = "";
    host.classList.toggle("review-open", expanded);
    host.classList.toggle("design-active", designActive);
    if (inViewport && viewport) {
      // This page stays as it was beneath the iframe; leave a placeholder frame first.
      if (wasFramed && !laidViewport) {
        restorePage();
        window.scrollTo({ left: frameBox.pan ? 0 : window.scrollX, top: scroll * zoom, behavior: "instant" });
      }
      html.style.overflow = "hidden";
      appliedScale = 1;
      frameBox = {
        left: view.left,
        top: view.top,
        width: Math.min(box.width, view.width * view.scale),
        height: Math.min(box.height, view.height * view.scale),
        logical: [view.width, view.height],
        pan: false,
      };
      viewport.place({
        left: frameBox.left * zoom,
        top: frameBox.top * zoom,
        width: frameBox.width * zoom,
        height: frameBox.height * zoom,
        logical: frameBox.logical,
        scale: view.scale,
        pan: view.pan,
      });
    } else if (useFrame) {
      appliedScale = scaled ? layout.scale : view.scale;
      const effective = appliedScale * zoom;
      // Native client coordinates stay in viewport CSS pixels. Reflow by
      // default so host handlers can use local CSS dimensions without scaling;
      // a chosen viewport larger than the box is scaled only to fit it.
      frameBox = scaled
        ? {
            left: layout.left / zoom,
            top: layout.top / zoom,
            width: (window.innerWidth / zoom) * appliedScale,
            height: layout.height / zoom,
            logical: [window.innerWidth / zoom, layout.height / effective],
            pan: false,
          }
        : {
            left: view.left,
            top: view.top,
            width: view.width * view.scale,
            height: view.height * view.scale,
            logical: [view.width, view.height],
            pan,
          };
      // A 100% frame larger than its stage stays fixed and pans inside it (see panFrame).
      Object.assign(surface.style, {
        position: "fixed",
        transform: appliedScale !== 1 ? `scale(${appliedScale})` : savedStyle.transform,
        transformOrigin: "top left",
        left: `${frameBox.left}px`,
        top: `${frameBox.top}px`,
        width: `${scaled ? window.innerWidth / zoom : view.width}px`,
        boxSizing: "border-box",
        height: `${scaled ? layout.height / effective : view.height}px`,
        paddingBottom: savedStyle.paddingBottom,
        zoom: savedStyle.zoom,
        overflow: scaled ? "hidden auto" : "auto",
        borderRadius: `${12 / effective}px`,
        background: pageBackground,
        borderRight: savedStyle.borderRight,
        borderBottom: savedStyle.borderBottom,
        clipPath: savedStyle.clipPath,
      });
      for (const header of surface.querySelectorAll<HTMLElement>("header")) {
        if (
          !fixedHeaders.has(header) &&
          getComputedStyle(header).position === "fixed"
        ) {
          fixedHeaders.set(header, preserveFrameStyles(header, ["position", "margin-bottom"]));
          header.style.position = "sticky";
          header.style.marginBottom = `-${header.offsetHeight}px`;
        }
      }
      html.style.overflow = "hidden";
      document.body.style.overflow = "hidden";
      html.style.background = document.body.style.background = "#080808";
      surface.scrollTop = scroll;
    } else {
      restorePage();
      if (framed && !laidViewport) window.scrollTo({ left: window.scrollX, top: scroll * zoom, behavior: "instant" });
      appliedScale = 1;
      frameBox.pan = false;
    }
    laidViewport = inViewport;
    framed = useFrame;
    framePortals();
    if (frameArea) loadFrameControls();
    frameControls?.update(frameArea, zoom);
    if (!useFrame && options.drawerContainer?.isConnected) {
      const rect = options.drawerContainer.getBoundingClientRect();
      drawerContainerCenter = rect.width
        ? rect.left + rect.width / 2
        : undefined;
    }
    if (
      useFrame !== wasFramed &&
      !switchingSidebar &&
      !restoring &&
      !reducedMotion()
    ) {
      pins.style.opacity = "0";
      pageTransitioning = true;
      if (options.frame?.scale === true) {
        const after = useFrame
          ? surface.getBoundingClientRect()
          : { left: 0, top: 0, width: window.innerWidth };
        // Translate in page pixels before the frame's own scale.
        const start = `translate(${(before.left - after.left) / zoom}px, ${(before.top - after.top) / zoom}px) scale(${(appliedScale * before.width) / after.width})`;
        surface.style.transformOrigin = useFrame ? "top left" : `0 ${scroll}px`;
        if (!useFrame) {
          html.style.background = document.body.style.background = "#080808";
          surface.style.background = pageBackground;
          // Short pages still need to cover the viewport while the frame expands.
          const minHeight = getComputedStyle(surface).minHeight;
          surface.style.minHeight = `max(${minHeight === "auto" ? "0px" : minHeight}, ${window.innerHeight / zoom}px)`;
        }
        pageMotion = surface.animate(
          [{ transform: start }, { transform: `translate(0px, 0px) scale(${appliedScale})` }],
          { duration: 250, easing: "cubic-bezier(0.32, 0.72, 0, 1)" },
        );
      } else pageMotion = fadePage();
      const currentMotion = pageMotion;
      void currentMotion.finished.then(() => {
        if (destroyed || pageMotion !== currentMotion) return;
        currentMotion.cancel();
        pageMotion = undefined;
        pageTransitioning = false;
        if (!framed) restorePage();
        pins.style.opacity = "";
        framePortals();
        portalFrame.reposition();
        geometry();
      }).catch(() => {});
    }
    // Pins and picking follow the visible frame, which a fitted viewport may not fill.
    // A panned frame shows only where it overlaps its stage.
    const clip = (start: number, size: number, from: number, length: number) => {
      const low = Math.max(start, from);
      return [low, Math.max(0, Math.min(start + size, from + length) - low)];
    };
    const [visibleLeft, visibleWidth] = clip(frameBox.left * zoom, frameBox.width * zoom, area.left, area.width);
    const [visibleTop, visibleHeight] = clip(frameBox.top * zoom, frameBox.height * zoom, area.top, area.height);
    const visible = scaled
      ? { left: layout.visibleLeft, top: layout.visibleTop, width: layout.visibleWidth, height: layout.visibleHeight }
      : { left: visibleLeft, top: visibleTop, width: visibleWidth, height: visibleHeight };
    pins.style.clipPath = useFrame
      ? `inset(${visible.top}px ${window.innerWidth - visible.left - visible.width}px ${viewportHeight - visible.top - visible.height}px ${visible.left}px)`
      : "";
    Object.assign(
      catcher.style,
      useFrame
        ? {
            left: `${visible.left}px`,
            top: `${visible.top}px`,
            width: `${visible.width}px`,
            height: `${visible.height}px`,
          }
        : { left: "", top: "", width: "", height: "" },
    );
  }
  let dockedToolbarStyles: Pick<CSSStyleDeclaration, "left" | "top" | "bottom" | "transform"> | undefined;
  function dockEdgeTabs() {
    if (toolbar.dataset.edgeTabs !== "true")
      dockedToolbarStyles = rememberStyles(toolbar, ["left", "top", "bottom", "transform"]);
    Object.assign(toolbar.style, { left: "", top: "", bottom: "", transform: "" });
    if (toolbar.parentElement !== sidebar) sidebar.append(toolbar);
    toolbar.dataset.edgeTabs = "true";
    if (expanded) toolbar.dataset.edgeOrient = "horizontal";
    else delete toolbar.dataset.edgeOrient;
  }
  function undockEdgeTabs() {
    if (toolbar.dataset.edgeTabs === "true") {
      Object.assign(toolbar.style, dockedToolbarStyles);
      dockedToolbarStyles = undefined;
    }
    delete toolbar.dataset.edgeTabs;
    delete toolbar.dataset.edgeOrient;
    if (toolbar.parentElement === sidebar) live.before(toolbar);
  }
  // An open sidebar shows the selected thread in place of its list; new
  // comments, the compact sheet and a closed sidebar keep the floating card.
  function threadPanel() {
    return selected && !account && !draft && expanded && !compactSidebar && !designActive && !options.onboarding
      ? sidebar.querySelector<HTMLElement>(".panel")
      : null;
  }
  function placeDialogs(panel: HTMLElement | null) {
    const parent = panel ?? (edgeSidebar && account ? sidebar : shadow);
    if (dialogs.parentNode !== parent)
      parent === shadow ? pinPreview.before(dialogs) : parent.append(dialogs);
    dialogs.classList.toggle("thread-pane", !!panel);
    sidebar.querySelector(".panel")?.toggleAttribute("data-thread", !!panel);
  }
  function drawerShell() {
    return (
      toolbar.querySelector<HTMLElement>(".morphing-menu__shell") ?? toolbar
    );
  }
  function drawerMenu() {
    return toolbar.querySelector<HTMLElement>(".morphing-menu");
  }
  function drawerBar() {
    return toolbar.querySelector<HTMLElement>(".morphing-menu__bar");
  }
  function edgeRows() {
    return [
      ...sidebar.querySelectorAll<HTMLElement>(
        ".panel-head, .panel .empty, .thread-card",
      ),
    ];
  }
  function trackEdge(motion: ReturnType<typeof animate>) {
    edgeMotions.push(motion);
    return motion;
  }
  function clearEdgeRows() {
    for (const row of edgeRows())
      Object.assign(row.style, { opacity: "", transform: "", filter: "" });
    grip.style.opacity = "";
  }
  function pinEdgeBox(
    box: { left: number; top: number; width: number; height: number },
    radius: string,
  ) {
    for (const animation of sidebar.getAnimations()) animation.cancel();
    Object.assign(sidebar.style, {
      transition: "none", transform: "none", translate: "none", opacity: "1",
      left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`,
      borderRadius: radius,
    });
  }
  function releaseEdgeBox() {
    Object.assign(sidebar.style, { width: "", height: "", borderRadius: "", transform: "", opacity: "" });
    if (edgeSidebar) positionSidebar();
    void sidebar.offsetWidth;
    sidebar.style.transition = "";
  }
  function clearEdgeSurface(menu = drawerMenu()) {
    delete sidebar.dataset.morphing;
    delete toolbar.dataset.edgeSurface;
    delete toolbar.dataset.edgeMorph;
    delete toolbar.dataset.hidden;
    if (menu) menu.style.transition = "";
  }
  function stopEdgeMotion(release = false) {
    edgeMorphGeneration += 1;
    for (const motion of edgeMotions) motion.stop();
    edgeMotions = [];
    const wasMorphing = edgeMorphing;
    edgeMorphing = false;
    if (release) sidebar.toggleAttribute("data-tips-ready", expanded);
    if (!release || !wasMorphing) return;
    clearEdgeSurface();
    undockEdgeTabs();
    clearEdgeRows();
    releaseEdgeBox();
  }
  function morphEdgeSidebar(
    opening: boolean,
    interrupted: boolean,
    openingPill?: {
      left: number;
      top: number;
      width: number;
      height: number;
    } | null,
  ) {
    const closingRect = sidebar.getBoundingClientRect();
    const closingFrom = opening
      ? null
      : {
          left: closingRect.left,
          top: closingRect.top,
          width: closingRect.width,
          height: closingRect.height,
          radius: sidebar.style.borderRadius || "16px",
        };
    stopEdgeMotion(false);
    if (closingFrom) pinEdgeBox(closingFrom, closingFrom.radius);
    const generation = edgeMorphGeneration;
    edgeMorphing = true;
    const menu = drawerMenu();
    if (menu) menu.style.transition = "none";
    const bar = drawerBar();
    const shell = drawerShell();
    let settled = false;
    const finish = () => {
      if (settled || generation !== edgeMorphGeneration || destroyed) return;
      settled = true;
      edgeMorphing = false;
      clearEdgeSurface(menu);
      if (!opening) {
        clearEdgeRows();
        sidebar.style.opacity = "0";
        undockEdgeTabs();
      }
      releaseEdgeBox();
      if (opening) sidebar.dataset.tipsReady = "";
    };
    const reduced =
      restoring || reducedMotion();
    if (opening) {
      const visual = interrupted ? sidebar.getBoundingClientRect() : null;
      const radius = sidebar.style.borderRadius || "16px";
      sidebar.style.transition = "none";
      sidebar.style.width = "";
      sidebar.style.height = "";
      sidebar.style.borderRadius = "";
      sidebar.style.transform = "none";
      const liveDrawer = shell.getBoundingClientRect();
      const drawer =
        !interrupted && openingPill && openingPill.width > 0
          ? openingPill
          : liveDrawer;
      if (!interrupted && drawer.width > 0)
        drawerHome = {
          left: drawer.left,
          top: drawer.top,
          width: drawer.width,
          height: drawer.height,
        };
      dockEdgeTabs();
      delete sidebar.dataset.morphing;
      positionSidebar();
      const destination = sidebar.getBoundingClientRect();
      sidebar.dataset.morphing = "true";
      if (
        reduced ||
        drawer.width <= 0 ||
        destination.width <= 0 ||
        (interrupted && !visual)
      ) {
        finish();
        return;
      }
      const pillRadius = `${drawer.height / 2}px`;
      if (interrupted && visual) pinEdgeBox(visual, radius);
      else pinEdgeBox(drawer, pillRadius);
      edgeRows().forEach((row, index) => {
        row.style.opacity = "0";
        row.style.transform = "translateY(48px)";
        row.style.filter = "blur(4px)";
        trackEdge(
          animate(
            row,
            { opacity: 1, y: 0, filter: "blur(0px)" },
            {
              ...drawerRowEnter,
              delay: drawerRowEnterDelay + index * drawerRowStagger,
            },
          ),
        );
      });
      grip.style.opacity = "0";
      trackEdge(
        animate(
          grip,
          { opacity: 1 },
          { ...drawerRowEnter, delay: drawerRowEnterDelay },
        ),
      );
      const springToPanel = () => {
        if (generation !== edgeMorphGeneration || destroyed) return;
        // Rest padding has to be in place for the grow, or the last frame
        // uses the pill padding and snaps when the motion ends.
        delete sidebar.dataset.morphing;
        const from = sidebar.getBoundingClientRect();
        const spring = trackEdge(
          animate(
            sidebar,
            {
              left: [`${from.left}px`, `${destination.left}px`],
              top: [`${from.top}px`, `${destination.top}px`],
              width: [`${from.width}px`, `${destination.width}px`],
              height: [`${from.height}px`, `${destination.height}px`],
              borderRadius: [sidebar.style.borderRadius || "16px", "16px"],
            },
            drawerExpandSpring,
          ),
        );
        void spring.finished.then(finish).catch(() => {
          if (generation === edgeMorphGeneration) finish();
        });
      };
      if (interrupted || drawer.height > drawer.width + 8) {
        springToPanel();
        return;
      }
      const size = compressedDrawerSize(
        bar?.offsetWidth || drawer.width,
        bar?.offsetHeight || drawer.height,
      );
      const compressed = boxFromAnchor(
        drawer.left + drawer.width / 2,
        drawer.top + drawer.height,
        size.width,
        size.height,
      );
      const from = sidebar.getBoundingClientRect();
      const compression = trackEdge(
        animate(
          sidebar,
          {
            left: [`${from.left}px`, `${compressed.left}px`],
            top: [`${from.top}px`, `${compressed.top}px`],
            width: [`${from.width}px`, `${compressed.width}px`],
            height: [`${from.height}px`, `${compressed.height}px`],
          },
          drawerExpandCompress,
        ),
      );
      void compression.finished.then(springToPanel).catch(() => {});
      return;
    }
    const visual = closingFrom ?? sidebar.getBoundingClientRect();
    const radius = closingFrom?.radius || sidebar.style.borderRadius || "16px";
    delete toolbar.dataset.hidden;
    sidebar.dataset.morphing = "true";
    dockEdgeTabs();
    const docked = toolbar.getBoundingClientRect();
    const drawer = drawerHome ?? {
      left: (window.innerWidth - (docked.width || 228)) / 2,
      top: window.innerHeight - 24 - (docked.height || 52),
      width: docked.width || 228,
      height: docked.height || 52,
    };
    if (reduced || drawer.width <= 0 || visual.width <= 0) {
      finish();
      return;
    }
    pinEdgeBox(visual, radius);
    for (const row of edgeRows()) {
      trackEdge(
        animate(row, { opacity: 0, y: 16, filter: "blur(2px)" }, drawerRowExit),
      );
    }
    trackEdge(animate(grip, { opacity: 0 }, drawerRowExit));
    const collapse = trackEdge(
      animate(
        sidebar,
        {
          left: [`${visual.left}px`, `${drawer.left}px`],
          top: [`${visual.top}px`, `${drawer.top}px`],
          width: [`${visual.width}px`, `${drawer.width}px`],
          height: [`${visual.height}px`, `${drawer.height}px`],
          borderRadius: [radius, `${drawer.height / 2}px`],
        },
        drawerCollapse,
      ),
    );
    void collapse.finished.then(finish).catch(() => {
      if (generation === edgeMorphGeneration) finish();
    });
  }
  function toggleExpanded(value: boolean, keepOpenState = false) {
    if (!value && threadRequest && !threadRequest.opened) cancelThreadRequest();
    if (value !== expanded) cancelPinMove();
    // Opening the list is a request to see comments again.
    if (value) revealComments();
    stopLayoutMotion();
    const opening = value && !expanded;
    expanded = value;
    if (!restoring) polling?.wake(opening);
    delete sidebar.dataset.tipsReady;
    sidebar.toggleAttribute("data-tips-restored", restoring);
    if (!options.onboarding && !keepOpenState) openStore.set(value);
    if (value) mode = false;
    if (!value) {
      clearTimeout(accountOpenTimer);
      accountOpenTimer = 0;
      account = false;
      hoverCard = focusCard = "";
      setHot();
    }
    if (compactSidebar) {
      cancelAnimationFrame(mobileEnterFrame);
      setMobilePanelOrigin();
      if (opening && !restoring && !reducedMotion())
        host.dataset.mobileEntering = "";
      else delete host.dataset.mobileEntering;
      hidden = false;
      scalePage();
      render();
      presence.show();
      presence.update();
      if (host.dataset.mobileEntering !== undefined)
        mobileEnterFrame = requestAnimationFrame(() => {
          delete host.dataset.mobileEntering;
        });
      return;
    }
    if (edgeSidebar) {
      const interrupted = edgeMorphing;
      const openingPill = value ? drawerShell().getBoundingClientRect() : null;
      if (!value) delete toolbar.dataset.edgeOrient;
      toolbarPlacement = value ? toolbarPlacement : savedToolbarPlacement;
      dockCenter = undefined;
      hidden = false;
      // Hold placement until the morph reads the open rect. render() would
      // otherwise park the sidebar before the close animation starts.
      edgeMorphing = true;
      const menu = drawerMenu();
      if (menu) menu.style.transition = "none";
      presence.show();
      scalePage();
      render();
      morphEdgeSidebar(value, interrupted, openingPill);
      presence.update();
      return;
    }
    const before = toolbar.getBoundingClientRect();
    toolbarPlacement = value ? undefined : savedToolbarPlacement;
    dockCenter = undefined;
    hidden = false;
    scalePage();
    render();
    dockMotion?.stop();
    toolbar.style.translate = "0px 0px";
    const after = toolbar.getBoundingClientRect();
    if (!restoring && !reducedMotion()) {
      dockMotion = animate(
        toolbar,
        {
          translate: [
            `${before.left - after.left}px ${before.top - after.top}px`,
            "0px 0px",
          ],
        },
        { type: "spring", stiffness: 680, damping: 32, mass: 0.55 },
      );
    }
    presence.show();
    presence.update();
  }
  function dismiss() {
    cancelThreadRequest();
    cancelPinMove();
    commentMode = false;
    clearTimeout(accountOpenTimer);
    accountOpenTimer = 0;
    if (account) {
      run(saveProfile);
      submitAfterIdentity = null;
      account = false;
      render();
      return;
    }
    selected = null;
    draft = null;
    account = false;
    editing = null;
    error = "";
    mode = false;
    render();
  }
  function dismissToolbar() {
    // Hide feedback without discarding pending Design previews.
    designReturnToComments = false;
    designActive = false;
    designController?.setActive(false);
    syncDesignFrame();
    dismiss();
    if (expanded) toggleExpanded(false);
    mode = false;
    commentMode = false;
    hidden = true;
    toolbarDismissed = true;
    try {
      sessionStorage.setItem(toolbarDismissKey, "1");
    } catch {
      /* Keep the dismissal in memory when session storage is blocked. */
    }
    render();
  }
  function revealComments() {
    if (!commentsHidden) return;
    commentsHidden = false;
    revealExpanded = false;
    try {
      sessionStorage.removeItem(visibilityKey);
    } catch {
      /* Comments stay shown for this page. */
    }
    live.textContent = "Comments shown";
    const scroll = revealScroll;
    revealScroll = 0;
    if (scroll)
      requestAnimationFrame(() => {
        const list = sidebar.querySelector<HTMLElement>(".list");
        if (list) list.scrollTop = scroll;
      });
  }
  /** Manual only: nothing reveals hidden comments except the reviewer. */
  function setCommentsHidden(value: boolean) {
    if (value === commentsHidden || destroyed || options.onboarding || (value && designActive)) return;
    if (!value) {
      const reopen = revealExpanded && !expanded;
      revealComments();
      if (reopen) toggleExpanded(true);
      else render();
      return;
    }
    cancelPinMove();
    commentsHidden = true;
    try {
      sessionStorage.setItem(visibilityKey, "1");
    } catch {
      /* Keep comments hidden in memory when session storage is blocked. */
    }
    live.textContent = "Comments hidden";
    mode = commentMode = false;
    clearTimeout(accountOpenTimer);
    accountOpenTimer = 0;
    account = false;
    const reopen = expanded;
    if (reopen) {
      revealScroll = sidebar.querySelector<HTMLElement>(".list")?.scrollTop ?? 0;
      toggleExpanded(false, true);
    } else render();
    revealExpanded = reopen;
  }
  function restoreToolbar() {
    toolbarDismissed = false;
    hidden = false;
    try {
      sessionStorage.removeItem(toolbarDismissKey);
    } catch {
      /* The toolbar remains visible for this page session. */
    }
    render();
  }
  function selectThread(thread: Thread, retained = false) {
    if (!retained) cancelThreadRequest();
    cancelPinMove();
    revealComments();
    // Opening from the list keeps keyboard focus in the sidebar.
    focusBack = !!shadow.activeElement?.matches(":focus-visible") && sidebar.contains(shadow.activeElement);
    commentMode = false;
    clearTimeout(accountOpenTimer);
    accountOpenTimer = 0;
    if (!retained && !here(thread)) {
      const url = new URL(thread.page, location.origin);
      url.searchParams.set("comment", thread.id);
      void go(url);
      return;
    }
    if (!retained) {
      cancelledLinks.delete(thread.id);
      threadRequest = { id: thread.id, inspect: false, pending: false, rejected: false, opened: true };
    }
    openingPreview =
      previewThread === thread.id && !pinPreview.hidden
        ? pinPreview.getBoundingClientRect()
        : null;
    if (openingPreview) hidePreview(true);
    selected = thread.id;
    draft = null;
    account = false;
    editing = null;
    error = "";
    mode = false;
    const fromMobileSidebar = compactSidebar && expanded;
    if (fromMobileSidebar) toggleExpanded(false);
    const rect = onThreadPage(thread) ? locateAnchor(thread.anchor) : null;
    if (
      rect?.attached &&
      !openingPreview &&
      (fromMobileSidebar || !compactSidebar)
    )
      (framed ? surface : window).scrollBy({
        top:
          (rect.y - (fromMobileSidebar
            ? Math.min(window.innerHeight, window.visualViewport?.height ?? window.innerHeight)
            : window.innerHeight) * 0.35) /
          (framed ? appliedScale * htmlZoom() : 1),
        behavior: fromMobileSidebar && !reducedMotion()
          ? "smooth"
          : "instant",
      });
    render();
  }
  function filtered() {
    const anchors = anchorPass(), current = page();
    return threads
      .filter(
        (t) =>
          (filter === "all" || t.resolved === (filter === "resolved")) &&
          (!tagFilter || !!t.tags?.includes(tagFilter)) &&
          (!search ||
            t.comments.some((c) =>
              `${c.body} ${c.author.name}`
                .toLowerCase()
                .includes(search.toLowerCase()),
            ) ||
            t.page.toLowerCase().includes(search.toLowerCase())) &&
          (allPages || here(t, anchors.resolve, current)),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }
  // Help lists the toolbar's current commands with their configured keys, the current
  // mode's groups first. More, the Design empty state and ? open it; ? closes it again.
  function openShortcutHelp() {
    void import("./shortcut-help.js").then(({ showShortcutHelp }) => showShortcutHelp(shadow, [
      ...helpItems.map(({ label, shortcut, group }) => ({ label, shortcut, group: group === "Comments & view" ? "Comments" : "General" })),
      { label: "Restore feedback", shortcut: shortcuts.restore, group: "General" },
    ], designEnabled, designActive ? "design" : commentMode ? "comment" : undefined, designKeys));
  }
  function renderToolbar() {
    toolbar.style.display = toolbarDismissed ? "none" : "";
    presence.update();
    const { dockCenter: viewportCenter } = reviewLayout(
      window.innerWidth,
      window.innerHeight,
      expanded,
    );
    if (compactSidebar) {
      undockEdgeTabs();
      Object.assign(toolbar.style, {
        left: "50%",
        top: "auto",
        bottom: "calc(16px + env(safe-area-inset-bottom,0px))",
        transform: "translateX(-50%)",
      });
    } else if (edgeSidebar) {
      // The drawer owns its placement at the edge; the background dock spring
      // does not apply in edge mode. Skip while a morph owns left/top/size.
      if (!edgeMorphing) {
        delete toolbar.dataset.hidden;
        if (expanded) dockEdgeTabs();
        else {
          undockEdgeTabs();
          if (toolbarPlacement) placeToolbar(toolbarPlacement);
        }
        positionSidebar();
      }
    } else {
      delete toolbar.dataset.hidden;
      const container =
        !expanded && options.drawerContainer?.isConnected
          ? options.drawerContainer.getBoundingClientRect()
          : undefined;
      if (container?.width && !pageTransitioning)
        drawerContainerCenter = container.left + container.width / 2;
      const halfWidth = toolbar.offsetWidth / 2;
      const nextCenter =
        container?.width && drawerContainerCenter !== undefined
          ? Math.max(
              16 + halfWidth,
              Math.min(
                window.innerWidth - 16 - halfWidth,
                drawerContainerCenter,
              ),
            )
          : viewportCenter;
      if (toolbarPlacement) placeToolbar(toolbarPlacement);
      else if (nextCenter !== dockCenter) {
        const rect = toolbar.getBoundingClientRect();
        const previousCenter = rect.left + rect.width / 2;
        dockMotion?.stop();
        toolbar.style.top = "";
        toolbar.style.bottom = "";
        toolbar.style.left = `${nextCenter}px`;
        toolbar.style.translate = "0px 0px";
        if (
          dockCenter !== undefined &&
          !reducedMotion()
        ) {
          dockMotion = animate(
            toolbar,
            {
              translate: [
                `${previousCenter - nextCenter}px ${rect.top - toolbar.getBoundingClientRect().top}px`,
                "0px 0px",
              ],
            },
            { type: "spring", stiffness: 680, damping: 32, mass: 0.55 },
          );
        }
        dockCenter = nextCenter;
      }
    }
    const glyph = (name: keyof typeof icons) => ({ glyph: name });
    const items: ToolbarMenuItem[] = [
      {
        id: "browse",
        label: "Browse website",
        group: "Modes",
        shortcut: shortcuts.browse,
        icon: glyph("pointer"),
        onSelect: () => setMode(false),
      },
      {
        id: "comment",
        label: "Add comment",
        group: "Modes",
        shortcut: shortcuts.comment,
        icon: glyph("comment"),
        onSelect: () => setMode(!commentMode),
      },
      ...(designEnabled
        ? [
            {
              id: "design",
              label: "Design mode",
        group: "Modes",
        shortcut: shortcuts.design,
              icon: glyph("design"),
              onSelect: () => setDesignMode(!designActive),
            },
          ]
        : []),
      {
        id: "comments",
        group: "Comments & view",
        label: options.onboarding ? expanded ? "Close project panel" : "Project settings" : expanded ? "Close comments panel" : "All comments",
        shortcut: options.onboarding ? null : shortcuts.comments,
        count: options.onboarding || expanded ? undefined : threads.filter(t => !t.resolved).length,
        icon: glyph("expand"),
        onSelect: () => toggleExpanded(!expanded),
      },
      {
        id: "account",
        group: "Account & help",
        label: api.user
          ? `${api.user.name} · Account`
          : options.onboarding?.inProject
            ? "Set up inline feedback"
            : "Enter your name",
        icon: { user: api.user },
        onSelect: () => {
          if (account || accountOpenTimer) {
            clearTimeout(accountOpenTimer);
            accountOpenTimer = 0;
            account = false;
            render();
          } else openAccount();
        },
      },
      {
        id: "copy-prompts",
        group: "Comments & view",
        keepOpenOnSelect: true,
        label:
          copiedPrompt === "all"
            ? "Copied prompt"
            : "Copy comments for agent",
        icon: glyph(copiedPrompt === "all" ? "check" : "copy"),
        showInBar: false,
        onSelect: () => run(() => copyPrompt("all")),
      },
      // Switch between the floating sidebar and Frame (page beside comments).
      // Design mode manages its own Frame while active, so the switch waits.
      ...(canFrame && !compactSidebar && !designActive
        ? [
            {
              id: "layout",
              group: "Comments & view",
              label: sidebarMode === "edge" ? "Frame view" : "Floating view",
              icon: glyph("expand"),
              showInBar: false,
              onSelect: () => setSidebarMode(sidebarMode === "edge" ? "background" : "edge"),
            },
          ]
        : []),
      {
        id: "dismiss",
        group: "Feedback",
        label: "Dismiss feedback",
        icon: glyph("close"),
        onSelect: dismissToolbar,
      },
      {
        id: "visibility",
        group: "Comments & view",
        label: commentsHidden ? "Show comments" : "Hide comments",
        shortcut: shortcuts.visibility,
        icon: glyph("comment"),
        showInBar: false,
        onSelect: () => setCommentsHidden(!commentsHidden),
      },
      {
        id: "pin-size",
        group: "Comments & view",
        label: `Pin size: ${pinSizeNames[pinSize]}`,
        icon: glyph("pointer"),
        showInBar: false,
        children: pinSizes.map((size) => ({
          id: `pin-size-${size}`,
          label: pinSizeNames[size],
          icon: glyph("check"),
          checked: size === pinSize,
          onSelect: () => setPinSize(size),
        })),
      },
    ];
    items.push({ id: "shortcuts", group: "Account & help", label: "Keyboard shortcuts", icon: glyph("info"), showInBar: false,
      onSelect: openShortcutHelp,
    });
    helpItems = items;
    if (connection === "Offline")
      items.push({
        id: "retry",
        label: `${issue?.title ?? "Offline"} · Retry`,
        icon: glyph("info"),
        showInBar: false,
        onSelect: retryConnection,
      });
    const menu = options.onboarding
      ? items.filter((item) => item.id === "account" || item.id === "comments")
      : items;
    // Setup keeps its account and project controls whatever the configured order.
    const bar = toolbarLayout(
      options.onboarding ? defaultToolbarItems : toolbarItems,
      (id) => id === "more" || menu.some((item) => item.id === id),
    );
    // An empty configuration hides the toolbar; shortcuts keep working.
    if (!bar.length) toolbar.style.display = "none";
    toolbarRoot.render({
      items: menu,
      bar,
      alignEnd:
        expanded && edgeSidebar
          ? false
          : !!toolbarPlacement && toolbarPlacement.y > window.innerHeight / 2,
      edge:
        expanded && edgeSidebar
          ? "bottom"
          : (toolbarPlacement?.edgeX ??
            toolbarPlacement?.edgeY ??
            (toolbarPlacement && toolbarPlacement.y < window.innerHeight / 2
              ? "top"
              : "bottom")),
      activeId: designActive ? "design" : commentMode ? "comment" : "browse",
      label: "Website review",
      moreLabel: "More review tools",
    });
  }

  function setPinSize(size: PinSize) {
    if (size === pinSize || destroyed) return;
    pinSize = size;
    try {
      localStorage.setItem(pinSizeKey, size);
    } catch {
      /* Keep the preference in memory when storage is blocked. */
    }
    live.textContent = `Pin size: ${pinSizeNames[size]}`;
    pinSnapshot = "";
    renderPins();
    renderToolbar();
  }
  // Auto is full while commenting or with the sidebar open, dots while browsing.
  const pinDensity = () =>
    pinSize === "auto" ? (mode || commentMode || expanded ? "full" : "dot") : pinSize;
  // Collapsed pins expand when the pointer comes within 24px. Distance is
  // measured to the pin's current box, so an expanded pin keeps itself open.
  let nearPoint: { x: number; y: number } | null = null;
  let nearFrame = 0;
  function markNear() {
    nearFrame = 0;
    for (const pin of pins.querySelectorAll<HTMLElement>(":scope > .pin")) {
      const box = pin.getBoundingClientRect();
      const near =
        !!nearPoint &&
        Math.hypot(
          Math.max(box.left - nearPoint.x, 0, nearPoint.x - box.right),
          Math.max(box.top - nearPoint.y, 0, nearPoint.y - box.bottom),
        ) <= 24;
      pin.toggleAttribute("data-near", near);
    }
  }
  // Unread dots breathe for three 1.8s cycles when they first appear, then
  // rest until another unread thread arrives.
  const breathed = new Set<string>();
  let breatheStart = 0;
  let breatheTimer = 0;
  function breathe(visible: Thread[]) {
    let fresh = false;
    for (const thread of visible)
      if (unread(thread) && !breathed.has(thread.id)) fresh = !!breathed.add(thread.id);
    if (!fresh || reducedMotion()) return;
    breatheStart = performance.now();
    pins.style.setProperty("--pin-breathe-delay", "0ms");
    pins.dataset.breathe = "";
    clearTimeout(breatheTimer);
    breatheTimer = window.setTimeout(() => delete pins.dataset.breathe, 5400);
  }
  let pinSnapshot = "";
  // Threads on this page whose element can no longer be found or is not visible.
  const detachedThreads = new Set<string>();
  const pageLabels = new Map<string, Promise<string>>();
  function updateCardPage(item: Element, thread: Thread) {
    const route = item.querySelector<HTMLAnchorElement>(".page");
    if (!route) return;
    const url = new URL(thread.page, location.origin).href;
    // All-pages threads read "All pages"; the link and its detail stay on their own page.
    const everywhere = everyPage(thread);
    const ownPage = thread.page === page();
    route.href = url;
    route.title = url;
    route.setAttribute("aria-label", `Open page: ${url}`);
    const row = route.closest<HTMLElement>(".card-page-row")!;
    row.hidden = ownPage && !everywhere;
    row.querySelector(".card-page-url")!.textContent = url;
    const key = everywhere ? "" : url;
    if (route.dataset.url !== key) {
      route.dataset.url = key;
      const fallback = everywhere ? "All pages" : readablePageLabel(new URL(url));
      route.textContent = fallback;
      if (options.pageLabel && !everywhere) {
        let label = pageLabels.get(url);
        if (!label) {
          label = Promise.resolve().then(() => options.pageLabel!(new URL(url)))
            .then(value => value?.trim() || fallback, () => fallback);
          pageLabels.set(url, label);
        }
        void label.then(value => {
          if (!destroyed && route.dataset.url === url) route.textContent = value;
        });
      }
    }
    const status = item.querySelector<HTMLElement>(".card-status")!;
    status.textContent = thread.resolved ? "Resolved" : detachedThreads.has(thread.id) && ownPage ? "Not found on page" : "";
    status.hidden = !status.textContent;
    item.classList.toggle("resolved", thread.resolved);
    item.classList.toggle("active", selected === thread.id);
    item.querySelector(".thread-card")!.setAttribute("aria-description", [everywhere && "All pages", url, status.textContent].filter(Boolean).join(" · "));
  }
  let pinsScrolling = false;
  let pinScrollTimer = 0;
  // Stacks and collision bubbles load the first time a page has one to draw; until then
  // their pins wait, so a crowded row never flashes uncollapsed.
  let grouping = options.pins?.cluster !== false;
  let pinGroups: typeof import("./pin-groups.js") | undefined;
  let groupsLoading = false;
  function loadGroups() {
    if (groupsLoading) return;
    groupsLoading = true;
    void import("./pin-groups.js")
      .then((module) => (pinGroups = module), () => (grouping = false))
      .then(() => {
        pinSnapshot = "";
        renderPins();
      });
  }
  const pinBounds = () =>
    framed
      ? frameRect()
      : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  function renderPins(force = false) {
    const off = hidden || commentsHidden;
    if (off) cancelPinMove();
    if (movingThread || (pinsScrolling && !force)) return;
    if (off) {
      pinSnapshot = "";
      hidePreview();
      pins.replaceChildren();
      return;
    }
    const density = pinDensity();
    if (density === "full") delete pins.dataset.size;
    else pins.dataset.size = density;
    const open = threads.find((thread) => thread.id === selected);
    if (open) markRead(open);
    const anchors = anchorPass();
    const currentPage = page();
    const visible = threads.filter(
      (t) =>
        !t.resolved &&
        (!tagFilter || !!t.tags?.includes(tagFilter)) &&
        here(t, anchors.resolve, currentPage),
    );
    if (density === "dot") breathe(visible);
    // Same-target threads share their persistent owner (the anchorTarget adapter's, else
    // komo's); the page itself is no shared target.
    const owners = new Map<string, Element>();
    const stacks = grouping
      ? pinStacks(visible, (thread) => {
          const element = anchors.resolve(thread.anchor);
          const owner = element && commentAnchorTarget(element, surface, options.anchorTarget);
          if (!owner || owner === surface || owner === document.body) return null;
          owners.set(thread.id, owner);
          return owner;
        })
      : new Map<string, Thread[]>();
    const positions = visible.map((thread) => {
      const rect = anchors.locate(thread.anchor);
      if (rect.y < -rect.height - 40 || rect.y > window.innerHeight + 40)
        return { thread, rect, blocked: false };
      const target = anchors.resolve(thread.anchor);
      const hit = siteElementAt(rect.x + 8, rect.y - 10);
      const blocked = !!(
        target &&
        hit &&
        !target.contains(hit) &&
        !hit.contains(target)
      );
      return { thread, rect, blocked };
    });
    for (const { thread, rect } of positions) {
      if (detachedThreads.has(thread.id) === !rect.attached) continue;
      if (rect.attached) detachedThreads.delete(thread.id);
      else detachedThreads.add(thread.id);
      const item = shadow.querySelector(
        `.thread-item[data-thread="${CSS.escape(thread.id)}"]`,
      );
      if (item) updateCardPage(item, thread);
    }
    const snapshot = JSON.stringify([
      selected,
      density,
      draft && anchors.locate(draft),
      positions.map(({ thread, rect, blocked }) => [
        thread.id,
        rect,
        blocked,
        pinDirection(rect, window.innerWidth),
        stacks.get(thread.id)?.[0].id,
      ]),
    ]);
    if (snapshot === pinSnapshot) return;
    pinSnapshot = snapshot;
    // A hover card previewing After changes the page itself; keep it open.
    if (!designModule?.isPreviewing(hoverPreviewKey)) hidePreview();
    const focused = shadow.activeElement?.matches(".pins :focus-visible")
      ? (shadow.activeElement as HTMLElement).dataset
      : undefined;
    const listed = pins.querySelector<HTMLElement>(".pin-cluster[open]")?.dataset.cluster;
    pins.replaceChildren();
    // Rebuilt pins pick up the breath where the previous ones left it.
    if ("breathe" in pins.dataset)
      pins.style.setProperty("--pin-breathe-delay", `${(breatheStart - performance.now()) % 1800}ms`);
    const measured = new Map(
      positions.map((position) => [position.thread.id, position]),
    );
    const bounds = pinBounds();
    // Each unit is a lone pin or a same-target stack at its oldest thread's anchor. Moved
    // pins keep their own place: they never stack or merge.
    const units: PinUnit[] = [];
    const grouped = new Set<Thread[]>();
    for (const { thread, rect, blocked } of positions) {
      // Never draw a pin at stale page coordinates; the sidebar lists it instead.
      if (!rect.attached) continue;
      const group = stacks.get(thread.id);
      const leader = group && measured.get(group[0].id);
      const placement = leader?.rect.attached ? leader : { rect, blocked };
      if (
        placement.rect.y < -placement.rect.height - 40 ||
        placement.rect.y > window.innerHeight + 40
      )
        continue;
      if (placement.blocked) continue;
      if (rect.width && rect.height) {
        const area = el("div", "area");
        Object.assign(area.style, {
          left: `${rect.x}px`,
          top: `${rect.y}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          opacity: thread.id === selected ? "1" : ".45",
        });
        pins.append(area);
      }
      const stack = leader?.rect.attached ? group! : null;
      if (stack && grouped.has(stack)) continue;
      const at = placement.rect;
      // A stack fans out away from the nearer edge of the page.
      const right = stack
        ? at.x - 9 + Math.min(stack.length, 6) * 38 > bounds.right
        : pinDirection(at, window.innerWidth) === "right";
      if (stack) grouped.add(stack);
      units.push({
        threads: stack ?? [thread],
        rect: at,
        right,
        owner: stack ? owners.get(stack[0].id) : undefined,
        box: thread.anchor.unstacked || thread.id === selected
          ? null
          : hitArea(at.x, at.y, right, stack ? stackWidth(stack.length, density === "dot" ? 12 : 20) : 24),
      });
    }
    const pinFor = (thread: Thread, rect: (typeof positions)[number]["rect"]) => {
      const number = threads.indexOf(thread) + 1;
      const first = thread.comments[0];
      const pin = button(
        first
          ? `Comment ${number} by ${first.author.name}: ${firstLine(first.body)}`
          : `Comment ${number}`,
        () => selectThread(thread),
        `pin${thread.id === selected ? " active" : ""}${thread.id === hotCard ? " hot" : ""}${thread.resolved ? " resolved" : ""}${rect.attached ? "" : " detached"}`,
      );
      pin.textContent = "";
      // The hover card replaces the native tooltip; aria-label stays.
      pin.title = "";
      pin.toggleAttribute("data-read", !unread(thread));
      if (first) {
        const author = first.author;
        applyAccent(pin, author.accentColor);
        const face = avatar(author);
        face.dataset.initial = initials(author.name).slice(0, 1);
        pin.append(face);
        const photo = pin.querySelector("img");
        if (photo) photo.draggable = false;
      }
      if (thread.resolved) {
        const resolved = el("span", "pin-check");
        resolved.append(icon("check"));
        pin.append(resolved);
      }
      const showPreview = () => {
        if (
          selected ||
          draft ||
          mode ||
          movingThread ||
          draggedPin ||
          previewSuppressed
        )
          return;
        previewClosing = false;
        window.clearTimeout(previewTimer);
        const wasHidden = pinPreview.hidden || previewThread !== thread.id;
        previewMotion?.cancel();
        previewThread = thread.id;
        pinPreview.replaceChildren();
        const message = thread.comments[0];
        if (!message) return;
        const open = button(
          "Open comment",
          () => selectThread(thread),
          "pin-preview-open",
        );
        open.textContent = "";
        const design = designProposal.test(message.body);
        const summary = el(design ? "div" : "p", "hover-message", commentText(message.body));
        if (design)
          void loadDesignComments().then(({ renderDesignComment }) =>
            renderDesignComment(summary, message.body, {
              key: (hoverPreviewKey = `hover:${message.id}`),
              resolve: (selector) => onThreadPage(thread) ? designTarget(thread.anchor)(selector) : null,
              note: (node, text) => (node.textContent = text),
              compact: true,
              design: options.design,
            }),
          );
        // The design card has its own Before/After buttons, so it sits beside the
        // open button (buttons can't nest) and opens the comment on other clicks.
        open.append(authorRow(message));
        if (design) {
          summary.classList.add("pin-preview-card");
          summary.addEventListener("click", (event) => {
            if (!(event.target as Element).closest(".design-toggle")) selectThread(thread);
          });
        } else open.append(summary);
        // A sibling of the open button: buttons can't nest.
        const resolve = button(
          thread.resolved ? "Reopen comment" : "Resolve comment",
          () => {
            hidePreview();
            toggleResolved(thread);
          },
          "icon pin-preview-resolve",
          "check",
        );
        resolve.disabled = !canResolve();
        pinPreview.append(open, ...(design ? [summary] : []), resolve);
        pinPreview.hidden = false;
        const point = indicatorPoint(pin, rect);
        const right =
          expanded && !compactSidebar
            ? 396
            : 12;
        const place = placeCard(pinEdges(pin), pinPreview.offsetWidth || 320, pinPreview.offsetHeight, {
          left: 12,
          top: 12,
          right: window.innerWidth - right,
          bottom: framed ? Math.min(window.innerHeight, frameRect().bottom) - 12 : window.innerHeight - 92,
        });
        Object.assign(pinPreview.style, {
          left: `${place.x}px`,
          transformOrigin:
            point.x < place.x + 160 ? "top left" : "top right",
          top: `${place.y}px`,
        });
        if (
          wasHidden &&
          !reducedMotion()
        )
          previewMotion = pinPreview.animate(
            [
              { opacity: 0, transform: "translateY(6px) scale(.97)" },
              { opacity: 1, transform: "none" },
            ],
            { duration: 250, easing: "cubic-bezier(.22,1,.36,1)" },
          );
      };
      pin.addEventListener("pointerenter", showPreview);
      pin.addEventListener("pointermove", (event) => {
        if (
          previewSuppressed &&
          !movingThread &&
          !draggedPin &&
          event.buttons === 0 &&
          (event.movementX || event.movementY)
        ) {
          previewSuppressed = false;
          showPreview();
        }
      });
      pin.addEventListener("focus", showPreview);
      pin.addEventListener("blur", () => hidePreview());
      pin.addEventListener("pointerleave", () => {
        previewTimer = window.setTimeout(hidePreview, 120);
      });
      pin.dataset.thread = thread.id;
      return pin;
    };
    const context = {
      root: shadow,
      bounds,
      pin: (thread: Thread) => pinFor(thread, measured.get(thread.id)!.rect),
      summary: (thread: Thread) => firstLine(thread.comments[0]?.body ?? ""),
      open: (thread: Thread) => selectThread(thread),
      menu: actionMenu,
    };
    // Pins on distinct targets whose 24px hit areas overlap at the current scale merge.
    for (const members of grouping ? collisions(units.map((unit) => unit.box)) : units.map((_, index) => [index])) {
      const unit = units[members[0]];
      if (members.length > 1 || unit.threads.length > 1) {
        if (!pinGroups) loadGroups();
        else
          pins.append(
            members.length > 1
              ? pinGroups.bubble(members.map((index) => units[index]), members.flatMap((index) => units[index].threads).sort(byAge), context)
              : pinGroups.stack(unit, context),
          );
      } else {
        const pin = context.pin(unit.threads[0]);
        pin.dataset.pointer = unit.right ? "right" : "left";
        Object.assign(pin.style, { left: `${unit.rect.x}px`, top: `${unit.rect.y}px` });
        pins.append(pin);
      }
    }
    // Keyboard focus survives a redraw; an open bubble list follows its bubble.
    if (focused?.thread || focused?.cluster)
      pins
        .querySelector<HTMLElement>(
          focused.thread ? `.pin[data-thread="${CSS.escape(focused.thread)}"]` : `[data-cluster="${CSS.escape(focused.cluster!)}"]`,
        )
        ?.focus({ preventScroll: true });
    if (listed) pins.querySelector<HTMLDetailsElement>(`[data-cluster="${CSS.escape(listed)}"]`)?.setAttribute("open", "");
    if (pins.dataset.size && nearPoint) markNear();
    if (draft && draft.width > 0 && draft.height > 0) {
      const rect = locateAnchor(draft);
      const area = el("div", "area");
      Object.assign(area.style, {
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${Math.max(8, rect.width)}px`,
        height: `${Math.max(8, rect.height)}px`,
      });
      pins.append(area);
    }
  }
  let copiedPrompt: "all" | "page" | null = null;
  let copiedPromptTimer = 0;
  async function copyPrompt(scope: "all" | "page") {
    // A page prompt includes all-pages threads only where their target exists.
    const prompt = agentPrompt(scope === "page" ? threads.filter((thread) => here(thread)) : threads, {
      ...options,
      origin: location.origin,
      page: scope === "page" ? page() : undefined,
    });
    if (!prompt) {
      notify(
        scope === "page"
          ? "No open comments on this page"
          : "No open comments to copy",
      );
      return;
    }
    await navigator.clipboard.writeText(prompt);
    if (destroyed) return;
    copiedPrompt = scope;
    live.textContent = "Agent prompt copied";
    clearTimeout(copiedPromptTimer);
    renderToolbar();
    renderList();
    copiedPromptTimer = window.setTimeout(() => {
      copiedPrompt = null;
      renderToolbar();
      renderList();
    }, 2000);
  }
  let disposeHeaderTip: (() => void) | undefined;
  // The sidebar's dark tooltip, shared by header tools and list card actions.
  let sidebarTip: { show(target: HTMLElement): void; hide(): void } | undefined;
  /** Give a sidebar control the dark tooltip in place of a native title. */
  const tipFor = (node: HTMLElement) => {
    node.removeAttribute("title");
    node.addEventListener("pointerenter", (event) => {
      if (event.pointerType === "mouse") sidebarTip?.show(node);
    });
    node.addEventListener("focus", () => sidebarTip?.show(node));
    for (const type of ["pointerleave", "blur", "pointerdown"])
      node.addEventListener(type, () => sidebarTip?.hide());
  };
  const dismissedTips = new Set<string>();
  const dismissedTipsKey = "branch-comments:dismissed-tips";
  const tips: [string, string][] = [
    ["copy", "Copy comments for your agent."],
  ];
  if (shortcuts.comment)
    tips.push(["shortcut", `Press ${shortcuts.comment.label} to comment.`]);
  // Empty-state coach marks: persistent tooltips pinned to the buttons they
  // describe. They live on the sidebar so they ride along as it parks/peeks.
  function syncTips(show: boolean) {
    try {
      const stored = JSON.parse(localStorage.getItem(dismissedTipsKey) ?? "[]");
      if (Array.isArray(stored))
        for (const id of stored)
          if (typeof id === "string") dismissedTips.add(id);
    } catch {
      /* Show every tip when storage is blocked. */
    }
    for (const [id, body] of tips) {
      let card = sidebar.querySelector<HTMLElement>(`[data-tip="${id}"]`);
      if (!show || dismissedTips.has(id)) {
        card?.remove();
        continue;
      }
      if (card) continue;
      card = el("div", "morphing-menu__tooltip sidebar-tip");
      card.dataset.tip = id;
      const node = card;
      card.append(
        el("p", "", body),
        button(
          "Dismiss tip",
          () => {
            dismissedTips.add(id);
            try {
              localStorage.setItem(
                dismissedTipsKey,
                JSON.stringify([...dismissedTips]),
              );
            } catch {
              /* Dismissal still lasts for this widget instance. */
            }
            node.dataset.leaving = "";
            setTimeout(() => node.remove(), 150);
          },
          "icon",
          "close",
        ),
      );
      sidebar.append(card);
    }
    pointTips();
  }
  function pointTips() {
    const frame = sidebar.getBoundingClientRect();
    for (const card of sidebar.querySelectorAll<HTMLElement>(".sidebar-tip")) {
      const up = card.dataset.tip === "copy";
      const box = sidebar
        .querySelector(
          up ? ".copy-page-prompt" : '.toolbar [aria-label^="Add comment"]',
        )
        ?.getBoundingClientRect();
      card.hidden = !box?.width;
      if (!box?.width) continue;
      const x = box.left + box.width / 2 - frame.left;
      const left = Math.max(
        12,
        Math.min(frame.width - 12 - card.offsetWidth, x - card.offsetWidth / 2),
      );
      card.style.left = `${left}px`;
      card.style.top = up
        ? `${box.bottom - frame.top + 10}px`
        : `${box.top - frame.top - 10 - card.offsetHeight}px`;
      card.style.setProperty("--caret-x", `${x - left}px`);
    }
  }
  let cleanupIdentity: string | null | undefined;
  let cleanupOwner = false;
  function confirmResolvedCleanup(trigger: HTMLButtonElement) {
    if (!cleanupOwner || optimistic.busy) return;
    const ids = filtered()
      .filter((thread) => thread.resolved)
      .map((thread) => thread.id);
    if (!ids.length) return;
    const prompt = el("div", "cleanup-confirm");
    prompt.popover = "auto";
    prompt.setAttribute("role", "alertdialog");
    prompt.setAttribute("aria-label", "Delete resolved comments permanently");
    prompt.append(
      el(
        "strong",
        "",
        `Delete ${ids.length} resolved ${ids.length === 1 ? "thread" : "threads"}?`,
      ),
      el("p", "", "Their replies will be deleted too. This can’t be undone."),
    );
    const actions = el("div", "cleanup-actions");
    const close = () => {
      prompt.hidePopover();
      trigger.focus({ preventScroll: true });
    };
    actions.append(
      button("Cancel", close, "secondary"),
      button(
        "Delete permanently",
        () => {
          close();
          run(async () => {
            try {
              for (let offset = 0; offset < ids.length; offset += 250) {
                const batch = ids.slice(offset, offset + 250);
                const removed = new Set(batch);
                await optimistic.submit(
                  (state) => state.filter((thread) => !removed.has(thread.id)),
                  async () => {
                    await api.request("project/clear-resolved", "POST", {
                      confirm: options.project,
                      threadIds: batch,
                    });
                  },
                );
              }
            } finally {
              await refresh();
            }
          });
        },
        "secondary destructive",
      ),
    );
    prompt.append(actions);
    sidebar.append(prompt);
    prompt.addEventListener("toggle", () => {
      if (!prompt.matches(":popover-open")) prompt.remove();
    });
    prompt.showPopover();
    const rect = trigger.getBoundingClientRect();
    prompt.style.left = `${Math.max(12, Math.min(rect.right - prompt.offsetWidth, innerWidth - prompt.offsetWidth - 12))}px`;
    prompt.style.top = `${Math.max(12, Math.min(rect.bottom + 8, innerHeight - prompt.offsetHeight - 12))}px`;
    actions.querySelector<HTMLButtonElement>("button")?.focus();
  }
  const canResolve = () => !pending && (guestResolve || !!api.user?.verified);
  function toggleResolved(
    thread: Thread,
    noticeAnchor?: ReturnType<typeof captureNoticePosition>,
  ) {
    if (!api.user && (!guests || !guestName.trim())) {
      openAccount();
      return;
    }
    // Sidebar toggles leave the open card alone; the card's own toggle closes it.
    const wasSelected = selected === thread.id;
    const updateResolved = (resolved: boolean) => {
      const previous = selected;
      if (wasSelected) selected = resolved ? null : thread.id;
      return saveOptimistic(
        changeThread(thread.id, (current) => ({
          ...current,
          resolved,
          resolvedBy: resolved ? api.user : null,
        })),
        async (id) => {
          if (!api.user) await api.guest(guestName);
          await api.request(`threads/${id(thread.id)}`, "PATCH", {
            resolved,
          });
        },
        () => {
          if (!selected) selected = previous;
        },
      );
    };
    run(() => updateResolved(!thread.resolved));
    notify(
      thread.resolved ? "Comment reopened" : "Comment resolved",
      {
        label: "Undo",
        run: () => run(() => updateResolved(thread.resolved)),
      },
      noticeAnchor,
    );
  }
  const listItems = new WeakMap<Thread, HTMLElement>();
  const expandedReplies = new Set<string>();
  /** A thread's one-line summary, as on its list card. */
  function summary(node: HTMLElement, body: string) {
    node.textContent = body;
    if (designProposal.test(body)) {
      node.textContent = "Design change";
      void loadDesignComments().then(({ summarizeDesignComment }) => {
        node.textContent = summarizeDesignComment(body);
      });
    }
    return node;
  }
  function renderList() {
    if (options.onboarding) {
      disposeHeaderTip?.();
      sidebar.replaceChildren();
      if (options.onboarding.inProject) return;
      if (expanded) {
        const panel = el("aside", "panel");
        panel.setAttribute("aria-label", "Project settings");
        const head = el("div", "panel-head", "Project settings");
        const content = el("div", "empty");
        content.append(
          el("p", "", "Leave comments on your connected website."),
          button(
            "Manage project",
            () => {
              openAccount();
            },
            "secondary",
          ),
        );
        panel.append(head, content);
        sidebar.append(panel);
      }
      return;
    }
    // Keep outgoing rows intact for the collapse animation; refresh them on open.
    if (!expanded && (edgeSidebar || compactSidebar)) return;
    const existingList = sidebar.querySelector(".list");
    const scroll = existingList?.scrollTop ?? 0;
    const editing = shadow.activeElement?.closest<HTMLElement>(".thread-item");
    const retained = editing?.querySelector(".reply-composer")?.contains(shadow.activeElement)
      ? editing : null;
    const retainedMarker = el("div");
    const focusedSearch =
      shadow.activeElement?.getAttribute("aria-label") === "Search comments";
    const searchCaret = focusedSearch
      ? (shadow.activeElement as HTMLInputElement).selectionStart
      : null;
    if (!expanded && !edgeSidebar && !compactSidebar) {
      disposeHeaderTip?.();
      sidebar.replaceChildren();
      return;
    }
    let panel = sidebar.querySelector<HTMLElement>(".panel");
    if (!panel) {
      panel = el("aside", "panel");
      panel.setAttribute("aria-label", "All comments");
      const head = el("div", "panel-head");
      const title = el("div", "row between sidebar-title");
      const filterSlot = el("div", "filter-slot");
      const tools = el("div", "row");
      const setSearch = (open: boolean) => {
        const field = panel!.querySelector<HTMLElement>(
          ".sidebar-search-field",
        )!;
        const trigger = tools.querySelector<HTMLButtonElement>(
          '[aria-label="Search comments"]',
        )!;
        const origin = (open ? trigger : field).getBoundingClientRect();
        searchOpen = open;
        if (!open) {
          search = "";
          field.querySelector("input")!.value = "";
        }
        renderList();
        const destination = (open ? field : trigger).getBoundingClientRect();
        if (!reducedMotion()) {
          field.animate(
            open
              ? [
                  {
                    transform: `translate(${origin.left - destination.left}px, ${origin.top - destination.top}px)`,
                    width: `${origin.width}px`,
                    height: `${origin.height}px`,
                    borderRadius: "50%",
                    opacity: 0.4,
                  },
                  {
                    transform: "none",
                    width: `${destination.width}px`,
                    height: `${destination.height}px`,
                    borderRadius: "10px",
                    opacity: 1,
                  },
                ]
              : [
                  { transform: "none", opacity: 1 },
                  {
                    transform: `translate(${destination.left - origin.left}px, ${destination.top - origin.top}px) scale(.2)`,
                    opacity: 0,
                  },
                ],
            { duration: 280, easing: "cubic-bezier(.22,1,.36,1)" },
          );
        }
        if (open) field.querySelector("input")?.focus();
        else trigger.focus();
      };
      tools.append(
        button(
          "Copy page comments",
          () =>
            filter === "resolved"
              ? confirmResolvedCleanup(
                  panel!.querySelector<HTMLButtonElement>(".copy-page-prompt")!,
                )
              : run(() => copyPrompt("page")),
          "icon copy-page-prompt",
          "copy",
        ),
        el("div", "tag-filter-slot"),
        button(
          "Search comments",
          () => setSearch(true),
          "icon sidebar-search-trigger",
          "search",
        ),
        button("Close sidebar", () => toggleExpanded(false), "icon", "close"),
      );
      const selector = el("div", "sidebar-selector");
      selector.append(filterSlot, el("div", "scope-slot"));
      title.append(selector, tools);
      const searchPanel = el("div", "sidebar-search");
      const searchInner = el("div", "sidebar-search-inner");
      const searchRow = el("div", "sidebar-search-row");
      const field = el("div", "sidebar-search-field");
      const input = el("input");
      input.type = "search";
      input.placeholder = "Search";
      input.setAttribute("aria-label", "Search comments");
      input.addEventListener("input", () => {
        search = input.value;
        renderList();
      });
      input.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          closeSearch();
        }
      });
      field.append(icon("search"), input);
      const closeSearch = () => setSearch(false);
      field.append(
        button("Close search", closeSearch, "icon search-cancel", "close"),
      );
      searchRow.append(field);
      searchInner.append(searchRow);
      searchPanel.append(searchInner);
      head.append(title, searchPanel);
      // Header icon tooltips reuse the toolbar's tooltip surface. It lives at
      // the shadow root so the sidebar's park/peek transforms can't offset it.
      const tip = el("div", "morphing-menu__tooltip sidebar-tooltip");
      tip.setAttribute("aria-hidden", "true");
      shadow.append(tip);
      let tipTimer = 0;
      let tipWarmUntil = 0;
      const hideTip = () => {
        clearTimeout(tipTimer);
        if (!tip.dataset.open) return;
        delete tip.dataset.open;
        tipWarmUntil = Date.now() + 300;
      };
      disposeHeaderTip = () => {
        clearTimeout(tipTimer);
        tip.remove();
        disposeHeaderTip = undefined;
        sidebarTip = undefined;
      };
      const showTip = (target: HTMLElement) => {
        clearTimeout(tipTimer);
        const reveal = () => {
          if (!target.isConnected) return;
          const box = target.getBoundingClientRect();
          tip.textContent = target.ariaLabel;
          const half = tip.offsetWidth / 2;
          tip.style.left = `${Math.max(8 + half, Math.min(innerWidth - 8 - half, box.left + box.width / 2))}px`;
          tip.style.top = `${box.bottom + 8}px`;
          tip.dataset.open = "true";
        };
        if (tip.dataset.open || Date.now() < tipWarmUntil) reveal();
        else tipTimer = window.setTimeout(reveal, 400);
      };
      tools.querySelectorAll("button").forEach(tipFor);
      sidebarTip = { show: showTip, hide: hideTip };
      panel.append(head);
      sidebar.append(panel);
    }
    const copyPage =
      panel.querySelector<HTMLButtonElement>(".copy-page-prompt")!;
    if (filter === "resolved" && cleanupIdentity !== api.token) {
      cleanupIdentity = api.token;
      cleanupOwner = false;
      const identity = cleanupIdentity;
      if (identity)
        void api
          .request("project")
          .then(() => {
            if (api.token !== identity) return;
            cleanupOwner = true;
            renderList();
          })
          .catch(() => {});
    }
    const deleting = filter === "resolved";
    copyPage.disabled =
      deleting && (!cleanupOwner || optimistic.busy || !filtered().length);
    copyPage.classList.toggle("destructive", deleting);
    const copyGlyph = deleting
      ? "trash"
      : copiedPrompt === "page"
        ? "check"
        : "copy";
    if (copyPage.dataset.glyph !== copyGlyph) {
      const previous = copyPage.querySelector("svg:not([data-leaving])");
      const next = icon(copyGlyph);
      const shouldAnimate =
        copyPage.dataset.glyph !== undefined &&
        !reducedMotion();
      copyPage.dataset.glyph = copyGlyph;
      if (shouldAnimate && previous) {
        previous.setAttribute("data-leaving", "true");
        copyPage.append(next);
        const timing = { duration: 200, easing: "cubic-bezier(.22,1,.36,1)" };
        const hidden = {
          opacity: 0,
          transform: "scale(.7)",
          filter: "blur(2px)",
        };
        const visible = {
          opacity: 1,
          transform: "scale(1)",
          filter: "blur(0px)",
        };
        previous
          .animate([visible, hidden], { ...timing, fill: "forwards" })
          .finished.then(() => previous.remove())
          .catch(() => previous.remove());
        next.animate([hidden, visible], timing);
      } else copyPage.replaceChildren(next);
    }
    copyPage.setAttribute(
      "aria-label",
      deleting
        ? cleanupOwner
          ? "Delete resolved comments permanently"
          : "Project owner only"
        : copiedPrompt === "page"
          ? "Copied prompt"
          : "Copy page comments",
    );
    panel.dataset.search = String(searchOpen);
    panel.querySelector<HTMLElement>(".filter-slot")!.inert = searchOpen;
    panel.querySelector<HTMLElement>(".scope-slot")!.inert = !searchOpen;
    panel.querySelector<HTMLElement>(".sidebar-search-trigger")!.inert =
      searchOpen;
    const searchPanel = panel.querySelector<HTMLElement>(".sidebar-search")!;
    searchPanel.inert = !searchOpen;
    const filterSlot = panel.querySelector<HTMLElement>(".filter-slot")!;
    const knownTags = tagsEnabled
      ? [...new Set(threads.flatMap((t) => t.tags ?? []))].sort()
      : [];
    // A tag that no longer exists on any thread stops filtering.
    if (tagFilter && !knownTags.includes(tagFilter)) tagFilter = "";
    if (filterSlot.dataset.value !== filter) {
      filterSlot.dataset.value = filter;
      filterSlot.replaceChildren(
        selectionMenu(
          "Filter comments",
          [
            ["open", "Comments"],
            ["all", "All comments"],
            ["resolved", "Resolved"],
          ],
          filter,
          (value) => {
            filter = value as typeof filter;
            renderList();
            renderPins();
          },
        ),
      );
    }
    const tagSlot = panel.querySelector<HTMLElement>(".tag-filter-slot");
    const tagKey = `${tagFilter} ${knownTags}`;
    if (tagSlot && tagSlot.dataset.value !== tagKey) {
      tagSlot.dataset.value = tagKey;
      tagSlot.replaceChildren();
      if (knownTags.length) {
        // An icon button beside Search; the menu lists the project's tags.
        const label = tagFilter ? `Filtered by #${tagFilter}` : "Filter by tag";
        const menu = selectionMenu(
          label,
          [["", "All tags"], ...knownTags.map((tag) => [tag, `#${tag}`] as const)],
          tagFilter,
          (value) => {
            tagFilter = value;
            renderList();
            renderPins();
          },
        );
        const trigger = menu.querySelector("summary")!;
        trigger.className = `icon tag-filter-trigger${tagFilter ? " active" : ""}`;
        trigger.setAttribute("aria-label", label);
        trigger.title = label;
        trigger.replaceChildren(icon("tag"));
        tagSlot.append(menu);
      }
    }
    const scopeSlot = panel.querySelector<HTMLElement>(".scope-slot")!;
    if (scopeSlot.dataset.value !== String(allPages)) {
      scopeSlot.dataset.value = String(allPages);
      scopeSlot.replaceChildren(
        selectionMenu(
          "Comment pages",
          [
            ["page", "This page"],
            ["all", "All pages"],
          ],
          allPages ? "all" : "page",
          (value) => {
            allPages = value === "all";
            renderList();
          },
        ),
      );
    }
    const animateRows =
      !compactSidebar &&
      !restoring &&
      !reducedMotion();
    const previous = new Map<string | undefined, number>();
    if (animateRows && existingList) {
      const bounds = existingList.getBoundingClientRect();
      for (const card of existingList.querySelectorAll<HTMLElement>(
        "[data-thread]",
      )) {
        const box = card.getBoundingClientRect();
        if (box.bottom >= bounds.top && box.top <= bounds.bottom)
          previous.set(card.dataset.thread, box.top);
      }
    }
    let list = el("div", "list");
    const rows = filtered();
    if (rows.length > 40) list.dataset.long = "";
    const loading = !knownThreads && connection === "Connecting";
    list.setAttribute("aria-busy", String(loading));
    clearTimeout(listScrollTimer);
    list.addEventListener(
      "scroll",
      () => {
        list.dataset.scrolling = "true";
        clearTimeout(listScrollTimer);
        listScrollTimer = window.setTimeout(() => {
          delete list.dataset.scrolling;
        }, 800);
      },
      { passive: true },
    );
    for (const thread of rows) {
      const first = thread.comments[0];
      if (!first) continue;
      const cached = listItems.get(thread);
      if (cached) {
        cached
          .querySelector(".thread-card")!
          .classList.toggle("active", selected === thread.id);
        cached.querySelector<HTMLButtonElement>(".card-resolve")!.disabled =
          !canResolve();
        cached.querySelector("small")!.textContent = age(first.createdAt);
        cached.querySelectorAll(".reply-meta small").forEach((node, index) => {
          node.textContent = age(thread.comments[index + 1].createdAt);
        });
        updateCardPage(cached, thread);
        const input = cached.querySelector("textarea");
        if (input && shadow.activeElement !== input)
          requestAnimationFrame(() => input.dispatchEvent(new Event("komo-sync-reply")));
        list.append(cached === retained ? retainedMarker : cached);
        continue;
      }
      const card = button(
        `Open comment by ${first.author.name}`,
        () => selectThread(thread),
        `thread-card${selected === thread.id ? " active" : ""}`,
      );
      card.replaceChildren();
      // The accessible name is enough; a native title would paint a browser tooltip.
      card.removeAttribute("title");
      const header = el("div", "row");
      const status = el("span", "card-status");
      header.append(
        avatar(first.author),
        el("span", "author", first.author.name),
        status,
        el("small", "", age(first.createdAt)),
      );
      const route = el("div", "card-page-row");
      const pageLink = el("a", "page", "Page link");
      pageLink.addEventListener("click", event => {
        event.preventDefault();
        selectThread(thread);
      });
      const copyPage = button("Copy page URL", () => run(async () => {
        await navigator.clipboard.writeText(new URL(thread.page, location.origin).href);
        notify("Page URL copied");
      }), "icon card-page-copy", "copy");
      const fullUrl = el("span", "card-page-url");
      route.append(icon("link"), pageLink, copyPage, fullUrl);
      const preview = summary(el("p", "preview"), first.body);
      card.append(header, preview);
      if (tagsEnabled && thread.tags?.length) {
        const tags = el("div", "card-tags");
        tags.setAttribute("role", "group");
        tags.setAttribute("aria-label", "Tags");
        for (const tag of thread.tags) {
          const chip = el("span", "card-tag", `#${tag}`);
          chip.title = tag;
          tags.append(chip);
        }
        card.append(tags);
      }
      const keep = retained?.dataset.thread === thread.id ? retained : null;
      const item = keep ?? el("div", "thread-item");
      const livePreviews = keep?.querySelector<HTMLElement>(".sidebar-replies");
      const liveComposer = livePreviews?.querySelector(".reply-composer");
      if (keep) for (const child of [...keep.children]) {
        if (child !== livePreviews) child.remove();
      }
      item.dataset.thread = thread.id;
      const quickResolve = button(
        thread.resolved ? "Reopen comment" : "Resolve comment",
        () => toggleResolved(thread),
        "icon card-resolve",
        "check",
      );
      quickResolve.disabled = !canResolve();
      tipFor(quickResolve);
      item.insertBefore(card, livePreviews ?? null);
      item.insertBefore(quickResolve, livePreviews ?? null);
      item.insertBefore(route, livePreviews ?? null);
      updateCardPage(item, thread);
      {
        const previews = livePreviews ?? el("div", "sidebar-replies");
        if (liveComposer) for (const child of [...previews.children]) {
          if (child !== liveComposer) child.remove();
        }
        previews.id = `replies-${thread.id}`;
        previews.setAttribute("role", "group");
        previews.setAttribute("aria-label", `Replies to ${first.author.name}`);
        const count = thread.comments.length === 1 ? "Reply" : `${thread.comments.length - 1} ${thread.comments.length === 2 ? "reply" : "replies"}`;
        const toggle = button(count, () => {
          if (expandedReplies.has(thread.id)) expandedReplies.delete(thread.id);
          else expandedReplies.add(thread.id);
          syncReplies();
        }, "card-reply-toggle");
        toggle.replaceChildren(icon("comment"), el("span", "", count), icon("chevron"));
        toggle.removeAttribute("title");
        toggle.setAttribute("aria-controls", previews.id);
        const syncReplies = () => {
          const open = expandedReplies.has(thread.id);
          previews.hidden = !open;
          toggle.setAttribute("aria-expanded", String(open));
          toggle.setAttribute("aria-label", `${open ? "Hide" : "Show"} ${count}`);
          if (open) requestAnimationFrame(() =>
            previews.querySelector("textarea")?.dispatchEvent(new Event("komo-sync-reply")),
          );
        };
        syncReplies();
        for (const reply of thread.comments.slice(1)) {
          const row = el("div", "sidebar-reply");
          const meta = el("div", "row reply-meta");
          meta.append(
            avatar(reply.author),
            el("span", "author", reply.author.name),
            el("small", "", age(reply.createdAt)),
          );
          row.append(meta, el("p", "", reply.body));
          previews.insertBefore(row, liveComposer ?? null);
        }
        if (!liveComposer) previews.append(composer(thread));
        item.insertBefore(toggle, livePreviews ?? null);
        if (!livePreviews) item.append(previews);
        item.onkeydown = (event) => {
          if (event.key !== "Escape" || !expandedReplies.has(thread.id)) return;
          event.preventDefault();
          event.stopPropagation();
          expandedReplies.delete(thread.id);
          syncReplies();
          toggle.focus({ preventScroll: true });
        };
      }
      listItems.set(thread, item);
      list.append(keep ? retainedMarker : item);
    }
    if (!list.childElementCount) {
      const empty = el("div", "empty");
      if (loading) empty.setAttribute("role", "status");
      empty.append(
        icon("comment"),
        el(
          "strong",
          "",
          accessError
            ? privateProject
              ? "Private project"
              : "Sign in required"
            : connection === "Offline" && issue
              ? issue.title
              : loading
                ? "Loading comments…"
                : search
                  ? "No matching comments"
                  : filter === "resolved"
                    ? "Nothing resolved yet"
                    : "No comments yet",
        ),
      );
      if (accessError) {
        empty.append(el("p", "", accessError));
        if (!api.user?.verified)
          empty.append(button("Sign in", openAccount, "secondary"));
      } else if (connection === "Offline" && issue) {
        empty.append(el("p", "", issue.detail));
        const actions = el("div", "empty-actions");
        if (issue.kind === "site")
          actions.append(
            button(
              "Turn on comments",
              () => {
                // The owner approves this site on the komo service, where
                // sign-in isn't blocked; returning to this tab retries.
                const setup = new URL("/setup", options.endpoint);
                setup.searchParams.set("workspace", options.project);
                setup.searchParams.set("site", location.origin);
                window.open(setup, "_blank", "noopener");
              },
              "primary",
            ),
            button(
              "Copy link",
              () =>
                void navigator.clipboard
                  .writeText(location.origin)
                  .then(() => notify("Link copied"))
                  .catch(() => notify(location.origin)),
              "secondary",
            ),
          );
        // Returning focus retries a site approval; other issues need a button.
        if (issue.kind !== "site")
          actions.append(button("Try again", retryConnection, "secondary"));
        empty.append(actions);
      } else if (knownThreads && !search && filter !== "resolved") {
        empty.append(
          button(
            "Add a comment",
            () => {
              if (isCompactReview(window.innerWidth, window.innerHeight))
                toggleExpanded(false);
              setMode(true);
            },
            "secondary",
          ),
        );
      }
      list.append(empty);
      list.dataset.empty = "";
    }
    if (threads.length && connection === "Offline")
      list.prepend(
        button("Saved comments · Try again", retryConnection, "secondary"),
      );
    if (existingList && retained && retainedMarker.parentNode === list) {
      // Keep the editing subtree connected: moving it would end native composition.
      for (const child of [...existingList.children]) if (child !== retained) child.remove();
      for (const child of [...list.children]) {
        if (child === retainedMarker) break;
        existingList.insertBefore(child, retained);
      }
      retainedMarker.remove();
      existingList.append(...list.childNodes);
      existingList.setAttribute("aria-busy", String(loading));
      if (rows.length > 40) (existingList as HTMLElement).dataset.long = "";
      else delete (existingList as HTMLElement).dataset.long;
      list = existingList as HTMLDivElement;
    } else if (existingList) existingList.replaceWith(list);
    else panel.append(list);
    syncTips(!!list.querySelector(".empty [aria-label='Add a comment']"));
    requestAnimationFrame(pointTips);
    list.scrollTop = scroll;
    // Cards outdent past the list's scrollbar gutter so their content keeps the panel's grid.
    list.style.setProperty("--komo-scrollbar", `${list.offsetWidth - list.clientWidth}px`);
    if (animateRows) {
      let entered = 0;
      const bounds = list.getBoundingClientRect();
      for (const card of list.querySelectorAll<HTMLElement>("[data-thread]")) {
        const box = card.getBoundingClientRect();
        if (box.bottom < bounds.top || box.top > bounds.bottom) continue;
        const oldTop = previous.get(card.dataset.thread);
        const delta = oldTop === undefined ? 8 : oldTop - box.top;
        if (Math.abs(delta) > 0.5)
          card.animate(
            [
              {
                opacity: oldTop === undefined ? 0 : 1,
                transform: `translateY(${Math.max(-40, Math.min(40, delta))}px)`,
              },
              { opacity: 1, transform: "translateY(0)" },
            ],
            {
              duration: 250,
              delay: oldTop === undefined ? Math.min(entered++, 5) * 40 : 0,
              easing: "cubic-bezier(0.22, 1, 0.36, 1)",
              fill: "backwards",
            },
          );
      }
      if (!list.querySelector("[data-thread]"))
        list.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150 });
    }
    if (focusedSearch) {
      const input = panel.querySelector<HTMLInputElement>(
        'input[type="search"]',
      )!;
      input.focus();
      if (searchCaret !== null)
        input.setSelectionRange(searchCaret, searchCaret);
    }
  }

  function authorRow(comment: Comment) {
    const row = el("div", "row");
    row.append(
      avatar(comment.author),
      el("span", "author", comment.author.name),
      el("small", "", age(comment.createdAt)),
    );
    row.title = comment.author.verified ? "Verified" : "Guest";
    return row;
  }
  function messageActions(
    comment: Comment,
    thread: Thread,
  ): Parameters<typeof actionMenu>[1] {
    if (
      api.user?.id !== comment.author.id ||
      comment.body === "[Comment deleted]"
    )
      return [];
    return [
      {
        label: "Edit",
        icon: "edit",
        onSelect: () => {
          editing = comment.id;
          editText = comment.body;
          renderDialog();
        },
      },
      {
        label: "Delete",
        icon: "trash",
        destructive: true,
        onSelect: () => {
          const noticeAnchor = captureNoticePosition(thread.anchor);
          notify("Delete this comment?", {
            label: "Delete",
            run: () => {
              const wasSelected = selected;
              if (thread.comments.length === 1) selected = null;
              run(() =>
                saveOptimistic(
                  changeThread(thread.id, (current) => {
                    const comments = current.comments.filter(
                      (item) => item.id !== optimistic.id(comment.id),
                    );
                    return comments.length ? { ...current, comments } : null;
                  }),
                  async (id) => {
                    await api.request(
                      `threads/${id(thread.id)}/comments/${id(comment.id)}`,
                      "DELETE",
                    );
                  },
                  () => {
                    if (!selected) selected = wasSelected;
                  },
                ),
              );
              notify("Comment deleted", undefined, noticeAnchor);
            },
          });
        },
      },
    ];
  }
  function renderMessage(comment: Comment, thread: Thread) {
    const item = el("article", "message");
    item.dataset.comment = comment.id;
    item.append(authorRow(comment));
    if (editing === comment.id) {
      const content = el("div", "message-content message-edit");
      const input = el("textarea", "message-editor");
      input.value = editText;
      input.rows = 1;
      input.maxLength = 4000;
      input.setAttribute("aria-label", "Edit comment");
      input.dataset.focusKey = "edit";
      // Grow with the text from one line, like the read-only body it replaces.
      const fit = () => {
        input.style.height = "auto";
        input.style.height = `${input.scrollHeight + input.offsetHeight - input.clientHeight}px`;
      };
      input.addEventListener("input", () => {
        editText = input.value;
        fit();
      });
      requestAnimationFrame(() => input.isConnected && fit());
      const cancel = () => {
        editing = null;
        renderDialog();
      };
      const save = button(
        "Save changes",
        () => {
          const body = editText;
          editing = null;
          run(() =>
            saveOptimistic(
              changeThread(thread.id, (current) => ({
                ...current,
                comments: current.comments.map((item) =>
                  item.id === optimistic.id(comment.id)
                    ? { ...item, body, editedAt: Date.now() }
                    : item,
                ),
              })),
              async (id) => {
                await api.request(
                  `threads/${id(thread.id)}/comments/${id(comment.id)}`,
                  "PATCH",
                  { body },
                );
              },
              () => {
                if (!editing) {
                  editing = optimistic.id(comment.id);
                  editText = body;
                }
              },
            ),
          );
        },
        "primary",
      );
      save.disabled = pending;
      const mac = isMac();
      const withKeys = (node: HTMLButtonElement, label: string, key: string, modifier = false) => {
        node.replaceChildren(label, renderKbd({ key, ctrl: modifier && !mac, meta: modifier && mac } as Shortcut, mac));
        node.removeAttribute("title");
        return node;
      };
      input.addEventListener("keydown", (event) => {
        if (event.isComposing) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          cancel();
        } else if (event.key === "Enter" && (mac ? event.metaKey : event.ctrlKey) && !save.disabled) {
          event.preventDefault();
          save.click();
        }
      });
      const actions = el("div", "edit-actions");
      actions.append(
        withKeys(button("Cancel", cancel, "secondary"), "Cancel", "Escape"),
        withKeys(save, "Save", "Enter", true),
      );
      content.append(input, actions);
      item.append(content);
      return item;
    }
    const content = el("div", "message-content");
    const design = designProposal.test(comment.body);
    const message = el(design ? "div" : "p", "message-text");
    appendMessageLinks(message, comment.body);
    if (design) {
      const show = ({ renderDesignComment }: typeof import("./design-comment.js")) =>
        renderDesignComment(message, comment.body, {
          key: comment.id,
          resolve: (selector) => onThreadPage(thread) ? designTarget(thread.anchor)(selector) : null,
          note: appendMessageLinks,
          sourceHref: sourceLink,
          design: options.design,
          tip: tipFor,
          // The element can grow under the dialog; place it again once the change settles.
          onSwitch: () => positionDialog(),
          // After never mixes with this reviewer's own Design mode previews.
          blocked: () => !onThreadPage(thread) ? "Proposed on another page"
            : designActive && shadow.querySelector<HTMLElement>(".design-inspector__compare")?.hidden === false ? "Send or reset your Design mode edits first" : undefined,
        });
      if (designModule) show(designModule);
      else void loadDesignComments().then(show);
    }
    content.append(message);
    if (comment.body !== "[Comment deleted]") {
      const reaction = button(
        "Add reaction",
        () => {
          closePicker?.(true);
          closePicker = reactionPicker(
            shadow,
            reaction,
            (emoji) =>
              reactTo(
                comment,
                thread,
                emoji,
                !(api.user && comment.reactions[emoji]?.includes(api.user.id)),
              ),
            Object.entries(comment.reactions).find(
              ([, users]) => api.user && users.includes(api.user.id),
            )?.[0],
            `branch-comments:emoji:${options.project}:${api.user?.id ?? "guest"}`,
            options.emojiDataSource,
          );
        },
        "icon message-reaction",
        "smile",
      );
      const entries = Object.entries(comment.reactions).filter(
        ([, users]) => users.length > 0,
      );
      reaction.dataset.reactions = JSON.stringify(entries);
      if (entries.length) {
        reaction.replaceChildren();
        reaction.classList.add("has-reactions");
        for (const [emoji, users] of entries)
          reaction.append(
            el(
              "span",
              "reaction-value",
              `${emoji}${users.length > 1 ? ` ${users.length}` : ""}`,
            ),
          );
        reaction.setAttribute("aria-label", "Change reactions");
      }
      reaction.setAttribute("aria-haspopup", "menu");
      reaction.setAttribute("aria-expanded", "false");
      content.append(reaction);
    }
    item.append(content);
    const actions = el("div", "actions");
    if (
      api.user?.id === comment.author.id &&
      comment.body !== "[Comment deleted]"
    ) {
      const menu = actionMenu(
        "Message actions",
        messageActions(comment, thread),
      );
      if (thread.comments[0]?.id !== comment.id)
        item.firstElementChild?.append(menu);
    }
    if (comment.editedAt) actions.append(el("small", "", "Edited"));
    if (actions.childElementCount) item.append(actions);
    return item;
  }
  function reactTo(
    comment: Comment,
    thread: Thread,
    emoji: string,
    active: boolean,
  ) {
    if (!api.user && (!guests || !guestName.trim())) {
      openAccount();
      return;
    }
    run(async () => {
      if (!api.user) await api.guest(guestName);
      const user = api.user!;
      await saveOptimistic(
        changeThread(thread.id, (current) => ({
          ...current,
          comments: current.comments.map((item) => {
            if (item.id !== optimistic.id(comment.id)) return item;
            const reactions = Object.fromEntries(
              Object.entries(item.reactions).map(([key, users]) => [
                key,
                users.filter((id) => id !== user.id),
              ]),
            );
            if (active)
              reactions[emoji] = [...(reactions[emoji] ?? []), user.id];
            return { ...item, reactions };
          }),
        })),
        async (id) => {
          await api.request(
            `threads/${id(thread.id)}/comments/${id(comment.id)}/reactions`,
            "POST",
            { emoji, active },
          );
        },
      );
      if (active)
        recordEmoji(
          `branch-comments:emoji:${options.project}:${user.id}`,
          emoji,
        );
    });
  }

  async function githubLogin(provider: "github" | "google" = "github") {
    const popup = window.open(
      "about:blank",
      "branch-comments-signin",
      "popup,width=600,height=720",
    );
    if (!popup) throw new Error("Allow popups to sign in.");
    try {
      const start = await api.request<{ url: string }>(
        `auth/${provider}/start`,
        "POST",
        {},
      );
      const authOrigin = new URL(start.url).origin;
      const listen = (event: MessageEvent) => {
        if (
          event.origin !== authOrigin ||
          event.source !== popup ||
          event.data?.type !== "branch-comments:auth"
        )
          return;
        const { token, user } = event.data;
        if (
          typeof token !== "string" ||
          !user?.id ||
          !user?.name ||
          user.verified !== true
        )
          return;
        api.save({ token, user });
        hydrateThreads();
        profileDraft = null;
        window.removeEventListener("message", listen);
        clearTimeout(githubTimer);
        popup.close();
        account = !!options.onboarding;
        render();
        if (options.onboarding) return;
        if (submitAfterIdentity) run(resumeSubmission);
        else {
          run(refresh);
          notify(`Signed in as ${user.name}`);
        }
      };
      window.addEventListener("message", listen, { signal: abort.signal });
      githubTimer = window.setTimeout(() => {
        window.removeEventListener("message", listen);
      }, 600000);
      popup.location.href = start.url;
    } catch (reason) {
      popup.close();
      throw reason;
    }
  }
  let tagModule: typeof import("./tag-editor.js") | undefined;
  /** Tag chips load on demand, so the editor stays out of the initial bundle. */
  function tagSlot(
    tags: readonly string[],
    onAdd: (tag: string) => void,
    onRemove: (tag: string) => void,
    trigger?: HTMLButtonElement,
  ) {
    const slot = el("div", "tag-slot");
    slot.hidden = !!trigger && !tags.length;
    const show = ({ tagEditor }: typeof import("./tag-editor.js")) =>
      tagEditor(slot, {
        tags,
        suggestions: [...new Set(threads.flatMap((item) => item.tags ?? []))].sort(),
        onAdd,
        onRemove,
        trigger,
      });
    // Render synchronously once loaded, so redraws keep the dialog's height.
    if (tagModule) show(tagModule);
    else {
      let open = false;
      if (trigger) trigger.onclick = () => { open = true; };
      void import("./tag-editor.js").then((module) => {
        tagModule = module;
        show(module);
        if (open && trigger?.isConnected) trigger.click();
        positionDialog();
      });
    }
    return slot;
  }
  /** Save a tag change without re-rendering the open dialog, so typing continues. */
  function saveTag(thread: Thread, change: { tag: string } | { untag: string }) {
    if (!api.user) {
      // Tag changes need a reviewer identity, like posting; the chips reset when the dialog redraws.
      openAccount();
      return;
    }
    run(async () => {
      const { tags } = await api.request<{ tags: string[] }>(
        `threads/${optimistic.id(thread.id)}`,
        "PATCH",
        change,
      );
      threads = threads.map((item) =>
        item.id === thread.id ? { ...item, tags } : item,
      );
      renderList();
    });
  }
  function composer(thread: Thread | null) {
    const form = el(
      "form",
      `composer ${thread ? "reply-composer" : "new-comment-composer"}`,
    );
    const input = el("textarea");
    const proposal = thread ? "" : draftProposal;
    input.placeholder = thread ? "Reply…" : proposal ? "Add a note…" : "Add a comment…";
    input.rows = 1;
    input.maxLength = 4000;
    // With a Design mode proposal attached, the note is optional.
    input.required = !!thread || !draftProposal;
    input.value = thread ? (replies.get(thread.id) ?? "") : draftText;
    input.setAttribute("aria-label", thread ? "Reply" : "Comment");
    input.dataset.focusKey = "body";
    if (thread) {
      const selection = replySelections.get(thread.id);
      if (selection) input.setSelectionRange(...selection);
      const rememberSelection = () => replySelections.set(thread.id,
        [input.selectionStart, input.selectionEnd, input.selectionDirection]);
      input.addEventListener("select", rememberSelection);
      input.addEventListener("keyup", rememberSelection);
      input.addEventListener("pointerup", rememberSelection);
    }
    const resizeInput = () => {
      input.style.height = "auto";
      input.style.height = `${Math.min(128, Math.max(thread ? 34 : 28, input.scrollHeight))}px`;
      input.style.overflowY = input.scrollHeight > 128 ? "auto" : "hidden";
      positionDialog();
    };
    input.addEventListener("input", resizeInput);
    input.addEventListener("input", () => {
      if (thread) replies.set(thread.id, input.value);
      else draftText = input.value;
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        form.requestSubmit();
      }
    });
    const send = button(
      thread ? "Send reply" : "Post comment",
      () => {},
      "send",
      "arrow",
    );
    send.type = "submit";
    send.disabled = pending;

    if (thread) {
      // The writer's avatar fills the avatar column, so the reply text starts
      // where message bodies do.
      if (api.user) form.append(avatar(api.user));
      form.append(input, send);
    }
    else {
      const body = el("div", "draft-body");
      if (api.user) body.append(avatar(api.user));
      body.append(input, send);
      if (tagsEnabled)
        body.append(
          tagSlot(
            draftTags,
            (tag) => (draftTags = [...draftTags, tag]),
            (tag) => (draftTags = draftTags.filter((item) => item !== tag)),
          ),
        );
      form.append(body);
    }
    // A proposal can be posted on its own; the note is optional.
    input.addEventListener("input", () => {
      send.disabled = pending || (!input.value.trim() && !proposal);
    });
    send.disabled ||= !input.value.trim() && !proposal;
    input.addEventListener("komo-sync-reply", () => {
      if (!thread || !input.isConnected || (shadow.activeElement === input && replies.has(thread.id))) return;
      input.value = replies.get(thread.id) ?? "";
      const selection = replySelections.get(thread.id);
      if (selection) input.setSelectionRange(...selection);
      send.disabled = pending || !input.value.trim();
      if (!input.closest<HTMLElement>(".sidebar-replies")?.hidden) resizeInput();
    });
    if (proposal) {
      const card = el("div", "draft-proposal");
      card.textContent = proposal;
      const target = draft ? designTarget(draft) : () => null;
      void loadDesignComments().then(({ renderDraftProposal }) => {
        if (!card.isConnected || draftProposal !== proposal) return;
        const anchor = draft;
        return Promise.resolve(renderDraftProposal(card, proposal, target, {
          design: options.design,
          sourceHref: sourceLink,
          tip: tipFor,
          onUpdate(body) { if (draft === anchor && draftProposal) draftProposal = body; },
        })).then(positionDialog);
      });
      form.prepend(card);
    }
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if ((!input.value.trim() && !proposal) || pending) return;
      if (!api.user) {
        submitAfterIdentity = () => postMessage(thread);
        openAccount();
        return;
      }
      run(() => postMessage(thread));
    });
    requestAnimationFrame(() => {
      if (input.isConnected) resizeInput();
    });
    return form;
  }
  async function postMessage(thread: Thread | null) {
    if (options.onboarding)
      throw new Error("Open your connected website to leave a comment.");
    if (!api.user) throw new Error("Enter your name to leave a comment.");
    const now = Date.now();
    const comment: Comment = {
      id: `pending-${crypto.randomUUID()}`,
      body: thread
        ? (replies.get(thread.id) ?? "")
        : [draftText.trim(), draftProposal].filter(Boolean).join("\n\n"),
      author: { ...api.user },
      createdAt: now,
      editedAt: null,
      reactions: {},
    };
    if (!comment.body.trim()) return;
    if (thread) {
      replies.delete(thread.id);
      await saveOptimistic(
        changeThread(thread.id, (current) => ({
          ...current,
          updatedAt: now,
          comments: [...current.comments, comment],
        })),
        async (id) => {
          const result = await api.request<{ id: string }>(
            `threads/${id(thread.id)}/comments`,
            "POST",
            { body: comment.body },
          );
          const saved =
            result.id ??
            (await api.list())
              .find((item) => item.id === id(thread.id))
              ?.comments.filter(
                (item) =>
                  item.author.id === comment.author.id &&
                  item.body === comment.body,
              )
              .at(-1)?.id;
          return saved ? { [comment.id]: saved } : {};
        },
        () => {
          const id = optimistic.id(thread.id);
          if (threads.some((item) => item.id === id))
            replies.set(
              id,
              [comment.body, replies.get(id)].filter(Boolean).join("\n"),
            );
          else if (draft === thread.anchor)
            draftText = [draftText, comment.body].filter(Boolean).join("\n");
          else
            recoveredDrafts.push({ anchor: thread.anchor, text: comment.body });
        },
      );
    } else if (draft) {
      const anchor = draft;
      const tags = draftTags;
      const note = draftText;
      const proposal = draftProposal;
      // Persistent layout, e.g. an app sidebar, carries its comments to every page.
      const target = resolveAnchor(anchor);
      const scope = target && inPersistentRegion(target, options) ? "all" as const : undefined;
      const item: Thread = {
        id: `pending-${crypto.randomUUID()}`,
        page: page(),
        anchor,
        tags,
        ...(scope && { scope }),
        resolved: false,
        resolvedBy: null,
        createdAt: now,
        updatedAt: now,
        comments: [comment],
      };
      selected = item.id;
      draft = null;
      draftText = draftProposal = "";
      draftTags = [];
      await saveOptimistic(
        (items) => [...items, item],
        async () => {
          const result = await api.request<{ id: string; commentId?: string }>(
            "threads",
            "POST",
            { page: item.page, anchor, body: comment.body, ...(tags.length ? { tags } : {}), ...(scope && { scope }) },
          );
          // The initial message ID is returned so queued edits target the persisted comment.
          const saved =
            result.commentId ??
            (await api.list()).find((item) => item.id === result.id)
              ?.comments[0]?.id;
          return {
            [item.id]: result.id,
            ...(saved ? { [comment.id]: saved } : {}),
          };
        },
        () => {
          if (!draft) {
            selected = null;
            draft = anchor;
            draftText = note;
            draftProposal = proposal;
            draftTags = tags;
          } else recoveredDrafts.push({ anchor, text: comment.body });
        },
      );
      // Auth and composing pause capture, but do not end an explicitly chosen mode.
      // A later Browse/Escape or another selection wins over this pending post.
      if (
        commentMode &&
        !draft &&
        !account &&
        selected === optimistic.id(item.id)
      ) {
        // In Frame the new thread stays open in the sidebar, ready for the next click.
        if (!inFrame()) {
          selected = null;
          if (expanded) toggleExpanded(false);
        }
        mode = true;
        render();
      }
    }
  }

  async function resumeSubmission() {
    const submit = submitAfterIdentity;
    submitAfterIdentity = null;
    if (submit) await submit();
  }
  const reactionSwaps = new Map<
    string | undefined,
    { from: HTMLElement; to: string | undefined; started: number }
  >();
  function renderDialog() {
    if (tokenApi && (tokenApi !== api || !tokensAllowed())) closeTokens();
    // Undo Before/After previews from comments that are no longer on screen.
    void designComments?.then(({ resetDesignPreviews }) =>
      resetDesignPreviews(
        new Set([
          ...(account
            ? []
            : (threads.find((item) => item.id === selected && onThreadPage(item))?.comments.map((item) => item.id) ?? [])),
          ...(pinPreview.hidden ? [] : [hoverPreviewKey]),
          ...(draft ? ["draft"] : []),
        ]),
      ),
    );
    let disposePreviousAccentPicker = disposeAccentPicker;
    disposeAccentPicker = undefined;
    closePicker?.(true);
    closePicker = undefined;
    const active = shadow.activeElement as
      | HTMLInputElement
      | HTMLTextAreaElement
      | null;
    const focusKey = active?.dataset.focusKey;
    const caret = focusKey ? active?.selectionStart : null;
    const visibleFocus = !!active?.matches(":focus-visible");
    const scroll = dialogs.querySelector(".messages")?.scrollTop ?? 0;
    const accountScroll =
      dialogs.querySelector(".account-dialog")?.scrollTop ?? 0;
    const nextKey = account ? "account" : draft ? "draft" : selected;
    if (nextKey !== dialogKey) attachedKey = null;
    const previousDialog = dialogs.firstElementChild as HTMLElement | null;
    const panel = threadPanel();
    const wasDocked = dialogs.classList.contains("thread-pane");
    const changing = dialogKey !== nextKey;
    const previousRect = previousDialog?.getBoundingClientRect();
    const previousReactions = new Map(
      [
        ...(previousDialog?.querySelectorAll<HTMLElement>("[data-comment]") ??
          []),
      ].map((item) => [
        item.dataset.comment,
        item.querySelector<HTMLElement>(".message-reaction"),
      ]),
    );
    if (
      previousDialog &&
      changing &&
      !reducedMotion() &&
      !(wasDocked && (panel || !dialogs.isConnected))
    ) {
      // The outgoing card fades in place; the account sheet takes its backdrop
      // along, and a thread in the sidebar slides back off its list.
      const current = getComputedStyle(previousDialog);
      const from = { opacity: current.opacity, transform: current.transform };
      previousDialog.getAnimations().forEach((animation) => animation.cancel());
      const timing = {
        duration: 150,
        easing: "cubic-bezier(.22,1,.36,1)",
        fill: "forwards",
      } as const;
      const leaving =
        dialogKey === "account"
          ? el("div", "account-layer")
          : wasDocked
            ? el("div", "thread-pane")
            : previousDialog;
      if (leaving !== previousDialog) leaving.append(previousDialog);
      previousDialog.animate(
        [
          { transform: from.transform },
          { transform: wasDocked ? "translateX(24px)" : "translateY(4px) scale(.99)" },
        ],
        timing,
      );
      const exit = leaving.animate([{ opacity: from.opacity }, { opacity: 0 }], timing);
      leaving.inert = true;
      leaving.setAttribute("aria-hidden", "true");
      previousDialog.style.pointerEvents = "none";
      (wasDocked
        ? dialogs.parentElement!
        : leaving !== previousDialog && edgeSidebar
          ? sidebar
          : shadow
      ).append(leaving);
      exitingDialogs.set(leaving, disposePreviousAccentPicker);
      disposePreviousAccentPicker = undefined;
      void exit.finished
        .catch(() => {})
        .finally(() => {
          leaving.remove();
          exitingDialogs.get(leaving)?.();
          exitingDialogs.delete(leaving);
        });
    }
    disposePreviousAccentPicker?.();
    dialogs.replaceChildren();
    placeDialogs(panel);
    // The list steps aside for a thread and returns from it.
    const list = sidebar.querySelector<HTMLElement>(".panel");
    if (list && wasDocked !== !!panel) {
      if (!reducedMotion())
        for (const node of list.querySelectorAll<HTMLElement>(":scope > :not(.thread-pane)")) {
          const frames = [
            { visibility: "visible", opacity: 1, transform: "none" },
            { visibility: "visible", opacity: 0, transform: "translateX(-24px)" },
          ];
          node.animate(panel ? frames : frames.reverse(), {
            duration: 250,
            easing: "cubic-bezier(.22,1,.36,1)",
          });
        }
      // Keep keyboard focus in the sidebar across the swap, unless a new
      // comment's composer is taking it.
      const card = `[data-thread="${CSS.escape(dialogKey ?? "")}"] .thread-card`;
      if (panel ? focusBack : !draft && visibleFocus && (list.contains(active!) || !active!.isConnected))
        queueMicrotask(() =>
          (panel ? dialogs : list).querySelector<HTMLElement>(panel ? ".thread-back" : card)?.focus({ preventScroll: true }),
        );
      focusBack = false;
    }
    dialogKey = nextKey;
    dialogs.classList.toggle("account-layer", account);
    if (!draft && !selected && !account) {
      positionNotice();
      return;
    }
    const dialog = el("section", account ? "dialog account-dialog" : "dialog");
    if (account) dialog.setAttribute("aria-modal", "false");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute(
      "aria-label",
      account ? "Reviewer account" : draft ? "New comment" : "Comment thread",
    );
    const head = el("div", "dialog-head row between");

    const controls = el("div", "row");
    const thread = threads.find((t) => t.id === selected) ?? null;
    let tagAction: HTMLButtonElement | undefined;
    if (thread && !account) {
      const copy = (label: string, value: () => string) => ({
        label,
        icon: (label === "Copy link"
          ? "link"
          : label === "Copy selector"
            ? "code"
            : "comment") as keyof typeof icons,
        onSelect: () =>
          run(async () => {
            await navigator.clipboard.writeText(value());
            notify("Copied");
          }),
      });
      const source = thread.anchor.source;
      const sourceHref = source ? sourceLink(source) : "";
      const more = actionMenu("Comment actions", [
        ...messageActions(thread.comments[0], thread),
        ...(canMovePin(thread) ? [{
          label: "Move pin",
          icon: "pointer" as const,
          onSelect: () => { void beginPinMove(thread); },
        }] : []),
        ...(canScope(thread) ? [{
          label: everyPage(thread) ? `Only on ${thread.page === page() ? "this" : "its own"} page` : "Show on all pages",
          icon: "expand" as const,
          onSelect: () => setScope(thread),
        }] : []),
        ...(designEnabled ? [{
          label: "Open in Design",
          icon: "design" as const,
          onSelect: () => { void openThreadInDesign(thread); },
        }] : []),
        ...(sourceHref && /^(https?:|vscode:|cursor:)/.test(sourceHref)
          ? [
              {
                label: "Open source",
                icon: "code" as const,
                onSelect: () =>
                  window.open(sourceHref, "_blank", "noopener,noreferrer"),
              },
            ]
          : []),
        copy("Copy link", () => {
          const url = new URL(thread.page, location.origin);
          url.searchParams.set("comment", thread.id);
          return url.href;
        }),
        copy("Copy feedback", () =>
          [
            `Repository: ${options.repo}`,
            `Branch: ${options.branch}`,
            `Page: ${new URL(thread.page, location.origin).href}`,
            `Target: ${thread.anchor.selector || "Page position"}`,
            ...(thread.anchor.source
              ? [`Source: ${thread.anchor.source}`]
              : []),
            ...(thread.anchor.text
              ? [`Element text: ${thread.anchor.text}`]
              : []),
            "",
            ...thread.comments.map(
              (comment) => `${comment.author.name}: ${comment.body}`,
            ),
          ].join("\n"),
        ),
        copy("Copy selector", () => thread.anchor.selector),
      ]);
      controls.append(more);
      if (tagsEnabled) {
        tagAction = button(
          thread.tags?.length ? "Manage tags" : "Add tag",
          () => {},
          "icon thread-tag-action",
          "tag",
        );
        controls.append(tagAction);
      }
      const resolve = button(
        thread.resolved ? "Reopen comment" : "Resolve comment",
        () => toggleResolved(thread, captureNoticePosition(thread.anchor)),
        "icon",
        "check",
      );
      resolve.disabled = !canResolve();
      controls.append(resolve);
    }
    controls.append(
      panel
        ? button(
            "Close sidebar",
            () => {
              dismiss();
              toggleExpanded(false);
            },
            "icon",
            "close",
          )
        : button(account ? "Close account" : "Close comment", dismiss, "icon", "close"),
    );
    if (panel) {
      head.append(
        button("Back to comments", dismiss, "icon thread-back", "chevron"),
        summary(el("strong", "thread-title"), thread?.comments[0]?.body ?? ""),
      );
    }
    head.append(controls);
    if (thread || account || panel) dialog.append(head);
    else
      dialog.append(
        button("Close comment", dismiss, "draft-close icon", "close"),
      );

    if (tokenApi) dialog.append(tokensPanel());
    else if (account) {
      const content = el("form", "account");
      if (api.user) {
        profileDraft ??= {
          name: api.user.name,
          avatarUrl: api.user.avatarUrl ?? "",
          accentColor: api.user.accentColor ?? DEFAULT_ACCENT,
        };
        const profile = profileDraft;
        const portrait = avatar({ ...api.user, ...profile });
        const summary = el("div", "account-summary");
        const status = el("span", "account-status");
        if (api.user.verified) {
          status.append(document.createTextNode("Connected with "));
          if (api.user.id.startsWith("google:")) status.append(googleLogo());
          status.append(
            document.createTextNode(
              api.user.id.startsWith("google:") ? "Google" : "GitHub",
            ),
          );
        } else status.textContent = "Guest account";
        const photoButton = button(
          "Update profile photo",
          () => upload.click(),
          "account-avatar-button",
        );
        photoButton.replaceChildren(portrait);
        summary.append(photoButton, el("h2", "", "Your profile"), status);
        content.append(summary);
        const nameField = el("label", "account-name-label", "Display name");
        const nameInput = el("input");
        nameInput.value = profile.name;
        nameInput.name = "name";
        nameInput.autocomplete = "name";
        nameInput.required = true;
        nameInput.maxLength = 60;
        nameInput.dataset.focusKey = "profile-name";
        nameInput.addEventListener("input", () => {
          profile.name = nameInput.value;
          queueProfileSave(profile);
        });
        nameInput.addEventListener("blur", () => {
          queueProfileSave(profile, true);
        });
        nameField.append(nameInput);
        const upload = el("input");
        upload.type = "file";
        upload.accept = "image/png,image/jpeg,image/webp";
        upload.hidden = true;
        upload.setAttribute("aria-label", "Choose profile photo");
        upload.addEventListener("change", () =>
          run(async () => {
            const file = upload.files?.[0];
            if (!file) return;
            if (file.size > 10 * 1024 * 1024)
              throw new Error("Choose a photo under 10 MB.");
            const bitmap = await createImageBitmap(file);
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = 128;
            const ctx = canvas.getContext("2d")!;
            const size = Math.min(bitmap.width, bitmap.height);
            ctx.drawImage(
              bitmap,
              (bitmap.width - size) / 2,
              (bitmap.height - size) / 2,
              size,
              size,
              0,
              0,
              128,
              128,
            );
            bitmap.close();
            let quality = 0.8;
            do {
              profile.avatarUrl = canvas.toDataURL("image/jpeg", quality);
              quality -= 0.15;
            } while (profile.avatarUrl.length > 12000 && quality > 0.1);
            if (profile.avatarUrl.length > 12000)
              throw new Error("Choose a smaller photo.");
            queueProfileSave(profile, true);
            renderDialog();
          }),
        );
        summary.append(upload);
        const colors = accentPicker(profile.accentColor, (color) => {
          profile.accentColor = color;
          applyAccent(portrait, color);
          queueProfileSave(profile);
        });
        disposeAccentPicker = colors.destroy;
        content.append(nameField, colors.element);
        if (options.onboarding) {
          const onboarding = options.onboarding;
          content.append(
            later(
              el("section", "onboarding-panel"),
              import("./onboarding.js").then(({ onboardingPanel }) =>
                onboardingPanel(api, onboarding),
              ),
            ),
          );
        } else {
          content.append(sidebarSetting());
          if (localSite) content.append(channelSetting());
          content.append(usagePanel());
        }
        if (
          api.user?.verified &&
          !options.onboarding?.code &&
          !options.onboarding?.claimKey &&
          !options.onboarding?.invite
        ) {
          const settings = el("div");
          content.append(settings);
          void import("./onboarding.js").then(({ projectManagement }) => {
            if (settings.isConnected)
              settings.replaceWith(
                projectManagement(
                  api,
                  options.onboarding?.workspace,
                  (deleted) => {
                    if (deleted) {
                      selected = null;
                      optimistic.replace([], optimistic.revision);
                      content.querySelector(".account-usage")?.remove();
                    } else {
                      const path = options.onboarding?.workspace
                        ? `usage?workspace=${encodeURIComponent(options.onboarding.workspace)}`
                        : "usage";
                      content
                        .querySelector(".account-usage")
                        ?.replaceWith(usagePanel(path));
                      void refresh().catch(() => {});
                    }
                  },
                ),
              );
          });
        }
        content.addEventListener("submit", (event) => {
          event.preventDefault();
          queueProfileSave(profile, true);
        });
        const sessionActions = el("div", "account-session");
        sessionActions.append(
          button(
            "Sign out",
            () =>
              run(async () => {
                if (optimistic.busy || pending) {
                  notify("Wait for your changes to save.");
                  return;
                }
                clearTimeout(profileSaveTimer);
                queuedProfile = null;
                const signingOut = api.logout();
                hydrateThreads();
                profileDraft = null;
                confirmedProfile = null;
                render();
                try {
                  await signingOut;
                } finally {
                  hydrateThreads();
                  run(refresh);
                  render();
                }
              }),
            "secondary",
          ),
        );
        if (tokensAllowed()) {
          const entry = button("API tokens", openTokens, "account-sites-summary account-tokens-entry");
          entry.removeAttribute("title");
          entry.replaceChildren(el("span", "", "API tokens"), icon("chevron"));
          entry.dataset.focusKey = "account-tokens";
          const box = el("div", "account-sites");
          box.append(entry);
          content.append(box);
        }
        content.append(sessionActions);
        if (!api.user.verified && google) content.append(googleSignIn());
        if (!api.user.verified && github)
          content.append(
            button(
              "Sign in with GitHub",
              () => run(() => githubLogin()),
              "primary",
            ),
          );
      } else {
        content.append(
          el("h2", "", options.onboarding ? "Set up inline feedback" : "Leave comments"),
        );
        if (options.onboarding?.inProject) {
          content.append(
            el(
              "p",
              "",
              "Add the sites where you want to leave feedback. One site per line.",
            ),
          );
          const sitesLabel = el(
            "label",
            "account-name-label",
            "Production and preview sites",
          );
          const sitesInput = el("textarea");
          sitesInput.rows = 2;
          sitesInput.placeholder = "https://your-site.com";
          sitesInput.value = setupSiteDraft;
          sitesInput.dataset.focusKey = "setup-sites";
          sitesInput.addEventListener("input", () => {
            setupSiteDraft = sitesInput.value;
          });
          sitesLabel.append(sitesInput);
          content.append(sitesLabel);
          const connect = button(
            "Connect",
            () =>
              run(async () => {
                if (connectingProject) return;
                connectingProject = true;
                connect.disabled = true;
                try {
                  const result = await connectProject(
                    options,
                    abort.signal,
                    setupSites(setupSiteDraft, location.origin),
                  );
                  if (destroyed) return;
                  rememberProject(options, result);
                  options = {
                    ...options,
                    project: result.project,
                    repo: result.repo,
                    onboarding: undefined,
                  };
                  api = new CommentsApi(options);
                  api.save(result);
                  account = false;
                  profileDraft = null;
                  dialogKey = null;
                  await loadProject();
                  render();
                  notify(
                    "Inline feedback is connected. Select an element to comment.",
                  );
                } finally {
                  connectingProject = false;
                  if (!destroyed) render();
                }
              }),
            "primary",
          );
          connect.disabled = connectingProject;
          content.append(connect);
        }
        if (guests) {
          const label = el("label", "account-name-label", "Your name");
          const name = el("input");
          name.name = "name";
          name.autocomplete = "name";
          name.placeholder = "Your name";
          name.required = true;
          name.maxLength = 60;
          name.value = guestName;
          name.dataset.focusKey = "account-name";
          name.addEventListener("input", () => (guestName = name.value));
          label.append(name);
          content.append(label);
          const save = button("Continue", () => {}, "primary");
          save.type = "submit";
          save.disabled = pending;
          if (pending) save.setAttribute("aria-busy", "true");
          content.append(save);
        }
        if (guests && (google || github))
          content.append(el("div", "account-divider", "or"));
        if (google) content.append(googleSignIn());
        if (github)
          content.append(
            button(
              "Continue with GitHub",
              () => run(() => githubLogin()),
              "secondary",
            ),
          );
        content.addEventListener("submit", (event) => {
          event.preventDefault();
          run(async () => {
            await mutate(async () => {
              await api.guest(guestName);
              account = false;
            });
            await resumeSubmission();
          });
        });
      }
      dialog.append(content);
    } else if (draft) dialog.append(composer(null));
    else if (thread) {
      if (!onThreadPage(thread)) {
        const status = el("div", "notice thread-navigation");
        status.setAttribute("role", "status");
        status.append(el("p", "", threadRequest?.id === thread.id && threadRequest.rejected
          ? "Navigation could not be completed. The conversation is still available."
          : threadRequest?.pending
            ? "Opening this comment’s page…"
            : "The app is on a different page. The conversation is still available."));
        const destination = el("a", "thread-destination", "Open destination");
        destination.dataset.focusKey = "thread-destination";
        destination.href = new URL(thread.page, location.origin).href;
        destination.title = destination.href;
        destination.setAttribute("aria-label", `Open destination: ${destination.href}`);
        destination.setAttribute("aria-disabled", String(!!threadRequest?.pending));
        destination.addEventListener("click", (event) => {
          event.preventDefault();
          if (!threadRequest?.pending) selectThread(thread);
        });
        status.append(destination);
        dialog.append(status);
      } else if (!resolveAnchor(thread.anchor)) {
        const status = el("p", "notice thread-navigation thread-anchor-status", "This comment’s element could not be found on this page. The conversation is still available.");
        status.setAttribute("role", "status");
        dialog.append(status);
      }
      const messages = el("div", "messages");
      for (const comment of thread.comments)
        messages.append(renderMessage(comment, thread));
      dialog.append(messages);
      const fade = () =>
        (messages.dataset.fade = `${messages.scrollTop > 2 ? "top" : ""} ${messages.scrollTop + messages.clientHeight < messages.scrollHeight - 2 ? "bottom" : ""}`);
      messages.addEventListener("scroll", fade, { passive: true });
      requestAnimationFrame(fade);
      if (tagsEnabled) {
        const slot = tagSlot(
          thread.tags ?? [],
          (tag) => saveTag(thread, { tag }),
          (tag) => saveTag(thread, { untag: tag }),
          tagAction,
        );
        slot.classList.add("thread-tags");
        const first = messages.querySelector(".message");
        const body = first?.querySelector(".message-text, .edit-actions");
        if (body) body.after(slot);
        else first?.append(slot);
      }
      dialog.append(composer(thread));
    } else
      dialog.append(el("div", "empty", "This comment is no longer available."));
    dialogs.append(dialog);
    if (
      account &&
      changing &&
      !reducedMotion()
    ) {
      dialogs.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 250,
        easing: "ease-out",
      });
      dialog.animate(
        [
          { opacity: 0, transform: "translateY(8px) scale(.97)" },
          { opacity: 1, transform: "none" },
        ],
        { duration: 250, easing: "cubic-bezier(.22,1,.36,1)" },
      );
    }
    if (!account && !panel) {
      const dragHandle = el("div", "comment-drag-handle");
      dragHandle.setAttribute("aria-hidden", "true");
      dialog.prepend(dragHandle);
      floatingDrag(
        dialog,
        dragHandle,
        (p) => {
          if (dialogKey) cardPlacements.set(dialogKey, p);
          positionDialog();
        },
        abort.signal,
        () => cardFollow.stop(),
      );
    }
    positionDialog();
    if (panel) {
      if (changing) {
        outlineHover = false;
        showOutline(true, 1200);
      }
      const hover = (on: boolean) => {
        outlineHover = on;
        showOutline(on);
      };
      for (const part of [head, dialog.querySelector(".messages")]) {
        // Movement, not a card appearing under a resting pointer, brings it back.
        part?.addEventListener("pointermove", () => outlineHover || hover(true));
        part?.addEventListener("pointerleave", () => hover(false));
        part?.addEventListener("focusin", (event) => {
          if ((event.target as Element).matches(":focus-visible")) hover(true);
        });
        part?.addEventListener("focusout", () => hover(false));
      }
      dialog.addEventListener("click", () => showOutline(false, 600));
      // The outline shows the target here; its selector tooltip would cover the card.
      dialog.addEventListener("pointerover", (event) =>
        (event.target as Element).closest(".design-card-target")?.removeAttribute("title"),
      );
    }
    if (!account && !reducedMotion()) {
      const target = dialog.getBoundingClientRect();
      const origin = openingPreview ?? (!changing ? previousRect : null);
      if (panel) {
        if (changing)
          dialog.animate(
            [
              { opacity: 0, transform: wasDocked ? "none" : "translateX(24px)" },
              { opacity: 1, transform: "none" },
            ],
            { duration: 250, easing: "cubic-bezier(.22,1,.36,1)" },
          );
      } else if (
        origin &&
        (openingPreview ||
          Math.abs(origin.height - target.height) > 1 ||
          Math.abs(origin.width - target.width) > 1)
      ) {
        dialog.animate(
          [
            {
              left: `${origin.left}px`,
              top: `${origin.top}px`,
              width: `${origin.width}px`,
              height: `${origin.height}px`,
              opacity: 1,
            },
            {
              left: `${target.left}px`,
              top: `${target.top}px`,
              width: `${target.width}px`,
              height: `${target.height}px`,
              opacity: 1,
            },
          ],
          { duration: 250, easing: "cubic-bezier(.22,1,.36,1)" },
        );
      } else if (changing) {
        dialog.animate(
          [
            { opacity: 0, transform: "translateY(6px) scale(.97)" },
            { opacity: 1, transform: "none" },
          ],
          { duration: 250, easing: "cubic-bezier(.22,1,.36,1)" },
        );
      }
      for (const item of dialog.querySelectorAll<HTMLElement>(
        "[data-comment]",
      )) {
        const reaction = item.querySelector<HTMLElement>(".message-reaction");
        const previous = previousReactions.get(item.dataset.comment);
        const id = item.dataset.comment;
        if (
          reaction &&
          previous &&
          previous.dataset.reactions !== reaction.dataset.reactions
        )
          reactionSwaps.set(id, {
            from: previous,
            to: reaction.dataset.reactions,
            started: performance.now(),
          });
        const swap = reactionSwaps.get(id);
        const elapsed = swap ? performance.now() - swap.started : 470;
        if (
          reaction &&
          swap &&
          elapsed < 470 &&
          swap.to === reaction.dataset.reactions
        ) {
          const leaving = el("span", "reaction-leaving");
          leaving.setAttribute("aria-hidden", "true");
          for (const child of swap.from.children) {
            if (child.classList.contains("reaction-leaving")) continue;
            const copy = child.cloneNode(true);
            leaving.append(copy);
          }
          const arriving = [...reaction.children];
          reaction.append(leaving);
          const exit = leaving.animate(
            [
              { opacity: 1, transform: "scale(1)" },
              { opacity: 0, transform: "scale(.2, .35)" },
            ],
            { duration: 110, easing: "ease-in", fill: "forwards" },
          );
          exit.currentTime = elapsed;
          exit.finished
            .then(() => leaving.remove())
            .catch(() => leaving.remove());
          for (const emoji of arriving) {
            const enter = emoji.animate(
              [
                { opacity: 0, transform: "scale(.25, .4)", offset: 0 },
                { opacity: 1, transform: "scale(1.16, .92)", offset: 0.38 },
                { opacity: 1, transform: "scale(.95, 1.07)", offset: 0.6 },
                { opacity: 1, transform: "scale(1.025, .985)", offset: 0.8 },
                { opacity: 1, transform: "scale(1)", offset: 1 },
              ],
              {
                duration: 380,
                delay: 90,
                easing: "ease-in-out",
                fill: "backwards",
              },
            );
            enter.currentTime = elapsed;
            void enter.finished
              .then(() => {
                if (reactionSwaps.get(id) === swap) reactionSwaps.delete(id);
              })
              .catch(() => {});
          }
        }
      }
    }
    openingPreview = null;
    const messages = dialog.querySelector(".messages");
    if (messages) messages.scrollTop = scroll;
    if (account && !changing) dialog.scrollTop = accountScroll;
    if (focusKey) {
      const next = dialog.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        `[data-focus-key="${focusKey}"]`,
      );
      if (next) {
        next.focus({ preventScroll: true });
        if (caret !== null && caret !== undefined)
          next.setSelectionRange(caret, caret);
      }
    }
  }
  let dialogSize: ResizeObserver | undefined;
  let outlineUntil = 0;
  // The target outline flashes when a thread opens in the sidebar, and returns
  // while its header or messages are pointed at or focused. Before/After
  // switches hide it so only the change moves.
  let outlineShown = false,
    outlineHover = false,
    outlineTimer = 0;
  // A list card that is pointed at or focused outlines its target too, and
  // raises its pin. hotCard is the one shown.
  let hotCard = "",
    hoverCard = "",
    focusCard = "",
    hotTimer = 0;
  function setHot(id = hoverCard || focusCard) {
    clearTimeout(hotTimer);
    if (id === hotCard) return;
    hotCard = id;
    for (const pin of pins.querySelectorAll<HTMLElement>(".pin"))
      pin.classList.toggle("hot", pin.dataset.thread === id);
    updateHover();
  }
  function showOutline(on: boolean, ms = 0) {
    clearTimeout(outlineTimer);
    outlineShown = on;
    updateHover();
    if (ms) outlineTimer = window.setTimeout(() => showOutline(outlineHover), ms);
  }
  function positionDialog() {
    const availableHeight = Math.min(
      window.innerHeight,
      window.visualViewport?.height ?? window.innerHeight,
    );
    const dialog = dialogs.firstElementChild as HTMLElement | null;
    if (!dialog || account) return;
    const thread = threads.find((t) => t.id === selected);
    const missing = dialog.querySelector<HTMLElement>(".thread-anchor-status");
    if (missing) missing.hidden = !!(thread && onThreadPage(thread) && resolveAnchor(thread.anchor));
    // In the sidebar only the target outline moves; follow a Before/After morph.
    if (dialogs.classList.contains("thread-pane")) {
      const running = outlineUntil;
      outlineUntil = performance.now() + 500;
      const step = () => {
        updateHover();
        if (performance.now() < outlineUntil) requestAnimationFrame(step);
        else outlineUntil = 0;
      };
      if (!running) step();
      return;
    }
    if (compactSidebar && dialog.querySelector("textarea:focus")) {
      const viewport = window.visualViewport;
      const top = viewport?.offsetTop ?? 0;
      dialog.style.maxHeight = `${Math.max(0, availableHeight - 24)}px`;
      const position = mobileComposerPosition(
        window.innerWidth,
        availableHeight,
        top,
        dialog.offsetWidth,
        dialog.offsetHeight,
      );
      cardFollow.place(dialogKey, dialog, position.x, position.y, true);
      dialog.style.bottom = "auto";
      dialog.style.transformOrigin = "bottom center";
      positionNotice();
      return;
    }
    // Stay inside what's visible: the frame when framed, above the toolbar otherwise.
    // Content that loads later (design change cards) re-runs this through the observer.
    const bottom = framed ? Math.min(availableHeight, frameRect().bottom) - 12 : availableHeight - 92;
    dialog.style.maxHeight = `${bottom - 12}px`;
    (dialogSize ??= new ResizeObserver(() => positionDialog())).observe(dialog);
    const anchor = draft ?? (thread && onThreadPage(thread) ? thread.anchor : null);
    // Areas and design changes are about a region: open beside it, not over it.
    let around: { left: number; top: number; right: number; bottom: number } | undefined;
    let pinRect: ReturnType<typeof pinEdges> | undefined;
    const pin =
      draggedPin?.id === selected
        ? draggedPin
        : anchor
          ? (() => {
              const rect = locateAnchor(anchor);
              // A detached comment opens centred rather than at stale coordinates,
              // but one whose anchor leaves (a modal closing) closes with it.
              if (!rect.attached) return attachedKey === dialogKey ? false : null;
              attachedKey = dialogKey;
              around =
                rect.width > 16 && rect.height > 16
                  ? { left: rect.x, top: rect.y, right: rect.x + rect.width, bottom: rect.y + rect.height }
                  : (draft ? draftBeside : designProposal.test(thread?.comments[0]?.body ?? ""))
                    ? rect.component
                    : undefined;
              const indicator =
                selected &&
                pins.querySelector<HTMLElement>(
                  `[data-thread="${CSS.escape(selected)}"]`,
                );
              pinRect = indicator ? pinEdges(indicator) : undefined;
              return indicator ? indicatorPoint(indicator, rect) : rect;
            })()
          : null;
    if (pin === false) {
      // Unsent text survives: replies stay keyed by thread, drafts park.
      if (draft && draftText.trim()) parkedDraft = { anchor: draft, text: draftText };
      return dismiss();
    }
    const follow = draggedPin?.id === selected;
    const updateOrigin = () => {
      dialog.style.transformOrigin =
        !pin || pin.x < dialog.offsetLeft + dialog.offsetWidth / 2
          ? "top left"
          : "top right";
    };
    const placement = !follow && dialogKey && cardPlacements.get(dialogKey);
    if (placement) {
      const p = constrain(
        placement,
        dialog.offsetWidth,
        dialog.offsetHeight,
        html.clientWidth,
        availableHeight,
      );
      cardFollow.place(dialogKey, dialog, p.x, p.y, follow);
      updateOrigin();
      positionNotice();
      return;
    }
    let x = (window.innerWidth - 354) / 2,
      y = availableHeight - 450;
    const right =
      expanded && !compactSidebar
        ? 396
        : 12;
    const w = dialog.offsetWidth,
      h = dialog.offsetHeight;
    // The pin's point is on screen, after any Frame scale; the card itself is never scaled.
    if (pin)
      ({ x, y } = placeCard(pinRect?.width && !follow ? pinRect : pinBox(pin), w, h, {
        left: 12, top: 12, right: window.innerWidth - right, bottom,
      }));
    // Right, then left, then below, then above the region, 14px clear of it.
    // A region too wide for either side takes the roomier of below and above,
    // shortening the card to fit rather than covering the region.
    if (around && !compactSidebar && !follow) {
      const below = bottom - around.bottom - 14,
        above = around.top - 26;
      if (around.right + 14 + w <= window.innerWidth - right) [x, y] = [around.right + 14, around.top];
      else if (around.left - 14 - w >= 12) [x, y] = [around.left - 14 - w, around.top];
      else if (Math.max(below, above) >= Math.min(h, 200)) {
        const room = below >= h || below >= above ? below : above;
        dialog.style.maxHeight = `${room}px`;
        [x, y] = [around.left, room === below ? around.bottom + 14 : around.top - 14 - Math.min(h, room)];
      }
    }
    cardFollow.place(
      dialogKey,
      dialog,
      Math.max(12, Math.min(x, window.innerWidth - dialog.offsetWidth - right)),
      Math.max(12, Math.min(y, bottom - dialog.offsetHeight)),
      follow,
    );
    updateOrigin();
    positionNotice();
  }
  function openAccount() {
    cancelThreadRequest();
    cancelPinMove();
    clearTimeout(accountOpenTimer);
    profileDraft = null;
    mode = false;
    const mobile = compactSidebar;
    const revealPanel = mobile && !expanded;
    if (revealPanel) toggleExpanded(true);
    const show = () => {
      accountOpenTimer = 0;
      if (destroyed || (mobile && !expanded)) return;
      account = true;
      render();
      focusAccount();
    };
    show();
  }
  function focusAccount() {
    queueMicrotask(() => {
      if (!account) return;
      const mobile = compactSidebar;
      const target = mobile
        ? dialogs.querySelector<HTMLElement>(".account-dialog")
        : dialogs.querySelector<HTMLElement>("input,button");
      if (mobile && target) target.tabIndex = -1;
      target?.focus({ preventScroll: true });
    });
  }
  const anchorElement = resolveAnchor;
  const locateAnchor = measureAnchor;
  function siteElementAt(x: number, y: number) {
    return (
      pageElementsAt(x, y)
        .find((element) => element !== host && !host.contains(element)) ?? null
    );
  }
  // Portals (dialogs, popovers) render into body outside pageRoot, so the
  // whole body is pickable unless the host narrows it with pickRoots.
  function pickable(element: Element | null): element is Element {
    const page = pageDocument();
    return (
      !!element &&
      element !== framedRoot() &&
      element !== page.body &&
      // In the viewport iframe all of its body is pickable; pickRoots name this page's elements.
      (page === document && options.pickRoots ? [surface, ...options.pickRoots()] : [page.body]).some(
        (root) => root.contains(element),
      )
    );
  }
  function sourceLink(source: string, line?: number) {
    return options.sourceUrl?.(source, options.branch) ??
      `https://github.com/${options.repo}/blob/${encodeURIComponent(options.branch)}/${source.split("/").map(encodeURIComponent).join("/")}${line ? `#L${line}` : ""}`;
  }
  function ensureDesignController() {
    if (designController) return Promise.resolve(designController);
    if (!designControllerPromise) {
      designControllerPromise = import("./design-mode.js")
        .then(({ createDesignMode }) => {
          const controller = createDesignMode({
            root: shadow,
            panelRoot: sidebar,
            host,
            shortcutHelp: openShortcutHelp, visibility: shortcuts.visibility, keys: designKeys,
            reservedKey: event => Object.values(shortcuts).some(shortcut => matchesShortcut(event, shortcut)),
            design: options.design,
            sourceHref: sourceLink,
            page,
            bounds: element => framed && inFramePage(element) ? frameRect() : undefined,
            flip() {
              if (!edgeSidebar || !expanded || designDragged || edgeMorphing) return;
              const from = sidebar.getBoundingClientRect();
              placeSidebar({ x: html.clientWidth - from.right, y: from.top });
              designMoved = true;
              sidebar.animate(
                [{ transform: `translateX(${from.left - sidebar.getBoundingClientRect().left}px)` }, {}],
                { duration: 320, easing: "cubic-bezier(.22,1,.36,1)" },
              );
            },
            targetAt(x, y) {
              const target = siteElementAt(x, y);
              return pickable(target) ? target : null;
            },
            onComment(element, proposal) {
              designReturnToComments = false;
              // The comment list beside the composer is a distraction, and the
              // compact sheet would cover it, as in setMode(). Frame view stays.
              if (expanded && !inFrame()) toggleExpanded(false);
              setDesignMode(false);
              draftText = "";
              draftProposal = proposal ?? "";
              draftTags = [];
              // The centre of the element's visible part, so a page-wide proposal (on body) pins in view.
              const rect = element.getBoundingClientRect();
              const center = {
                x: (Math.max(rect.left, 0) + Math.min(rect.right, innerWidth)) / 2,
                y: (Math.max(rect.top, 0) + Math.min(rect.bottom, innerHeight)) / 2,
              };
              composeAt(element, center, center, true);
            },
            onExit() {
              designActive = false;
              designController?.setReturnAction(null);
              syncDesignFrame();
              renderToolbar();
              restoreCommentsAfterDesign();
            },
          });
          // The inspector opens once its controls and selection keys have loaded, so an
          // Enter or Space pressed on the open inspector is never dropped. A slow network
          // delays it by 2s at most; the controls then fill in as they arrive.
          return Promise.race([controller.ready, new Promise(resolve => setTimeout(resolve, 2e3))]).then(() => {
            if (destroyed) {
              controller.destroy();
              return null;
            }
            designController = controller;
            controller.setActive(designActive);
            return controller;
          });
        })
        .catch(() => {
          designActive = false;
          syncDesignFrame();
          renderToolbar();
          return null;
        })
        .finally(() => { designControllerPromise = null; });
    }
    return designControllerPromise;
  }
  async function openThreadInDesign(thread: Thread) {
    if (!designEnabled || destroyed) return;
    if (!here(thread)) {
      const url = new URL(thread.page, location.origin);
      url.searchParams.set("comment", thread.id);
      url.searchParams.set("comment-view", "design");
      await go(url);
      return;
    }
    if (!onThreadPage(thread)) {
      notify("Design is unavailable until this comment’s page is reached.");
      return;
    }
    const target = resolveAnchor(thread.anchor);
    if (!target || !pickable(target) || !locateAnchor(thread.anchor).attached) {
      notify("Design is unavailable: this comment’s element isn’t visible on this page.");
      return;
    }
    const returnExpanded = expanded;
    setDesignMode(true);
    designReturnExpanded = returnExpanded;
    const controller = await ensureDesignController();
    if (!controller || !designActive || destroyed || selected !== thread.id || !here(thread)) return;
    if (!target.isConnected || resolveAnchor(thread.anchor) !== target) {
      setDesignMode(false);
      notify("Design is unavailable: this comment’s element has changed.");
      return;
    }
    controller.select(target);
    controller.setReturnAction({ label: "Back to comment", run: () => setDesignMode(false) });
  }
  // Cards beside a stacked pin clear the whole fanned row, so the other pins stay reachable.
  function pinEdges(pin: Element) {
    const stack = pin.parentElement!;
    if (!stack.matches(".pin-stack")) return pin.getBoundingClientRect();
    const rect = stack.getBoundingClientRect();
    const width = Math.min(stack.children.length, 6) * 38 + 4;
    const left = stack.dataset.pointer === "right" ? rect.right - width : rect.left;
    const top = stack.hasAttribute("data-below") ? rect.top : rect.bottom - 38;
    return { left, right: left + width, top, bottom: top + 38, width };
  }
  function indicatorPoint(
    pin: HTMLElement,
    fallback: { x: number; y: number },
  ) {
    if (!pin.closest(".pin-stack") || pin.dataset.dragging) return fallback;
    const bounds = pin.getBoundingClientRect();
    return {
      x: bounds.left + (pin.dataset.pointer === "right" ? 25 : 9),
      y: bounds.top + 28,
    };
  }
  function canMovePin(thread: Thread) {
    return !!api.user && (api.user.verified || thread.comments[0]?.author.id === api.user.id);
  }
  // The author, or anyone who may resolve, chooses whether a comment follows persistent layout.
  const canScope = (thread: Thread) => guestResolve || canMovePin(thread);
  function setScope(thread: Thread) {
    if (!api.user && (!guests || !guestName.trim())) return openAccount();
    const scope = everyPage(thread) ? "page" : "all";
    run(async () => {
      await saveOptimistic(
        changeThread(thread.id, (current) => ({ ...current, scope })),
        async (id) => {
          if (!api.user) await api.guest(guestName);
          await api.request(`threads/${id(thread.id)}`, "PATCH", { scope });
        },
      );
      notify(`Shown on ${scope === "all" ? "all pages" : "its own page"}`);
    });
  }
  function cancelPinMove() {
    pinMoveRevision++;
    pinMove?.cancel();
  }
  async function beginPinMove(thread: Thread) {
    cancelPinMove();
    const revision = pinMoveRevision;
    const session = sessionRevision;
    if (pending || !canMovePin(thread)) return;
    const module = await import("./pin-move.js").catch(() => null);
    if (!module) { notify("Moving is unavailable. Try again."); return; }
    if (destroyed || revision !== pinMoveRevision || session !== sessionRevision || !canMovePin(thread)) return;
    const pin = pins.querySelector<HTMLButtonElement>(`.pin[data-thread="${CSS.escape(thread.id)}"]`);
    const rect = locateAnchor(thread.anchor);
    if (!here(thread) || !rect.attached || !pin) {
      notify("This pin isn’t visible on this page. Open its page before moving it.");
      return;
    }
    const point = indicatorPoint(pin, rect);
    movingThread = thread.id;
    previewSuppressed = true;
    hidePreview();
    cardFollow.stop();
    pins.append(pin);
    Object.assign(pin.style, { position: "fixed", margin: "0", left: `${point.x}px`, top: `${point.y}px` });
    pinMove = module.startPinMove({
      root: shadow, pin, point,
      bounds: pinBounds,
      preview(point) {
        pin.dataset.pointer = pinDirection(point, window.innerWidth);
        pin.style.left = `${point.x}px`;
        pin.style.top = `${point.y}px`;
        draggedPin = { id: thread.id, ...point };
        positionDialog();
      },
      finish(point) {
        pinMove = null;
        movingThread = null;
        draggedPin = null;
        pinSnapshot = "";
        renderPins();
        positionDialog();
        dialogs.querySelector<HTMLElement>('summary[aria-label="Comment actions"]')?.focus({ preventScroll: true });
        if (!point || destroyed || !here(thread) || !canMovePin(thread)) return;
        const target = componentAt(point.x, point.y);
        if (!target) { notify("Pin unchanged. Choose an element on this page."); return; }
        const anchor = captureAnchor(
          commentAnchorTarget(target, framedRoot(), options.anchorTarget), point,
          { x: point.x + rect.width, y: point.y + rect.height }, options.source,
        );
        anchor.unstacked = true;
        cardPlacements.delete(thread.id);
        run(async () => {
          await saveOptimistic(
            changeThread(thread.id, current => ({ ...current, anchor })),
            async id => { await api.request(`threads/${id(thread.id)}`, "PATCH", { anchor }); },
          );
          notify("Pin moved");
        });
      },
    });
  }
  function componentAt(x: number, y: number): Element | null {
    const hit = siteElementAt(x, y);
    if (!pickable(hit)) return null;
    const target =
      hit.closest(
        "button,a,input,textarea,select,[role=button],[role=link],[data-comment-anchor],h1,h2,h3,h4,h5,h6,p,li,figure,svg,canvas,img,video",
      ) ?? hit;
    // SVG paths and text spans belong to the control or text block they render.
    const control = target.closest("button,a,[role=button],[role=link]");
    return pickable(control) ? control : target;
  }
  function updateHover() {
    // A thread open in the sidebar outlines what it discusses; its pin steps back.
    // A hovered list card outlines its target the same way.
    const docked = !mode && !!threadPanel();
    const id = docked
      ? selected
      : expanded && !draft && !threadPanel() &&
          sidebar.querySelector(`.list [data-thread="${CSS.escape(hotCard)}"]`) && hotCard;
    const thread = id && threads.find((t) => t.id === id);
    const spot = thread && onThreadPage(thread) && locateAnchor(thread.anchor);
    const target = spot && spot.attached && (spot.width && spot.height
      ? { left: spot.x, top: spot.y, right: spot.x + spot.width, bottom: spot.y + spot.height }
      : spot.component);
    hoverOutline.toggleAttribute("data-thread", !!target);
    pins.toggleAttribute("data-quiet", !!target && docked);
    pins.toggleAttribute("data-outlined", !!target && docked && outlineShown);
    if (target) {
      const element = anchorElement(thread.anchor);
      outline(target, spot.width && spot.height ? null : element, framed && !!element && inFramePage(element));
      if (docked && !outlineShown) hoverOutline.style.opacity = "0";
      return;
    }
    if (
      (!mode && !draft) ||
      drag ||
      (draft && draft.width > 0 && draft.height > 0)
    ) {
      hoverOutline.style.opacity = "0";
      if (!mode && !draft) {
        hoverTarget = null;
        hoverPoint = null;
      }
      return;
    }
    if (draft) hoverTarget = anchorElement(draft);
    if (mode && hoverPoint)
      hoverTarget = componentAt(hoverPoint.x, hoverPoint.y);
    if (mode && hoverTarget)
      hoverTarget = commentAnchorTarget(hoverTarget, framedRoot(), options.anchorTarget);
    if (!hoverTarget?.isConnected) {
      hoverOutline.style.opacity = "0";
      return;
    }
    outline(screenRect(hoverTarget), hoverTarget, framed && inFramePage(hoverTarget));
  }
  let outlinedElement: Element | null = null;
  function outline(
    rect: { left: number; top: number; right: number; bottom: number },
    element: Element | null,
    inFrame: boolean,
  ) {
    outlinedElement = element;
    hoverOutline.style.opacity = drawHighlight(
      hoverOutline,
      rect,
      element,
      inFrame ? frameRect() : undefined,
    ) ? "1" : "0";
  }
  function scheduleHover() {
    if (hoverFrame) return;
    hoverFrame = requestAnimationFrame(() => {
      hoverFrame = 0;
      updateHover();
    });
  }
  function render() {
    if (destroyed) return;
    host.classList.toggle("design-active", designActive);
    if (account && !expanded) {
      if (isCompactReview(window.innerWidth, window.innerHeight)) {
        account = false;
        openAccount();
      } else toggleExpanded(true);
      return;
    }
    scalePage();
    const composingMobile =
      !!draft &&
      !account &&
      isCompactReview(window.innerWidth, window.innerHeight);
    host.classList.toggle("mobile-composing", composingMobile);
    sidebar.inert = compactSidebar
      ? !expanded || account
      : edgeSidebar
        ? !expanded
        : account;
    if (selected || draft || mode || hidden || commentsHidden || account) hidePreview(true);
    host.toggleAttribute("data-comments-hidden", commentsHidden);
    dialogs.style.display = commentsHidden && !account ? "none" : "";
    catcher.hidden = !mode;
    updateHover();
    hints.replaceChildren();

    renderToolbar();
    toolbar.inert = designActive;
    renderPins();
    renderList();
    renderDialog();
    const commentsPanel = sidebar.querySelector<HTMLElement>(".panel");
    if (commentsPanel) {
      commentsPanel.inert = designActive;
      commentsPanel.setAttribute("aria-hidden", String(designActive));
      commentsPanel.hidden = designActive;
    }
    if (designActive) designController?.mountPanel(sidebar);
    const head = sidebar.querySelector<HTMLElement>(".design-inspector__heading");
    if (head && !head.dataset.drag) {
      head.dataset.drag = "";
      dragSidebar(head);
    }
  }
  let drag: {
    x: number;
    y: number;
    element: Element;
    pointerId: number;
  } | null = null;
  let selection: HTMLElement | null = null;
  catcher.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const element = componentAt(event.clientX, event.clientY);
    if (!element) return;
    hoverTarget = element;
    hoverPoint = null;
    hoverOutline.style.opacity = "0";
    drag = {
      x: event.clientX,
      y: event.clientY,
      element,
      pointerId: event.pointerId,
    };
    catcher.setPointerCapture(event.pointerId);
    selection = el("div", "selection");
    shadow.append(selection);
  });
  catcher.addEventListener("pointermove", (event) => {
    if (!drag || !selection) {
      hoverPoint = { x: event.clientX, y: event.clientY };
      scheduleHover();
      return;
    }
    Object.assign(selection.style, {
      left: `${Math.min(drag.x, event.clientX)}px`,
      top: `${Math.min(drag.y, event.clientY)}px`,
      width: `${Math.abs(drag.x - event.clientX)}px`,
      height: `${Math.abs(drag.y - event.clientY)}px`,
    });
  });
  // Design mode comments are about the whole element, so their composer opens beside it.
  let draftBeside = false;
  function composeAt(
    element: Element,
    start: { x: number; y: number },
    end = start,
    beside = false,
  ) {
    cancelThreadRequest();
    revealComments();
    draftBeside = beside;
    hidePreview();
    element = commentAnchorTarget(element, framedRoot(), options.anchorTarget);
    draft = captureAnchor(element, start, end, options.source);
    // The viewport iframe's anchor is already in its own document coordinates.
    if (framed && !viewportShown) {
      // Store document coordinates, not the scaled frame's.
      const frame = surface.getBoundingClientRect(),
        scale = appliedScale * htmlZoom();
      draft.pageX = (Math.min(start.x, end.x) - frame.left) / scale + surface.scrollLeft;
      draft.pageY = (Math.min(start.y, end.y) - frame.top) / scale + surface.scrollTop;
    }
    hoverTarget = element;
    mode = false;
    selected = null;
    account = false;
    editing = null;
    error = "";
    render();
    // A thread pane sliding out of the sidebar still holds a reply box.
    dialogs
      .querySelector<HTMLTextAreaElement>('[data-focus-key="body"]')
      ?.focus({ preventScroll: true });
    positionDialog();
  }
  catcher.addEventListener("pointerup", (event) => {
    if (!drag) return;
    const target = drag;
    selection?.remove();
    selection = null;
    drag = null;
    composeAt(target.element, target, { x: event.clientX, y: event.clientY });
  });
  catcher.addEventListener("pointerleave", () => {
    if (drag || draft) return;
    hoverPoint = null;
    hoverTarget = null;
    hoverOutline.style.opacity = "0";
  });
  catcher.addEventListener("pointercancel", () => {
    drag = null;
    selection?.remove();
    selection = null;
    hoverPoint = null;
    hoverTarget = null;
    hoverOutline.style.opacity = "0";
  });
  function geometry() {
    if (movingThread && !threads.some(thread => thread.id === movingThread && here(thread))) cancelPinMove();
    if (frame || destroyed || document.hidden) return;
    const currentPage = page();
    if (
      !activeNotice &&
      ((commentsHidden && !account) ||
        (!draft &&
          !selected &&
          !mode &&
          (hidden ||
            !threads.some(
              (thread) => (thread.page === currentPage || everyPage(thread)) && !thread.resolved,
            ))))
    )
      return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      renderPins();
      positionDialog();
      positionNotice();
      updateHover();
    });
  }
  const onScroll = (event: Event) => {
      // komo's own pan notice is for others; pins already moved with the frame.
      if (panEvent) return;
      previewSuppressed = true;
      hidePreview();
      const target = event.target;
      // Sidebar and comment text scrolling do not move the page anchors.
      if (target === host || !target ||
        (target instanceof Node && target.getRootNode() === shadow)) return;
      const scroller = (target as Node).nodeType === Node.DOCUMENT_NODE ? (target as Document).scrollingElement : target;
      if (!isElement(scroller)) return;
      if (framed && frameBox.pan && target === document) {
        framePortals();
        frameControls?.update(frameArea, htmlZoom());
      }
      if (!movingThread) {
        pinsScrolling = true;
        pins.dataset.scrolling = "true";
        clearTimeout(pinScrollTimer);
        pinScrollTimer = window.setTimeout(() => {
          if (destroyed) return;
          pinSnapshot = "";
          renderPins(true);
          pinsScrolling = false;
          delete pins.dataset.scrolling;
        }, 180);
      }
      geometry();
  };
  const scrollOptions = { capture: true, passive: true, signal: abort.signal };
  document.addEventListener("scroll", onScroll, scrollOptions);
  onFrame("scroll", onScroll, scrollOptions);
  for (const type of ["focusin", "focusout", "click"])
    dialogs.addEventListener(type, () => requestAnimationFrame(positionDialog), {
      signal: abort.signal,
    });
  window.visualViewport?.addEventListener(
    "scroll",
    () => {
      if (!isCompactReview(window.innerWidth, window.innerHeight)) return;
      scalePage();
      if (account || draft || selected) geometry();
    },
    { signal: abort.signal },
  );
  window.visualViewport?.addEventListener(
    "resize",
    () => {
      if (!isCompactReview(window.innerWidth, window.innerHeight)) return;
      scalePage();
      geometry();
    },
    { signal: abort.signal },
  );
  window.addEventListener(
    "resize",
    () => {
      syncResponsiveSidebar();
      scalePage();
      if (!compactSidebar) renderToolbar();
      geometry();
    },
    { signal: abort.signal },
  );
  onPage<KeyboardEvent>(
    shadow,
    "keydown",
    (event) => {
      const target = event.composedPath()[0];
      if ((account || (compactSidebar && expanded)) && event.key === "Tab") {
        const scope = account ? dialogs : designActive ? shadow.querySelector(".design-inspector") ?? shadow : shadow;
        const controls = [
          ...scope.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input:not(:disabled):not([type=hidden]),select:not(:disabled),textarea:not(:disabled),summary,a[href],[tabindex]",
          ),
        ].filter(
          (control) =>
            control.tabIndex >= 0 &&
            control.getClientRects().length > 0 &&
            !control.closest("[inert]") &&
            (account || designActive ||
              !compactSidebar ||
              !!control.closest(".panel,.toolbar")),
        );
        const first = controls[0],
          last = controls.at(-1);
        if (
          event.shiftKey &&
          (shadow.activeElement === first ||
            !controls.includes(shadow.activeElement as HTMLElement))
        ) {
          event.preventDefault();
          last?.focus();
        } else if (
          !event.shiftKey &&
          (shadow.activeElement === last ||
            !controls.includes(shadow.activeElement as HTMLElement))
        ) {
          event.preventDefault();
          first?.focus();
        }
      }
      // Focus may sit in a nested shadow root that composedPath() can't see.
      let active = document.activeElement;
      while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
      // Only true text entry pauses review keys; a focused button, switch or closed select keeps them.
      // With focus inside Frame's viewport iframe, the frame's focused element decides.
      if (active === pageFrame()) active = pageDocument().activeElement;
      const typing = textEntry(target) || textEntry(active) || event.isComposing;
      if (event.key === "Escape") {
        if (designActive) return;
        if (event.defaultPrevented && !event.composedPath().includes(host)) return;
        // Hidden drafts and selection wait for Show comments; Escape belongs to the page.
        if (commentsHidden && !account) return;
        if (mode || draft || selected || account) {
          event.preventDefault();
          dismiss();
        } else if (expanded) {
          event.preventDefault();
          toggleExpanded(false);
        }
        return;
      }
      if (typing) return;
      if (toolbarDismissed && matchesShortcut(event, shortcuts.restore)) {
        event.preventDefault();
        restoreToolbar();
        return;
      }
      if (options.onboarding) return;
      if (matchesShortcut(event, shortcuts.comment)) {
        event.preventDefault();
        setMode(!commentMode);
      } else if (matchesShortcut(event, shortcuts.browse)) {
        event.preventDefault();
        setMode(false);
      } else if (designEnabled && matchesShortcut(event, shortcuts.design)) {
        event.preventDefault();
        setDesignMode(!designActive);
      } else if (matchesShortcut(event, shortcuts.comments)) {
        event.preventDefault();
        toggleExpanded(!expanded);
      } else if (!designActive && matchesShortcut(event, shortcuts.visibility)) {
        event.preventDefault();
        setCommentsHidden(!commentsHidden);
      }
    },
    { signal: abort.signal },
  );
  onPage<PointerEvent>(
    shadow,
    "pointermove",
    (event) => {
      if (event.pointerType === "touch") return;
      nearPoint = clientPoint(event);
      if (pins.dataset.size) nearFrame ||= requestAnimationFrame(markNear);
    },
    { passive: true, signal: abort.signal },
  );
  html.addEventListener(
    "pointerleave",
    () => {
      nearPoint = null;
      markNear();
    },
    { signal: abort.signal },
  );
  onPage<PointerEvent>(
    shadow,
    "pointerdown",
    (event) => {
      const path = event.composedPath();
      const reviewControl = path.some(
        (node) =>
          node instanceof Element &&
          node.getRootNode() === shadow &&
          node.matches(
            "button,input,textarea,summary,[role=menu],[role=listbox],.emoji-menu,.emoji-keyboard,.floating-notice",
          ),
      );
      if (
        event.button === 0 &&
        (selected || draft) &&
        !commentsHidden &&
        !(draft && isCompactReview(window.innerWidth, window.innerHeight)) &&
        !account &&
        !path.includes(dialogs) &&
        !path.includes(toolbar) &&
        !path.includes(pins) &&
        // A Frame thread left open after posting yields to the next comment.
        !(mode && path.includes(catcher)) &&
        !reviewControl
      ) {
        if (draft && draftText.trim())
          parkedDraft = { anchor: draft, text: draftText };
        dismiss();
      }
      for (const menu of shadow.querySelectorAll<HTMLDetailsElement>(
        ".comment-menu[open]",
      )) {
        if (!event.composedPath().includes(menu)) menu.open = false;
      }
    },
    { signal: abort.signal },
  );
  const observer = new ResizeObserver(() => { framePortals(); geometry(); });
  observer.observe(surface);
  let mutationTimer = 0;
  const mutations = new MutationObserver((records) => {
    if (records.some((record) => record.target === document.body)) framePortals();
    // Background host churn needs one refresh per burst, not per animation frame.
    if (draft || selected || mode || activeNotice) return geometry();
    if (!mutationTimer)
      mutationTimer = window.setTimeout(() => {
        mutationTimer = 0;
        geometry();
      }, 80);
  });
  mutations.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  watchHighlight(host, () => hoverOutline.style.opacity !== "0" ? [outlinedElement] : [], scheduleHover, abort.signal);
  dialogs.addEventListener("pointerdown", (event) => {
    if (account && event.target === dialogs) dismiss();
  });
  function checkPage() {
    if (destroyed || page() === lastPage) return;
    lastPage = page();
    // A proposal previewed on the last route never stays behind on this one.
    designModule?.resetDesignPreviews();
    designController?.clearSelection();
    designController?.setReturnAction(null);
    parkedDraft = null;
    selected = threadRequest?.id === selected ? selected : null;
    draft = null;
    render();
  }
  // Client-side routers change the URL without reloading; repaint pins right
  // away from the threads already in memory. The poll below still catches
  // routers that update the URL after these events fire.
  const onNavigate = () => setTimeout(() => (checkPage(), openDeepLink()));
  window.addEventListener("popstate", onNavigate, { signal: abort.signal });
  (
    window as Window & { navigation?: EventTarget }
  ).navigation?.addEventListener("navigatesuccess", onNavigate, {
    signal: abort.signal,
  });
  /** A host router owns redirect/rejection decisions; never override them with a reload. */
  async function go(url: URL) {
    const framed = pageFrame()?.contentWindow;
    if (framed && url.origin === location.origin) {
      url.searchParams.delete("comment");
      url.searchParams.delete("comment-view");
      return framed.location.assign(url);
    }
    if (!options.navigate || url.origin !== location.origin)
      return location.assign(url);
    const id = url.searchParams.get("comment");
    if (!id) return;
    cancelThreadRequest();
    cancelledLinks.delete(id);
    const request: ThreadRequest = { id, inspect: url.searchParams.get("comment-view") === "design", pending: true, rejected: false };
    threadRequest = request;
    if (selected === id) renderDialog();
    try {
      await options.navigate(url);
    } catch {
      request.rejected = true;
    }
    if (destroyed || threadRequest !== request) return;
    request.pending = false;
    checkPage();
    await openRequestedThread(request);
  }
  let linking: ThreadRequest | null = null;
  async function openRequestedThread(request: ThreadRequest) {
    const thread = threads.find((item) => item.id === request.id);
    if (!thread || linking === request || request.opened) return;
    linking = request;
    // A successful route can render its anchor after the router promise resolves.
    for (let wait = 0; wait < 5e3 && onThreadPage(thread) && !resolveAnchor(thread.anchor); wait += 100) {
      await new Promise((done) => setTimeout(done, 100));
      if (destroyed || threadRequest !== request) break;
    }
    if (linking === request) linking = null;
    if (destroyed || threadRequest !== request || !threads.some((item) => item.id === thread.id)) return;
    const url = new URL(location.href);
    if (url.searchParams.get("comment") === request.id) {
      url.searchParams.delete("comment");
      url.searchParams.delete("comment-view");
      history.replaceState(history.state, "", url);
    }
    checkPage();
    request.opened = true;
    if (!expanded) toggleExpanded(true);
    selectThread(thread, true);
    if (request.inspect && onThreadPage(thread)) void openThreadInDesign(thread);
  }
  /** Open ?comment=<id> once its page and anchor render, then drop the param. */
  async function openDeepLink() {
    const url = new URL(location.href);
    const id = url.searchParams.get("comment");
    if (id && cancelledLinks.has(id)) {
      url.searchParams.delete("comment");
      url.searchParams.delete("comment-view");
      history.replaceState(history.state, "", url);
      return;
    }
    const thread = threads.find((t) => t.id === id);
    if (!thread || threadRequest?.pending) return;
    if (threadRequest?.id !== thread.id) {
      cancelThreadRequest();
      threadRequest = { id: thread.id, inspect: url.searchParams.get("comment-view") === "design", pending: false, rejected: false };
    }
    await openRequestedThread(threadRequest);
  }
  function syncSession() {
    const next = new CommentsApi(options);
    if (next.token === api.token || (api.transient && !next.token))
      return false;
    api.cancelReads();
    api = next;
    projectLoaded = false;
    issue = null;
    connection = "Connecting";
    google = github = guests = guestResolve = privateProject = apiTokens = false;
    draft = parkedDraft = null;
    draftText = draftProposal = "";
    draftTags = [];
    replies.clear();
    replySelections.clear();
    recoveredDrafts.length = 0;
    queuedProfile = profileDraft = confirmedProfile = null;
    profileRevision++;
    clearTimeout(profileSaveTimer);
    hydrateThreads();
    render();
    run(loadProject);
    return true;
  }
  window.addEventListener(
    "storage",
    (event) => {
      if (
        event.storageArea === localStorage &&
        event.key === api.sessionKey &&
        event.newValue !== api.token
      )
        syncSession();
    },
    { signal: abort.signal },
  );
  window.addEventListener(
    "focus",
    () => {
      if (!syncSession()) polling?.wake();
    },
    {
      signal: abort.signal,
    },
  );
  const cardAt = (event: Event) =>
    (event.target as Element).closest?.<HTMLElement>(".list .thread-item")?.dataset.thread ?? "";
  // Moving between cards crosses gaps; settle briefly instead of flickering.
  const settleHot = () => {
    clearTimeout(hotTimer);
    hotTimer = window.setTimeout(() => setHot(), 80);
  };
  for (const [type, handle] of [
    ["pointerover", (event: Event) => (hoverCard = cardAt(event)) ? setHot() : settleHot()],
    ["pointerleave", () => { hoverCard = ""; settleHot(); }],
    ["focusin", (event: Event) => { focusCard = cardAt(event); setHot(); }],
    ["focusout", () => { focusCard = ""; settleHot(); }],
    ["scroll", () => { hoverCard = focusCard = ""; setHot(); }],
  ] as const)
    sidebar.addEventListener(type, handle, { capture: true, signal: abort.signal });
  polling = adaptivePolling({
    interval: Math.max(2000, options.pollInterval ?? 4000),
    enabled: () =>
      !destroyed &&
      !document.hidden &&
      navigator.onLine !== false &&
      !options.onboarding,
    active: () => expanded || account || mode || !!draft || !!selected,
    read: async () => {
      checkPage();
      return projectLoaded ? refresh() : loadProject();
    },
  });
  for (const event of ["online", "offline"])
    window.addEventListener(event, () => polling?.wake(), {
      signal: abort.signal,
    });
  host.addEventListener("click", () => polling?.wake(false), {
    signal: abort.signal,
  });
  host.addEventListener("keydown", () => polling?.wake(false), {
    signal: abort.signal,
  });
  // Page listeners see komo's events retargeted to the host <div>. Stop them
  // here so host shortcuts skip komo's fields and open modals don't treat komo
  // as outside interaction; komo's own page handlers use onPage().
  if (options.isolateEvents !== false) {
    host.setAttribute("data-isolate", "");
    isolateEscape(host, abort.signal);
    for (const type of isolatedEvents)
      host.addEventListener(
        type,
        (event) => isolated(event, shadow) && event.stopPropagation(),
        { passive: true, signal: abort.signal },
      );
    // Moving focus into komo fires focusout on the page element, which focus
    // traps answer by refocusing. Stop it for document listeners added later.
    document.addEventListener(
      "focusout",
      (event) => event.relatedTarget === host && event.stopImmediatePropagation(),
      { signal: abort.signal },
    );
  }
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden) {
        mutations.disconnect();
        clearTimeout(mutationTimer);
        mutationTimer = 0;
      } else {
        mutations.observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true,
        });
        framePortals();
        geometry();
      }
      if (document.hidden || !syncSession()) polling?.wake();
    },
    { signal: abort.signal },
  );
  const controller: CommentsController = {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      frameControls?.destroy();
      cancelThreadRequest();
      cancelPinMove();
      polling?.stop();
      designController?.destroy();
      designModule?.resetDesignPreviews();
      api.cancelReads();
      stopLayoutMotion();
      disposeHeaderTip?.();
      cancelAnimationFrame(mobileEnterFrame);
      clearTimeout(mutationTimer);
      clearTimeout(pinScrollTimer);
      clearTimeout(breatheTimer);
      clearTimeout(accountOpenTimer);
      clearTimeout(copiedPromptTimer);
      reactionSwaps.clear();
      cardFollow.stop();
      run(saveProfile);
      disposeAccentPicker?.();
      closePicker?.(true);
      for (const [dialog, dispose] of exitingDialogs) {
        dispose?.();
        dialog.getAnimations().forEach((animation) => animation.cancel());
        dialog.remove();
      }
      exitingDialogs.clear();
      pageMotion?.cancel();
      dockMotion?.stop();
      stopEdgeMotion(true);
      abort.abort();
      clearTimeout(toastTimer);
      clearTimeout(listScrollTimer);
      clearTimeout(githubTimer);
      cancelAnimationFrame(frame);
      cancelAnimationFrame(hoverFrame);
      cancelAnimationFrame(nearFrame);
      cancelAnimationFrame(panFrameId);
      cancelAnimationFrame(noticeFrame);
      hidePreview();
      observer.disconnect();
      mutations.disconnect();
      themeWatch.disconnect();
      hostGuard.disconnect();
      cancelAnimationFrame(themeFrame);
      const scroll = framed && !laidViewport
        ? surface.scrollTop * htmlZoom()
        : window.scrollY / appliedScale;
      closeViewport();
      framePortals();
      if (framed || !edgeSidebar) {
        restorePage();
        window.scrollTo({ top: scroll, behavior: "instant" });
      }
      toolbarSize.disconnect();
      toolbarRoot.unmount();
      host.remove();
      instances.delete(document);
    },
    comment(element) {
      const compose = () => {
        if (destroyed || !element.isConnected) return;
        const rect = element.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        composeAt(element, {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        });
      };
      if (expanded && !inFrame()) {
        toggleExpanded(false);
        if (pageMotion && pageTransitioning)
          void pageMotion.finished.then(compose).catch(() => {});
        else compose();
      } else compose();
    },
    open() {
      if (destroyed) return;
      restoreToolbar();
      toggleExpanded(true);
    },
    close() {
      if (destroyed) return;
      dismiss();
      toggleExpanded(false);
    },
    async refresh() {
      await refresh();
    },
  };
  instances.set(document, { scope, controller });
  restoring = !options.onboarding && openStore.get();
  scalePage();
  const cached = options.onboarding ? null : api.cached();
  knownThreads ||= cached !== null;
  const reopen = restoring;
  restoring = true;
  if (cached) optimistic.replace(visibleThreads(cached));
  render();
  if (edgeSidebar) {
    // Park without the 320ms transition so the collapsed state is applied in
    // the first paint instead of sliding across the screen on load.
    sidebar.style.transition = "none";
    positionSidebar();
    void sidebar.offsetWidth;
    sidebar.style.transition = "";
  }
  // Hidden comments keep a remembered open sidebar for Show comments.
  revealExpanded = reopen && commentsHidden;
  restoring = reopen && !commentsHidden;
  if (restoring) {
    // Reopen where the reviewer left off: no frame, dock or card motion; one fade.
    toggleExpanded(true);
    restoring = false;
    if (!reducedMotion())
      for (const node of [host, framed ? surface : null])
        node?.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: 200,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        });
  }
  void openDeepLink();
  async function loadProject() {
    const client = api;
    const token = client.token;
    let config: {
      github: boolean;
      google?: boolean;
      guests: boolean;
      guestResolve: boolean;
      private?: boolean;
      tokens?: boolean;
    };
    // Settle a stored session before starting reads: an expired token clears
    // session-bound reads, including a config launched alongside restore.
    try {
      await client.restore();
    } catch {
      /* An expired guest session can be renewed by entering a name. */
    }
    if (destroyed || client !== api) return;
    if (token !== client.token) hydrateThreads();
    renderToolbar();
    if (account) renderDialog();
    // Once the session is settled, threads and config can load in parallel.
    const listed = refresh();
    listed.catch(() => {});
    try {
      config = await client.request("config");
    } catch (reason) {
      if (
        destroyed ||
        client !== api ||
        (reason instanceof DOMException && reason.name === "AbortError")
      )
        return;
      const next = connectionIssue(reason);
      const changed = issue?.detail !== next.detail;
      issue = next;
      connection = "Offline";
      if (changed) render();
      throw reason;
    }
    if (destroyed || client !== api) return;
    projectLoaded = true;
    google = !!config.google;
    github = config.github;
    guests = config.guests;
    guestResolve = config.guestResolve;
    privateProject = !!config.private;
    apiTokens = config.tokens === true;
    // The list may already have failed with an expected anonymous 401.
    // Publish auth options before awaiting it so an open account can sign in.
    render();
    const changed = await listed;
    if (destroyed || client !== api) return;
    void openDeepLink();
    render();
    return changed;
  }
  if (!options.onboarding?.inProject)
    run(() => loadProject().finally(() => polling?.wake(false)));
  // Motion drives sidebar and dock moves only; fetch it once mount work is done.
  const prefetch = () => void loadMotion().catch(() => {});
  if ("requestIdleCallback" in window) requestIdleCallback(prefetch, { timeout: 2e3 });
  else setTimeout(prefetch, 200);
  return controller;
}
