/* ============================================================
   Respite · dropdown.js · A List the Game Draws
   ------------------------------------------------------------
   A native <select> hands its list to the operating system, which
   draws it in the operating system's colours, at the operating
   system's size, in a font the game never picked. Every other
   surface in Respite is bone on a dark ground; the one that opens
   on a tap is a white sheet. So the game draws its own.

   The shape is a select's, deliberately: `.value` reads and
   writes, `onChange` fires when the reader picks something, and
   `fill` takes the same groups-and-options an <optgroup> would.
   A call site swaps one for the other and changes almost nothing.

   The panel is fixed to the viewport rather than sitting inside
   the field, because the field is often in a modal body that
   scrolls and would clip it. That costs a reposition on scroll
   and resize, and buys a list that opens anywhere.
   ============================================================ */

import { h, setText, setAttr } from "./dom.js";
import { iconEl } from "./icons.js";

const GAP = 6;          // between the field and its panel
const EDGE = 10;        // never nearer the viewport edge than this
const MIN_PANEL = 140;  // below this there is no room, so the panel flips

let openOne = null;     // only one list is ever open
let seq = 0;            // ids, so aria-activedescendant has something to point at

// Every option, in order, out of the groups: the arrow keys walk this.
const flatten = (groups) => groups.flatMap((g) => g.options || []);

/* groups: [{ label, options: [{ value, label, note, disabled }] }]
   A group with no label draws no heading, which is the ungrouped case. */
export function dropdown({ groups = [], value = null, label = "", id = null, className = "", onChange = null } = {}) {
  const uid = `drop${++seq}`;
  const current = h("span.drop-current");
  const btn = h("button.drop-btn", {
    type: "button",
    id: id || null,
    role: "combobox",
    "aria-haspopup": "listbox",
    "aria-expanded": false,
    "aria-label": label || null,
  }, current, iconEl("chevron-down"));

  const list = h("div.drop-list", { role: "listbox", "aria-label": label || null });
  const panel = h("div.drop-panel", { hidden: true }, list);
  const node = h("div.drop", { class: className || null }, btn);

  let all = [];
  let fire = onChange;   // settable after the fact, so a call site can wire it later
  let picked = null;
  let open = false;
  let marked = -1;    // which option the keyboard is on
  let cells = [];

  const optAt = (i) => (i >= 0 && i < all.length ? all[i] : null);
  const indexOf = (v) => all.findIndex((o) => String(o.value) === String(v));

  function paintFace() {
    const o = all[indexOf(picked)];
    setText(current, o ? o.label : "");
    setAttr(btn, "data-empty", o ? null : "");
  }

  /* The panel is built once a list is opened, not on every fill: a page that
     fills four dropdowns it never opens should build four buttons, not four lists. */
  function build() {
    cells = [];
    const kids = [];
    groups.forEach((g) => {
      if (g.label) kids.push(h("div.drop-group", g.label));
      (g.options || []).forEach((o) => {
        const i = all.indexOf(o);
        const cell = h("button.drop-opt", {
          type: "button",
          id: `${uid}-o${i}`,
          role: "option",
          disabled: !!o.disabled,
          "aria-selected": String(String(o.value) === String(picked)),
          "data-value": String(o.value),
        }, h("span.drop-opt-label", o.label), o.note ? h("span.drop-opt-note", o.note) : null);
        cell.addEventListener("click", () => { if (!o.disabled) choose(o.value); });
        cell.addEventListener("mousemove", () => mark(i, false));
        cells[i] = cell;
        kids.push(cell);
      });
    });
    list.replaceChildren(...kids);
  }

  function mark(i, scroll = true) {
    if (i === marked) return;
    const was = cells[marked];
    if (was) was.classList.remove("is-on");
    marked = i;
    const now = cells[i];
    if (!now) return;
    now.classList.add("is-on");
    setAttr(btn, "aria-activedescendant", now.id);
    if (scroll) now.scrollIntoView({ block: "nearest" });
  }

  // Put the panel under the field, or over it when the bottom of the screen is closer.
  function place() {
    const r = btn.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - GAP - EDGE;
    const above = r.top - GAP - EDGE;
    const up = below < MIN_PANEL && above > below;
    panel.style.left = `${Math.round(r.left)}px`;
    panel.style.width = `${Math.round(r.width)}px`;
    panel.style.maxHeight = `${Math.round(Math.max(MIN_PANEL, up ? above : below))}px`;
    if (up) {
      panel.style.top = "auto";
      panel.style.bottom = `${Math.round(window.innerHeight - r.top + GAP)}px`;
    } else {
      panel.style.bottom = "auto";
      panel.style.top = `${Math.round(r.bottom + GAP)}px`;
    }
  }

  function onDocDown(e) {
    if (!panel.contains(e.target) && !node.contains(e.target)) close();
  }
  const onScroll = (e) => { if (panel.contains(e.target)) return; place(); };
  const onResize = () => place();

  function show() {
    if (open || !all.length) return;
    if (openOne && openOne !== close) openOne();
    open = true;
    build();
    document.body.appendChild(panel);
    panel.hidden = false;
    place();
    setAttr(btn, "aria-expanded", "true");
    btn.classList.add("is-open");
    marked = -1;
    mark(Math.max(0, indexOf(picked)));
    document.addEventListener("pointerdown", onDocDown, true);
    window.addEventListener("keydown", onKeys, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    openOne = close;
  }

  function close({ focus = false } = {}) {
    if (!open) return;
    open = false;
    panel.hidden = true;
    panel.remove();
    setAttr(btn, "aria-expanded", "false");
    btn.classList.remove("is-open");
    document.removeEventListener("pointerdown", onDocDown, true);
    window.removeEventListener("keydown", onKeys, true);
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onResize);
    setAttr(btn, "aria-activedescendant", null);
    if (openOne === close) openOne = null;
    if (focus) btn.focus();
  }

  function choose(v, { quiet = false } = {}) {
    const was = picked;
    picked = String(v);
    paintFace();
    close({ focus: true });
    if (!quiet && String(was) !== picked && typeof fire === "function") fire(picked);
  }

  btn.addEventListener("click", () => (open ? close() : show()));

  btn.addEventListener("keydown", (e) => {
    if (open) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      show();
    }
  });

  /* An open list owns the keyboard. A modal takes Escape on document in the capture
     phase, and capture runs window first, so this is on window: Escape shuts the list
     the reader opened, not the dialog underneath it. */
  function onKeys(e) {
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close({ focus: true });
      return;
    }
    if (e.key === "Tab") { close(); return; }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      const o = optAt(marked);
      if (o && !o.disabled) choose(o.value);
      return;
    }
    // The arrows walk past anything that cannot be picked rather than stopping on it.
    const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (step) {
      e.preventDefault();
      e.stopPropagation();
      let i = marked;
      for (let n = 0; n < all.length; n += 1) {
        i = (i + step + all.length) % all.length;
        if (!all[i].disabled) break;
      }
      mark(i);
      return;
    }
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      e.stopPropagation();
      mark(e.key === "Home" ? 0 : all.length - 1);
    }
  }

  const api = {
    node,
    button: btn,
    get value() { return picked; },
    set value(v) { setValue(v); },
    get onChange() { return fire; },
    set onChange(fn) { fire = fn; },
    // Quiet by design: a call site setting a value is not the reader picking one.
    set: setValue,
    fill(next, v) {
      groups = Array.isArray(next) ? next : [];
      all = flatten(groups);
      const want = v !== undefined ? v : picked;
      picked = indexOf(want) >= 0 ? String(want) : all.length ? String(all[0].value) : null;
      if (open) { build(); mark(Math.max(0, indexOf(picked))); }
      paintFace();
      return api;
    },
    close: () => close(),
    destroy() { close(); },
  };

  /* A repaint writing back the value it already holds must not shut a list the
     reader has open, so an unchanged write does nothing at all. */
  function setValue(v) {
    if (indexOf(v) < 0 || String(v) === String(picked)) return;
    choose(v, { quiet: true });
  }

  api.fill(groups, value);
  return api;
}

/* The everyday case: one flat list of options, no headings. */
export const dropdownOf = (options, opts = {}) => dropdown({ ...opts, groups: [{ label: null, options }] });
