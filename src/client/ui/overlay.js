/* ============================================================
   Respite · overlay.js · The Veil Between
   ------------------------------------------------------------
   Everything that floats over the page: dialogs and phone
   sheets, confirmations (every gold spend goes through one),
   toasts, tooltips, and the navigation drawer.

   One stack of layers decides who has the keyboard: the top
   layer traps focus and takes Escape, everything under it is
   made inert, and page scroll is locked while any layer is up.
   ============================================================ */

import { h, html, qsa } from "./dom.js";
import { icon, iconEl } from "./icons.js";
import { fmtGold } from "./format.js";

/* ================= 1. THE LAYER STACK ================= */

const FOCUSABLE = [
  "a[href]", "area[href]", "button:not([disabled])", "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])", "textarea:not([disabled])", "iframe", "summary",
  "[contenteditable]:not([contenteditable='false'])", "[tabindex]:not([tabindex='-1'])",
].join(",");

const layers = [];             // { kind, root, focusRoot, keep, dismissible, close }
const madeInert = new Set();   // only what this module made inert, so it can undo exactly that
let scrollLocks = 0;
let savedScroll = null;

const media = (q) => (typeof matchMedia === "function" ? matchMedia(q) : { matches: false, addEventListener() {} });
const reducedMotion = () => media("(prefers-reduced-motion: reduce)").matches;
const isSheet = () => media("(max-width: 599px)").matches;

function focusables(root) {
  return qsa(FOCUSABLE, root).filter((n) => !n.closest("[inert]") && n.getClientRects().length > 0);
}

// Kept live under any layer: tooltips, toasts and the screen reader region.
function isKept(node, keep) {
  if (keep && keep.includes(node)) return true;
  const tag = node.tagName;
  if (tag === "SCRIPT" || tag === "STYLE" || tag === "LINK" || tag === "TEMPLATE") return true;
  return node.id === "tipLayer" || node.id === "toasts" || node.id === "srLive" ||
    node.classList.contains("tip-layer") || node.classList.contains("toasts");
}

// Everything outside the top layer goes inert: siblings at every level up to <body>.
function applyLayers() {
  for (const n of madeInert) n.inert = false;
  madeInert.clear();

  layers.forEach((l, i) => {
    if (l.kind === "modal") l.root.classList.toggle("is-under", i < layers.length - 1);
  });

  const top = layers[layers.length - 1];
  if (!top) return;

  let node = top.root;
  while (node && node.parentElement && node !== document.body) {
    for (const sib of node.parentElement.children) {
      if (sib === node || isKept(sib, top.keep) || sib.inert) continue;
      sib.inert = true;
      madeInert.add(sib);
    }
    node = node.parentElement;
  }
}

function pushLayer(layer) {
  layers.push(layer);
  applyLayers();
  lockScroll();
}

function dropLayer(layer) {
  const i = layers.indexOf(layer);
  if (i < 0) return;
  layers.splice(i, 1);
  applyLayers();
  unlockScroll();
}

function lockScroll() {
  if (scrollLocks++ > 0) return;
  const de = document.documentElement;
  const gap = window.innerWidth - de.clientWidth;
  savedScroll = { overflow: de.style.overflow, padding: document.body.style.paddingRight };
  de.style.overflow = "hidden";
  if (gap > 0) document.body.style.paddingRight = gap + "px";
}

function unlockScroll() {
  if (scrollLocks === 0 || --scrollLocks > 0) return;
  const de = document.documentElement;
  de.style.overflow = savedScroll ? savedScroll.overflow : "";
  document.body.style.paddingRight = savedScroll ? savedScroll.padding : "";
  savedScroll = null;
}

function restoreFocus(node) {
  if (node && node.isConnected && typeof node.focus === "function" && !node.closest("[inert]")) {
    node.focus({ preventScroll: true });
  }
}

let keysBound = false;

function bindKeys() {
  if (keysBound || typeof document === "undefined") return;
  keysBound = true;

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (tipState.anchor) {
        hideTip();
        e.stopPropagation();
        return;
      }
      const top = layers[layers.length - 1];
      if (top && top.dismissible) {
        e.preventDefault();
        top.close("escape");
      }
      return;
    }

    if (e.key !== "Tab") return;
    const top = layers[layers.length - 1];
    if (!top) return;

    const box = top.focusRoot;
    const items = focusables(box);
    const active = document.activeElement;
    if (!items.length) {
      e.preventDefault();
      box.focus({ preventScroll: true });
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (active === box || !box.contains(active)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    } else if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }, true);

  // Focus that wanders out from under the top layer (a click on the page behind) comes back.
  document.addEventListener("focusin", (e) => {
    const top = layers[layers.length - 1];
    if (!top || !(e.target instanceof Element)) return;
    // A dropdown's list hangs off the body so a scrolling modal cannot clip it; it belongs
    // to the field that opened it, so focus landing in it is not focus wandering off.
    if (top.focusRoot.contains(e.target) || e.target.closest(".toasts, .tip-layer, .drop-panel")) return;
    top.focusRoot.focus({ preventScroll: true });
  });
}

/* ================= 2. MODALS AND SHEETS ================= */

let modalSeq = 0;

const KIND_CLASS = {
  primary: "btn-primary",
  gold: "btn-gold",
  ember: "btn-ember",
  danger: "btn-danger",
  quiet: "btn-quiet",
  default: "",
};

function modalRoot() {
  let node = document.getElementById("modalRoot");
  if (!node) {
    node = h("div#modalRoot");
    document.body.appendChild(node);
  }
  return node;
}

// Strings become paragraphs, arrays flatten, Nodes go in as they are.
function fill(target, content) {
  if (content == null || content === false) return;
  if (Array.isArray(content)) {
    content.forEach((c) => fill(target, c));
  } else if (typeof content === "string" || typeof content === "number") {
    target.appendChild(h("p.copy", String(content)));
  } else {
    target.appendChild(content);
  }
}

function makeArt(art, tone, rarity, artClass) {
  let inner;
  if (typeof art === "string") inner = art.trim().startsWith("<") ? html(art) : iconEl(art);
  else inner = art;
  return h("div.art.art-lg", {
    class: artClass,
    "data-tone": rarity ? null : tone || "violet",
    "data-rarity": rarity || null,
    "aria-hidden": "true",
  }, inner);
}

/**
 * openModal({ title, sub, art, artTone, artRarity, artClass, body, actions,
 *             onClose, size, dismissible, role, initialFocus, footLayout, className })
 *
 * A centred dialog on wider screens, a bottom sheet on phones. Returns
 * { el, body, buttons, close(reason), setBody(content), setActions(list), setTitle(title, sub) }.
 *
 * Actions: [{ label, kind: "gold"|"primary"|"ember"|"danger"|"quiet", onClick, disabled,
 *             icon, soft, wide, id, keep }]. After onClick the modal closes, unless the
 * action has keep: true or onClick returns false. A Promise shows the button loading
 * and closes when it resolves to anything but false.
 */
export function openModal(opts = {}) {
  bindKeys();

  const {
    title = "",
    sub = "",
    art = null,
    artTone = "violet",
    artRarity = null,
    artClass = "",
    body = null,
    actions = [],
    onClose = null,
    size = "md",
    dismissible = true,
    role = "dialog",
    initialFocus = null,
    footLayout = "auto",
    className = "",
  } = opts;

  const id = `modal${++modalSeq}`;
  const opener = document.activeElement;

  const titleNode = h("h2.modal-title", { id: `${id}-title` }, title);
  const subNode = h("p.modal-sub", { id: `${id}-sub`, hidden: !sub }, sub || "");
  const closeBtn = dismissible
    ? h("button.btn.btn-quiet.btn-icon.modal-x", { type: "button", "aria-label": "Close", html: icon("close") })
    : null;
  const bodyNode = h("div.modal-body");
  const foot = h("footer.modal-foot");

  const dialog = h("div.modal", {
    class: [`modal-${size}`, className],
    role,
    "aria-modal": "true",
    "aria-labelledby": `${id}-title`,
    "aria-describedby": sub ? `${id}-sub` : null,
    tabindex: "-1",
  },
    h("div.modal-grab", { "aria-hidden": "true" }),
    h("header.modal-head",
      art ? makeArt(art, artTone, artRarity, artClass) : null,
      h("div.modal-titles", titleNode, subNode),
      closeBtn),
    bodyNode,
    foot);

  const backdrop = h("div.modal-backdrop");
  const wrap = h("div.modal-wrap", { style: { zIndex: `calc(var(--z-modal) + ${layers.length})` } }, backdrop, dialog);

  let closed = false;
  let busy = false;

  const handle = {
    el: dialog,
    body: bodyNode,
    buttons: [],
    get closed() { return closed; },
    close,
    setBody(content) {
      bodyNode.replaceChildren();
      fill(bodyNode, content);
    },
    setTitle(nextTitle, nextSub) {
      titleNode.textContent = nextTitle == null ? "" : String(nextTitle);
      if (nextSub !== undefined) {
        subNode.textContent = nextSub || "";
        subNode.hidden = !nextSub;
        if (nextSub) dialog.setAttribute("aria-describedby", `${id}-sub`);
        else dialog.removeAttribute("aria-describedby");
      }
    },
    setActions(list) {
      foot.replaceChildren();
      handle.buttons = [];
      const items = (list || []).filter(Boolean);
      items.forEach((a) => {
        const btn = h("button.btn", {
          type: "button",
          id: a.id || null,
          class: [KIND_CLASS[a.kind || "default"], a.soft && "btn-soft", a.wide && "wide"],
          disabled: !!a.disabled,
          "aria-describedby": a.describedBy || null,
        }, a.icon ? iconEl(a.icon) : null, h("span", a.label));
        btn.addEventListener("click", (e) => runAction(a, btn, e));
        foot.appendChild(btn);
        handle.buttons.push(btn);
      });
      foot.hidden = items.length === 0;
      foot.classList.toggle("is-grid", footLayout === "grid" || (footLayout === "auto" && items.length > 2));
    },
  };

  async function runAction(action, btn, event) {
    if (busy || closed) return;
    let result;
    try {
      result = action.onClick ? action.onClick(handle, event) : undefined;
    } catch (err) {
      console.error(err);
      return;
    }
    if (result && typeof result.then === "function") {
      busy = true;
      const was = handle.buttons.map((b) => b.disabled);
      btn.classList.add("is-loading");
      handle.buttons.forEach((b) => { b.disabled = true; });
      try {
        result = await result;
      } catch (err) {
        console.error(err);
        result = false;
      }
      busy = false;
      if (!closed) {
        btn.classList.remove("is-loading");
        handle.buttons.forEach((b, i) => { b.disabled = was[i]; });
        // A confirm opened from this action took focus with it; bring it back to the button.
        if (!dialog.contains(document.activeElement) && layers[layers.length - 1] === layer) {
          (btn.disabled ? dialog : btn).focus({ preventScroll: true });
        }
      }
    }
    if (result !== false && !action.keep && !closed) close("action");
  }

  function close(reason = "close") {
    if (closed) return;
    closed = true;
    dropLayer(layer);

    wrap.classList.remove("is-open");
    wrap.classList.add("is-closing");
    const remove = () => wrap.remove();
    if (reducedMotion()) remove();
    else setTimeout(remove, isSheet() ? 300 : 220);

    restoreFocus(opener);
    const top = layers[layers.length - 1];
    if (top && !top.focusRoot.contains(document.activeElement)) top.focusRoot.focus({ preventScroll: true });
    if (onClose) {
      try { onClose(reason); } catch (err) { console.error(err); }
    }
  }

  const layer = { kind: "modal", root: wrap, focusRoot: dialog, keep: null, dismissible, close };

  handle.setBody(body);
  handle.setActions(actions);

  if (closeBtn) closeBtn.addEventListener("click", () => close("close"));

  // A press that starts and ends on the backdrop closes; a drag out of the dialog does not.
  let downOnBackdrop = false;
  wrap.addEventListener("pointerdown", (e) => {
    downOnBackdrop = e.target === wrap || e.target === backdrop;
  });
  wrap.addEventListener("click", (e) => {
    if (dismissible && downOnBackdrop && (e.target === wrap || e.target === backdrop)) close("backdrop");
    downOnBackdrop = false;
  });

  bindSheetDrag(wrap, dialog, () => dismissible && !closed, () => close("swipe"));

  modalRoot().appendChild(wrap);
  pushLayer(layer);
  void wrap.offsetWidth;   // commit the closed state so the opening transition runs
  wrap.classList.add("is-open");

  let target = null;
  if (typeof initialFocus === "string") target = dialog.querySelector(initialFocus);
  else if (initialFocus instanceof Element) target = initialFocus;
  if (!target) target = dialog.querySelector("[autofocus]");
  (target || dialog).focus({ preventScroll: true });

  return handle;
}

// Phones: drag the sheet down by its handle or header to dismiss it.
function bindSheetDrag(wrap, dialog, allowed, dismiss) {
  let pointer = null;
  let startY = 0;
  let startT = 0;
  let dy = 0;

  const down = (e) => {
    if (!isSheet() || !allowed() || e.button > 0) return;
    if (e.target.closest("button, a, input, select, textarea, label")) return;
    pointer = e.pointerId;
    startY = e.clientY;
    startT = performance.now();
    dy = 0;
    try { e.currentTarget.setPointerCapture(pointer); } catch (_) { /* a synthetic or finished pointer: dragging still works without capture */ }
    wrap.classList.add("is-dragging");
  };

  const move = (e) => {
    if (e.pointerId !== pointer) return;
    dy = Math.max(0, e.clientY - startY);
    wrap.style.setProperty("--sheet-drag", dy + "px");
  };

  const up = (e) => {
    if (e.pointerId !== pointer) return;
    pointer = null;
    wrap.classList.remove("is-dragging");
    const speed = dy / Math.max(1, performance.now() - startT);
    if (dy > 110 || (dy > 36 && speed > 0.55)) {
      dismiss();
    } else {
      wrap.style.setProperty("--sheet-drag", "0px");
    }
  };

  for (const zone of dialog.querySelectorAll(".modal-grab, .modal-head")) {
    zone.addEventListener("pointerdown", down);
    zone.addEventListener("pointermove", move);
    zone.addEventListener("pointerup", up);
    zone.addEventListener("pointercancel", up);
  }
}

/* ================= 3. CONFIRM ================= */

let confirmSeq = 0;

function costRow(label, value, cls, withCoin) {
  return h("div.cost-row", { class: cls },
    h("span.l", label),
    h("span.v", withCoin ? iconEl("coin") : null, value));
}

/**
 * confirm({ title, body, confirmText, cancelText, danger, cost: { gold, have }, typeToConfirm })
 * -> Promise<boolean>. Resolves false on Cancel, Escape, the backdrop or a swipe.
 */
export function confirm({
  title = "Are you sure?",
  body = null,
  confirmText = "Confirm",
  cancelText = "Cancel",
  danger = false,
  cost = null,
  typeToConfirm = null,
  art = null,
  artTone = null,
} = {}) {
  return new Promise((resolve) => {
    let answer = false;
    const parts = [];
    const seq = ++confirmSeq;
    const noteId = `confirm${seq}-note`;

    let bodyNode = null;
    if (body != null) {
      bodyNode = typeof body === "string" ? h("p.confirm-body", body) : body;
      if (!bodyNode.id) bodyNode.id = `confirm${seq}-body`;
      parts.push(bodyNode);
    }

    let short = false;
    if (cost) {
      const price = Math.max(0, Math.floor(Number(cost.gold) || 0));
      const have = Math.floor(Number(cost.have) || 0);
      const left = have - price;
      short = left < 0;
      parts.push(h("div.cost", { class: short && "is-short" },
        costRow("Costs", fmtGold(price), "is-price", true),
        costRow("Your gold", fmtGold(have)),
        costRow(short ? "Short by" : "Left after", fmtGold(Math.abs(left)), "is-left")));
      if (short) {
        parts.push(h("p.cost-note", { id: noteId }, iconEl("alert"), `You need ${fmtGold(-left)} more.`));
      }
    }

    let input = null;
    if (typeToConfirm) {
      const inputId = `confirm${seq}-type`;
      input = h("input.input", {
        id: inputId,
        type: "text",
        autocomplete: "off",
        autocapitalize: "characters",
        spellcheck: "false",
        enterkeyhint: "done",
      });
      parts.push(h("div.field.confirm-type",
        h("label.field-label", { for: inputId }, "Type ", h("b", typeToConfirm), " to confirm"),
        input));
    }

    const kind = danger ? "danger" : cost ? "gold" : "primary";
    const modal = openModal({
      title,
      body: parts,
      size: "sm",
      role: "alertdialog",
      art,
      artTone: artTone || (danger ? "ember" : cost ? "gold" : "violet"),
      footLayout: "row",
      actions: [
        { label: cancelText, kind: "quiet", onClick: () => { answer = false; } },
        {
          label: confirmText,
          kind,
          disabled: short || !!typeToConfirm,
          describedBy: short ? noteId : null,
          onClick: () => { answer = true; },
        },
      ],
      onClose: () => resolve(answer),
    });

    const [cancelBtn, okBtn] = modal.buttons;
    if (bodyNode) modal.el.setAttribute("aria-describedby", bodyNode.id);

    if (input) {
      const check = () => { okBtn.disabled = short || input.value.trim() !== typeToConfirm; };
      input.addEventListener("input", check);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !okBtn.disabled) {
          e.preventDefault();
          okBtn.click();
        }
      });
      input.focus({ preventScroll: true });
    } else if (danger || short) {
      cancelBtn.focus({ preventScroll: true });
    } else {
      okBtn.focus({ preventScroll: true });
    }
  });
}

/* ================= 4. TOASTS ================= */

const MAX_TOASTS = 4;
const TOAST_ICONS = { info: "info", good: "check", warn: "warn", bad: "alert", gold: "coin" };
const liveToasts = new Set();   // { pause(), resume() } for each toast still up
let stackHeld = false;

function toastStack() {
  let node = document.getElementById("toasts");
  if (!node) {
    node = h("div#toasts.toasts", { "aria-live": "polite", "aria-relevant": "additions" });
    document.body.appendChild(node);
  }
  if (!node.dataset.bound) {
    node.dataset.bound = "1";
    // Reading one toast holds them all, so none slips away while you look.
    const hold = (on) => {
      if (stackHeld === on) return;
      stackHeld = on;
      liveToasts.forEach((t) => (on ? t.pause() : t.resume()));
    };
    node.addEventListener("pointerover", () => hold(true));
    node.addEventListener("pointerout", (e) => { if (!(e.relatedTarget instanceof Node && node.contains(e.relatedTarget))) hold(false); });
    node.addEventListener("focusin", () => hold(true));
    node.addEventListener("focusout", (e) => { if (!(e.relatedTarget instanceof Node && node.contains(e.relatedTarget))) hold(false); });
  }
  return node;
}

/**
 * toast(text, { kind: "info"|"good"|"warn"|"bad"|"gold", icon, ms = 3200, action: { label, onClick } })
 * Newest on top, four at most. Click to dismiss; hover or focus pauses the timer. ms 0 stays.
 * Returns { el, close() }.
 */
export function toast(text, { kind = "info", icon: iconName = null, ms = 3200, action = null } = {}) {
  const stack = toastStack();
  /* The same words already on screen are not said again underneath: four presses that each
     came back "Sign in again first" are one toast held a little longer, not four stacked. */
  const key = typeof text === "string" && !action ? `${kind}|${text}` : null;
  if (key) {
    const same = Array.from(stack.children).find((c) => c._toast && c._toast.key === key && !c.classList.contains("is-leaving"));
    if (same) {
      same._toast.again();
      return { el: same, close: same._toast.close };
    }
  }
  let remaining = Math.max(0, Number(ms) || 0);
  let started = 0;
  let timer = 0;
  let leaving = false;

  const node = h("div.toast", { "data-kind": kind, role: kind === "bad" ? "alert" : null },
    h("span.toast-ico", { html: icon(iconName || TOAST_ICONS[kind] || "info") }),
    h("div.toast-text", text),
    action ? h("button.toast-action", {
      type: "button",
      onClick: (e) => {
        e.stopPropagation();
        try { action.onClick && action.onClick(); } finally { dismiss(); }
      },
    }, action.label) : null,
    remaining > 0 ? h("span.toast-timer", { style: { animationDuration: remaining + "ms" }, "aria-hidden": "true" }) : null);

  function dismiss() {
    if (leaving) return;
    leaving = true;
    liveToasts.delete(control);
    clearTimeout(timer);
    if (reducedMotion()) {
      node.remove();
      return;
    }
    node.classList.add("is-leaving");
    setTimeout(() => node.remove(), 170);
  }

  function run() {
    if (remaining <= 0 || leaving) return;
    started = performance.now();
    timer = setTimeout(dismiss, remaining);
    node.classList.remove("is-paused");
  }

  function pause() {
    if (remaining <= 0 || leaving || node.classList.contains("is-paused")) return;
    clearTimeout(timer);
    remaining = Math.max(400, remaining - (performance.now() - started));
    node.classList.add("is-paused");
  }

  // Said again while still up: the clock starts over, and the bar with it.
  function again() {
    if (leaving || !(Number(ms) > 0)) return;
    clearTimeout(timer);
    remaining = Math.max(0, Number(ms) || 0);
    const bar = node.querySelector(".toast-timer");
    if (bar) bar.replaceWith(h("span.toast-timer", { style: { animationDuration: remaining + "ms" }, "aria-hidden": "true" }));
    if (stackHeld) {
      started = performance.now();
      node.classList.add("is-paused");
    } else {
      run();
    }
  }

  const control = { pause, resume: run };
  liveToasts.add(control);
  node.addEventListener("click", dismiss);

  stack.prepend(node);
  const live = Array.from(stack.children).filter((c) => !c.classList.contains("is-leaving"));
  live.slice(MAX_TOASTS).forEach((old) => {
    if (old._toast) old._toast.close();
    old.remove();
  });
  node._toast = { close: dismiss, key, again };

  if (stackHeld) {
    started = performance.now();
    node.classList.add("is-paused");
  } else {
    run();
  }
  return { el: node, close: dismiss };
}

/* ================= 5. TOOLTIPS ================= */

const tipState = {
  el: null,
  content: null,
  arrow: null,
  anchor: null,
  source: null,
  showTimer: 0,
  hideTimer: 0,
  frame: 0,
};

const bound = new WeakMap();   // anchor -> { content, placement }
let tipsBound = false;
let lastPointer = { type: "mouse", at: 0 };

function tipLayer() {
  let layer = document.getElementById("tipLayer");
  if (!layer) {
    layer = h("div#tipLayer");
    document.body.appendChild(layer);
  }
  layer.classList.add("tip-layer");
  if (!tipState.el) {
    tipState.content = h("div.tip-inner");
    tipState.arrow = h("span.tip-arrow", { "aria-hidden": "true" });
    tipState.el = h("div.tip#tip", { role: "tooltip", "data-side": "top" }, tipState.content, tipState.arrow);
    layer.appendChild(tipState.el);
  } else if (!tipState.el.isConnected) {
    layer.appendChild(tipState.el);
  }
  return tipState.el;
}

function tipConfig(anchor) {
  if (bound.has(anchor)) return bound.get(anchor);
  if (anchor.hasAttribute("data-tip")) {
    return { content: anchor.getAttribute("data-tip"), placement: anchor.getAttribute("data-tip-placement") || "top" };
  }
  return null;
}

const anchorOf = (target) => (target instanceof Element ? target.closest("[data-tip], [data-tip-bound]") : null);

function renderTip(anchor) {
  const cfg = tipConfig(anchor);
  if (!cfg) return false;
  let content = typeof cfg.content === "function" ? cfg.content(anchor) : cfg.content;
  if (content == null || content === "") return false;
  tipLayer();
  tipState.content.replaceChildren();
  const rich = typeof content !== "string" && typeof content !== "number";
  if (rich) tipState.content.appendChild(content);
  else tipState.content.textContent = String(content);
  tipState.el.classList.toggle("is-rich", rich);
  tipState.el.dataset.placement = cfg.placement || "top";
  return true;
}

function placeTip() {
  const anchor = tipState.anchor;
  const tip = tipState.el;
  if (!anchor || !tip) return;
  if (!anchor.isConnected || anchor.closest("[hidden]")) {
    hideTip();
    return;
  }

  const a = anchor.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  if (a.bottom < 0 || a.top > vh || a.right < 0 || a.left > vw) {
    hideTip();
    return;
  }

  const MARGIN = 8;
  const GAP = 10;
  const t = { width: tip.offsetWidth, height: tip.offsetHeight };
  const room = {
    top: a.top - MARGIN,
    bottom: vh - a.bottom - MARGIN,
    left: a.left - MARGIN,
    right: vw - a.right - MARGIN,
  };

  let side = tip.dataset.placement || "top";
  const need = (s) => (s === "top" || s === "bottom" ? t.height : t.width) + GAP;
  if (room[side] < need(side)) {
    const opposite = { top: "bottom", bottom: "top", left: "right", right: "left" }[side];
    if (room[opposite] >= need(opposite)) side = opposite;
    else side = room.bottom >= room.top ? "bottom" : "top";
  }

  let x;
  let y;
  if (side === "top" || side === "bottom") {
    x = a.left + a.width / 2 - t.width / 2;
    y = side === "top" ? a.top - GAP - t.height : a.bottom + GAP;
  } else {
    x = side === "left" ? a.left - GAP - t.width : a.right + GAP;
    y = a.top + a.height / 2 - t.height / 2;
  }
  x = Math.max(MARGIN, Math.min(x, vw - MARGIN - t.width));
  y = Math.max(MARGIN, Math.min(y, vh - MARGIN - t.height));

  tip.style.left = Math.round(x) + "px";
  tip.style.top = Math.round(y) + "px";
  tip.dataset.side = side;

  const arrow = tipState.arrow;
  if (side === "top" || side === "bottom") {
    const ax = Math.max(12, Math.min(a.left + a.width / 2 - x - 5, t.width - 22));
    arrow.style.left = Math.round(ax) + "px";
    arrow.style.top = "";
  } else {
    const ay = Math.max(10, Math.min(a.top + a.height / 2 - y - 5, t.height - 20));
    arrow.style.top = Math.round(ay) + "px";
    arrow.style.left = "";
  }
}

function onViewportChange() {
  if (!tipState.anchor || tipState.frame) return;
  tipState.frame = requestAnimationFrame(() => {
    tipState.frame = 0;
    placeTip();
  });
}

function describe(anchor, on) {
  const ids = (anchor.getAttribute("aria-describedby") || "").split(/\s+/).filter((x) => x && x !== "tip");
  if (on) ids.push("tip");
  if (ids.length) anchor.setAttribute("aria-describedby", ids.join(" "));
  else anchor.removeAttribute("aria-describedby");
  if (on) anchor.setAttribute("data-tip-open", "");
  else anchor.removeAttribute("data-tip-open");
}

function showTip(anchor, source) {
  clearTimeout(tipState.showTimer);
  clearTimeout(tipState.hideTimer);
  if (tipState.anchor && tipState.anchor !== anchor) describe(tipState.anchor, false);
  if (!renderTip(anchor)) return;

  tipState.anchor = anchor;
  tipState.source = source;
  describe(anchor, true);

  const tip = tipState.el;
  tip.style.left = "0px";
  tip.style.top = "0px";
  placeTip();
  if (!tipState.anchor) return;
  tip.classList.add("is-open");

  window.addEventListener("scroll", onViewportChange, true);
  window.addEventListener("resize", onViewportChange);
}

function hideTip() {
  clearTimeout(tipState.showTimer);
  clearTimeout(tipState.hideTimer);
  if (tipState.anchor) describe(tipState.anchor, false);
  tipState.anchor = null;
  tipState.source = null;
  if (tipState.el) tipState.el.classList.remove("is-open");
  window.removeEventListener("scroll", onViewportChange, true);
  window.removeEventListener("resize", onViewportChange);
}

function bindTips() {
  if (tipsBound || typeof document === "undefined") return;
  tipsBound = true;
  bindKeys();

  const touchy = () => lastPointer.type !== "mouse" && performance.now() - lastPointer.at < 900;

  document.addEventListener("pointerdown", (e) => {
    lastPointer = { type: e.pointerType || "mouse", at: performance.now() };
  }, true);

  // Mouse: hover shows after a beat, instantly if a tip is already up.
  document.addEventListener("pointerover", (e) => {
    if (e.pointerType !== "mouse") return;
    const anchor = anchorOf(e.target);
    if (!anchor) return;
    if (tipState.anchor === anchor) {
      clearTimeout(tipState.hideTimer);
      return;
    }
    clearTimeout(tipState.showTimer);
    const delay = tipState.anchor ? 0 : 140;
    tipState.showTimer = setTimeout(() => showTip(anchor, "hover"), delay);
  });

  document.addEventListener("pointerout", (e) => {
    if (e.pointerType !== "mouse") return;
    const anchor = anchorOf(e.target);
    if (!anchor) return;
    if (e.relatedTarget instanceof Node && anchor.contains(e.relatedTarget)) return;
    clearTimeout(tipState.showTimer);
    if (tipState.anchor === anchor && tipState.source === "hover") {
      tipState.hideTimer = setTimeout(hideTip, 90);
    }
  });

  // Keyboard: focus shows, blur hides.
  document.addEventListener("focusin", (e) => {
    const anchor = anchorOf(e.target);
    if (!anchor || touchy()) return;
    let visible = true;
    try { visible = anchor.matches(":focus-visible") || e.target.matches(":focus-visible"); } catch (_) { /* old engines */ }
    if (visible) showTip(anchor, "focus");
  });

  document.addEventListener("focusout", (e) => {
    const anchor = anchorOf(e.target);
    if (anchor && tipState.anchor === anchor && tipState.source === "focus") hideTip();
  });

  // Touch: a tap toggles, a tap anywhere else closes.
  document.addEventListener("click", (e) => {
    let anchor = anchorOf(e.target);
    if (anchor && anchor.getAttribute("data-tip-touch") === "off") anchor = null;
    if (touchy()) {
      if (anchor) {
        if (tipState.anchor === anchor) hideTip();
        else showTip(anchor, "tap");
      } else if (tipState.anchor) {
        hideTip();
      }
      return;
    }
    if (!anchor && tipState.anchor && tipState.source !== "hover") hideTip();
  }, true);
}

/**
 * tooltip(anchor, content, { placement: "top"|"bottom"|"left"|"right" })
 * content: a string, a Node, or a function returning one (called each time it opens).
 * Returns { update(content), show(), hide(), destroy() }.
 * Plain text needs no call at all: give any element data-tip="..." (and data-tip-placement).
 * data-tip-touch="off" keeps a tap on touch screens for the element's own action only.
 */
export function tooltip(anchor, content, { placement = "top" } = {}) {
  bindTips();
  bound.set(anchor, { content, placement });
  anchor.setAttribute("data-tip-bound", "");
  return {
    update(next) {
      const cfg = bound.get(anchor);
      if (!cfg) return;
      cfg.content = next;
      if (tipState.anchor === anchor && renderTip(anchor)) placeTip();
    },
    show() { showTip(anchor, "api"); },
    hide() { if (tipState.anchor === anchor) hideTip(); },
    destroy() {
      bound.delete(anchor);
      anchor.removeAttribute("data-tip-bound");
      if (tipState.anchor === anchor) hideTip();
    },
  };
}

export { hideTip };

// Closes every open dialog, newest first. For route changes.
export function closeModals(reason = "route") {
  for (const l of layers.slice().reverse()) {
    if (l.kind === "modal") l.close(reason);
  }
}

/**
 * tipBody({ title, sub, text, rows: [[label, value, tone]], list: [..], table: { head, rows }, foot, footTone })
 * Builds the standard rich tooltip content. tone is "good"|"bad"|"gold".
 */
export function tipBody({ title, sub, text, rows, list, table, track, foot, footTone } = {}) {
  const box = h("div.tip-body-wrap");
  if (title) box.appendChild(h("div.tip-title", title));
  if (sub) box.appendChild(h("div.tip-sub", sub));
  if (text) box.appendChild(h("p.tip-text", text));
  if (list && list.length) box.appendChild(h("ul.tip-list", list.map((li) => h("li", li))));
  if (rows && rows.length) {
    box.appendChild(h("div.tip-rows", rows.map(([l, v, tone]) =>
      h("div.tip-row", h("span.l", l), h("span.v", { class: tone && `t-${tone}` }, v)))));
  }
  if (track && track.length) {
    box.appendChild(h("div.tip-track", track.map((s) =>
      h("div.tip-step", { class: [s.done && "is-done", s.next && "is-next"] },
        h("span.g", s.done ? iconEl("check") : null),
        h("span.lv", s.at),
        h("span.name", s.label),
        h("span.v", s.value)))));
  }
  if (table) {
    box.appendChild(h("table.tip-table",
      h("thead", h("tr", table.head.map((c) => h("th", c)))),
      h("tbody", table.rows.map((r) => h("tr", { class: r.className },
        r.cells.map((c, i) => h("td", i === 0 && r.rarity ? h("span", { class: `rar-${r.rarity}` }, c) : c)))))));
  }
  if (foot) box.appendChild(h("div.tip-foot", { class: footTone && `t-${footTone}` }, foot));
  return box;
}

/* ================= 6. THE DRAWER ================= */

/**
 * bindDrawer({ app, sidebar, menu, closeButton, backdrop, query })
 * Wires the shell's navigation drawer for phones and tablets. Defaults to the
 * index.html ids. Returns { open(), close(), toggle(), isOpen() }.
 */
export function bindDrawer({
  app = document.getElementById("app"),
  sidebar = document.getElementById("sidebar"),
  menu = document.getElementById("tbMenu"),
  closeButton = document.getElementById("drawerClose"),
  backdrop = document.getElementById("drawerBackdrop"),
  query = "(max-width: 1023px)",
} = {}) {
  bindKeys();
  if (!app || !sidebar) return null;

  const mq = media(query);
  let open = false;
  let opener = null;
  let hideTimer = 0;

  const layer = {
    kind: "drawer",
    root: sidebar,
    focusRoot: sidebar,
    keep: backdrop ? [backdrop] : null,
    dismissible: true,
    close: () => set(false),
  };

  function set(next, instant) {
    const want = !!next && mq.matches;
    if (want === open) return;
    open = want;
    clearTimeout(hideTimer);

    if (open) {
      opener = document.activeElement;
      if (backdrop) backdrop.hidden = false;
      void sidebar.offsetWidth;
      app.dataset.drawer = "open";
      sidebar.setAttribute("tabindex", "-1");
      sidebar.setAttribute("role", "dialog");
      sidebar.setAttribute("aria-modal", "true");
      pushLayer(layer);
      const current = sidebar.querySelector("[aria-current='page'], .is-active");
      const first = current || focusables(sidebar)[0] || sidebar;
      first.focus({ preventScroll: true });
    } else {
      app.dataset.drawer = "closed";
      sidebar.removeAttribute("role");
      sidebar.removeAttribute("aria-modal");
      dropLayer(layer);
      if (backdrop) {
        if (instant || reducedMotion()) backdrop.hidden = true;
        else hideTimer = setTimeout(() => { backdrop.hidden = true; }, 280);
      }
      restoreFocus(opener || menu);
      opener = null;
    }
    if (menu) menu.setAttribute("aria-expanded", String(open));
  }

  if (menu) menu.addEventListener("click", () => set(!open));
  if (closeButton) closeButton.addEventListener("click", () => set(false));
  if (backdrop) backdrop.addEventListener("click", () => set(false));

  // Choosing a page closes the drawer.
  sidebar.addEventListener("click", (e) => {
    if (open && e.target instanceof Element && e.target.closest("a[href]")) set(false);
  });

  const onChange = () => { if (!mq.matches && open) set(false, true); };
  if (mq.addEventListener) mq.addEventListener("change", onChange);

  return {
    open: () => set(true),
    close: () => set(false),
    toggle: () => set(!open),
    isOpen: () => open,
  };
}

/* Plain data-tip works the moment this module loads. */
if (typeof document !== "undefined") bindTips();
