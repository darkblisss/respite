# Respite v5 UI Kit

The contract for page authors. Build every page from what is written here: the shell in `index.html`, the stylesheets in `css/`, and the helpers in `src/client/ui/`. If something you need is not here, add it to the kit (components.css or pages.css, and this file) instead of styling it inline.

**The direction (Sept 2026): a field ledger laid over a dark scene.** The UI has two registers and nothing else. *The scene* is where something is happening (the hunt's field, the camp under a gathering page, a region's vista): full bleed, no frame, figures standing on ground, state written as type. *The ledger* is where things are listed: hairline rules, inked names, small-caps labels, tabular figures. There are no cards, pills, icon tiles or glossy gradients. The materials are soot, ash, bone, tanned leather and iron; violet belongs to the Veil alone and ember to danger alone. Class names from the card era are kept (`.card`, `.item-pill`, `.chip`, `.art`) because every page is built from them; what they draw has changed.

The living style guide draws every component with the real CSS and helpers:

- `dev/kit.html`: the gallery (tokens, icons, every component and state, working dialogs, toasts and tooltips).
- `dev/kit.html?page=<name>`: one page mock inside the real shell. Names: `character`, `gather`, `bench`, `storage`, `armaments`, `hunt`, `atlas`, `shop`, `bounties`, `requisitions`, `companions`, `sky`, `market`, `party`, `hiscores`, `states`.
- Extra query flags for page mode: `&modal=action|item|stack|sell|settings|account|class|buy|short|reset|huntZone|foe`, `&bench=idle|working|crafting`, `&hunt=idle|hunting|recovering|hiding`, `&conn=online|syncing|offline|guest`, `&drawer=open`, `&shot=1` (freezes motion, hides the kit switcher).

ES modules need HTTP: `cd repo && python3 -m http.server 8765`, then open `http://127.0.0.1:8765/dev/kit.html`. The kit sets `<base href="../">`, so every path in it is relative to the repo root, the same as in `index.html`. `dev/kit.js` is also a working reference for page code: most snippets below are lifted from it.

---

## Contents

1. Ground rules
2. Files and imports
3. Tokens
4. Breakpoints and responsive rules
5. The shell (mount ids, topbar, sidebar, drawer)
6. Helpers: dom.js, icons.js, overlay.js, format.js
7. Components
8. Page recipes
9. Content rules
10. Accessibility checklist
11. Decisions page authors must know

---

## 1. Ground rules

1. **Colour has a job.** Bone is the ink, focus, the current page and the one plain decision on a surface. Tan is the bench and the crews: work under way. Ember is danger and damage and nothing else: foe health, low health, a fall, the road down into the Core. Veil (violet) is the Veil and nothing else: charge, techniques, disciplines, Sovereigns. Gold is money. Green (`good`) is your health, gains and online. Never pick an accent for looks, and never use ember or violet as decoration: they only mean something while they are rare.
2. **One solid plate per surface**, for the thing the surface is for (Forge, Hunt the Inner, Buy for 700g). Repeated actions in lists use the soft variant (`.btn-soft`). Everything else is an outline or quiet.
3. **Nothing is boxed unless it floats or holds things.** A dialog, a tooltip and a toast float, so they have an edge. A slot and a form field are places you put things, so they have one too. Everything else is a rule above it and space around it: a `.card` is a ruled section, not a panel, and nothing is ever nested in a second container. Group inside a section with `.list`, `.stats`, `.divider`, a `.kpis` line or a `.well` (a marginal note).
3a. **Data is written, not badged.** A chip is words in a tone; a tag is a word in small caps. Neither has a border or a fill. A glyph stands bare: `.art` has no tile behind it.
3b. **Names are inked, figures are set.** Names, titles and the state of a fight use the display face. Anything that counts uses the UI face with lining tabular figures (`.num`, or `font-variant-numeric: var(--figures)`). Labels are true small caps (`.eyebrow`), never capitals.
4. **Card grids show three across at most** (`.grid-cards`). The storage slot grid is the one exception: five across (four on narrow phones).
5. **Gathering nodes and recipes are one full-width ruled entry each** (`.item-pill`), never small tiles in a grid.
6. **Features that are not open are not rendered at all**: no nav row, no teaser, no locked tier beyond the next one. Do not hide them with CSS; do not build them.
7. **Every gold spend goes through `confirm({ cost })`**: Bonesetter, Smuggler, Atlas tolls, companions, agent hire, market buys.
8. **No inline styles** except a bar fill width (use `setWidth`). Everything else is a class or a `data-tone` / `data-rarity` attribute. A new look is a new class in the kit.
9. **Build once, update in place.** Anything that moves several times a second (bars, counts, timers) is updated with `setText`, `setWidth`, `setAttr` and `toggleClass`, which only touch the DOM when the value changed. Rebuild a subtree only when its shape changes.
10. **No em dash, no en dash, no infinity sign**, on screen or in source. Unlimited reads "No limit". See section 9.

---

## 2. Files and imports

### Stylesheets (order matters)

```html
<link rel="stylesheet" href="css/tokens.css">      <!-- custom properties only, dark only -->
<link rel="stylesheet" href="css/base.css">        <!-- reset, type styles, utilities -->
<link rel="stylesheet" href="css/components.css">  <!-- everything reusable -->
<link rel="stylesheet" href="css/layout.css">      <!-- the shell: topbar, sidebar, drawer; wins over components -->
<link rel="stylesheet" href="css/pages.css">       <!-- one page only: arena, paperdoll, atlas, market, party... -->
```

Fonts, from Google Fonts: IM Fell English, roman and italic (display: an inked, letterpress face with one weight, so display rules say `font-weight: 400` and let size do the work) and Alegreya Sans 400/500/700 plus 400 italic (UI). A third link loads ten glyphs of EB Garamond 500, the figures 0 to 9 (`&text=0123456789`): the Fell type has only old-style figures and its 1 reads as an I, so `--font-display` opens with EB Garamond, which catches every figure and lets every letter fall through. Keep the `text=` on that link or every heading turns Garamond. Fallbacks are Palatino, Georgia and Gill Sans or the system UI font, so the UI stays usable if fonts are blocked.

### Helper modules

From `src/client/main.js` the paths are `./ui/...`; from `src/client/pages/*.js` they are `../ui/...`.

```js
import { h, el, qs, qsa, setText, setWidth, setAttr, clear, on, toggleClass, html } from "../ui/dom.js";
import { ICONS, icon, iconEl } from "../ui/icons.js";
import { openModal, confirm, toast, tooltip, tipBody, hideTip, closeModals, bindDrawer } from "../ui/overlay.js";
import { clamp, fmt, fmtWhole, fmtGold, fmtTime, fmtStat, fmtAgo, signedPct, chancePct, fmtClock, titleCase, plural } from "../ui/format.js";
```

The UI helpers have no dependencies and no game logic. They never import engine modules (format.js re-exports `src/shared/format.js`, nothing else). Importing `confirm` shadows `window.confirm` inside your module, which is intended: never use the browser's dialogs.

---

## 3. Tokens

All in `css/tokens.css`. Use them through `var()`. Do not write raw colours in page CSS where a token fits.

### Surfaces and lines

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0d0c0a` | the page: soot (set on `html`; `body` is transparent over a fixed vignette and grain) |
| `--surface-1` | `#141210` | a sheet laid on the page: dialogs, the drawer, a filled slot |
| `--surface-2` | `#1b1815` | plates: a hovered slot, a select's options |
| `--surface-3` | `#25211b` | floating: tooltips, toasts |
| `--surface-sunk` | `#090807` | wells: inputs, the empty tray |
| `--scrim` | `rgba(5,4,3,.8)` | behind dialogs and the drawer |
| `--panel`, `--panel-raised`, `--panel-deep` | aliases of surface-1, surface-2, surface-sunk | v4 names, kept |
| `--line-soft` | bone at 7.5% | rules between rows |
| `--line` | bone at 13% | the rule above a section, field and slot edges |
| `--line-strong` | bone at 22% | outline buttons, dialogs, inputs |
| `--wash`, `--wash-strong` | bone at 4% and 7.5% | hover fills |

### Text

| Token | Value | Contrast on surface-3 | Use |
|---|---|---|---|
| `--bone` | `#e7e0d2` | 12:1 | names, numbers that matter, titles |
| `--bone-dim` | `#b8ae9d` | 7.3:1 | body copy, secondary values |
| `--bone-faint` | `#938a7a` | 4.7:1 | meta, captions, small-caps labels |
| `--bone-ghost` | `#5c554a` | 2.3:1 | decoration and disabled marks only, never for reading |
| `--on-accent` | `#14110d` | | text on solid bone, gold, ember |

### Accents

Each accent has a family. `-hi` is the readable text tone on dark surfaces; `-lo` and `-deep` are the dark ends of the family, for the rare toned ground (a toned surface reads `--tone-deep`); `-soft` is a tinted wash; `-edge` is a tinted rule.

| Family | Base | `-hi` | `-lo` | `-deep` | `-soft` | `-edge` |
|---|---|---|---|---|---|---|
| tan | `#b08a5b` | `#d2ae80` | `#6d5233` | `#231b12` | 13% | 42% |
| ember | `#cf5f2e` | `#ea8a5c` | `#7a3019` | `#26130c` | 13% | 45% |
| veil | `#a48ce8` | `#c8b8f8` | `#58458f` | `#1c1630` | 13% | 42% |
| gold | `#d2ad5a` | `#e8cd8a` | `#77602c` | `#241d10` | 12% | 40% |
| good | `#8fb08a` | `#b2d0ab` | `#46603f` | | 12% | 38% |
| warn | `#dba24f` | | | | 12% | 40% |
| bad | `--ember-hi` | | | | ember-soft | ember-edge |

There is no `--violet` family any more. What it coloured was split by meaning: work and "where you are" went to tan and bone, and the Veil kept the violet under its own name.

Also: `--focus` (bone), `--focus-ring`, `--hp`, `--hp-deep`, `--foe`, `--foe-deep`.

### Rarity

`--r-common #a9a294`, `--r-uncommon #8fb08a`, `--r-rare #7f9fcf`, `--r-epic #b18ad6`, `--r-legendary #d9b25e`, `--r-relic #dd7245`.

Any element with `data-rarity="common|uncommon|rare|epic|legendary|relic"` gets `--rar` (the colour) and `--rar-soft` (a tint; transparent for common). Components read these.

Any element with `data-tone="tan|ember|gold|good|veil"` gets `--tone`, `--tone-hi`, `--tone-soft`, `--tone-edge`, `--tone-deep`. These inherit: an `.art` glyph inside a `data-tone="ember"` section is ember unless the glyph sets its own `data-tone`. With no tone anywhere above it, a glyph is plain ink.

### Type

| Token | Size | Use |
|---|---|---|
| `--text-2xs` | 12px | the smallest figures: wear on a slot, a count in a corner |
| `--text-xs` | 13px | meta, timestamps |
| `--text-sm` | 14px | secondary copy, sub lines |
| `--text-md` | 15px | body (the default) |
| `--text-lg` | 17px | lead copy, the chronicle's italic voice |
| `--text-xl` | 21px | entry and row names (display) |
| `--text-2xl` | 27px | section and dialog titles (display) |
| `--text-3xl` | 38px | large titles (display) |
| `--text-4xl` | 54px | page titles, the state of a fight (display) |
| `--text-5xl` | 76px | a skill's masthead, the commander's name |
| `--caps-sm`, `--caps`, `--caps-lg` | 15, 16, 18px | small-caps labels: a tag, a label or column head, a button. True small caps stand about half as tall as the size they are set at, so a 16px label reads the way an 11px line of capitals used to |

`--font-display` (IM Fell English, with EB Garamond's figures) is for names and titles: page, section, item, foe, region, and for the italic "voice" lines (`.voice`, `.page-sub`, item and zone descriptions). Never under 16px. `--font-ui` (Alegreya Sans) is for everything else. Alegreya's figures are old-style by default, so `body` asks for `lining-nums` and anything that updates or lines up asks for `font-variant-numeric: var(--figures)` (lining and tabular; class `.num`; most components already set it). Line heights: `--lh-tight 1.15`, `--lh 1.45`, `--lh-loose 1.6`. `--tracking-caps .1em`.

### Space, radii, depth, motion, layers

- Space (4px steps): `--sp-0 2px`, `--sp-1 4px`, `--sp-2 8px`, `--sp-3 12px`, `--sp-4 16px`, `--sp-5 20px`, `--sp-6 24px`, `--sp-7 28px`, `--sp-8 32px`, `--sp-10 40px`, `--sp-12 48px`, `--sp-16 64px`, `--sp-20 80px`.
- Corners: most things are cut square. `--r-plate 2px` eases anything you press (buttons, inputs, the stepper, a badge); `--r-sheet 4px` anything that floats (dialogs); only a dot is round. The old names survive as aliases (`--r-xs 0`, `--r-sm`, `--r-md`, `--r-lg`, `--r-pill` all 2px, `--r-xl 4px`) so older page code lands on the new shapes.
- Depth: only what floats casts a shadow. `--shadow-pop` (tooltips, toasts) and `--shadow-modal`; `--hi`, `--shadow-1` and `--shadow-card` are `none`.
- Motion: `--dur-1 120ms` (hover, press), `--dur-2 180ms` (dialogs, tooltips), `--dur-3 260ms` (sheets, drawer), `--bar-dur 140ms` (progress bars, linear), `--ease`, `--ease-in`. All durations become 0 under `prefers-reduced-motion`.
- Layers: `--z-sticky 10`, `--z-topbar 40`, `--z-drawer 60`, `--z-modal 80` (each stacked dialog adds 1), `--z-toast 90`, `--z-tip 100`.

### Shell variables (responsive)

| Token | Desktop | Below 1280 | Below 1024 | Below 600 | Below 380 |
|---|---|---|---|---|---|
| `--topbar-h` | 60px | 60px | 56px | 56px | 56px |
| `--hpline-h` | 0 | 0 | 3px | 3px | 3px |
| `--gutter` | 44px | 32px | 24px | 16px | 12px |
| `--page-gap` | 44px | 44px | 36px | 32px | 32px |
| `--sheet-pad` | 22px | 22px | 22px | 16px | 16px |
| `--grid-gap` | 28px | 28px | 28px | 20px | 20px |

`--card-pad` is `0` at every width: a section has no box, so it has no padding of its own. Dialogs and the drawer use `--sheet-pad`.

Fixed: `--sidebar-w 212px`, `--content-max 1200px`. `--tap` is 32px, and 44px on touch screens (`pointer: coarse`); every button, chip button, tier, segment, tab, stepper and input uses it as a floor for its height (so a 38px button stays 38px on desktop and grows to 44px on touch).

---

## 4. Breakpoints and responsive rules

| Query | Name | What changes |
|---|---|---|
| `min-width: 1280px` | wide | breadcrumb and HP numbers show in the topbar |
| `min-width: 1200px` | | storage pages (Stockpile, Armaments) get a sticky side column |
| `min-width: 1024px` | desktop | 60px topbar with brand, the two activities with meta and start-over buttons, gold, health line, connection, settings; sticky 212px sidebar |
| `max-width: 1023px` | tablet | 56px topbar plus a 3px health line on its bottom edge; menu button opens the sidebar as a drawer; connection pill hides and the settings button shows a coloured dot; inputs 16px |
| `max-width: 899px` | | Sky forecast becomes a list of rows |
| `max-width: 767px` | | entries put their stats under the name; the hunt's scene stacks (foes above, the state between, you below), the descent turns on its end and the quarry stands two by two; market listings stack; atlas stacks (list above detail) |
| `max-width: 599px` | phone | topbar: menu, two compact chips (icon, short name, bar), gold, settings; brand hidden; dialogs become bottom sheets; toasts span the bottom; heroes stack; `.grid-2` goes to one column; `.list-row.stack-sm` drops its end to a new line; skills grid 2 columns |
| `max-width: 479px` | | storage slot grid 4 across |
| `max-width: 379px` | narrow phone | tighter topbar; gutter 12px |
| `pointer: coarse` | touch | `--tap: 44px`; chip buttons 44px tall; info buttons get a larger invisible hit area; tooltips open on tap |
| `hover: hover` | | hover styles only apply on devices that can hover, so taps never leave things lit |
| `prefers-reduced-motion: reduce` | | no transitions or loops; hit floats are not shown; bars jump straight to their value |

The activity chip also measures itself with a container query: when it is narrower than 76px it keeps only the icon and the bar.

Tested with no horizontal overflow at 360, 390, 768, 1024 and 1440px.

---

## 5. The shell

`index.html` is a static skeleton. `main.js` fills its mount points. Every id below is stable and part of this contract.

### Mount ids

| Id | Element | What goes there | Notes |
|---|---|---|---|
| `app` | `div.app` | the whole UI | `data-drawer="closed" \| "open"`, managed by `bindDrawer()` |
| `topbar` | `header.topbar` | | sticky, blurred, safe-area aware |
| `tbMenu` | `button.tb-icon-btn.tb-menu` | opens the drawer | shows below 1024px; `aria-expanded` managed by `bindDrawer()` |
| `tbBrand` | `a.tb-brand` | logo and wordmark | links to `#/character`; hidden on phones |
| `tbCrumbs` | `nav.tb-crumbs` | breadcrumb | shows at 1280px and up; hides itself when empty (see markup below) |
| `tbActs` | `div.tb-acts` | the two activity chips | |
| `tbBench` | `div.act` | the crews chip | `data-kind="bench"`, `data-state="idle" \| "working"` |
| `tbBenchLink` | `a.act-link` | | set `href` to the working skill page (`#/skill/delving`), `#/character` when idle |
| `tbBenchIcon` | `span.act-ico` | one `iconEl()` | replace its child when the action changes |
| `tbBenchName` | `span.act-name` | full name: "Bog Ore" | tablet and desktop |
| `tbBenchShort` | `span.act-short` | short name for phones | same as the name unless it is long |
| `tbBenchMeta` | `span.act-meta` | one short line: "42 of 200 · 1h 12m left" | tablet and desktop |
| `tbBenchBar` | `i` | progress fill | `setWidth(bar, pct)`; add `.nojump` while pct < 6 so a wrap to 0 never animates backwards |
| `tbBenchStop` | `button.act-stop` | stands the crews down | hidden when idle and on phones |
| `tbHunt` and `tbHuntLink`, `tbHuntIcon`, `tbHuntName`, `tbHuntShort`, `tbHuntMeta`, `tbHuntBar`, `tbHuntStop` | same shapes | the hunt chip | `data-kind="hunt"`, `data-state="idle" \| "hunting" \| "recovering" \| "hiding"`; stop hidden when idle or recovering |
| `tbGold` | `div.tb-gold` | | contains the coin icon |
| `tbGoldText` | `span` | `fmtWhole(gold)` | a visually hidden " gold" follows it for screen readers |
| `tbHp` | `div.tb-hp` | `role="meter"` | keep `aria-valuenow` and `aria-valuemax` current; set `data-low` (via `setAttr(tbHp, "data-low", hp / max <= .35)`) to turn it ember |
| `tbHpFill` | `i` | health fill | `setWidth`. Below 1024px this bar becomes the 3px line under the topbar |
| `tbHpText` | `span.tb-hptext` | "87/112" | shows at 1280px and up |
| `tbConn` | `button.conn` | connection indicator | `data-state="online" \| "syncing" \| "offline" \| "guest"`; opens account settings; hidden below 1024px |
| `tbConnText` | `span` | "212 online", "Syncing", "Offline", "Guest" | |
| `tbSettings` | `button.tb-icon-btn` | opens the settings modal | contains `span.tb-dot`, which mirrors `tbConn`'s state below 1024px |
| `sidebar` | `aside.sidebar` | navigation | sticky column on desktop, drawer below 1024px |
| `drawerClose` | `button` | closes the drawer | only visible in the drawer |
| `nav` | `nav.nav` | the six groups | |
| `navVanguard`, `navCamp`, `navTrades`, `navArtisans`, `navField`, `navRealm` | `section.nav-group` | | a group whose list is empty hides itself; also set `hidden` on it for older browsers |
| `navVanguardList`, `navCampList`, `navTradesList`, `navArtisansList`, `navFieldList`, `navRealmList` | `ul.nav-list` | `li > a.nav-item` rows | see Sidebar below |
| `sideFoot` | `div.side-foot` | pinned to the foot of the sidebar | |
| `weather` | `div.weather` | the weather card | starts `hidden`; fill it, then unhide |
| `drawerBackdrop` | `div.drawer-backdrop` | | managed by `bindDrawer()` |
| `main` | `main.main` | | |
| `bannerDock` | `div.banner-dock` | guest and offline banners | collapses when empty; clear it with `clear()`, never leave whitespace text in it |
| `view` | `div.view` | the current page | `tabindex="-1"`: focus it (with `preventScroll`) after a route change |
| `boot` | `div.boot` inside `#view` | "Waking the camp" placeholder | replaced on first render |
| `logDock` | `section.log-dock` | the camp log card, when a page wants it below | starts `hidden` |
| `modalRoot` | `div` | dialogs | used by `openModal()` |
| `tipLayer` | `div.tip-layer` | the one tooltip | used by `tooltip()` |
| `toasts` | `div.toasts` | toasts | used by `toast()`; `aria-live="polite"` |
| `srLive` | `div.sr-only` | screen reader announcements | `setText(el("srLive"), "Bog Ore finished")` |

Route hrefs the shell and kit assume (main.js decides, but keep these): `#/character` (default), `#/armaments`, `#/companions`, `#/stockpile`, `#/bounties`, `#/requisitions`, `#/shop`, `#/sky`, `#/skill/<skillId>` (the Hunt is `#/skill/warfare`), `#/atlas`, `#/market`, `#/party`, `#/hiscores`.

The icons baked into `index.html` are copies of `icon()` output. When a chip's state changes, replace them with `iconEl()`.

### Topbar: activity chip states

| Chip | `data-state` | Icon | Name / short | Meta | Bar | Stop |
|---|---|---|---|---|---|---|
| bench | `idle` | `hammer` | "Idle" | "No crews at work" | hidden | hidden |
| bench | `working` | the action's icon | "Bog Ore" (crafting: "Bog Bar") | "42 of 200 · 1h 12m left"; crafting: "Forging · 18 of 60 · 9m left"; no limit: "42 · 11h 58m left" | tan, action progress | shown |
| hunt | `idle` | `swords` | "Idle" | "Nobody is hunting" | hidden | hidden |
| hunt | `hunting` | `zoneOuter` / `zoneMiddle` / `zoneInner` / `zoneCore` | "Inner · Gallowmoor" / "Inner" | "38 kills · 4,210 XP/hr · Threat 64" | ember, hunt progress | shown |
| hunt | `recovering` | `heart` | "Recovering" / the countdown "3m 12s" | "Back in 3m 12s" | ember stripes, recovery progress | hidden |
| hunt | `hiding` | `eye-off` | "Hiding" | "4m 10s left · The Drowned Bailiff searches" | bone dashes, time hidden so far | shown |

An activity is not a chip any more: it is a column of writing between two hairlines, with a bare glyph in its tone and its progress drawn along the topbar's own bottom rule. On phones each is only its link (glyph, short name, line): a tap opens the page. The whole topbar is one row, 56px plus the 3px health line, and every target is 44px.

```js
function paintBench(plan) {
  const chip = el("tbBench");
  const state = plan ? "working" : "idle";
  if (chip.dataset.state !== state) chip.dataset.state = state;
  if (iconKey !== (plan ? plan.icon : "hammer")) {          // rebuild the icon only when it changes
    iconKey = plan ? plan.icon : "hammer";
    el("tbBenchIcon").replaceChildren(iconEl(iconKey));
  }
  setText(el("tbBenchName"), plan ? plan.name : "Idle");
  setText(el("tbBenchShort"), plan ? plan.name : "Idle");
  setText(el("tbBenchMeta"), plan ? `${fmtWhole(plan.done)} of ${fmtWhole(plan.limit)} · ${fmtTime(plan.left)} left` : "No crews at work");
  setAttr(el("tbBenchLink"), "href", plan ? `#/skill/${plan.skillId}` : "#/character");
  const bar = el("tbBenchBar");
  toggleClass(bar, "nojump", !plan || plan.pct < 6);
  setWidth(bar, plan ? plan.pct : 0);
}
```

### Breadcrumb markup

```html
<nav class="tb-crumbs" id="tbCrumbs" aria-label="Breadcrumb">
  <span>Trades</span>
  <span class="tb-crumb-sep" aria-hidden="true">/</span>
  <span aria-current="page">Delving</span>
</nav>
```

### Sidebar rows

```html
<li>
  <a class="nav-item" href="#/skill/delving" aria-current="page">   <!-- aria-current on the current page only -->
    <span class="nav-label">Delving</span>                            <!-- no glyph: the sidebar is a table of contents -->
    <span class="nav-dot" role="img" aria-label="Working"></span>    <!-- only while this skill works; data-tone="ember" for the hunt -->
    <span class="nav-meta">Lv 24</span>                               <!-- skills: "Lv 24"; storage: "24/30"; requisitions: "2/3" -->
    <span class="badge" aria-label="2 unread">2</span>              <!-- only when something needs attention -->
  </a>
</li>
```

- Current row: `aria-current="page"` (or `.is-active`). The ink darkens to bone and a 2px bone rule stands in the margin. No fill.
- A row's `icon` in shell.js is still what the topbar and the pages draw; the sidebar itself shows words and figures only.
- Badge tones: `.badge` (bone, party), `.badge-gold` (a bounty ready), `.badge-ember` (something wrong), `.badge-good`.
- Groups and rows by the information architecture: **The Vanguard** (Character `person`, Armaments `plate`, Companions `paw`), **The Camp** (Stockpile `stockpile`, Bounties `scroll`, Requisitions `crate` only from tier 2, Shop `shop`, Sky `sky`), **Trades** (Felling `axe`, Delving `pick`, Harvesting `sickle`, Flaying `knife`, Dredging `net`), **Artisans** (Forgemaster `plate`, Woodwright `ward`, Tanner `treads`, Weaver `cowl`, Artificer `charm`), **The Field** (Hunt `swords`), **The Realm** (Atlas `atlas`, Market `market`, Party `party`, Hiscores `trophy`).
- In the drawer rows are 44px tall with 15px text.

### Weather note

No card: a rule above it at the foot of the contents, the sky's name inked, its two modifiers, and "The week ahead" in small caps. The whole note opens the Sky.

```html
<div class="weather" id="weather">
  <div class="weather-top"><svg class="ico">moon</svg><span class="weather-name">Faint Gloom</span></div>
  <div class="weather-mods"><span class="up">+9% Flaying</span><span class="down">−9% Harvesting</span></div>
  <div class="weather-bonus">Bountiful Weekend · +20% XP to every trade</div>   <!-- weekends only -->
  <div class="weather-next">Tomorrow: Extreme Aridity</div>
</div>
```

Use `signedPct()` for the numbers (it writes a true minus sign).

### The drawer

Call once at boot:

```js
const drawer = bindDrawer();   // uses #app, #sidebar, #tbMenu, #drawerClose, #drawerBackdrop
```

Below 1024px the menu button opens the sidebar as a drawer: focus moves to the current row, focus is trapped, the page behind is inert and does not scroll. It closes on Escape, the backdrop, the close button, any link click inside it, and when the viewport grows past 1023px (focus returns to the menu button). Returns `{ open(), close(), toggle(), isOpen() }`.

---

## 6. Helpers

### 6.1 dom.js

#### `h(tag, props?, ...children) -> Element`

Hyperscript. `tag` accepts shorthand: `"button.btn.btn-primary#forgeBtn"`. SVG tag names (`svg`, `path`, `circle`, `g`...) are created in the SVG namespace.

| Prop | Behaviour |
|---|---|
| `class` / `className` | a string, an array (falsy entries skipped) or `{ name: bool }`; added to shorthand classes |
| `data-*` keys | written as attributes: `{ "data-rarity": "rare" }` |
| `dataset: {}` | `{ itemKey: "bog_bar" }` becomes `data-item-key`; `true` writes an empty value, `false`/`null` skip |
| `on<Event>` functions | `onClick`, `onInput`, `onKeydown`... become `addEventListener(event)` |
| `style` | an object (`{ width: "40%", "--grid-min": "220px" }`) or a string; null values skipped. Page code uses it only for bar widths |
| `aria-*` booleans | always written out: `"aria-expanded": false` gives `aria-expanded="false"` |
| other attributes | `true` sets an empty (boolean) attribute; `false`, `null`, `undefined` leave it out |
| `value`, `checked`, `selected`, `indeterminate` | set as properties, after the children exist (so a `<select>` takes its value) |
| `html` | an SVG string from `icon()` appended as markup. Never pass player text |
| `ref` | `(node) => {}` called with the node |

Children: strings and numbers become text nodes (so player text is always safe), arrays flatten, Nodes append, `null`, `undefined`, `false` and `true` are skipped.

```js
const buy = h("button.btn.btn-gold.btn-soft.btn-sm", { type: "button", disabled: gold < price, onClick: () => buyRemedy(key) },
  iconEl("coin"), "Buy");

const row = h("div.list-row", { class: { "is-dealt": bought } },
  h("div.art", { "data-tone": "gold", "aria-hidden": "true" }, iconEl("log")),
  h("div.lr-main", h("div.lr-title", name), h("div.lr-sub", `Tier ${tier} · ${fmtGold(price)} the lot`)),
  h("div.lr-end", buy));
```

#### Finding and updating

| Function | Behaviour |
|---|---|
| `el(id)` | `document.getElementById(id)` |
| `qs(sel, root = document)` | `root.querySelector(sel)` |
| `qsa(sel, root = document)` | `querySelectorAll` as a real array |
| `setText(node, text)` | writes `textContent` only when it differs; `null` writes "" |
| `setWidth(node, pct)` | clamps 0 to 100, rounds to 0.01, writes `style.width` only when it differs; non-numbers write 0 |
| `setAttr(node, name, value)` | writes only on change; `null`/`false` removes, `true` sets "" |
| `toggleClass(node, cls, on?)` | like `classList.toggle`, but only touches the DOM when the state changes |
| `clear(node)` | removes every child |
| `on(root, type, selector, handler, options?) -> off()` | delegation: `handler(event, matchedElement)` for current and future matches inside `root`; returns a function that removes the listener. Use bubbling events (`click`, `input`, `change`, `keydown`, `focusin`) |
| `html(markup) -> DocumentFragment` | parses an SVG or icon string. For strings built in code only |

```js
// One listener for every pill on the page, however often the list is rebuilt.
const off = on(el("view"), "click", ".item-pill .pill-hit", (e, btn) => {
  openActionPopup(btn.closest(".item-pill").dataset.action);
});
```

### 6.2 icons.js

- `ICONS`: `{ name: svgInnerMarkup }`, 109 hand-drawn 24 by 24 stroke icons (1.5 stroke, round caps).
- `icon(name, cls?) -> string`: `<svg class="ico cls" width="24" height="24" viewBox="0 0 24 24" ... aria-hidden="true" focusable="false">`. Unknown names draw `unknown`.
- `iconEl(name, cls?) -> SVGElement`: a fresh element each call (parsed once per name and class, then cloned).

Sizes: `.ico` is 20px; `.ico-xs` 14, `.ico-sm` 16, `.ico-md` 20, `.ico-lg` 24, `.ico-xl` 32, `.ico-2xl` 44. Most components size their own icons, so you rarely need these. Icons are `aria-hidden`: give the control a label.

The `width` and `height` attributes are the icon's own size, and they are not optional: an `<svg>` with only a `viewBox` has no intrinsic size, and Safari lays it out from the attributes on the first paint. Every `.ico` rule still wins over them, so the sizes above are what you see. The copies baked into `index.html` carry them too.

Names (all v4 names are kept, unchanged):

- Gathering tools: `pick`, `axe`, `sickle`, `knife`, `net`
- Materials: `ore`, `log`, `fibre`, `hide`, `gem`, `ration`, `crate`; reagents: `coalIco`, `resinIco`, `pulpIco`, `tallowIco`, `shardIco`
- Gear: `blade`, `greatblade`, `stave`, `ward`, `plate`, `greaves`, `treads`, `gauntlets`, `cowl`, `shroud`, `band`, `charm`, `book`
- Foes: `beast`, `man`, `golemMob`, `horror`, `drakeMob`, `skull`
- Companions: `rat`, `crow`, `marshcat`, `hound`, `stag`, `paw`
- Hunt zones: `zoneOuter`, `zoneMiddle`, `zoneInner`, `zoneCore`
- Weather: `rain`, `sun`, `fog`, `wind`, `frost`, `moon`, `sky`, `unknown`
- Places and pages: `atlas`, `shop`, `scroll`, `pack`, `person`, `swords`, `market`, `party`, `trophy`, `bonesetter`, `stockpile`, `map-pin`, `calendar`
- Money: `coin`, `coin-stack`, `tag`
- Online: `chat`, `send`, `mail`, `online`, `sync`, `cloud`, `offline`, `logout`, `user-plus`, `crown`, `bell`
- Controls: `menu`, `plus`, `minus`, `close`, `check`, `chevron-down`, `chevron-right`, `chevron-left`, `chevron-up`, `arrow-right`, `search`, `filter`, `sort`, `dots`, `gear`, `eye`, `eye-off`, `lock`, `info`, `warn`, `alert`
- Misc: `clock`, `hourglass`, `heart`, `shield`, `sparkle`, `hammer`, `flag`

### 6.3 overlay.js

#### `openModal(options) -> handle`

A centred dialog at 600px and up; a bottom sheet on phones (grab handle, 88vh max, drag the handle or header down to dismiss, internal scroll, footer pinned above the safe area).

| Option | Default | Meaning |
|---|---|---|
| `title` | `""` | the heading (display face) |
| `sub` | `""` | a quiet line under the title; also the dialog's description |
| `art` | `null` | an icon name, an SVG string (a monster drawing) or a Node, shown in a 56px `.art` tile |
| `artTone` | `null` (plain ink) | `"tan" \| "ember" \| "gold" \| "good" \| "veil" \| "neutral"` |
| `artRarity` | `null` | a rarity: the tile takes the rarity colour instead of a tone |
| `artClass` | `""` | extra classes on the tile |
| `body` | `null` | a Node, a string (becomes `p.copy`) or an array of them |
| `actions` | `[]` | footer buttons, see below |
| `onClose(reason)` | `null` | called once: `"close"`, `"escape"`, `"backdrop"`, `"swipe"`, `"action"`, `"route"` |
| `size` | `"md"` | `"sm"` 400px, `"md"` 480px, `"lg"` 640px, `"xl"` 860px |
| `dismissible` | `true` | `false`: no close button, Escape, backdrop or swipe (the discipline picker) |
| `role` | `"dialog"` | `"alertdialog"` for confirmations |
| `initialFocus` | `null` | a selector or element to focus; otherwise `[autofocus]`, otherwise the dialog itself |
| `footLayout` | `"auto"` | `"auto"`: a two-column grid when there are more than two actions, a row otherwise; `"grid"`; `"row"` |
| `className` | `""` | extra classes on `.modal` |

Handle: `{ el, body, buttons, closed, close(reason?), setBody(content), setActions(list), setTitle(title, sub?) }`. `el` is the `.modal`; `body` is `.modal-body`; `buttons` are the footer buttons in order.

Action: `{ label, kind, onClick, disabled, icon, soft, wide, id, keep, describedBy }`.

- `kind`: `"primary"` (bone), `"gold"`, `"ember"`, `"danger"`, `"quiet"`, or omit for default.
- `soft: true` uses the soft variant; `wide: true` spans both columns of a grid footer (the main action, or a quiet last one).
- `onClick(handle, event)`: the dialog closes afterwards, unless the action has `keep: true` or `onClick` returns `false`. Returning a Promise shows the button loading, disables the footer, and closes when it resolves to anything but `false` (on `false` it re-enables and keeps focus in the dialog).

Behaviour: Escape and a press that starts and ends on the backdrop close it; focus is trapped inside; everything else on the page is inert; page scroll is locked (the scrollbar width is compensated); focus returns to what opened it. Dialogs stack: a confirm opened from a dialog sits above it, the lower one dims, Escape closes only the top one.

```js
const m = openModal({
  title: "Bog Bar",
  sub: "Forgemaster · Tier 2 · At camp",
  art: "ore",
  body: [descNode, chipsNode, statsNode, needsNode, runNode, pickerBlock, planNode],
  actions: [
    { label: "Stop", kind: "quiet", onClick: () => send("stopSkill") },
    { label: "Forge", kind: "primary", onClick: () => send("startSkill", { skillId, actionId, limit }) },
  ],
});
// Later, when the numbers move:
setText(qs(".ap-run-top b", m.body), `${fmtTime(left)} left`);
```

#### `confirm(options) -> Promise<boolean>`

| Option | Default | Meaning |
|---|---|---|
| `title` | `"Are you sure?"` | a question: "Buy 5 × Star-Steel Tonic?" |
| `body` | `null` | a string or a Node |
| `confirmText` | `"Confirm"` | say what happens and what it costs: "Buy for 700g", "Pay 100g and travel" |
| `cancelText` | `"Cancel"` | |
| `danger` | `false` | ember art, a danger button, focus starts on Cancel |
| `cost` | `null` | `{ gold, have }`: shows Costs, Your gold and Left after. If `have < gold` the rows read Short by, a note says "You need Ng more." and Confirm is disabled |
| `typeToConfirm` | `null` | a word, e.g. `"RESET"`: Confirm stays disabled until the input matches exactly; Enter confirms |
| `art`, `artTone` | | optional tile; defaults to gold with a cost, ember when dangerous |

Resolves `true` only on Confirm; Cancel, Escape, the backdrop and a swipe resolve `false`. The gold button is the confirm kind when there is a cost; primary otherwise; danger when `danger` is set.

```js
if (!(await confirm({
  title: `Buy ${qty} × ${name}?`,
  body: "They go into Belongings, to pack in the Satchel.",
  confirmText: `Buy for ${fmtGold(price * qty)}`,
  cost: { gold: price * qty, have: state.player.gold },
}))) return;
send("buyRemedy", { key, qty });

// Start over (Settings)
if (await confirm({ title: "Start over?", body: "Every skill, item, companion and coin is gone for good.", confirmText: "Wipe my camp", danger: true, typeToConfirm: "RESET" })) {
  send("resetCamp");
}
```

#### `toast(text, options?) -> { el, close() }`

| Option | Default | Meaning |
|---|---|---|
| `kind` | `"info"` | `"info"` (bone), `"good"`, `"warn"`, `"bad"` (ember, announced assertively), `"gold"` |
| `icon` | by kind | any icon name |
| `ms` | `3200` | time on screen; `0` stays until clicked |
| `action` | `null` | `{ label, onClick }`: a small text button ("View", "Undo") |

Newest on top, four at most (older ones leave). Click dismisses. Hovering or focusing the stack pauses every toast in it. Bottom right on desktop; full width at the bottom on phones, clear of the topbar and above the safe area. A thin bar at the bottom shows time left. Keep toast text to one short sentence without a full stop.

```js
toast("Delving reached level 25", { kind: "good", icon: "sparkle" });
toast("Bounty paid: 27g", { kind: "gold", action: { label: "View", onClick: () => go("#/bounties") } });
```

#### Tooltips

- Plain text needs no code: `<button class="info-btn" aria-label="Mastery" data-tip="Every ten levels adds to the chance of double yield.">`. Optional `data-tip-placement="top|bottom|left|right"` (default top).
- Rich or live content: `tooltip(anchor, content, { placement })` where `content` is a string, a Node, or a function `(anchor) => string | Node` called each time it opens. Returns `{ update(content), show(), hide(), destroy() }`.
- `tipBody(spec) -> Node` builds the standard rich layout:

```js
tipBody({
  title: "Delving Mastery",
  sub: "optional quiet line",
  text: "optional paragraph",
  list: ["Every ten levels adds to the chance an action yields double."],
  rows: [["Time", "16.0s each"], ["Double yield", "2%", "good"]],          // tone: "good" | "bad" | "gold"
  track: [{ at: "Lv 20", label: "Steady hands", value: "+2%", done: true },
          { at: "Lv 30", label: "Deep veins", value: "+3%", next: true }],
  table: { head: ["Rarity", "Attack", "Crit", "Durab."],
           rows: [{ rarity: "common", cells: ["Common", "+11", "2.0%", "620"] }] },
  foot: "Now +2% double yield. Deep veins at Lv 30.", footTone: "good",
});
```

Interaction: with a mouse, hover opens after 140ms (instantly if another tip is open) and leaving closes; keyboard focus opens and blur closes; on touch, a tap on the anchor toggles it and a tap anywhere else closes it. Escape closes. One floating layer: it is positioned against the anchor, flips to the opposite side when there is no room, is clamped 8px inside the viewport, follows scroll and resize, and closes if the anchor scrolls away or leaves the DOM. Max width 320px. The anchor gets `aria-describedby="tip"` and `data-tip-open` while open.

On touch the tap also reaches the anchor's own click handler, so put tooltips on anchors that do nothing else (`.info-btn`, `.tip-chip`). If an element has its own action and a tooltip, add `data-tip-touch="off"`: its tip then shows on hover and focus only.

`hideTip()` closes the open tooltip. `closeModals(reason = "route")` closes every open dialog, newest first: call it on route changes.

### 6.4 format.js

A re-export of `src/shared/format.js`, so numbers read the same on screen, on the server and in the log.

| Function | Example |
|---|---|
| `fmt(n)` | `9999 -> "9,999"`, `12500 -> "12.5K"`, `1250000 -> "1.25M"` |
| `fmtWhole(n)` | `10000 -> "10,000"` |
| `fmtGold(n)` | `1234 -> "1,234g"` (always the whole amount, never "1.2K") |
| `fmtTime(ms)` | `"42s"`, `"3m 12s"`, `"1h 12m"`, `"2d 4h"` |
| `fmtStat(n)` | `0.026 -> "0.03"`, `3.28 -> "3.3"`, `403.4 -> "403"` |
| `fmtAgo(ms)` | `"Just now"`, `"2m ago"`, `"4h ago"`, `"3d ago"` |
| `signedPct(n)` | `18 -> "+18%"`, `-18 -> "−18%"` (true minus sign) |
| `chancePct(x)` | `0.0125 -> "1.25%"` |
| `fmtClock(ms)` | `"22:03:52 UTC"` |
| `titleCase(s)`, `plural(n, word, many?)`, `clamp(n, lo, hi)` | `plural(3, "stack") -> "3 stacks"` |

---

## 7. Components

Each entry: what it is for, the markup, modifiers and states, and how it responds. Markup is given as HTML; build it with `h()`.

### 7.1 Page structure

**Page.** Every page is one `.page` in `#view`: a column with `--page-gap` between blocks and a short rise-in on mount.

```html
<div class="page">
  <header class="page-head">
    <div>
      <div class="eyebrow page-eyebrow">The Camp</div>
      <h1 class="page-title">Requisitions</h1>
      <p class="page-sub">Send Agents out for supplies. They return at the daily reset.</p>
    </div>
    <div class="page-actions"><!-- chips, a clock, at most one solid button --></div>
  </header>
  ...cards and sections...
</div>
```

Skill pages use a `.hero` instead of `.page-head` (7.3); Character uses `.char-hero` (8.1).

The title is set at `--text-4xl` and `.page-sub` is the chronicle's voice: italic display type. That contrast, one large inked name over quiet ledger text, is the page's hierarchy; do not add a container to make one.

**Section.** A titled group of entries, without a rule above it.

```html
<section class="section">
  <div class="section-head">
    <div><h2 class="section-title">Zones</h2><p class="section-sub">Deeper zones field more foes.</p></div>
    <!-- optional: a chip or a button -->
  </div>
  ...
</section>
```

**Column grid, three across at most.** Columns fill to three, never more, and drop as the space narrows below `--grid-min` (260px) per column.

```html
<div class="grid-cards">...</div>           <!-- 3, 2, 1 -->
<div class="grid-cards max-2">...</div>     <!-- 2, 1: zones, party members, the two activity cards -->
```

To change the narrowest card, set `--grid-min` on a page class in pages.css (`.skills-grid` and `.class-grid` use 220px). `.grid-2` is a plain two-column split that goes to one column on phones (market lists, party chat and invites).

### 7.2 Card (a ruled section)

`.card` keeps its name because every page is built from it, but it draws the opposite of a card: no border, no fill, no corner, no shadow. It is a hairline rule above, a title inked at `--text-2xl`, and its matter. `data-tone` tints the rule.

```html
<section class="card" data-tone="tan">                       <!-- data-tone optional: tints the rule above the section -->
  <div class="card-head">
    <div>
      <div class="eyebrow">The Camp</div>                      <!-- optional -->
      <h2 class="card-title"><svg class="ico">bonesetter</svg>The Bonesetter</h2>   <!-- icon optional -->
      <p class="card-sub">Always open. Remedies go into Belongings, to pack in the Satchel.</p>
    </div>
    <div class="card-actions"><!-- chips or small buttons --></div>
  </div>
  ...content...
  <div class="card-foot"><button class="btn btn-quiet">Later</button><button class="btn btn-gold">Buy · 75g</button></div>
</section>
```

| Class | Meaning |
|---|---|
| `.card-flush` | kept for markup that used it; every section is flush now, so it changes nothing but a footer's top margin |
| `.card-link` | the whole section is a link or button (class picker): hover brightens its rule |
| `.card-foot.between` | footer content spread to both ends |
| `.well` | an aside set in from a rule in the margin (a comparison line, a hint). Not a box |
| `.divider` | a quiet `hr` with 20px space around it |

The card head wraps its actions under the title when there is no room.

### 7.3 Hero (skill pages)

A masthead, not a panel: the skill's name at `--text-5xl` on the left, its level as large on the right, the way to the next level as one 3px rule under both, then a line of writing.

```html
<section class="hero">
  <div class="hero-main">
    <div class="eyebrow hero-eyebrow">Trades · Gallowmoor</div>
    <h1 class="hero-title">Delving</h1>
  </div>
  <div class="hero-level">
    <div class="hero-lv"><small>Lv</small>24</div>
    <div class="hero-lv-sub">120,450 / 131,600 XP</div>
  </div>
  <div class="hero-xp">
    <div class="bar"><i style="width: 42%"></i></div>
    <div class="hero-xp-meta"><span>Ore and coal, hauled up by lamplight.</span><span><b>11,150</b> to Lv 25</span></div>
  </div>
  <div class="chip-row hero-tags">                              <!-- optional: Mastery tip chip, XP modifier chips -->
    <button class="tip-chip" type="button"><svg>info</svg>Mastery · +2% double yield</button>
    <span class="chip chip-good">+16% XP · Extreme Aridity</span>
  </div>
</section>
```

Eyebrow: "Trades · Gallowmoor", "Artisans · At camp". The first span of `.hero-xp-meta` is the skill's note and is set in the chronicle's voice. Show modifier chips only when they apply (weather, Bountiful Weekend, companion, bounty buff). When maxed: `hero-lv-sub` reads "Mastered" and the XP line drops its "to Lv" part. An `.art` as the first child is still laid out (a column opens for it), but no live page passes one.

The Hunt has no hero: its field is the page, and the level, the XP line and the modifier chips are written into the head of the scene (8.7).

Phones: `hero-lv-sub` hides and the note and "to Lv" stack.

### 7.4 Buttons

```html
<button class="btn" type="button">Move to Vault</button>
<button class="btn btn-primary" type="button">Forge</button>
<button class="btn btn-gold" type="button">Buy · 250g</button>
<button class="btn btn-ember" type="button">Hunt</button>
<button class="btn btn-danger" type="button">Wipe my camp</button>
<button class="btn btn-quiet" type="button">Cancel</button>
```

| Modifier | Use |
|---|---|
| (none) | an outline plate: the default for anything that is not the surface's one decision |
| `.btn-primary` | solid bone: the plain decision (Forge, Equip, Sign in, List for sale, Travel here) |
| `.btn-gold` | solid gold: a spend (buy, pay a toll, hire, claim gold) |
| `.btn-ember` | solid ember: setting out to fight ("Hunt the Inner", "Move the hunt here"). Not for "Change hunt" while already out: that is an outline |
| `.btn-danger` | destructive: Start over, kick (inside a confirm) |
| `.btn-quiet` | no chrome: Cancel, Stop, Pull back, Later |
| `.btn-soft` | with a kind: the tinted variant for repeated actions in lists (Buy in shop rows, Deploy, Take along) |
| `.btn-sm` | 32px (44px on touch); `.btn-lg` 48px |
| `.btn-icon` | square, icon only; always with `aria-label` |
| `.btn-block` | full width |
| `.is-loading` | a spinner replaces the label (openModal does this for Promise actions) |
| `disabled` | 38% opacity, no hover |

Every button is lettered in small caps (`--caps-lg`), cut nearly square (`--r-plate`) and flat: no gradient, no glow, no inner highlight. A button with an icon: put `iconEl(name)` before the label. Group buttons with `.btn-row` (`.btn-row.end` to align right). `.link` is an underlined bone text link for use inside copy.

**Info button.** A 28px round (i) that only opens a tooltip.

```html
<button class="info-btn" type="button" aria-label="Bog Sword: what it gives"><svg>info</svg></button>
```

### 7.5 Chips, tags, badges, dots

**Chip**: a short fact, written. No border, no fill, no pill: words in the tone that says what kind of fact it is, with an optional small glyph in front.

```html
<span class="chip"><svg>clock</svg>16s</span>
<span class="chip chip-good">+9% XP · Faint Gloom</span>
<span class="chip chip-good"><svg>party</svg>+20% Hunt XP · 2 here</span>
```

Tones: `.chip-good` (a gain), `.chip-warn`, `.chip-bad`, `.chip-gold` (money), `.chip-tan` (work: XP an action, a trade), `.chip-bone` (you, here), `.chip-ember` (the hunt is out somewhere), `.chip-veil` (a discipline). Sizes: `.chip-sm`, `.chip-lg`. `<b>` inside a chip is brighter. Wrap several in `.chip-row` (it hides itself when empty).

**Chip as a button**: filters, tabs, quantity presets, leaderboard picks. A word with a 2px bone rule under the chosen one. Words, not glyphs: a filter is its own name.

```html
<div class="filters" role="group" aria-label="Show">
  <button class="chip" type="button" aria-pressed="true">All</button>
  <button class="chip" type="button" aria-pressed="false">Gear</button>
</div>
```

States: `aria-pressed="true"`, `aria-selected="true"` or `.is-active`; `disabled`. 32px tall, 44px on touch.

**Tip chip**: a chip that opens a rich tooltip (the Mastery tooltip).

```html
<button class="tip-chip" type="button"><svg>info</svg>Mastery · +2% double yield</button>
```

```js
tooltip(chipEl, () => tipBody({ title: "Delving Mastery", list: [...], track: [...], foot: "..." }), { placement: "bottom" });
```

**Tag**: a label on a thing: a word in small caps, in a tone. No border, no fill.

```html
<span class="tag tag-veil">Warrior</span>
<span class="tag tag-elite">Elite</span>
<span class="tag tag-sovereign">Sovereign</span>
<span class="tag" data-rarity="legendary">Legendary</span>
```

Tones: `.tag-veil` (a discipline), `.tag-bone` (here, you, yours), `.tag-tan` (out, at your side), `.tag-ember`, `.tag-gold` (tier), `.tag-good` (open, paid out), `.tag-elite`, `.tag-sovereign` (veil), `data-rarity`, or plain (expired).

**Badge**: a count that needs attention, and the one mark in the kit that keeps a filled shape. `.badge` (bone), `.badge-gold`, `.badge-ember`, `.badge-good`. Give it an `aria-label` that says what it counts.

**Dot**: status.

```html
<span class="dot dot-online"></span>   <!-- also dot-away, dot-offline, dot-working (tan pulse), dot-hunting (ember pulse) -->
```

Give a meaningful dot `role="img"` and an `aria-label` (or put the words next to it).

### 7.6 Glyphs (`.art`)

A glyph in the margin of a row: an item, a skill, a zone, a foe. It keeps the square it always had so rows still line up, but there is nothing behind it: no tile, no edge, no gradient.

```html
<div class="art" aria-hidden="true"><svg class="ico">ore</svg></div>                  <!-- plain ink, or the nearest data-tone -->
<div class="art art-sm" data-tone="ember" aria-hidden="true">...</div>
<div class="art art-lg" data-rarity="epic" aria-hidden="true">...</div>
<div class="art" data-tone="neutral" aria-hidden="true">...</div>
```

Sizes: `.art-sm` 28px, default 40px, `.art-lg` 52px, `.art-xl` 72px. `data-tone`: `tan` (work under way), `ember` (the hunt), `gold` (money), `good` (remedies, done), `veil` (a discipline), `neutral` (bare hands, not owned); none at all is plain ink, and that is the default for a dialog's glyph. `data-rarity` for gear. `.is-dim` greys it out.

### 7.7 Bars and meters

```html
<div class="bar"><i style="width: 36%"></i></div>
```

| Modifier | Use |
|---|---|
| (none) | tan: skills, XP, crafting |
| `.bar-ember` | a foe's health seen from outside the field (the Character page's hunt), a fall |
| `.bar-gold` | bounties, market progress |
| `.bar-good` | health outside the field, bond when complete |
| `.bar-veil` | the Veil |
| `.bar-neutral` | anything without meaning (odds, a share) |
| `.bar-thin` (2px), `.bar-lg` (6px) | heights; default 4px. Square ends, no track box |
| `.bar-striped` | recovering (animated stripes) |
| `.nojump` on the `i` | no transition, for the frame a bar wraps back to 0 |

Always update with `setWidth(fill, pct)`. When the bar is the only place a number lives, add `role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="36"`; otherwise leave it decorative.

**Vital**: someone's health, written under them. A line and its figures side by side; nothing is painted on top of a bar.

```html
<div class="vital"><div class="vital-line"><i style="width: 78%"></i></div><span class="vital-text">87 / 112</span></div>
<div class="vital vital-foe">...22 / 48...</div>          <!-- ember: a foe -->
<div class="vital vital-veil">...Bulwark · 64 of 100...</div>   <!-- a 2px violet hairline that glows as it fills -->
<div class="vital vital-sm">...</div>                      <!-- the warband -->
```

`.is-low` turns your own line and figures ember at 35% and under. The Veil's text reads "Bulwark · ready" when full, "Volley · 2 to come" mid volley, and the technique's name alone at camp. There is no locked state: before a discipline is held the line is not built at all.

**Meter**: a labelled bar.

```html
<div class="meter">
  <div class="meter-top"><span>Threat</span><b>64 / 100</b></div>
  <div class="bar bar-ember bar-thin"><i style="width: 64%"></i></div>
</div>
```

**KPI line**: key numbers in a line (the hunt, the party's fight): a small-caps label over a figure, and only space between one and the next. No strip, no cells.

```html
<div class="kpis">
  <div class="kpi"><span class="l">Kills</span><span class="v">38</span></div>
  <div class="kpi"><span class="l">Threat</span><span class="v">64 / 100</span><div class="bar bar-ember bar-thin"><i></i></div></div>
</div>
```

`.kpi .s` is an optional small line under the value. The line wraps on its own as the space narrows.

### 7.8 Lists, stats, prices

**List rows**: people, remedies, sales, invites.

```html
<div class="list">
  <div class="list-row stack-sm">
    <div class="art" data-tone="good" aria-hidden="true"><svg>ration</svg></div>      <!-- or an .avatar -->
    <div class="lr-main">
      <div class="lr-title">Bitter-Ash Salve</div>
      <div class="lr-sub">Restores 25 HP · 12 in Belongings</div>
    </div>
    <div class="lr-end">
      <span class="price">5g<small>each</small></span>
      <button class="btn btn-gold btn-soft btn-sm" type="button">Buy</button>
    </div>
  </div>
</div>
```

Rows are divided by soft lines. `.lr-title.display` uses the display face. `.list-row.no-lead` has no art in front. `.list-row.stack-sm` drops `.lr-end` to its own right-aligned line on phones (a price in it moves to the left end): use it whenever the end holds more than one control. In a `.card-flush` the rows carry the card padding.

**Price**: `<span class="price">140g<small>each</small></span>`, gold; `.price.is-short` (ember) when you cannot afford it, or for money going out ("−420g").

**Pick list**: choose one from a list (atlas regions).

```html
<div class="pick-list" role="listbox" aria-label="Regions">
  <button class="pick-row is-selected" type="button" role="option" aria-selected="true">
    <span class="region-tier">3</span>
    <span class="lr-main"><span class="region-name">The Cold Warrens</span><span class="region-sub">Gear around Lv 20</span></span>
    <span class="region-toll"><svg>lock</svg>100g</span>
  </button>
</div>
```

States: `.is-selected` / `aria-selected="true"` (a wash and a bone rule in the margin), `.is-current` (you are here), `.is-locked`.

**Stat rows**: label and value pairs.

```html
<div class="stats">
  <div class="stat"><span class="l">Attack</span><span class="v">+14 <span class="delta up">+3</span></span></div>
  <div class="stat"><span class="l">Defence</span><span class="v">9.8 <small>stops 31% here</small></span></div>
  <div class="stat"><span class="l">Gold on hand</span><span class="v t-gold">1,234g</span></div>
</div>
```

Value tones: `.t-good`, `.t-gold`, `.t-bad`, `.t-tan`, `.t-veil`. **Delta** (a change against what is worn): `.delta.up` (green), `.delta.down` (ember), `.delta.same`; write "+3", "−2" (true minus).

### 7.9 Tabs, segments, tiers

**Tabs**: underlined, for switching a whole view.

```html
<div class="tabs" role="tablist">
  <button class="tab" type="button" role="tab" aria-selected="true">Belongings <span class="count">7/10</span></button>
  <button class="tab" type="button" role="tab" aria-selected="false">Vault <span class="count">8/50</span></button>
</div>
```

**Segmented control**: the compact choice (Belongings / Vault, Components / Wares, market kinds). Preferred over tabs inside cards.

```html
<div class="seg" role="tablist" aria-label="Bench">
  <button class="seg-btn" type="button" role="tab" aria-selected="true">Components <span class="count">4</span></button>
  <button class="seg-btn" type="button" role="tab" aria-selected="false">Wares <span class="count">7</span></button>
</div>
```

`.seg-full` stretches the buttons across the row. It scrolls sideways if it ever runs out of room.

**Tier row**: the bench tiers. Show the tiers the player can use plus the next one, never more.

```html
<div class="tier-row" role="group" aria-label="Tier">
  <button class="tier" type="button" aria-pressed="false">Lv 1</button>
  <button class="tier" type="button" aria-pressed="true">Lv 10</button>
  <button class="tier is-next" type="button" aria-pressed="false"><svg>lock</svg>Lv 30</button>
</div>
```

States: `aria-pressed="true"` or `.is-active`; `.is-next` (dashed, with a lock) for the one tier above.

### 7.10 Forms

```html
<div class="field">
  <label class="field-label" for="sellPrice">Price each</label>
  <div class="input-wrap">
    <svg class="ico">coin</svg>
    <input class="input" id="sellPrice" inputmode="numeric">
    <span class="affix">g</span>
  </div>
  <span class="field-hint">Lowest listed now: 13g.</span>          <!-- field-hint t-bad for an error -->
</div>

<select class="select select-sm" aria-label="Sort">...</select>
<textarea class="textarea" maxlength="240"></textarea>
<label class="check"><input type="checkbox" checked> Show locked recipes</label>
<label class="switch"><input type="checkbox" checked> Hide when Threat peaks</label>
```

| Class | Meaning |
|---|---|
| `.input`, `.select`, `.textarea` | 38px (44px on touch), sunk and square; the edge turns bone on focus |
| `.input-sm`, `.select-sm` | 34px |
| `.is-invalid` | ember border; say why in a `.field-hint.t-bad` |
| `.input-wrap` | a leading icon (`svg` before the input) and/or a trailing `.affix` |
| `.check`, `.switch` | a styled checkbox and a toggle; the label text is the control's name |

Inputs are 16px on phones and touch screens so the page never zooms.

### 7.11 Quantity picker

One control for every "how many": a stepper you can type in, presets, Max, and "No limit" where an unlimited run makes sense. Unlimited is shown as an empty box with a dim italic "No limit" placeholder and a pressed "No limit" chip. Never a symbol.

```html
<div class="qty">                                                  <!-- .is-unlimited while No limit is chosen -->
  <div class="qty-stepper">
    <button class="qty-btn" type="button" aria-label="One fewer"><svg>minus</svg></button>
    <input class="qty-input" type="text" inputmode="numeric" autocomplete="off" aria-label="How many" placeholder="No limit">
    <button class="qty-btn" type="button" aria-label="One more"><svg>plus</svg></button>
  </div>
  <div class="qty-presets">
    <button class="chip" type="button" aria-pressed="false">1</button>
    <button class="chip" type="button" aria-pressed="false">10</button>
    <button class="chip" type="button" aria-pressed="true">100</button>
    <button class="chip" type="button" aria-pressed="false">Max</button>
    <button class="chip chip-wide" type="button" aria-pressed="false">No limit</button>   <!-- only where unlimited is allowed -->
  </div>
</div>
```

Behaviour: the value is clamped to 1 and the most possible (`max`); a preset above `max` snaps to it; minus from No limit starts at `max - 1`; typing keeps only digits, and a number above `max` snaps to it; blur tidies the box; Enter can start the action. Presets are pressed when they equal the value. The popup's plan line (7.16) says what the chosen amount comes to.

Phones: the stepper fills the row and the presets share the line below.

Compact stepper for rows (shop): `<div class="qty-stepper qty-sm">` with the same three children, no presets.

Reference implementation (the `qtyPicker` function in `dev/kit.js`, quoted exactly; copy it into page code):

```js
function qtyPicker({ value = 1, max = 9999, unlimited = false, allowUnlimited = true, presets = [1, 10, 100], onChange = null } = {}) {
  const pick = { n: value, unlimited };
  const input = h("input.qty-input", { type: "text", inputmode: "numeric", autocomplete: "off", "aria-label": "How many", placeholder: "No limit" });
  const dec = h("button.qty-btn", { type: "button", "aria-label": "One fewer" }, iconEl("minus"));
  const inc = h("button.qty-btn", { type: "button", "aria-label": "One more" }, iconEl("plus"));
  const chips = presets.map((n) => h("button.chip", { type: "button", "data-q": String(n) }, fmtWhole(n)));
  const maxChip = h("button.chip", { type: "button", "data-q": "max" }, "Max");
  const noLimit = allowUnlimited ? h("button.chip.chip-wide", { type: "button", "data-q": "none" }, "No limit") : null;
  const node = h("div.qty", h("div.qty-stepper", dec, input, inc), h("div.qty-presets", chips, maxChip, noLimit));

  // notify is false for redraws from outside, so a caller's onChange never loops back into refresh().
  const show = (notify = true) => {
    pick.n = Math.max(1, Math.min(max, Math.floor(pick.n) || 1));
    input.value = pick.unlimited ? "" : String(pick.n);
    toggleClass(node, "is-unlimited", pick.unlimited);
    if (noLimit) setAttr(noLimit, "aria-pressed", String(pick.unlimited));
    chips.forEach((c) => setAttr(c, "aria-pressed", String(!pick.unlimited && Number(c.dataset.q) === pick.n)));
    setAttr(maxChip, "aria-pressed", String(!pick.unlimited && pick.n === max));
    dec.disabled = !pick.unlimited && pick.n <= 1;
    inc.disabled = !pick.unlimited && pick.n >= max;
    if (notify && onChange) onChange(pick);
  };

  dec.addEventListener("click", () => { pick.n = (pick.unlimited ? max : pick.n) - 1; pick.unlimited = false; show(); });
  inc.addEventListener("click", () => { if (!pick.unlimited) pick.n += 1; show(); });
  on(node, "click", ".qty-presets .chip", (e, b) => {
    const q = b.dataset.q;
    if (q === "none") pick.unlimited = true;
    else if (q === "max") { pick.unlimited = false; pick.n = max; }
    else { pick.unlimited = false; pick.n = Number(q); }
    show();
  });
  input.addEventListener("input", () => {
    const digits = input.value.replace(/[^0-9]/g, "");
    if (digits !== input.value) input.value = digits;
    if (!digits) return;
    pick.unlimited = false;
    pick.n = Number(digits);
    if (pick.n > max) show(); else if (onChange) onChange(pick);
  });
  input.addEventListener("blur", () => show());
  show(false);
  return {
    node,
    pick,
    // The most possible can change underneath (stock used up); keep the box honest, but never while typing.
    refresh(nextMax) {
      if (nextMax != null) max = Math.max(1, Math.floor(nextMax));
      if (document.activeElement !== input) show(false);
    },
  };
}
```

Returns `{ node, pick, refresh(nextMax?) }`. `pick` is `{ n, unlimited }`: the limit to send is `pick.unlimited ? null : pick.n`. Keep `pick` per skill for the session if you want the popup to remember the last choice. `onChange` is not called on construction or on `refresh`.

### 7.12 Entries (`.item-pill`: gathering nodes, recipes)

One ruled line per node or recipe: a page of the ledger, not a stack of pills. The name is inked and is the button, and its hit area covers the whole line; the (i) button on the right stays separately clickable. The running action's progress is drawn on the entry's own bottom rule.

```html
<div class="pills">
  <article class="item-pill is-working" data-action="delving_t2_raw">
    <div class="art" aria-hidden="true"><svg>ore</svg></div>
    <div class="pill-main">
      <button class="pill-hit" type="button">Bog Ore</button>
      <div class="pill-sub"><span>Working</span><span><b>42</b> of 200</span><span>1h 12m left</span></div>
    </div>
    <div class="pill-stats">
      <span class="chip"><svg>clock</svg>16s</span>
      <span class="chip chip-tan">3 XP</span>
      <span class="chip">147 held</span>
    </div>
    <div class="pill-end">
      <button class="info-btn" type="button" aria-label="Bog Ore: what it gives"><svg>info</svg></button>
      <svg class="ico pill-go">chevron-right</svg>
    </div>
    <span class="pill-bar" aria-hidden="true"><i style="width: 36%"></i></span>
  </article>
</div>
```

| State | Markup | Looks |
|---|---|---|
| idle | none | quiet; `.pill-sub` holds a one-line description or recipe note |
| working | `.is-working` | a 2px tan mark in the margin, the glyph and status line in tan, the line moving on the bottom rule |
| locked by level | `.is-locked` | faded glyph and dim name; `.pill-sub` holds `iconEl("lock")` then "Needs Delving Lv 30"; still opens its popup |
| missing materials | `.is-short` | the status line goes to pencil (faint italic: "Missing Bog Great Blade"); only the figure you are short of turns ember in its `.need` |
| hunt tone | `data-tone="ember"` | ember instead of tan |

- `.pill-sub`: separate parts as `<span>`s and a quiet dot is drawn between them. `<b>` is brighter.
- `.pill-stats`: chips for the numbers (time, XP, held) or `.need`s for recipe inputs. Both are plain writing along the line.
- The (i) opens the stats before you commit: for nodes, time, XP, yield, double yield, held; for gear recipes, a table of stats by rarity (Common to Relic). Build it with `tooltip(infoBtn, () => tipBody({...}), { placement: "left" })`.
- Wire clicks once with `on(view, "click", ".pill-hit", ...)` and read `closest(".item-pill").dataset.action`.
- Updates several times a second: `setWidth(pill bar)`, `setText` on the status parts, `toggleClass(pill, "is-working" | "is-short", ...)`.

Phones (below 768px): the stats wrap under the name, the chevron hides, the (i) stays top right.

**Need**: what a recipe takes, have over need, written.

```html
<span class="need"><svg>ore</svg>Bog Ore <span class="have">147<small>/2</small></span></span>
<span class="need is-short"><svg>ore</svg>Bog Bar <span class="have">0<small>/12</small></span></span>
```

### 7.13 Storage: toolbar, capacity, slots

```html
<section class="card storage-main">
  <div class="toolbar">
    <div class="seg" role="tablist" aria-label="Pool">...Stockpile 24/30 · Vault 8/50...</div>
    <div class="filters" role="group" aria-label="Show">...chip buttons: All, Gear, Materials, Remedies, Tools...</div>
    <div class="toolbar-end">
      <label class="sr-only" for="sortSel">Sort</label>
      <select class="select select-sm" id="sortSel"><option>Custom order</option><option>Rarity</option><option>Name</option></select>
    </div>
  </div>
  <div class="capacity"><span>Capacity</span><b>24 / 30</b><div class="bar bar-thin"><i style="width: 80%"></i></div></div>
  <div class="slot-grid">
    <button class="slot" type="button" data-rarity="common" aria-label="Bog Ore, 147">
      <span class="slot-qty">147</span>
      <span class="slot-art"><svg>ore</svg></span>
      <span class="slot-name">Bog Ore</span>
    </button>
    <button class="slot" type="button" data-rarity="rare" aria-label="Sundering Bog Sword, 100% condition">
      <span class="slot-wear is-fine">100%</span>
      <span class="slot-art"><svg>blade</svg></span>
      <span class="slot-name">Sundering Bog Sword</span>
    </button>
    <div class="slot is-empty" aria-hidden="true"></div>
  </div>
</section>
```

- Show `.slot-qty` (via `fmt(qty)`, so 12,500 reads "12.5K") for stacks, or `.slot-wear` for gear and tools: `.is-fine` above 60%, `.is-worn` 26 to 60%, `.is-bad` 25% and under.
- The grid is one partitioned tray, not a wall of cards: square cells that share their hairline edges. A full cell is a shade lighter than an empty one.
- Rarity shows as a 2px line along the cell's foot and the glyph's colour (common has none).
- States: `.is-empty` (the bare tray, not focusable), `.is-selected` (a 2px bone edge), `.is-dragover` (tan, while dragging to reorder), `.is-locked`.
- Fill the grid to the pool's capacity with empty slots.
- `.capacity.is-full` turns the count ember.
- Five across; four at 479px and below. The toolbar wraps; on phones the sort select takes its own full line.
- `.storage-stack` is a column of two `storageCard`s, used by the Satchel page to put Belongings above the Satchel. `.satchel` is the second card's tighter grid, and `.satchel-next` the line under it naming the draught the next fight would reach (off `bestRemedy`).
- A `storageCard` takes `filters: false` where a pool holds one kind (the Satchel), and a `hint` for a line under its capacity bar. A remedy in Belongings costs a slot a bottle, so it draws as separate cells of 1 rather than one stack, and the capacity line counts them that way.
- Drag to reorder (pages/stockpile.js `storageCard`): set `data-reorder` on `.slot-grid` while the view is in custom order (it also stops a held finger selecting the name or opening the touch callout). While dragging the grid carries `.is-sorting` (a grabbing cursor), the lifted slot `.is-selected` and the place it would take `.is-dragover`; the drop sends `reorder { pool, key, before }`. Mouse: press and move 5px. Touch: hold still 380ms, then move; a finger that moves first scrolls the page. Near the top or bottom edge the page scrolls under the drag; Escape cancels.

### 7.14 Tooltip content classes

Built by `tipBody()`; listed so you can style custom content the same way: `.tip-title` (display), `.tip-sub`, `.tip-text`, `.tip-rows` > `.tip-row` (`.l`, `.v` with `.t-good`, `.t-bad`, `.t-gold`), `.tip-list` (small square bullets in faint bone), `.tip-track` > `.tip-step` (`.g` mark, `.lv`, `.name`, `.v`; `.is-done` inks the mark in and turns its value green, `.is-next` brightens the row), `.tip-table` (first column may carry `.rar-*`), `.tip-foot` (`.t-good` for good news).

### 7.15 Dialog anatomy

Built by `openModal()`; do not write it by hand.

```
.modal-wrap (.is-open, .is-closing, .is-under, .is-dragging)
  .modal-backdrop
  .modal.modal-{sm|md|lg|xl} role="dialog" aria-modal="true"
    .modal-grab                                (phones)
    header.modal-head  > .art.art-lg  .modal-titles (.modal-title, .modal-sub)  .modal-x
    .modal-body                                 (your content; 16px between direct children)
    footer.modal-foot (.is-grid)                (your actions; .wide spans both columns)
```

Body helpers: `.modal-note` (a quiet line), `.modal-section` (sections divided by a line), `.eyebrow` as a block label (8px above the block it labels).

**Confirm** (built by `confirm()`): `.confirm-body`, `.cost` > `.cost-row` (`.is-price`, `.is-left`; `.cost.is-short` makes the last row ember), `.cost-note`, `.confirm-type`.

### 7.16 Toasts

Built by `toast()`: `.toasts` > `.toast[data-kind]` > `.toast-ico`, `.toast-text`, `.toast-action`, `.toast-timer`. Kinds: `info`, `good`, `warn`, `bad`, `gold`.

### 7.17 Banners (notices)

For guests, offline, and anything that applies to the whole page. They go in `#bannerDock`. A notice is a note pinned in the margin: a 2px rule down its side in its tone, a bare glyph, the word, and what to do about it. No box.

```html
<div class="banner" role="status">                                  <!-- data-tone: gold (default), tan, ember, good, veil -->
  <span class="banner-ico"><svg>cloud</svg></span>
  <div class="banner-text"><b>You are playing as a guest</b>Nothing is kept once this tab closes.</div>
  <div class="banner-actions"><button class="btn btn-gold btn-sm" type="button">Sign in</button></div>
</div>
```

Guest: gold, `cloud`, "Sign in". Offline: ember, `offline`, "Your camp keeps running here and syncs when the road clears." Phones: the actions take a full-width line.

### 7.18 Empty states

```html
<div class="empty">                                               <!-- .empty-sm for a small card -->
  <div class="empty-art"><svg>search</svg></div>
  <div class="empty-title">No listings match</div>
  <p class="empty-text">Nobody is selling Wyrm Plank right now. Try another tier, or list your own.</p>
  <button class="btn btn-sm" type="button">Clear filters</button>
</div>
```

Say what is missing and what to do about it. Guests on Market, Party and Hiscores see an empty state with `lock` and a "Sign in" button.

### 7.19 Loading

```html
<span class="spinner" role="status" aria-label="Loading"></span>          <!-- .spinner-sm, .spinner-lg -->
<div class="loading"><span class="spinner"></span>Asking the realm</div>
<span class="skel skel-art"></span>
<span class="skel skel-line"></span>                                     <!-- .skel-title, .skel-block (a pill), .skel-circle -->
```

Skeletons keep the shape of what is coming (use `.skel-block` rows for pills and listings). Set their widths with a page class, not inline. Buttons waiting on the server: `.btn.is-loading`.

Added with the realm pages (pages.css): width steps for skeleton lines, `.skel-w-35`, `.skel-w-50`, `.skel-w-60`, `.skel-w-80` (add `.ml-auto` to push one to the right of a numeric column). Put `.realm-skel` on the container of skeleton `.listing` or `.list-row` rows and their `.skel-art` shrinks to the 36px `art-sm` tile those rows really use.

### 7.20 Camp log

```html
<ol class="log">
  <li class="log-line"><time>40s ago</time><span class="log-msg">Your crews brought up 12 Bog Ore.</span></li>
  <li class="log-line" data-tone="gold"><time>26m ago</time><span class="log-msg">Bog Bar ×20 sold on the market for 266g.</span></li>
</ol>
```

`data-tone` on a line: `good` (levels), `gold` (money), `ember` (deaths, losses), `tan` (party and companions). Times with `fmtAgo()`; redraw at most twice a minute.

### 7.21 Tables

```html
<div class="table-wrap">                                         <!-- scrolls sideways inside a card if it must -->
  <table class="table">
    <thead><tr><th>Rank</th><th>Commander</th><th class="num">Level</th><th class="num hs-hide-sm">XP</th></tr></thead>
    <tbody>
      <tr class="is-me" aria-current="true">
        <td><span class="hs-rank">7</span></td>
        <td class="strong"><span class="hs-name"><span class="avatar avatar-sm">M</span><span class="truncate">Morwen</span><span class="tag tag-bone">You</span></span></td>
        <td class="num">318</td><td class="num hs-hide-sm">4.6M</td>
      </tr>
    </tbody>
  </table>
</div>
```

`.num` right-aligns with tabular figures; `td.strong` is the bright column; `tr.is-me` inks your row darker and marks it with a bone rule in the margin.

### 7.22 Initials and figures

```html
<span class="avatar" aria-hidden="true">T<span class="dot dot-online"></span></span>   <!-- .avatar-sm 28px, .avatar-lg 64px; data-tone gold, ember, good, tan -->
<div class="portrait"><img src="assets/commander-default.webp" alt=""></div>
```

An avatar is the first letter of a name, inked, with a rule under it in its tone. No tile. A `.dot` inside sits on its corner. `.portrait` has no frame: the commander's painting is already cut out, so the figure stands straight on the page (`object-fit: contain`, from the floor up) and all the class adds is the shadow under her feet. Page classes set the size.

### 7.23 Utilities (base.css)

- Type: `.display`, `.eyebrow`, `.title-lg`, `.title-md`, `.title-sm`, `.lead`, `.copy`, `.small`, `.tiny`, `.muted`, `.dim`, `.strong`, `.num`, `.nowrap`, `.truncate`, `.clamp-2`, `.break`, `kbd` / `.kbd`.
- Tones (these win over component colours): `.t-tan`, `.t-veil`, `.t-ember`, `.t-gold`, `.t-good`, `.t-warn`, `.t-bad`, and rarity names `.rar-common` to `.rar-relic`.
- `.voice`: a line in the chronicle's voice (italic display type, `--text-lg`): what a place is like, what a thing was.
- Layout: `.vstack`, `.hstack`, `.wrap`, `.grow`, `.shrink-0`, `.ml-auto`, `.center`, `.between`, `.end`, `.items-start`, `.items-baseline`, `.gap-1` to `.gap-6`, `.mt-1`, `.mt-2`, `.mt-3`, `.mt-4`, `.mt-6`, `.full`.
- Access: `.sr-only`, `.skip-link`, `.hover-only`, `.touch-only`.

---

## 8. Page recipes

What each page is built from. Page-only classes live in `pages.css`. See each page in `dev/kit.html?page=<name>`.

### 8.1 Character (`?page=character`)

```html
<div class="page">
  <section class="char-hero">
    <div class="portrait char-portrait"><img src="assets/commander-default.webp" alt=""></div>
    <div>
      <div class="eyebrow page-eyebrow">In Gallowmoor</div>
      <h1 class="char-name">Morwen</h1>
      <div class="chip-row char-tags">
        <span class="tag tag-veil">Warrior</span>                      <!-- the discipline, only once picked -->
        <span class="chip"><svg>paw</svg>Tunnel Rat</span>
        <span class="chip chip-gold"><svg>scroll</svg>Bounty 12 of 17</span>
      </div>
    </div>
    <div class="char-total"><span class="char-total-v">187</span><span class="eyebrow">Total level</span></div>
  </section>

  <div class="grid-cards max-2">
    <article class="card act-card" data-tone="tan">                    <!-- the hunt card: data-tone="ember", .bar-ember -->
      <div class="act-card-top">
        <div class="art" aria-hidden="true"><svg>pick</svg></div>
        <div class="grow"><div class="eyebrow">The crews · Delving</div><h2 class="card-title">Bog Ore</h2></div>
        <button class="btn btn-sm btn-quiet" type="button">Stop</button>
      </div>
      <div class="bar"><i style="width: 36%"></i></div>
      <div class="act-card-meta"><span>42 of 200 actions</span><b>1h 12m left</b></div>
    </article>
    ...
  </div>

  <section class="card">
    <div class="card-head"><div><h2 class="card-title">Standing</h2></div><div class="card-actions">...Armaments link...</div></div>
    <div class="standing">
      <div class="standing-cell"><div class="v">112</div><div class="eyebrow l">Health</div></div>
      ...Attack, Defence, Kills, Deaths, Gold earned (v t-gold)...
    </div>
  </section>

  <section class="section">
    <div class="section-head">...Skills...</div>
    <div class="grid-cards skills-grid">
      <a class="skill-card is-working" href="#/skill/delving">           <!-- data-tone="ember" for the Hunt -->
        <div class="art art-sm" aria-hidden="true"><svg>pick</svg></div>
        <div class="skill-main">
          <div class="skill-name">Delving <span class="dot dot-working" role="img" aria-label="Working"></span></div>
          <div class="skill-xp">58.2K / 66.9K XP</div>
        </div>
        <div class="skill-lv"><small>Lv</small>24</div>
        <div class="bar"><i style="width: 45%"></i></div>
      </a>
    </div>
  </section>
</div>
```

Idle activity card: `.act-card.is-idle` with a neutral art tile, a title ("No crews at work", "Recovering"), `p.act-card-idle` copy and a small default button ("Open Delving"). Recovering uses `.bar-striped` and "Back in 3m 12s". The camp log goes in `#logDock` under this page. Phones: the total level sits under the name row; the skills grid is two across; standing numbers shrink.

### 8.2 Gathering skill page (`?page=gather`)

1. `.hero` with the Mastery `.tip-chip` (tooltip: `tipBody` with `title`, `list` of lore, `track` of mastery steps, `foot`) and XP modifier chips.
2. `section.section` with a `.section-head` ("The seams of Gallowmoor"; the tool in hand as a chip on the right) and `.pills`: one `.item-pill` per node in the current region, in order. Working, idle and locked states as in 7.12.
3. The camp:

```html
<section class="card card-flush">
  <div class="card-head"><div><h2 class="card-title">The camp</h2><p class="card-sub">It grows each time Delving reaches a new tier.</p></div>
    <div class="card-actions"><span class="chip">Tier 3 of 9</span></div></div>
  <div class="camp-scene"><svg viewBox="0 34 1000 186" preserveAspectRatio="xMidYMax slice" role="img" aria-label="The Delving camp">...</svg></div>
  <div class="camp-foot"><b>Crates and barrels</b><span>Next at Lv 30: a proper work site</span></div>
</section>
```

The scene SVG is v4's `campScene()` output unchanged: it draws with the `c-*` classes (`c-moon`, `c-star`, `c-tree`, `c-hill-far`, `c-hill-near`, `c-hill-mid`, `c-ground`, `c-stake`, `c-sil`, `c-dark`, `c-void`, `c-rim`, `c-wood`, `c-wood.thin`, `c-rope`, `c-light`, `c-lamp`, `c-lamp-glow`, `c-door`, `c-ember`, `c-flame`, `c-cloth`, `c-fig`, `c-tool`, `c-toolhead`, `c-herb`, `c-hide`, `c-water`, `c-shine`, `c-plank`, `c-wheel`, and the flickering `g.camp-fire`), all in pages.css. Insert it with `h("div.camp-scene", { html: svgString })`.

### 8.3 Artisan bench (`?page=bench`)

```html
<section class="section">
  <div class="bench-bar">
    <div class="seg" role="tablist" aria-label="Bench">...Components 4 · Wares 7...</div>
    <div class="tier-row" role="group" aria-label="Tier">...unlocked tiers, then one .tier.is-next...</div>
  </div>
  <div class="bench-group">
    <div class="bench-label"><span class="eyebrow">Weapons</span><span class="count">2</span></div>
    <div class="pills">...item pills with .need chips...</div>
  </div>
  <div class="bench-group">...Armour...</div>
</section>
```

Recipe pills: `.pill-sub` holds "Rarity is rolled when it is made" (gear), "Missing Bog Great Blade" with `.is-short`, or the running status with `.is-working`. `.pill-stats` holds a `.need` chip per input and a time chip. The (i) opens the crafted-stats tooltip: `tipBody({ title, sub: "Rarity is rolled when it is made", table: { head: ["Rarity", "Attack", "Crit", "Durab."], rows: [{ rarity: "common", cells: [...] }, ...through relic] }, foot })`. The same content also belongs in the recipe popup. Phones: the segment stretches full width above the tier row.

### 8.4 Action popup (`?page=gather&modal=action`)

`openModal({ title: "Bog Bar", sub: "Forgemaster · Tier 2 · At camp", art: "ore", body, actions })` with these body parts in order (leave out what does not apply):

```html
<p class="ap-desc">Dark iron from the moor, beaten flat. It still smells of peat.</p>
<div class="chip-row">...XP modifier chips...</div>
<div class="stats">...Time, Experience, Makes / Yield, Double yield, Held; "Needs · Forgemaster Lv 30" first (v t-bad) when locked...</div>
<div class="ap-block">
  <div class="eyebrow">Needs</div>                                      <!-- "Also turns up" for gathering; "Turns up here" and "Drops" for the hunt -->
  <div class="ap-list">
    <div class="ap-row">
      <button class="ap-link" type="button"><svg>ore</svg><span>Bog Ore</span></button>   <!-- opens that item's popup; data-tone="ember" for foes -->
      <span class="ap-val is-short">200 for 100 · 147 held</span>
    </div>
  </div>
</div>
<div class="ap-run">                                                    <!-- only while this action runs; data-tone="ember" for the hunt -->
  <div class="ap-run-top"><span>Underway · 18 of 60</span><b>9m left</b></div>
  <div class="bar"><i style="width: 62%"></i></div>
</div>
<div class="ap-block"><div class="eyebrow">How many</div>...qty picker...</div>
<p class="ap-plan"><span><b>100 × Bog Bar</b> · 33m 20s · 800 XP</span><span class="t-warn">Stock covers 15.</span></p>
```

Actions: `{ label: "Stop", kind: "quiet" }` first while running, then the verb: `{ label: "Forge", kind: "primary" }` ("Delve", "Fell", "Carve"...; the Hunt uses `kind: "ember"` with "Hunt" or "Move the hunt here"). Disabled start labels: "Needs Lv 30", "Missing materials", "Recovering". Plan line with no limit: "No limit · stock covers 15" or "No limit · up to 2,700 in twelve hours"; for the hunt "No limit · until you pull back, fall or twelve hours pass". Foe popups (`?page=hunt&modal=foe`) pass the monster drawing as `art` (an `svg.m-art` string; it fills the glyph's square, with nothing behind it) with `artTone: "ember"`, a `.stats` block (Health, Attack, Against you, Defence, Swings every, Experience, Threat, Gold, As an Elite), a Drops `.ap-list`, and one wide action back to the zone they were opened from.

### 8.5 Item popup (`?page=storage&modal=item`, `&modal=stack`)

`openModal({ title, sub: "Rare weapon · Tier 2 · Belongings ×2", art: iconName, artRarity: rarity, body, actions })`:

```html
<p class="ip-desc">Bog iron that remembers being something else.</p>
<div class="ip-effect"><b>Sundering. </b>Ignores some of a foe's Defence.</div>             <!-- prefixed gear only -->
<div class="stats">...Attack +14 <span class="delta up">+3</span>, Crit chance, Veil a blow, Grip, Durability or Condition, Value (t-gold), Held in all...</div>
<div class="well ip-compare"><svg>swords</svg><span>Against your worn <b>Slag Sword</b>. Equipping it moves the Slag Sword to Belongings.</span></div>
<dl class="ip-sources"><dt>Made by</dt><dd>Forgemaster</dd><dt>Dropped by</dt><dd>Bog Brute</dd></dl>
<div class="ap-block"><div class="eyebrow">Amount</div>...qty picker without No limit, only when more than one...</div>
```

Actions (a grid footer): the main action `wide` and `kind: "primary"` ("Equip · Weapon", "Take up · Delving", "Open · +5 Stockpile slots", "Unequip"), then "Move to Stockpile", "Move to Vault", "Sell · 186g" (`kind: "gold", soft: true`, behind a confirm for rare and better), "List on market" (`kind: "primary", soft: true`, opens the sell dialog on top: return `false` so the item popup stays), and "Break down · 6 Bog Bar" (`kind: "quiet", wide: true`). With an amount picked, labels carry it: "Move 147 to Vault", "Sell 147 · 2,058g".

Built: `src/client/ui/popups/item.js` registers `item` as `openPopup("item", ctx, key, { from, readOnly })` (the dev runner's positional `args=["key","bank",{"readOnly":true}]` also works). `from` decides the actions: a pool (`inv`, `bank`, `vault`) gives the main action, Move to the other two pools, Sell, List on the market (account mode, tradeable), Repair (gear with wear) and Break down; `"worn"` gives Unequip and Repair for gear, "Stow in Stockpile" for a racked tool; `null` or `readOnly` gives the facts and no footer. A remedy reads "Heals 70 · taken automatically on the hunt at 45% health" in a `.well.ip-compare` with `heart`; a chest says how far it widens the Stockpile. Stat deltas come from `combatStats` with the piece swapped in, so relic effects count. The popup keeps itself current on `ctx.onTick` and closes when the item leaves the place it was opened from.

### 8.6 Storage pages: Stockpile and Armaments (`?page=storage`, `?page=armaments`)

```html
<div class="page">
  <header class="page-head">...</header>
  <div class="storage">
    <section class="card storage-main">...toolbar, capacity, slot grid (7.13)...</section>
    <aside class="storage-side">...side cards...</aside>
  </div>
</div>
```

At 1200px and up the side column (372px) sits beside the grid and sticks under the topbar; below it stacks under the grid. Stockpile side: "Tools in hand" (a `.list` of the five trades: tool name, speed chip, wear) and "Camp standing" (`.stats`). Remedies are stored in Belongings (Armaments), not the Stockpile.

**Paperdoll** (Armaments side):

```html
<section class="card">
  <div class="card-head">...Worn · Warrior chip...</div>
  <div class="doll">
    <div class="doll-col">                                                  <!-- Head, Chest, Hands, Feet -->
      <button class="doll-slot" type="button" data-rarity="uncommon" aria-label="Head: Bog Helm, 84% condition">
        <span class="doll-slot-top"><span class="doll-slot-l">Head</span><span class="doll-wear is-fine">84%</span></span>
        <span class="doll-slot-art"><svg>cowl</svg></span>
        <span class="doll-slot-name">Bog Helm</span>
      </button>
      <div class="doll-slot is-empty" role="img" aria-label="Feet: empty">
        <span class="doll-slot-top"><span class="doll-slot-l">Feet</span></span>
        <span class="doll-slot-art"><svg>treads</svg></span>
        <span class="doll-slot-name">Empty</span>
      </div>
    </div>
    <div class="doll-figure">
      <div class="portrait"><img src="assets/commander-default.webp" alt=""></div>
      <div class="doll-name">Morwen</div>
      <div class="doll-sub">Warrior · Gallowmoor</div>
    </div>
    <div class="doll-col">...Weapon, Offhand, Neck, Ring...</div>
  </div>
</section>
```

A two-handed weapon: render the offhand slot as `.doll-slot.is-empty.is-blocked` with the name "Both hands". Wear thresholds as for slots. Below the doll, a "Standing" card of `.stats` (Discipline, Health, Attack, Defence with "stops 31% here", Swing, Crit chance, Crit damage, Penetration, Veil, Hunt level). Phones: the slot columns are 88px and the figure takes the middle.

Armaments renders a two-handed weapon as one spanning slot instead: `.doll-col.has-span` turns that column into four equal rows and the weapon's `button.doll-slot.is-span` takes two of them (Weapon and Offhand), so it lines up exactly with two slots across the figure; the offhand slot is not rendered. The slot columns follow `DOLL_ORDER`: armour (head, chest, hands, feet) on the left, weapon, offhand, neck and ring on the right. Belongings on Armaments has no pool tabs: its toolbar starts with an `h2.card-title` "Belongings"; the Stockpile page's `.seg` switches between the Stockpile and the Vault. Discipline and Veil rows (and the Worn card's class chip) appear only once a discipline is chosen.

### 8.7 Hunt (`?page=hunt`, `&field=fight|quiet|search|sovereign|down|party`)

The hunt is a place, not a panel. The page is `div.page.hunt-page` and opens on the scene itself: there is no `.hero`, because the ground you hunt is the page's title and the level, the XP line and the modifier chips are written into the scene's head. Nothing in the scene is a card, a tile or a pill, and there is no "VS": what the fight is doing is set in large italic type between the two sides.

1. The scene:

```html
<section class="scene" data-state="fight" aria-label="The field">     <!-- quiet | search | fight | sovereign | down; .is-party for the shared fight -->
  <div class="scene-sky" aria-hidden="true"></div>                     <!-- the backdrop and nothing else: sky, a dead treeline, smoke, ground -->
  <header class="scene-head">
    <div class="scene-where">
      <div class="eyebrow">The Field · Hunt</div>
      <h1 class="scene-title">The Inner of Gallowmoor</h1>              <!-- not hunting: the region's name -->
      <p class="scene-sub">Two or three at once · ×1.7 XP a kill</p>
      <div class="scene-company"><span class="chip chip-good"><svg>party</svg>Thane hunts here too</span></div>
    </div>
    <div class="scene-rank">                                            <!-- all the masthead the hunt has -->
      <div class="scene-lv"><small>Hunt Lv</small>31</div>
      <div class="bar bar-thin"><i></i></div>
      <div class="scene-xp-meta"><span class="scene-xp-sub">120,450 / 131,600 XP</span><span class="scene-xp-next"><b>11,150</b> to Lv 32</span></div>
      <div class="chip-row scene-tags"><span class="tag tag-veil">Warrior</span><span class="chip chip-good">+8% XP · Veil Hound</span></div>
    </div>
  </header>
  <div class="scene-stage">
    <div class="scene-side">
      <div class="fighter fighter-you" data-veil="6">                   <!-- .is-down recovering, .is-dead on the killing blow, .is-charged at a full Veil -->
        <div class="fx-layer"></div>
        <div class="portrait fighter-art"><div class="fighter-mist" aria-hidden="true"></div><img src="assets/commander-default.webp" alt=""></div>
        <div class="fighter-plate">
          <div class="fighter-name">Morwen</div>
          <div class="vital"><div class="vital-line"><i></i></div><span class="vital-text">87 / 112</span></div>
          <div class="vital vital-veil">...Bulwark · 64 of 100...</div>  <!-- only once a discipline is held -->
        </div>
      </div>
      <div class="scene-band" data-n="4" hidden>...</div>               <!-- the warband, while the party is out -->
    </div>
    <div class="scene-state" role="status">
      <div class="scene-status">Fighting</div>                          <!-- Searching, A Sovereign, Recovering, Something vast approaches -->
      <div class="scene-timer">Reinforcements in 31s</div>
    </div>
    <div class="scene-foes">
      <div class="fighter fighter-foe is-target">                       <!-- .is-elite, .is-sovereign; .is-gone sinks a fallen foe -->
        <div class="fx-layer"></div>
        <button class="fighter-art foe-art" type="button" aria-label="Fen Stalker: details"><svg class="m-art" viewBox="0 0 120 120">...</svg></button>
        <div class="fighter-plate">
          <div class="fighter-name"><span>Fen Stalker</span><span class="tag tag-elite">Elite</span></div>
          <div class="vital vital-foe">...22 / 48...</div>
          <div class="fighter-on">On Thane</div>                        <!-- the party's fight only -->
        </div>
      </div>
      <!-- no foes: <div class="scene-empty"><span class="scene-empty-title">The Inner lies quiet</span><span class="scene-empty-sub">Nothing is being hunted here.</span></div> -->
    </div>
  </div>
  <footer class="scene-foot">
    <div class="kpis">...Kills, XP/hr, DPS, Sovereign (with a line), Time left...</div>   <!-- not hunting: <p class="scene-hint">Choose a zone below to take up the hunt.</p> -->
    <div class="scene-actions"><button class="btn btn-quiet" type="button">Pull back</button><button class="btn" type="button">Change hunt</button></div>
  </footer>
</section>
```

- **A fighter** is a figure, a name and a vital. Every `.fighter-plate` is the same height, so every pair of feet comes down on the same ground. The foe you are on (`.is-target`) stands nearest, largest and fully lit; the rest hang back smaller and dimmer. Reinforcements come in from the right; the fallen sink (`.is-gone`, removed after 700ms). Foes are keyed by uid and updated in place.
- **One measure.** `--figure-h` on `.scene` is how tall you stand, cut from the window's height (`100dvh - 510px`, clamped 260 to 500px), and every foe's size is cut from it. That is what keeps the whole fight, down to the last line of health, above the fold on a laptop.
- **`data-state`** turns the light. `fight` lays ember heat on the ground under the foes (`--scene-heat`); `sovereign` turns the horizon and the ground violet, because a Sovereign is of the Veil; `search` quickens the smoke; `quiet` hides the state block and says the quiet once, large, where the foes would stand; `down` greys you.
- **The Veil** is weather at your feet: `.fighter-mist` thickens in tenths with `data-veil="0..10"` on `.fighter-you` (an attribute, so no inline style is needed), and `.is-charged` puts a violet rim on the figure. The `.vital-veil` hairline keeps the exact figure. These two and the Sovereign's light are the only violet in the scene.
- **The sky bleeds.** `.scene-sky` runs from the sidebar to the far edge of the window where the browser supports `overflow: clip` (`.main` clips; a scroller would unstick the sticky side panels elsewhere) and fades into the page at its sides and top. The lights that belong to the fighters sit on `.scene::before`, in the scene's own box, so they stay under the figures however wide the sky is.
- Floats: append `<span class="float {kind} lane{0|1|2}">Crit</span>` to the fighter's `.fx-layer` and remove it after 1 second. They are words in italic ink, never damage numbers: `crit` (gold), `strike`, `ambush`, `empowered`, `veil`, `volley` (veil), `bleed`, `thorns`, `hurt`, `ambushed` (ember), `heal` (green, a figure), `block`, `dodge`, `glance`, `join`, `enrage` (small caps). Cycle the lane so blows do not overlap. Show at most the last 8 per frame.
- Struck: remove `.struck` from the art, read `offsetWidth`, add `.struck` (a 260ms shake and flash).
- Monster drawings: `MONSTER_ART` markup inside `svg.m-art` (`.elite`, `.sovereign` stroke colours), classes `m-body`, `m-void`, `m-eye`, `m-edge`, `m-steel`, `m-crack`, `m-bone`. Inside `.scene` they are restyled as shapes: black against the smoke, a rim of firelight, the eyes lit.
- The go button is `.btn-ember` only while nobody is out ("Hunt the Inner"): setting out is the one solid plate the scene ever shows.

2. The descent. The four zones are one road going down, so they are drawn as one: a line from bone at the camp's edge to ember by the Core, a stop each.

```html
<ol class="descent">
  <li><button class="descent-stop is-active" type="button" data-depth="3" aria-current="true">
    <span class="descent-mark" aria-hidden="true"></span>
    <span class="descent-name">Inner</span>
    <span class="descent-sub">2 or 3 at once</span>
    <span class="descent-sub">×1.7 XP · ×1.27 foes</span>
    <span class="descent-tag">You hunt here</span>                      <!-- empty on the other three -->
  </button></li>
</ol>
```

3. The quarry, stood in a line on one floor the way a field guide plates its specimens: `div.lineup` of three `button.specimen` and one `button.specimen.is-sovereign` (wider, larger, its kind in veil). Each is `span.foe-art` (the drawing, feet on the floor rule), `span.specimen-kind` ("Stalker"), `span.specimen-name`, `span.specimen-sub` ("48 health · swings every 2.4s").

`.foe-tile` (glyph, name, sub, in a ruled row) is still the kit's compact foe entry: the Character page's Collection lists every foe in the world with it.

Phones (below 768px): the scene stacks. Foes stand in a row at the top, the state is one centred line under them, and you stand at the bottom left with your name and lines beside you rather than under you. The descent turns on its end (a line down the margin, a stop a row) and the quarry stands two by two.

The party's shared fight is the same scene with `.is-party`: your own figure is hidden and `.scene-band` stands the whole warband where you stood, you first (`div.fighter.band-mate`, `.is-me`, `.is-down`; a `.vital-sm` each, reading "Fallen" or "Waiting" where that applies). The state moves above the stage as one line, and the foes, up to a dozen, stand in ranks of small figures with `.fighter-on` saying who each is on. The band is a sibling of `.fighter-you`, not a child, so hiding your figure leaves it standing.

### 8.8 Atlas (`?page=atlas`)

```html
<div class="atlas">
  <section class="card atlas-regions">
    <div class="card-head">...Regions · "2 of 9 open" chip...</div>
    <div class="pick-list" role="listbox" aria-label="Regions">
      <button class="pick-row is-current" role="option" aria-selected="false">...tier, name, sub, <span class="tag tag-bone">Here</span></button>
      <button class="pick-row" role="option" aria-selected="false">...<span class="tag tag-good">Open</span></button>
      <button class="pick-row is-locked is-selected" role="option" aria-selected="true">...<span class="region-toll"><svg>lock</svg>100g</span></button>
    </div>
  </section>
  <section class="card card-flush atlas-detail">
    <div class="atlas-vista"><svg viewBox="0 0 600 100" preserveAspectRatio="none">three hill paths: .v-far .v-mid .v-near</svg>
      <div class="atlas-vista-tier"><span class="tag tag-gold">Tier 3</span></div></div>
    <div class="atlas-body">
      <h2 class="atlas-title">The Cold Warrens</h2>
      <p class="atlas-note">Tunnels under the moor.</p>
      <div class="atlas-facts">
        <div class="atlas-fact"><div class="eyebrow">Gear around</div><div class="v">Lv 20</div></div>
        <div class="atlas-fact"><div class="eyebrow">Your Hunt</div><div class="v t-good">Lv 31</div></div>
        <div class="atlas-fact"><div class="eyebrow">Toll</div><div class="v t-gold">100g</div></div>
      </div>
      <div class="atlas-block"><div class="eyebrow">Lives here</div><div class="chip-row">...foe chips, the Sovereign as chip-veil with skull...</div></div>
      <div class="atlas-block"><div class="eyebrow">Yields</div><div class="chip-row">...material chips...</div></div>
      <div class="atlas-block"><div class="eyebrow">Your standing</div><div class="stats">...Threat here, Remedies held, Suits your gear...</div></div>
    </div>
    <div class="atlas-actions">
      <span class="small muted">Pay once. The road stays open.</span>
      <button class="btn btn-gold" type="button"><svg>coin</svg>Pay 100g and travel</button>   <!-- open: "Travel here" (primary); here: no button -->
    </div>
  </section>
</div>
```

The detail panel updates as a region is picked (arrow keys should move the selection). The toll goes through `confirm({ cost })`. `.region-toll.is-short` greys a toll you cannot pay. At 768px and up: list 260 to 340px beside a sticky detail; below, the list sits above the detail.

Added with the live page (pages.css, Atlas):

- Strata: the rows sit in `div.atlas-group[role="group"][aria-label]`, one per stratum, each opened by `div.eyebrow.atlas-stratum` (aria-hidden, the group carries the name). Row subs stay short: "Gear around Lv 30".
- `.pick-row.is-far` (with `.is-locked`): ground past a road not yet opened. Its name, sub ("Beyond Graveshelf") and toll fade; the detail's action is a disabled `btn` with `lock`, "Open Graveshelf first".
- `.atlas-yields` on the Yields `.chip-row`: `.chip.is-locked` (dashed, faint, `lock` icon) for a raw material no trade of yours is high enough to work; a `p.small.muted` under it says how many can be worked.
- `.kpis.atlas-threat`: Threat in the region's four zones (`.kpi` with `.l` zone, `.v` Threat, a thin ember bar, and `.s.t-ember` "Hunting" on the zone being hunted). Four across, two on phones. Only once you have hunted there; otherwise a "Threat here · None yet" stat.
- The vista's hills are drawn per tier (same three `v-*` paths, rougher in deeper strata), and `.atlas-vista-tier` holds a `.chip-row` of the tier tag and a plain stratum tag.
- Leaving ground with an unclaimed bounty that has progress shows a `span.small.t-warn` note in `.atlas-actions`, and free travel then asks first (`confirm`, "Travel anyway"): the board re-posts for the new ground.

### 8.9 Shop (`?page=shop`)

- Page actions: the world clock `<span class="clock"><svg>clock</svg>22:03:52 UTC</span>` (`fmtClock`), with a `data-tip` saying bounties and the Smuggler run on it.
- "The Bonesetter" card (`card-title` icon `bonesetter`): a `.list` of `.list-row.shop-row.stack-sm` rows: art `ration` with `data-tone="good"`, title, sub "Restores 70 HP · 4 in Belongings", end: `.price` each, a `.qty-stepper.qty-sm`, and "Buy" (`btn-gold btn-soft btn-sm`). Buying opens `confirm({ cost })` for the total.
- "The Smuggler" card (`hourglass`), `card-actions` holds the timer chip ("Moves on in 1h 56m", `chip-gold`, `clock`). Rows: "13× Wyrm Plank", "Tier 7 · 8,112g the lot", price, "Buy". A bought row: `.is-dealt` and a `tag-good` "Dealt" instead of the price and button.
- Added with the live page (pages.css, Shop): in a Bonesetter row the stepper and the Buy button sit together in `div.shop-buy` after the `.price`. The button carries the total ("Buy for 25g") and has a 132px floor on wider screens so the steppers line up. On phones the row end may wrap: `.shop-buy` then drops under the price and keeps to the right. The compact stepper is `qtyPicker({ presets: [], allowUnlimited: false })` with its `.qty-stepper` taken out and given `.qty-sm`.

### 8.10 Bounties (`?page=bounties`)

```html
<section class="card bounty" data-tone="gold">
  <div class="art art-lg" data-tone="gold" aria-hidden="true"><svg>scroll</svg></div>
  <div><div class="eyebrow">Posted for Gallowmoor</div><h2 class="bounty-title">Put down 17 of whatever holds Gallowmoor</h2></div>
  <div class="bounty-progress">
    <div class="meter-top"><span>Progress</span><b>12 of 17</b></div>
    <div class="bar bar-gold bar-lg"><i></i></div>
    <div class="chip-row"><span class="chip chip-gold"><svg>coin</svg>Pays 27g</span><span class="chip chip-good"><svg>sparkle</svg>An hour of double XP</span></div>
  </div>
  <div class="bounty-foot"><span class="small muted">Kills anywhere in Gallowmoor count.</span><button class="btn btn-gold" type="button">Claim 27g</button></div>
</section>
```

The claim button reads "5 more to go" (disabled) until done, then "Claim 27g", then "Paid out" (disabled). Page actions: the world clock and "New posting in 1h 56m". Earlier postings: a `.list` with `tag-good` "Paid out" or a plain "Expired" tag.

### 8.11 Requisitions (`?page=requisitions`)

Only rendered once a tier 2 region is unlocked.

- Page actions: `<span class="req-slots" role="img" aria-label="1 of 3 deployments used"><i class="req-pip is-used"></i><i class="req-pip"></i><i class="req-pip"></i></span>` and "2 of 3 left today".
- "Out on a run" card: a `.list` of pending runs (avatar, name, "14 × Bog Ore, back at the daily reset", a time chip).
- "The roster" section: head with "Hire an Agent · 250g" (`btn-gold`, confirm with cost), then `.grid-cards` of agent cards:

```html
<article class="card agent-card">                                          <!-- .is-out while on a run -->
  <div class="agent-top"><span class="avatar" data-tone="gold">E</span>
    <div class="grow"><div class="agent-name">Edda Fell</div><div class="chip-row mt-1"><span class="tag" data-rarity="epic">Epic</span></div></div></div>
  <p class="agent-yield">Returns about 48 of whatever you ask for.</p>
  <div class="agent-deploy"><select class="select select-sm" aria-label="Send Edda Fell for">...</select><button class="btn btn-primary btn-soft btn-sm" type="button">Deploy</button></div>
</article>
```

The live page puts only a `btn-block` "Deploy" in `.agent-deploy` ("None left today", disabled, once three are out). It opens a small dialog: `openModal({ title: "Send an Agent out", art: "crate", size: "sm" })` with two `.field`s (Agent, and Bring back: a `select.select` of `requisitionTargets` in `optgroup`s, Reagents then "Tier 3 · The Cold Warrens"), a `p.ap-plan` ("12 × Cold Ore back in 6h 12m", "Into the Stockpile · 40 held") and Cancel / Deploy (primary). An empty roster is a `.card` with `.empty.empty-sm` (`crate`).

### 8.12 Companions (`?page=companions`)

`.grid-cards` of `.card.comp-card` (`.is-active` for the one at your side): `.comp-top` (art `art-lg`, tan when owned and neutral when not; `.comp-name`; `.comp-sub` "Rank II · Bond 7" or the price; `tag-tan` "At your side"), `p.comp-blurb`, `.well.comp-trait` (`.t-name`, `.t-val` green), a `.meter` for Bond when owned, `ul.comp-unlocks` (`li.is-open` for unlocked: `span.g` with a check icon, `span.req` "Bond 10" or "Rank III", then the text), and `.comp-actions`: "Take along" (`btn-primary btn-soft`), "Leave at camp" (`btn-quiet`) or "Buy · 300g" (`btn-gold btn-soft`, confirm with cost). Page actions: "Tunnel Rat walks with you" chip.

### 8.13 Sky (`?page=sky`)

```html
<ol class="forecast">
  <li class="fc-day is-today" aria-current="date">                               <!-- .is-past for days gone -->
    <div class="fc-when"><span class="eyebrow">Today</span><span class="fc-date">16 Sep</span></div>
    <span class="fc-ico"><svg>moon</svg></span>
    <div class="fc-body"><div class="fc-name">Faint Gloom</div><div class="fc-mods"><span class="up">+9% Flaying</span><span class="down">−9% Harvesting</span></div></div>
    <span class="tag tag-gold">Bountiful</span>                                   <!-- weekends; otherwise an empty span -->
  </li>
</ol>
```

Seven columns in one ruled strip; below 900px, seven rows.

### 8.14 Market (`?page=market`, `&modal=sell`)

- Page actions: "Sell an item" (`btn-primary`, `tag` icon) opens the sell dialog.
- Listings card (`card-flush`): `card-head` holds the title and a `.market-bar` (`.input-wrap.market-search` with `search`, a `.seg` of kinds, tier and sort selects).

  The market is anonymous both ways, so no row names anybody: the fourth column is the
  depth behind the price, not a seller. A row can only ever tell you that it is *yours*
  (`.is-mine`, from the `mine` flag the realm sends on your own rows).

  Two kinds of row, because two kinds of goods. Materials are fungible, so every open
  listing of one is merged into a pool: how many there are, the cheapest price, and the
  price bands behind it. Gear and tools are not, so they stay one row a piece.

```html
<div class="listings" role="table" aria-label="Listings">
  <div class="listing-head" role="row"><span>Item</span><span class="num">Left</span><span class="num">Each</span><span>Price bands</span><span></span></div>

  <!-- a material pool -->
  <div class="listing" role="row">
    <div class="listing-item"><div class="art art-sm" aria-hidden="true"><svg>ore</svg></div>
      <div class="lr-main"><div class="lr-title">Slag Ore</div><div class="lr-sub">Ores · Tier 1</div></div></div>
    <div class="listing-qty"><span class="listing-l">Left</span>55</div>
    <div class="listing-price"><span class="listing-l">From</span>12g</div>
    <div class="listing-depth"><span class="listing-l">Price bands</span>40 at 12g · 15 at 13g</div>
    <div class="listing-buy"><button class="btn btn-gold btn-soft btn-sm" type="button">Buy</button></div>
  </div>

  <!-- one piece of gear -->
  <div class="listing" role="row">                                               <!-- .is-mine for your own -->
    <div class="listing-item"><div class="art art-sm" data-rarity="rare" aria-hidden="true"><svg>blade</svg></div>
      <div class="lr-main"><div class="lr-title rar-rare">Sundering Bog Sword</div><div class="lr-sub">Rare weapon · Tier 2</div></div></div>
    <div class="listing-qty"><span class="listing-l">Left</span>1</div>
    <div class="listing-price"><span class="listing-l">Each</span>420g</div>
    <div class="listing-depth"></div>
    <div class="listing-buy"><button class="btn btn-gold btn-soft btn-sm" type="button">Buy</button></div>   <!-- yours: "Remove" (btn-quiet) -->
  </div>
</div>
```

  Below 768px each listing stacks into one ruled entry: item and price on top, "Left", the bands and Buy below (the `.listing-l` labels appear).
- Buying: pick a quantity if more than one, then `confirm({ cost })`.
- "My listings" (`.list`, a thin gold bar of how much sold, Cancel) and "Recent sales" (`.list`, `.price` "+67g" or `.price.is-short` "−420g") share a `.grid-2`.
- Sell dialog body: a qty picker (no No limit), a price field (`.input-wrap` with `coin` and `.affix` "g", a hint with the lowest listing and the merchant price), and a fee preview:

```html
<div class="fee">
  <div class="cost-row"><span class="l">Listing 20 × 14g</span><span class="v">280g</span></div>
  <div class="cost-row"><span class="l">Market fee (5%)</span><span class="v">−14g</span></div>
  <div class="cost-row is-total"><span class="l">You receive when it all sells</span><span class="v"><svg>coin</svg>266g</span></div>
</div>
```

  Actions: "Cancel" (quiet) and "List for sale" (primary, returns the server Promise so the button shows loading).
- Added with the live page (pages.css, Market): the tier and sort selects sit straight in the `.market-bar` (`.market-bar > .select` keeps its own width, no inline style). A listing's item name is `button.lr-title.listing-name` (it opens the item popup read only; underlined on hover); the kind, tier and time left share its `.lr-sub` ("Bars · Tier 2 · 6d 21h left"). The page actions are "Refresh" (`btn-quiet`, `sync`) and "Sell an item"; with no item, the `sell` popup first lists what can be listed, pool by pool. Buying a stack opens a small dialog (an `.ap-block` "How many" picker without No limit, an `.ap-plan` line, "Buy for 60g" gold) before `confirmSpend`; one of a kind goes straight to `confirmSpend`.

### 8.15 Party (`?page=party`)

- Not in a party: an `.empty` ("You march alone") with a party name input and "Found a party"; incoming invites below it as `.list-row.stack-sm` with Decline / Accept.
- In a party: page head eyebrow "The Realm · Party of 3", the party name as the title, the bonus rule as the sub, and page actions: an invite form (`.input-wrap` with `user-plus`, "Invite") and "Leave".
- Members, two across:

```html
<article class="card member">                                                  <!-- .is-me, .is-offline -->
  <span class="avatar" aria-hidden="true">T<span class="dot dot-online"></span></span>
  <div><div class="member-name">Thane <span data-tip="Party leader" role="img" aria-label="Leader"><svg>crown</svg></span></div>
       <div class="member-lv">Total level 164</div></div>
  <span class="small t-good">Online</span>                                        <!-- or "Away" (muted) -->
  <div class="member-doing" data-tone="ember"><svg>swords</svg><span>Hunting the Inner of Gallowmoor · 1h 04m</span></div>
  <div class="member-foot"><span class="chip chip-good"><svg>check</svg>Counts toward your bonus</span><button class="btn btn-quiet btn-sm" type="button" aria-label="Remove Thane from the party">Kick</button></div>
</article>
```

  `member-doing` tones: `ember` for hunting, `tan` for crafting and gathering, none for offline ("Last seen 2h ago"). Bonus chip: "Counts toward your bonus" (good), "Not hunting", "Other ground", "Offline". Your own card: "+20% to your Hunt XP". Kick only for the leader, never on yourself.
- Chat (`card card-flush chat` in a `.grid-2` with Invites):

```html
<ol class="chat-log" aria-live="polite">
  <li class="msg-note">Thane joined the party · 2d ago</li>
  <li class="msg"><span class="avatar avatar-sm">T</span><div><div class="msg-meta"><b>Thane</b><time>14m</time></div><p class="msg-text">Bring poultices.</p></div></li>
  <li class="msg is-own"><div><div class="msg-meta"><time>6m</time></div><p class="msg-text">I have 30 spare.</p></div></li>
</ol>
<form class="composer">
  <div class="input-wrap"><input class="input" maxlength="240" placeholder="Say something to the party" aria-label="Message"></div>
  <span class="composer-count">31/240</span>                                   <!-- .is-near from 200 -->
  <button class="btn btn-primary btn-icon" type="submit" aria-label="Send"><svg>send</svg></button>
</form>
```

  Newest at the bottom; scroll the log to the bottom on new messages unless the reader has scrolled up. Message text is player text: always a text child, never markup.
- Added with the live page (pages.css, Party): a refusal from chat (the rate limit, a message too long) shows for four seconds between the log and the composer as `<div class="chat-alert" role="alert"><svg>alert</svg><span>You are sending messages too quickly.</span></div>` (hidden otherwise). The "Found a party" form inside the `.empty` is `form.btn-row.empty-form`: centred, and its button drops the lone-button top margin `.empty .btn` gives, so the input and the button line up. The bonus summary is one chip under the page sub (`chip-good` with `party` "+10% Hunt XP · 1 of your party here", or plain "No party bonus · nobody else here"); keep chip text short, chips never wrap.

### 8.16 Hiscores (`?page=hiscores`)

A `.hs-skills` row of word tabs (`button.chip`, `role="tablist"`, `aria-selected`): Total, then each skill by name. No icons: a tab is a word with a rule under the current one. Then a card with the table from 7.21: `.hs-rank` (`.is-1` gold, `.is-2` silver, `.is-3` bronze), `.hs-name` with an avatar and the name, level and XP (`fmt`). Your row `tr.is-me`; `chip-bone` "You are #7" in the card head. Top 50. Phones: the XP column (`.hs-hide-sm`) and avatars hide.

Added with the live page (pages.css, Hiscores): the chip tabs carry `.hs-pick-tabs` as well, and a `select.select.hs-pick-select` of the same boards sits beside them. Below 600px the tabs hide and the select shows; above, the select stays hidden. The tabs take arrow keys, Home and End.

### 8.17 Settings and account (`?page=character&modal=settings`, `&modal=account`, `&modal=reset`)

`openModal({ title: "Settings", sub: "Account, connection and starting over", art: "gear", body })`, no actions (each section has its own buttons):

```html
<section class="set-section">
  <div class="set-head"><h3 class="set-title">Account</h3><span class="small muted">Not signed in</span></div>
  <div class="banner">...Playing as a guest · Nothing is kept...</div>
  <form class="vstack gap-3">
    <div class="set-fields">...Username field, Password field...</div>
    <div class="set-actions"><button class="btn btn-primary" type="submit">Sign in</button><button class="btn" type="button">Create account</button></div>
  </form>
  <!-- signed in: <div class="well account"><span class="avatar">M</span><div class="grow"><span class="strong">Morwen</span><span class="small muted">Your camp saves to the cloud as you play.</span></div><button class="btn btn-quiet btn-sm"><svg>logout</svg>Sign out</button></div> -->
</section>
<section class="set-section">...Connection: .stats of Status, Last sync, Engine...</section>
<section class="set-section">
  <div class="danger-zone vstack gap-2">
    <h3 class="set-title">Start over</h3>
    <p class="set-copy">Wipes this character back to a ruin. Skills, gear, gold and companions are all lost, for good.</p>
    <div><button class="btn btn-danger btn-soft" type="button">Start over</button></div>
  </div>
</section>
```

"Start over" opens `confirm({ danger: true, typeToConfirm: "RESET" })`, then the server command `resetCamp`. Phones: the two fields stack.

### 8.18 Discipline picker (`?page=character&modal=class`)

`openModal({ title: "Choose your discipline", sub, art: "sparkle", size: "xl", dismissible: false, body })` with `div.grid-cards.class-grid` of `button.card.card-link.class-card`: an `.hstack` of `art art-sm` and `.class-name`, `.class-blurb`, a `.chip-row` of multipliers, `.class-veil`. Picking one closes it. Only offered at Hunt level 5 with no discipline; the Veil and disciplines appear nowhere before that.

### 8.19 Guests, offline, loading (`?page=states`)

- Guests: the gold guest banner in `#bannerDock` on every page; `tbConn[data-state="guest"]`; Market, Party and Hiscores render a sign-in `.empty` instead of their content.
- Offline: the ember banner; `tbConn[data-state="offline"]`.
- First load of an online page: skeleton rows in the shape of the content, or `.loading` with a spinner.

---

## 9. Content rules

- **No em dash, en dash or infinity sign**, anywhere. Use a colon, a comma, parentheses or " · " (a middle dot with spaces) to join parts: "Inner · Gallowmoor", "42 of 200 · 1h 12m left". Ranges read "Lv 10 to 19", "Common to Relic".
- **Counts**: "42 of 200" for a limited run; for a run with no limit show just the count ("42 kills") and say "No limit" where the limit would be. Never "42 / (anything)" for unlimited.
- **Numbers**: gold with `fmtGold` ("1,234g", never abbreviated); counts with `fmt` or `fmtWhole`; times with `fmtTime`; percentages with `signedPct` (true minus sign) or `chancePct`; "×1.7 XP" uses the multiplication sign.
- **Names**: items, foes, regions and skills in Title Case (`titleCase` keeps "of", "the", "and" lower). Pages: Character, Armaments, Companions, Stockpile, Bounties, Requisitions, Shop (the Bonesetter and the Smuggler), Sky, Atlas, Market, Party, Hiscores. Pools: Belongings, Stockpile, Vault. Never "Provisions" or "Apothecary".
- **Buttons** say what happens: "Forge", "Pay 100g and travel", "Buy for 700g", "Wipe my camp". Not "OK" or "Submit".
- **Chips, tags and toasts** have no full stop. Copy sentences (captions, empty states, notes) do.
- **Voice**: short, dry, grim. "Nothing is kept once this tab closes." "The Smuggler does not haggle and does not wait."

---

## 10. Accessibility checklist

- Every icon-only control has an `aria-label` that names the thing ("Bog Sword: what it gives", "Remove Thane from the party").
- Toggles use `aria-pressed`; tabs use `role="tablist"` / `role="tab"` / `aria-selected`; pick lists use `role="listbox"` / `role="option"` / `aria-selected`; the current nav row has `aria-current="page"`; today in the forecast has `aria-current="date"`.
- Focus is always visible: a 2px `--focus` outline with a 2px offset on `:focus-visible` (entries draw it inside the line; inputs turn their edge bone). Never remove it.
- Dialogs, confirms and the drawer trap focus and restore it (the helpers do this). Route changes: call `closeModals()` and focus `#view`.
- Text is 4.5:1 or better: `--bone-faint` is the quietest text allowed. `--bone-ghost` is for decoration only.
- Touch targets are 44px on touch screens; do not shrink `.btn`, `.chip` buttons, `.tier`, `.seg-btn`, `.qty-btn` or nav rows below `--tap`.
- Motion respects `prefers-reduced-motion` (the tokens and base.css handle it; do not add `!important` animations).
- Player text (names, chat, listing names) is always set as text, never as markup.
- Announce things that happen off screen through toasts or `#srLive`, not only through colour changes.
- Status dots and colour-only states carry words nearby or an `aria-label`.

---

## 11. Decisions page authors must know

1. **Stylesheet order is tokens, base, components, layout, pages.** Layout comes after components so the shell's rules win; pages come last.
2. **`data-tone` and `data-rarity` are the colour API.** They set custom properties that inherit. An `.art` takes the nearest tone unless it sets its own. `.t-*` and `.rar-*` text utilities are `!important` by design.
3. **The phone topbar is fixed in shape**: menu, two chips (icon, `.act-short`, bar), gold, settings; health is the 3px line under it; connection is the dot on settings. Always fill `tbBenchShort` and `tbHuntShort`.
4. **Nothing locked is teased.** Do not render nav rows, tiers (beyond the next), Requisitions (before tier 2), the Veil or disciplines (before Hunt level 5 and a pick), or "coming soon" rows.
5. **Every gold spend is a `confirm({ cost })`.** The helper disables Confirm when the player cannot afford it; still check on the server side.
6. **Popups are built with `openModal` every time**, not kept as hidden markup in `index.html`. Update their numbers in place through the handle (`m.body`, `m.buttons`), and close them when what they show no longer exists.
7. **Toasts are for news, the camp log is the record.** Keep toasts short; anything the player may want later also goes in the log.
8. **The quantity picker lives in page code** (reference in 7.11 and `dev/kit.js`). It never shows a symbol for unlimited.
9. **Bars update with `setWidth` only**, several times a second, with `.nojump` on wrap. The CSS transition is 140ms linear.
10. **`index.html` has no page markup.** Pages render into `#view` with `replaceChildren`; the shell's ids are the only fixed DOM.
11. **Modern CSS is used**: `:has()` (empty nav groups hide, the settings dot mirrors the connection, some press states) and a container query on the activity chip. Where unsupported these degrade cosmetically; set `hidden` on empty nav groups yourself.
12. **The kit is the reference.** When in doubt, open `dev/kit.html?page=<name>` and read how `dev/kit.js` builds it. When you add a component, add it to the kit and to this file.
