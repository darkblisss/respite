/* ============================================================
   Respite · dom.js · The Hands
   ------------------------------------------------------------
   Building and touching the page. No game logic and no state:
   every helper here takes nodes and values and nothing else.

   Rendering rule, as in v4: build a thing once, then update the
   parts that move in place (setText, setWidth, toggleClass).
   These writers only touch the DOM when the value changed, so
   calling them several times a second costs next to nothing.
   ============================================================ */

const SVG_NS = "http://www.w3.org/2000/svg";

const SVG_TAGS = new Set([
  "svg", "g", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon",
  "defs", "linearGradient", "radialGradient", "stop", "use", "symbol", "clipPath",
  "mask", "pattern", "filter", "text", "tspan", "title", "desc",
]);

// Set as properties, not attributes, so they reflect live state.
const PROPS = new Set(["value", "checked", "selected", "indeterminate", "muted", "volume", "currentTime"]);

/* ================= 1. BUILDING ================= */

/**
 * Hyperscript. h("button.btn.btn-primary#go", { onClick, disabled: busy }, "Forge")
 *
 * tag      "div", or with shorthand: "span.chip.chip-good", "input#acctUser".
 * props    optional. class / className (string, array or {name: bool}),
 *          data-* keys or dataset: {}, on<Event> handlers, style (object
 *          or string, --custom properties allowed), aria-* and any other
 *          attribute. true sets a boolean attribute, false / null /
 *          undefined leave it out. ref: (node) => {} hands you the node.
 * children strings and numbers become text; arrays flatten; Nodes are
 *          appended; null, false, true and undefined are skipped.
 */
export function h(tag, props, ...children) {
  if (props != null && (typeof props !== "object" || Array.isArray(props) || isNode(props))) {
    children.unshift(props);
    props = null;
  }

  const { name, id, classes } = parseTag(tag);
  const node = SVG_TAGS.has(name) ? document.createElementNS(SVG_NS, name) : document.createElement(name);
  if (id) node.id = id;
  if (classes.length) setClass(node, classes);

  // value, checked and selected go on last: a <select> can only take a value once its options exist.
  const late = props ? applyProps(node, props) : null;
  append(node, children);
  if (late) for (const [key, value] of late) node[key] = value;
  return node;
}

function parseTag(tag) {
  const parts = String(tag || "div").split(/(?=[.#])/);
  let name = "div";
  let id = "";
  const classes = [];
  for (const p of parts) {
    if (p[0] === ".") classes.push(p.slice(1));
    else if (p[0] === "#") id = p.slice(1);
    else if (p) name = p;
  }
  return { name, id, classes };
}

function isNode(v) {
  return typeof Node !== "undefined" && v instanceof Node;
}

// Turns "btn", ["btn", cond && "on"] or { btn: true, on: false } into a class list.
function classList(value, out = []) {
  if (!value) return out;
  if (typeof value === "string") {
    for (const c of value.split(/\s+/)) if (c) out.push(c);
  } else if (Array.isArray(value)) {
    for (const v of value) classList(v, out);
  } else if (typeof value === "object") {
    for (const k of Object.keys(value)) if (value[k]) classList(k, out);
  }
  return out;
}

function setClass(node, list) {
  const value = list.join(" ");
  // SVG elements have a read-only className object; the attribute works everywhere.
  node.setAttribute("class", value);
}

function applyProps(node, props) {
  let late = null;
  for (const key of Object.keys(props)) {
    const value = props[key];

    if (key === "class" || key === "className") {
      const extra = classList(value);
      if (extra.length) setClass(node, classList(node.getAttribute("class") || "").concat(extra));
      continue;
    }

    if (key === "style") {
      if (typeof value === "string") node.setAttribute("style", value);
      else if (value && typeof value === "object") {
        for (const s of Object.keys(value)) {
          const v = value[s];
          if (v == null || v === false) continue;
          if (s.startsWith("--") || s.includes("-")) node.style.setProperty(s, String(v));
          else node.style[s] = v;
        }
      }
      continue;
    }

    if (key === "dataset") {
      if (value && typeof value === "object") {
        for (const d of Object.keys(value)) {
          if (value[d] != null && value[d] !== false) node.dataset[d] = value[d] === true ? "" : String(value[d]);
        }
      }
      continue;
    }

    if (key === "ref") {
      if (typeof value === "function") value(node);
      continue;
    }

    if (key.length > 2 && key[0] === "o" && key[1] === "n" && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
      continue;
    }

    if (PROPS.has(key) && key in node) {
      if (value !== undefined) (late || (late = [])).push([key, value]);
      continue;
    }

    if (key === "html") {
      // Icon SVG strings only. Never pass player text here.
      if (value != null) node.appendChild(html(value));
      continue;
    }

    // aria-expanded="false" means something, so ARIA booleans are always written out.
    if (key.startsWith("aria-") && typeof value === "boolean") {
      node.setAttribute(key, String(value));
      continue;
    }

    if (value == null || value === false) continue;
    const attr = key === "htmlFor" ? "for" : key;
    node.setAttribute(attr, value === true ? "" : String(value));
  }
  return late;
}

function append(node, children) {
  for (const child of children) {
    if (child == null || child === false || child === true) continue;
    if (Array.isArray(child)) append(node, child);
    else if (isNode(child)) node.appendChild(child);
    else node.appendChild(document.createTextNode(String(child)));
  }
}

/**
 * html('<svg ...>...</svg>') -> DocumentFragment. For icon and scene SVG
 * strings built in code. Never for anything a player typed.
 */
export function html(markup) {
  const t = document.createElement("template");
  t.innerHTML = String(markup);
  return t.content;
}

/* ================= 2. FINDING ================= */

export const el = (id) => document.getElementById(id);

export const qs = (sel, root = document) => root.querySelector(sel);

export const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ================= 3. UPDATING IN PLACE ================= */

// Writes only when the text actually changes.
export function setText(node, text) {
  if (!node) return;
  const value = text == null ? "" : String(text);
  if (node.textContent !== value) node.textContent = value;
}

// A bar's fill, 0 to 100. Writes only when the rounded width changes.
export function setWidth(node, pct) {
  if (!node) return;
  const n = Number(pct);
  const v = Number.isFinite(n) ? Math.round(Math.min(100, Math.max(0, n)) * 100) / 100 : 0;
  const value = v + "%";
  if (node.style.width !== value) node.style.width = value;
}

// An attribute, written only on change. null or false removes it; true sets it empty.
export function setAttr(node, name, value) {
  if (!node) return;
  if (value == null || value === false) {
    if (node.hasAttribute(name)) node.removeAttribute(name);
    return;
  }
  const v = value === true ? "" : String(value);
  if (node.getAttribute(name) !== v) node.setAttribute(name, v);
}

export function toggleClass(node, cls, on) {
  if (!node) return;
  const want = on === undefined ? !node.classList.contains(cls) : !!on;
  if (node.classList.contains(cls) !== want) node.classList.toggle(cls, want);
}

export function clear(node) {
  if (node) node.replaceChildren();
}

/* ================= 4. EVENTS ================= */

/**
 * Delegation: one listener on root for every current and future match.
 * handler(event, matched). Returns a function that removes the listener.
 * Use bubbling events (click, input, change, keydown, focusin, pointerover).
 */
export function on(root, type, selector, handler, options) {
  const listener = (e) => {
    const start = e.target instanceof Element ? e.target : e.target && e.target.parentElement;
    const match = start && start.closest(selector);
    if (match && root.contains(match)) handler(e, match);
  };
  root.addEventListener(type, listener, options);
  return () => root.removeEventListener(type, listener, options);
}
