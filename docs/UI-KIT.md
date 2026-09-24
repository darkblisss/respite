# Respite v5 UI Kit

The contract for page authors. Build every page from what is written here: the shell in `index.html`, the stylesheets in `css/`, and the helpers in `src/client/ui/`. If something you need is not here, add it to the kit (components.css or pages.css, and this file) instead of styling it inline.

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

1. **Colour has a job.** Violet is the bench, the crews, focus and "where you are". Ember is the hunt, danger and things going wrong. Gold is money and the one spend on a surface. Green (`good`) is health, gains and online. Never pick an accent for looks.
2. **One solid button per surface**, for the thing the surface is for (Forge, Hunt, Buy for 700g). Repeated actions in lists use the soft variant (`.btn-soft`). Everything else is default or quiet.
3. **Cards never sit inside cards.** Inside a card, group with `.well`, `.list`, `.stats`, `.divider` or a `.kpis` strip.
4. **Card grids show three across at most** (`.grid-cards`). The storage slot grid is the one exception: five across (four on narrow phones).
5. **Gathering nodes and recipes are one full-width pill each** (`.item-pill`), never small tiles in a grid.
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

Fonts: Spectral 500/600/700 (display) and Inter 400/500/600/700 (UI) from Google Fonts. Fallbacks are Georgia and the system UI font, so the UI stays usable if fonts are blocked.

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
| `--bg` | `#0b0910` | the page (set on `html`; `body` is transparent over a fixed glow and grain) |
| `--surface-1` | `#141019` | cards, pills, rows that stand alone |
| `--surface-2` | `#1c1723` | raised: default buttons, slots, avatars |
| `--surface-3` | `#241d2d` | floating: tooltips, toasts, the active segment |
| `--surface-sunk` | `#0f0c14` | wells, inputs, bar tracks, KPI strips |
| `--scrim` | `rgba(6,4,10,.72)` | behind dialogs and the drawer |
| `--panel`, `--panel-raised`, `--panel-deep` | aliases of surface-1, surface-2, surface-sunk | v4 names, kept |
| `--line-soft` | bone at 6% | dividers inside a card |
| `--line` | bone at 10% | card and control borders |
| `--line-strong` | bone at 16% | hover borders, dialogs, inputs |
| `--wash`, `--wash-strong` | bone at 4% and 7% | neutral fills, hover backgrounds |

### Text

| Token | Value | Contrast on surface-3 | Use |
|---|---|---|---|
| `--bone` | `#e8e1d5` | 12.5:1 | names, numbers that matter, titles |
| `--bone-dim` | `#b5adbb` | 7.5:1 | body copy, labels, secondary values |
| `--bone-faint` | `#948c9f` | 5.0:1 | meta, captions, eyebrows, timestamps |
| `--bone-ghost` | `#5f586a` | 2.4:1 | decoration and disabled marks only, never for reading |
| `--on-accent` | `#120e18` | | text on solid violet, gold, ember |

### Accents

Each accent has a family. `-hi` is the readable text tone on dark surfaces; `-lo` and `-deep` are for gradients and tile backgrounds; `-soft` is a tinted fill; `-edge` is a tinted border.

| Family | Base | `-hi` | `-lo` | `-deep` | `-soft` | `-edge` |
|---|---|---|---|---|---|---|
| violet | `#9d82e0` | `#b9a4f2` | `#5b4891` | `#2a2140` | 14% | 42% |
| ember | `#d8743f` | `#eb9068` | `#7d3a2c` | `#2d1a18` | 14% | 42% |
| gold | `#d9b566` | `#ecd08f` | `#7a6232` | `#2a2215` | 13% | 40% |
| good | `#7cbfa4` | `#9dd6bf` | `#3f6e5d` | | 13% | 38% |
| warn | `#e3a857` | | | | 13% | 40% |
| bad | `--ember-hi` | | | | ember-soft | ember-edge |

Also: `--focus: #b9a4f2`, `--focus-ring` (a 3px violet halo for inputs), `--hp`, `--hp-deep`, `--foe`, `--foe-deep`, `--veil: #a88ee6`, `--veil-deep: #4a3a7a`.

### Rarity

`--r-common #a59eb0`, `--r-uncommon #7cbfa4`, `--r-rare #7aa2dc`, `--r-epic #b88bdb`, `--r-legendary #dcb462`, `--r-relic #e07a4c`.

Any element with `data-rarity="common|uncommon|rare|epic|legendary|relic"` gets `--rar` (the colour) and `--rar-soft` (a tint; transparent for common). Components read these.

Item tiles (`.slot`, `.doll-slot`, `.art`) show rarity as **bottom light**: `--rar-lit` (a background layer, colour rising from the lower edge), `--rar-glow` (the inset glow along that edge) and `--rar-edge` (the 1px line), each a step stronger per tier. Common, and anything without a rarity (materials, reagents, remedies), stays a plain tile. The gilded frame on Legendary/Relic and the corner gem on storage slots are kept in components.css but switched off; `class="gilded-frames"` or `class="rarity-gems"` on `<html>` turns them back on.

Any element with `data-tone="violet|ember|gold|good"` gets `--tone`, `--tone-hi`, `--tone-soft`, `--tone-edge`, `--tone-deep`. These inherit: an `.art` tile inside a `data-tone="ember"` card is ember unless the tile sets its own `data-tone`.

### Type

| Token | Size | Use |
|---|---|---|
| `--text-2xs` | 11px | eyebrows and tags, always uppercase and tracked |
| `--text-xs` | 12px | meta, chips, timestamps |
| `--text-sm` | 13px | secondary copy, sub lines |
| `--text-md` | 14px | body (the default) |
| `--text-lg` | 16px | lead copy, list titles in display face |
| `--text-xl` | 18px | card titles (display) |
| `--text-2xl` | 22px | section and dialog titles (display) |
| `--text-3xl` | 28px | page titles (display) |
| `--text-4xl` | 36px | hero numbers (display) |

`--font-display` (Spectral) is for names and titles: page, card, item, foe, region. `--font-ui` (Inter) is for everything else. Numbers that update use `font-variant-numeric: tabular-nums` (class `.num`; most components already set it). Line heights: `--lh-tight 1.2`, `--lh 1.45`, `--lh-loose 1.6`. `--tracking-caps .12em`.

### Space, radii, depth, motion, layers

- Space (4px steps): `--sp-0 2px`, `--sp-1 4px`, `--sp-2 8px`, `--sp-3 12px`, `--sp-4 16px`, `--sp-5 20px`, `--sp-6 24px`, `--sp-7 28px`, `--sp-8 32px`, `--sp-10 40px`, `--sp-12 48px`, `--sp-16 64px`.
- Radii: `--r-xs 4px` (tags, deltas), `--r-sm 6px`, `--r-md 10px` (buttons, inputs, slots, wells), `--r-lg 14px` (cards, pills), `--r-xl 18px` (heroes, dialogs), `--r-pill 999px` (chips, badges).
- Depth: `--hi` (a 1px inner highlight), `--shadow-1`, `--shadow-card`, `--shadow-pop` (tooltips, toasts), `--shadow-modal`.
- Motion: `--dur-1 120ms` (hover, press), `--dur-2 180ms` (dialogs, tooltips), `--dur-3 260ms` (sheets, drawer), `--bar-dur 140ms` (progress bars, linear), `--ease`, `--ease-in`. All durations become 0 under `prefers-reduced-motion`.
- Layers: `--z-sticky 10`, `--z-topbar 40`, `--z-drawer 60`, `--z-modal 80` (each stacked dialog adds 1), `--z-toast 90`, `--z-tip 100`.

### Shell variables (responsive)

| Token | Desktop | Below 1280 | Below 1024 | Below 600 | Below 380 |
|---|---|---|---|---|---|
| `--topbar-h` | 64px | 64px | 56px | 56px | 56px |
| `--hpline-h` | 0 | 0 | 3px | 3px | 3px |
| `--gutter` | 32px | 28px | 24px | 16px | 12px |
| `--page-gap` | 24px | 24px | 24px | 16px | 16px |
| `--card-pad` | 20px | 20px | 20px | 16px | 14px |
| `--grid-gap` | 16px | 16px | 16px | 12px | 12px |

Fixed: `--sidebar-w 232px`, `--content-max 1180px`. `--tap` is 32px, and 44px on touch screens (`pointer: coarse`); every button, chip button, tier, segment, tab, stepper and input uses it as a floor for its height (so a 38px button stays 38px on desktop and grows to 44px on touch).

---

## 4. Breakpoints and responsive rules

| Query | Name | What changes |
|---|---|---|
| `min-width: 1280px` | wide | breadcrumb and HP numbers show in the topbar |
| `min-width: 1200px` | | storage pages (Stockpile, Armaments) get a sticky side column |
| `min-width: 1024px` | desktop | 64px topbar with brand, activity chips with meta and stop buttons, gold, HP bar, connection pill, settings; sticky 232px sidebar |
| `max-width: 1023px` | tablet | 56px topbar plus a 3px health line on its bottom edge; menu button opens the sidebar as a drawer; connection pill hides and the settings button shows a coloured dot; inputs 16px |
| `max-width: 899px` | | Sky forecast becomes a list of rows |
| `max-width: 767px` | | item pills put their stats under the name; the hunt arena goes single column; market listings become cards; atlas stacks (list above detail) |
| `max-width: 599px` | phone | topbar: menu, two compact chips (icon, short name, bar), gold, settings; brand hidden; dialogs become bottom sheets; toasts span the bottom; heroes stack; `.grid-2` goes to one column; `.list-row.stack-sm` drops its end to a new line; skills grid 2 columns |
| `max-width: 479px` | | storage slot grid 4 across |
| `max-width: 379px` | narrow phone | tighter topbar; gutter 12px; card padding 14px |
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
| bench | `working` | the action's icon | "Bog Ore" (crafting: "Bog Bar") | "42 of 200 · 1h 12m left"; crafting: "Forging · 18 of 60 · 9m left"; no limit: "42 · 11h 58m left" | violet, action progress | shown |
| hunt | `idle` | `swords` | "Idle" | "Nobody is hunting" | hidden | hidden |
| hunt | `hunting` | `zoneOuter` / `zoneMiddle` / `zoneInner` / `zoneCore` | "Inner · Gallowmoor" / "Inner" | "38 kills · 4,210 XP/hr · Threat 64" | ember, hunt progress | shown |
| hunt | `recovering` | `heart` | "Recovering" / the countdown "3m 12s" | "Back in 3m 12s" | ember stripes, recovery progress | hidden |
| hunt | `hiding` | `eye-off` | "Hiding" | "4m 10s left · The Drowned Bailiff searches" | violet dashes, time hidden so far | shown |

On phones each chip is only its link (icon, short name, bar): a tap opens the page. The whole topbar is one row, 56px plus the 3px health line, and every target is 44px.

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
  <svg class="ico">...chevron-right...</svg>
  <span aria-current="page">Delving</span>
</nav>
```

### Sidebar rows

```html
<li>
  <a class="nav-item" href="#/skill/delving" aria-current="page">   <!-- aria-current on the current page only -->
    <svg class="ico nav-ico">...</svg>                                <!-- iconEl(name, "nav-ico") -->
    <span class="nav-label">Delving</span>
    <span class="nav-dot" role="img" aria-label="Working"></span>    <!-- only while this skill works; data-tone="ember" for the hunt -->
    <span class="nav-meta">Lv 24</span>                               <!-- skills: "Lv 24"; storage: "24/30"; requisitions: "2/3" -->
    <span class="badge" aria-label="2 unread">2</span>              <!-- only when something needs attention -->
  </a>
</li>
```

- Current row: `aria-current="page"` (or `.is-active`). It gets a violet wash, a 3px violet bar on the left and a violet icon.
- Badge tones: `.badge` (violet, party), `.badge-gold` (a bounty ready), `.badge-ember` (something wrong), `.badge-good`.
- Groups and rows by the information architecture: **The Vanguard** (Character `person`, Armaments `plate`, Companions `paw`), **The Camp** (Stockpile `stockpile`, Bounties `scroll`, Requisitions `crate` only from tier 2, Shop `shop`, Sky `sky`), **Trades** (Felling `felling`, Delving `delving`, Harvesting `harvesting`, Flaying `flaying`, Dredging `dredging`), **Artisans** (Forgemaster `plate`, Woodwright `ward`, Tanner `treads`, Weaver `cowl`, Artificer `charm`), **The Field** (Hunt `swords`), **The Realm** (Atlas `atlas`, Market `market`, Party `party`, Hiscores `trophy`).
- In the drawer rows are 44px tall with 15px text.

### Weather card

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

- `ICONS`: `{ name: svgInnerMarkup }`, 218 icons on a 24 by 24 grid, of two kinds. The controls are hand-drawn stroke icons (1.5 stroke, round caps). Everything that stands for a thing in the world is a solid glyph that fills with `currentColor`: the sidebar's places, and the gear, tools, materials, remedies, foes, zones, weather, disciplines, Path nodes and tab marks. Those are drawn with the icon kit (boolean shapes, parts cut apart where they meet) and go in through `GLYPH(d)`, one path each, between the generated markers at the end of `ICONS`: redraw in the kit and inject rather than editing them by hand. Every v4 name still draws; the gear's old names are aliases (`ALIASES` under `ICONS`).
- `icon(name, cls?) -> string`: `<svg class="ico cls" width="24" height="24" viewBox="0 0 24 24" ... aria-hidden="true" focusable="false">`. Unknown names draw `unknown`.
- `iconEl(name, cls?) -> SVGElement`: a fresh element each call (parsed once per name and class, then cloned).

Sizes: `.ico` is 20px; `.ico-xs` 14, `.ico-sm` 16, `.ico-md` 20, `.ico-lg` 24, `.ico-xl` 32, `.ico-2xl` 44. Most components size their own icons, so you rarely need these. Icons are `aria-hidden`: give the control a label.

The `width` and `height` attributes are the icon's own size, and they are not optional: an `<svg>` with only a `viewBox` has no intrinsic size, and Safari lays it out from the attributes on the first paint. Every `.ico` rule still wins over them, so the sizes above are what you see. The copies baked into `index.html` carry them too.

Names (every v4 name still draws):

- Gathering tools: `pick`, `axe`, `sickle`, `knife`, `net`
- Trade skills (sidebar): `delving`, `felling`, `flaying`, `harvesting`, `dredging`
- Artisan skills (sidebar): `forgemaster`, `woodwright`, `tanner`, `weaver`, `artificer`
- The Camp in the sidebar: `campStockpile`, `campBounties`, `campRequisitions`, `campShop`, `campFortify`
- The Realm in the sidebar: `realmAtlas`, `realmMarket`, `realmLeaderboard`
- The Vanguard in the sidebar: `vanguardCharacter`, `vanguardInventory`, `vanguardDiscipline`, `warfare` (the Hunt skill, everywhere it appears), `vanguardParty`
- Weapons: `sword`, `dagger`, `greatsword`, `targe` (the shield), `bow`, `staff`, `grimoire`
- Armour, plate: `helm`, `breastplate`, `gauntlets`, `sabatons`; leather: `leatherHood`, `jerkin`, `leatherGloves`, `leatherBoots`; cloth: `clothHood`, `robe`, `clothGloves`, `clothBoots`
- Jewellery and the Veil's charms: `amulet`, `ring`, `charmLesser`, `charmVeiled`, `charmSovereign`
- Components: `swordBlade`, `hilt`, `shieldCore`, `binding`, `bowStave`, `bowstring`, `grip`, `shaft`, `staffHead`, `greatBlade`, `greatGrip`, `tome`, `clasp`
- Materials: `ore`, `log`, `fibre`, `hide`, `gem`, `chest` (the Banded Chest); reagents: `coalIco`, `resinIco`, `pulpIco`, `tallowIco`, `shardIco`, and `flask` for reagents as a whole
- Remedies: `salve`, `tincture`, `poultice`, `draught`, `decoction`, `tonic`, `leviathanBlood`, `philtre`, `elixir`, one per tier, and `potion` for remedies as a whole
- Foes, small: `beast`, `man`, `golemMob`, `horror`, `drakeMob`, `skull` (each foe's full drawing is in `ui/monster-art.js`)
- Companions: `rat`, `crow`, `marshcat`, `hound`, `stag`, `paw`
- Hunt zones: `zoneOuter`, `zoneMiddle`, `zoneInner`, `zoneCore` (rings, one more for each step in; the Core's heart is the Veil's star)
- Weather: `rain`, `sun`, `fog`, `wind`, `frost`, `moon`, `sky`, `unknown`
- Disciplines: `warrior`, `rogue`, `mage`; the Path, one a node: `ironhide`, `deepLungs`, `hammerhand`, `braced`, `sunder`, `stonewall`, `weightOfBlow`, `grimPace`, `devastation`, `bulwark`, `quickHands`, `keenEdge`, `sinew`, `lightfoot`, `killersEye`, `findTheGap`, `coiled`, `openVein`, `perfectAmbush`, `shadowstep`, `kindling`, `wardedSkin`, `drawnBreath`, `focus`, `pierceVeil`, `deepWell`, `cadence`, `overchannel`, `elemental`, `arcaneBulwark`
- Tabs and marks: `path`, `gathering`, `artisans`, `purse` (Wealth), `medal` (a milestone won), `trophy`, `book`, `hourglass`, `swords`
- Old gear names, now aliases: `blade`, `greatblade`, `stave`, `ward`, `plate`, `greaves`, `treads`, `cowl`, `shroud`, `band`, `charm`, `ration`, `crate`
- Places and pages: `atlas`, `shop`, `scroll`, `pack`, `person`, `market`, `party`, `bonesetter`, `stockpile`, `map-pin`, `calendar`
- Money: `coin`, `coin-stack`, `tag`
- Online: `chat`, `send`, `mail`, `online`, `sync`, `cloud`, `offline`, `logout`, `user-plus`, `crown`, `bell`
- Controls: `menu`, `plus`, `minus`, `close`, `check`, `chevron-down`, `chevron-right`, `chevron-left`, `chevron-up`, `arrow-right`, `search`, `filter`, `sort`, `dots`, `gear`, `eye`, `eye-off`, `lock`, `info`, `warn`, `alert`
- Misc: `clock`, `heart`, `shield`, `sparkle`, `hammer`, `flag`

### 6.3 overlay.js

#### `openModal(options) -> handle`

A centred dialog at 600px and up; a bottom sheet on phones (grab handle, 88vh max, drag the handle or header down to dismiss, internal scroll, footer pinned above the safe area).

| Option | Default | Meaning |
|---|---|---|
| `title` | `""` | the heading (display face) |
| `sub` | `""` | a quiet line under the title; also the dialog's description |
| `art` | `null` | an icon name, an SVG string (a monster drawing) or a Node, shown in a 56px `.art` tile |
| `artTone` | `"violet"` | `"violet" \| "ember" \| "gold" \| "good" \| "neutral"` |
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

- `kind`: `"primary"` (violet), `"gold"`, `"ember"`, `"danger"`, `"quiet"`, or omit for default.
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
| `kind` | `"info"` | `"info"` (violet), `"good"`, `"warn"`, `"bad"` (ember, announced assertively), `"gold"` |
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
      <div class="eyebrow page-eyebrow">The Camp</div>                 <!-- data-tone="ember" for hunt pages -->
      <h1 class="page-title">Requisitions</h1>
      <p class="page-sub">Send Agents out for supplies. They return at the daily reset.</p>
    </div>
    <div class="page-actions"><!-- chips, a clock, at most one solid button --></div>
  </header>
  ...cards and sections...
</div>
```

Skill pages use a `.hero` instead of `.page-head` (7.3); Character uses `.char-hero` (8.1).

**Section.** A titled group of cards or pills without a card around it.

```html
<section class="section">
  <div class="section-head">
    <div><h2 class="section-title">Zones</h2><p class="section-sub">Deeper zones field more foes.</p></div>
    <!-- optional: a chip or a button -->
  </div>
  ...
</section>
```

**Card grid, three across at most.** Columns fill to three, never more, and drop as the space narrows below `--grid-min` (260px) per card.

```html
<div class="grid-cards">...</div>           <!-- 3, 2, 1 -->
<div class="grid-cards max-2">...</div>     <!-- 2, 1: zones, party members, the two activity cards -->
```

To change the narrowest card, set `--grid-min` on a page class in pages.css (`.skills-grid` and `.class-grid` use 220px). `.grid-2` is a plain two-column split that goes to one column on phones (market lists, party chat and invites).

### 7.2 Card

```html
<section class="card" data-tone="violet">                    <!-- data-tone optional: a thin accent line on the top edge -->
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
| `.card-flush` | no padding: for content that runs edge to edge (lists with row padding, the camp scene, the atlas detail, chat). A `.card-head` inside gets the padding back |
| `.card-link` | the whole card is a link or button (class picker): hover lifts the border |
| `.card-foot.between` | footer content spread to both ends |
| `.well` | a sunk group inside a card (stats, a comparison line). Never a card inside a card |
| `.divider` | a quiet `hr` with 16px space around it |

The card head wraps its actions under the title when there is no room.

### 7.3 Hero (skill pages)

```html
<section class="hero" data-tone="ember">                        <!-- data-tone="ember" on the Hunt only -->
  <div class="art art-xl" data-tone="ember" aria-hidden="true"><svg>swords</svg></div>
  <div class="hero-main">
    <div class="eyebrow hero-eyebrow">The Field · Gallowmoor</div>
    <h1 class="hero-title">Hunt</h1>
  </div>
  <div class="hero-level">
    <div class="hero-lv"><small>Lv</small>31</div>
    <div class="hero-lv-sub">120,450 / 131,600 XP</div>
  </div>
  <div class="chip-row hero-tags">                              <!-- optional: Mastery tip chip, XP modifier chips, party bonus -->
    <button class="tip-chip" type="button"><svg>info</svg>Mastery · +2% double yield</button>
    <span class="chip chip-good">+16% XP · Extreme Aridity</span>
  </div>
  <div class="hero-xp">
    <div class="bar bar-ember"><i style="width: 42%"></i></div>
    <div class="hero-xp-meta"><span>You take the vanguard.</span><span><b>11,150</b> to Lv 32</span></div>
  </div>
</section>
```

Eyebrow: "Trades · Gallowmoor", "Artisans · At camp", "The Field · Gallowmoor". Show modifier chips only when they apply (weather, Bountiful Weekend, companion, bounty buff, party bonus). When maxed: `hero-lv-sub` reads "Mastered" and the XP line drops its "to Lv" part.

Phones: the tags move to their own full-width row, the title is 24px and `hero-lv-sub` hides.

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
| `.btn-primary` | violet: the bench, crews, equip, sign in, list for sale |
| `.btn-gold` | a spend: buy, pay a toll, hire, claim gold |
| `.btn-ember` | the hunt: Hunt, Change hunt |
| `.btn-danger` | destructive: Start over, kick (inside a confirm) |
| `.btn-quiet` | no chrome: Cancel, Stop, Pull back, Later |
| `.btn-soft` | with a kind: the tinted variant for repeated actions in lists (Buy in shop rows, Deploy, Take along) |
| `.btn-sm` | 32px (44px on touch); `.btn-lg` 48px |
| `.btn-icon` | square, icon only; always with `aria-label` |
| `.btn-block` | full width |
| `.is-loading` | a spinner replaces the label (openModal does this for Promise actions) |
| `disabled` | 42% opacity, no hover |

A button with an icon: put `iconEl(name)` before the label. Group buttons with `.btn-row` (`.btn-row.end` to align right). `.link` is an underlined violet text link for use inside copy.

**Info button.** A 28px round (i) that only opens a tooltip.

```html
<button class="info-btn" type="button" aria-label="Bog Sword: what it gives"><svg>info</svg></button>
```

### 7.5 Chips, tags, badges, dots

**Chip**: a short fact.

```html
<span class="chip"><svg>clock</svg>16s</span>
<span class="chip chip-good">+9% XP · Faint Gloom</span>
<span class="chip chip-violet"><svg>party</svg>+20% Hunt XP · 2 here</span>
```

Tones: `.chip-good`, `.chip-warn`, `.chip-bad`, `.chip-gold`, `.chip-violet`, `.chip-ember`. Sizes: `.chip-sm` (22px), `.chip-lg` (32px). `<b>` inside a chip is brighter. Wrap several in `.chip-row` (it hides itself when empty).

**Chip as a button**: filters, quantity presets, hiscore skills. It lights violet when pressed or selected.

```html
<div class="filters" role="group" aria-label="Show">
  <button class="chip" type="button" aria-pressed="true">All</button>
  <button class="chip" type="button" aria-pressed="false" aria-label="Gear" data-tip="Gear"><svg>blade</svg></button>
</div>
```

States: `aria-pressed="true"`, `aria-selected="true"` or `.is-active`; `disabled`. 30px tall, 44px on touch.

**Tip chip**: a chip that opens a rich tooltip (the Mastery tooltip).

```html
<button class="tip-chip" type="button"><svg>info</svg>Mastery · +2% double yield</button>
```

```js
tooltip(chipEl, () => tipBody({ title: "Delving Mastery", list: [...], track: [...], foot: "..." }), { placement: "bottom" });
```

**Tag**: a label on a thing, uppercase.

```html
<span class="tag tag-violet">Warrior</span>
<span class="tag tag-elite">Elite</span>
<span class="tag tag-sovereign">Sovereign</span>
<span class="tag" data-rarity="legendary">Legendary</span>
```

Tones: `.tag-violet` (here, you, class), `.tag-ember` (hunting), `.tag-gold` (tier), `.tag-good` (open, paid out), `.tag-elite`, `.tag-sovereign`, `data-rarity`, or plain (expired).

**Badge**: a count that needs attention. `.badge` (violet), `.badge-gold`, `.badge-ember`, `.badge-good`. Give it an `aria-label` that says what it counts.

**Dot**: status.

```html
<span class="dot dot-online"></span>   <!-- also dot-away, dot-offline, dot-working (violet pulse), dot-hunting (ember pulse) -->
```

Give a meaningful dot `role="img"` and an `aria-label` (or put the words next to it).

### 7.6 Art tiles

The square that holds an item, skill, zone or foe icon.

```html
<div class="art" aria-hidden="true"><svg class="ico">ore</svg></div>                  <!-- violet by default, or the nearest data-tone -->
<div class="art art-sm" data-tone="ember" aria-hidden="true">...</div>
<div class="art art-lg" data-rarity="epic" aria-hidden="true">...</div>
<div class="art" data-tone="neutral" aria-hidden="true">...</div>
```

Sizes: `.art-sm` 36px, default 44px, `.art-lg` 56px, `.art-xl` 72px. `data-tone`: `violet` (skills, bench), `ember` (hunt, zones), `gold` (shop, money), `good` (remedies, done), `neutral` (bare hands, not owned). `data-rarity` for gear. `.is-dim` greys it out.

### 7.7 Bars and meters

```html
<div class="bar"><i style="width: 36%"></i></div>
```

| Modifier | Use |
|---|---|
| (none) | violet: skills, XP, crafting |
| `.bar-ember` | the hunt, Threat |
| `.bar-gold` | bounties, market progress |
| `.bar-good` | health outside the arena, bond when complete |
| `.bar-neutral` | anything without meaning |
| `.bar-thin` (3px), `.bar-lg` (10px) | heights; default 6px |
| `.bar-striped` | recovering (animated stripes) |
| `.nojump` on the `i` | no transition, for the frame a bar wraps back to 0 |

Always update with `setWidth(fill, pct)`. When the bar is the only place a number lives, add `role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="36"`; otherwise leave it decorative.

**Health bar with numbers** (arena, foes):

```html
<div class="hpbar"><i style="width: 78%"></i><span>87 / 112</span></div>
<div class="hpbar hpbar-foe"><i style="width: 46%"></i><span>22 / 48</span></div>     <!-- hpbar-sm: 16px -->
```

**Veil bar**: `<div class="veilbar"><i></i></div><div class="veil-note">Bulwark · 64 of 100</div>`; `.veilbar.is-locked` before a discipline (the note then reads "The Veil opens at Hunt 5" or "Choose a discipline").

**Meter**: a labelled bar.

```html
<div class="meter">
  <div class="meter-top"><span>Threat</span><b>64 / 100</b></div>
  <div class="bar bar-ember bar-thin"><i style="width: 64%"></i></div>
</div>
```

**KPI strip**: key numbers in a sunk strip (the hunt).

```html
<div class="kpis">
  <div class="kpi"><span class="l">Kills</span><span class="v">38</span></div>
  <div class="kpi"><span class="l">Threat</span><span class="v">64 / 100</span><div class="bar bar-ember bar-thin"><i></i></div></div>
</div>
```

`.kpi .s` is an optional small line under the value. Phones: two per row.

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

States: `.is-selected` / `aria-selected="true"` (violet wash and bar), `.is-current` (you are here), `.is-locked`.

**Stat rows**: label and value pairs.

```html
<div class="stats">
  <div class="stat"><span class="l">Attack</span><span class="v">+14 <span class="delta up">+3</span></span></div>
  <div class="stat"><span class="l">Defence</span><span class="v">9.8 <small>stops 31% here</small></span></div>
  <div class="stat"><span class="l">Gold on hand</span><span class="v t-gold">1,234g</span></div>
</div>
```

Value tones: `.t-good`, `.t-gold`, `.t-bad`, `.t-violet`. **Delta** (a change against what is worn): `.delta.up` (green), `.delta.down` (ember), `.delta.same`; write "+3", "−2" (true minus).

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
| `.input`, `.select`, `.textarea` | 40px (44px on touch), violet focus ring |
| `.input-sm`, `.select-sm` | 34px |
| `.is-invalid` | ember border; say why in a `.field-hint.t-bad` |
| `.input-wrap` | a leading icon (`svg` before the input) and/or a trailing `.affix` |
| `.check`, `.switch` | a styled checkbox and a toggle; the label text is the control's name |

Inputs are 16px on phones and touch screens so the page never zooms.

### 7.11 Quantity picker

One control for every "how many": a stepper you can type in, presets, Max, and "No limit" where an unlimited run makes sense. Unlimited is shown as an empty box with a violet "No limit" placeholder and a pressed "No limit" chip. Never a symbol.

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

### 7.12 Item pills (gathering nodes, recipes, zones in lists)

One full-width row per node or recipe. The name is the button, and its hit area covers the whole pill; the (i) button on the right stays separately clickable. A 3px bar along the bottom edge shows the running action.

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
      <span class="chip chip-violet">3 XP</span>
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
| working | `.is-working` | violet border and wash, glowing art, violet status line, bar moving |
| locked by level | `.is-locked` | greyed art and dim name; `.pill-sub` holds `iconEl("lock")` then "Needs Delving Lv 30"; still opens its popup |
| missing materials | `.is-short` | the status line turns ember ("Missing Bog Great Blade"); the short `.need` chips turn ember |
| hunt tone | `data-tone="ember"` | ember instead of violet (a zone or hunt pill) |

- `.pill-sub`: separate parts as `<span>`s and a quiet dot is drawn between them. `<b>` is brighter.
- `.pill-stats`: chips for the numbers (time, XP, held) or `.need` chips for recipe inputs.
- The (i) opens the stats before you commit: for nodes, time, XP, yield, double yield, held; for gear recipes, a table of stats by rarity (Common to Relic). Build it with `tooltip(infoBtn, () => tipBody({...}), { placement: "left" })`.
- Wire clicks once with `on(view, "click", ".pill-hit", ...)` and read `closest(".item-pill").dataset.action`.
- Updates several times a second: `setWidth(pill bar)`, `setText` on the status parts, `toggleClass(pill, "is-working" | "is-short", ...)`.

Phones (below 768px): the stats wrap under the name as compact chips (24px), the chevron hides, the (i) stays top right.

**Need chip**: what a recipe takes, have over need.

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
- Rarity shows as a 2px edge along the bottom, a soft glow and the icon colour (common has none).
- States: `.is-empty` (dashed, not focusable), `.is-selected` (violet ring), `.is-dragover` (while dragging to reorder), `.is-locked`.
- Fill the grid to the pool's capacity with empty slots.
- `.capacity.is-full` turns the count ember.
- Five across; four at 479px and below. The toolbar wraps; on phones the sort select takes its own full line.
- `.storage-stack` is a column of two `storageCard`s, used by the Satchel page to put Belongings above the Satchel. `.satchel` is the second card's tighter grid, and `.satchel-next` the line under it naming the draught the next fight would reach (off `bestRemedy`).
- A `storageCard` takes `filters: false` where a pool holds one kind (the Satchel), and a `hint` for a line under its capacity bar. A remedy in Belongings costs a slot a bottle, so it draws as separate cells of 1 rather than one stack, and the capacity line counts them that way.
- Drag to reorder (pages/stockpile.js `storageCard`): set `data-reorder` on `.slot-grid` while the view is in custom order (it also stops a held finger selecting the name or opening the touch callout). While dragging the grid carries `.is-sorting` (a grabbing cursor), the lifted slot `.is-selected` and the place it would take `.is-dragover`; the drop sends `reorder { pool, key, before }`. Mouse: press and move 5px. Touch: hold still 380ms, then move; a finger that moves first scrolls the page. Near the top or bottom edge the page scrolls under the drag; Escape cancels.

### 7.14 Tooltip content classes

Built by `tipBody()`; listed so you can style custom content the same way: `.tip-title` (display), `.tip-sub`, `.tip-text`, `.tip-rows` > `.tip-row` (`.l`, `.v` with `.t-good`, `.t-bad`, `.t-gold`), `.tip-list` (violet bullets), `.tip-track` > `.tip-step` (`.g` mark, `.lv`, `.name`, `.v`; `.is-done` fills the mark violet, `.is-next` brightens the row), `.tip-table` (first column may carry `.rar-*`), `.tip-foot` (`.t-good` for good news).

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

### 7.17 Banners

For guests, offline, and anything that applies to the whole page. They go in `#bannerDock`.

```html
<div class="banner" role="status">                                  <!-- data-tone: gold (default), violet, ember, good -->
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

`data-tone` on a line: `good` (levels), `gold` (money), `ember` (deaths, losses), `violet` (party and companions). Times with `fmtAgo()`; redraw at most twice a minute.

### 7.21 Tables

```html
<div class="table-wrap">                                         <!-- scrolls sideways inside a card if it must -->
  <table class="table">
    <thead><tr><th>Rank</th><th>Commander</th><th class="num">Level</th><th class="num hs-hide-sm">XP</th></tr></thead>
    <tbody>
      <tr class="is-me" aria-current="true">
        <td><span class="hs-rank">7</span></td>
        <td class="strong"><span class="hs-name"><span class="avatar avatar-sm">M</span><span class="truncate">Morwen</span><span class="tag tag-violet">You</span></span></td>
        <td class="num">318</td><td class="num hs-hide-sm">4.6M</td>
      </tr>
    </tbody>
  </table>
</div>
```

`.num` right-aligns with tabular figures; `td.strong` is the bright column; `tr.is-me` highlights your row with a violet wash and edge.

### 7.22 Avatars and portraits

```html
<span class="avatar" aria-hidden="true">T<span class="dot dot-online"></span></span>   <!-- .avatar-sm 30px, .avatar-lg 64px; data-tone gold, ember, good -->
<div class="portrait"><img src="assets/commander-default.webp" alt=""></div>
```

An avatar is the first letter of a name. A `.dot` inside sits on its corner. `.portrait` crops an image to fill the box you give it (page classes set the size).

### 7.23 Utilities (base.css)

- Type: `.display`, `.eyebrow`, `.title-lg`, `.title-md`, `.title-sm`, `.lead`, `.copy`, `.small`, `.tiny`, `.muted`, `.dim`, `.strong`, `.num`, `.nowrap`, `.truncate`, `.clamp-2`, `.break`, `kbd` / `.kbd`.
- Tones (these win over component colours): `.t-violet`, `.t-ember`, `.t-gold`, `.t-good`, `.t-warn`, `.t-bad`, and rarity names `.rar-common` to `.rar-relic`.
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
        <span class="tag tag-violet">Warrior</span>                    <!-- the discipline, only once picked -->
        <span class="chip"><svg>paw</svg>Tunnel Rat</span>
        <span class="chip chip-gold"><svg>scroll</svg>Bounty 12 of 17</span>
      </div>
    </div>
    <div class="char-total"><span class="char-total-v">187</span><span class="eyebrow">Total level</span></div>
  </section>

  <div class="grid-cards max-2">
    <article class="card act-card" data-tone="violet">                 <!-- the hunt card: data-tone="ember", .bar-ember -->
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
    <div class="card-actions"><span class="chip">Lv20 · 3 of 9</span></div></div>
  <div class="camp-scene"><svg width="1000" height="200" viewBox="0 0 1000 200" preserveAspectRatio="xMidYMax slice" role="img" aria-label="The Delving camp">...</svg></div>
  <div class="camp-foot"><b>Crates, barrels and a coal heap</b><span>Next at Lv 30: a shored adit and rails</span></div>
</section>
```

The scene comes from `ui/camp-art.js`: `campScene(skillId, stage, prefix)` returns the SVG's inner markup for `CAMP_VIEWBOX` (`0 0 1000 200`), and `CAMP_STAGES[skillId]` holds each trade's nine names for the foot line. Every trade has its own ground (Delving a crag, Felling a pine clearing, Flaying a moor, Harvesting fields, Dredging a lake) and its own nine pieces; at most two workers show. The `prefix` keeps gradient ids unique when two scenes share a page. Whatever moves carries a `cs-*` class (fire, sparks, smoke, lamps, banners, the workers, the wheel and the sails) and the keyframes are in pages.css; reduced motion stills all of it. In a box narrower than 5:1 the page slides the viewBox to keep the fire and the work in frame.

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

Actions: `{ label: "Stop", kind: "quiet" }` first while running, then the verb: `{ label: "Forge", kind: "primary" }` ("Delve", "Fell", "Carve"...; the Hunt uses `kind: "ember"` with "Hunt" or "Move the hunt here"). Disabled start labels: "Needs Lv 30", "Missing materials", "Recovering". Plan line with no limit: "No limit · stock covers 15" or "No limit · up to 2,700 in twelve hours"; for the hunt "No limit · until you pull back, fall or twelve hours pass". Foe popups (`?page=hunt&modal=foe`) pass the monster drawing as `art` (an `svg.m-art` string; it fills 88% of the tile) with `artTone: "ember"`, a `.stats` block (Health, Attack, Against you, Defence, Swings every, Experience, Threat, Gold, As an Elite), a Drops `.ap-list`, and one wide action back to the zone they were opened from.

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

Armaments renders a two-handed weapon as one spanning slot instead: `.doll-col.has-span` turns that column into four equal rows and the weapon's `button.doll-slot.is-span` takes two of them (Weapon and Offhand), so it lines up exactly with two slots across the figure; the offhand slot is not rendered. The left column follows `DOLL_ORDER`: armour (head, chest, hands, feet). The right column is neck, weapon, offhand, ring: the amulet level with the collarbone, and the weapon and offhand together so a two-hander can span them.

**Callout lines** (the Inventory's Worn card only: `dollCard(ctx, { lines: true })`; the Character tab and a commander's page draw the doll without them). `dollLines(doll)` (`src/client/ui/callouts.js`) lays an `svg.doll-lines` over the `.doll` and draws a dashed line from each slot (read by `data-slot`) to a point on the figure: head, neck (collarbone), chest, feet (the middle of the left boot), gloves and ring to the hand on the screen's left, weapon and offhand to the hand on the right. A two-hander draws one line. A line and its end dot take the slot's `data-rarity` colour; an empty slot's are `is-empty`. Points come from the skin's `anchors` in `SKINS` (fractions of the image, set by eye); a skin without them is measured once from its own pixels, and a figure that cannot be read gets a plain standing pose. Call `update(skin)` after repainting the slots or the skin; resizing and a late image load redraw by themselves. Belongings on Armaments has no pool tabs: its toolbar starts with an `h2.card-title` "Belongings"; the Stockpile page's `.seg` switches between the Stockpile and the Vault. Discipline and Veil rows (and the Worn card's class chip) appear only once a discipline is chosen.

### 8.7 Hunt (`?page=hunt`)

1. `.hero` with `data-tone="ember"`; the party bonus chip (`chip-violet`, `party` icon, "+20% Hunt XP · 2 of your party here") only when it applies.
2. The fight:

```html
<section class="card hunt-card">
  <div class="card-head">...The Inner of Gallowmoor · "Two or three at once · ×1.7 XP a kill"...</div>
  <div class="arena">
    <div class="arena-you">                                                 <!-- .is-down while recovering, .is-dead on the killing blow -->
      <div class="fx-layer"></div>
      <div class="portrait arena-portrait"><img src="assets/commander-default.webp" alt=""></div>
      <div class="arena-name">Morwen</div>
      <div class="hpbar"><i></i><span>87 / 112</span></div>
      <div class="veilbar"><i></i></div>
      <div class="veil-note">Bulwark · 64 of 100</div>
    </div>
    <div class="arena-mid">
      <div class="arena-vs" aria-hidden="true">VS</div>
      <div class="arena-status">Fighting</div>                             <!-- Searching, Hiding, A Sovereign, Recovering, Not hunting -->
      <div class="arena-timer">Reinforcements in 31s</div>
    </div>
    <div class="arena-foes">
      <div class="foe-card is-target">                                     <!-- .is-elite, .is-sovereign; .is-gone fades a fallen foe out -->
        <div class="fx-layer"></div>
        <button class="foe-art" type="button" aria-label="Fen Stalker: details"><svg class="m-art" viewBox="0 0 120 120">...</svg></button>
        <div class="foe-body">
          <div class="foe-name"><span>Fen Stalker</span><span class="tag tag-elite">Elite</span></div>
          <div class="hpbar hpbar-foe"><i></i><span>22 / 48</span></div>
        </div>
      </div>
      <!-- no foes: <div class="foe-empty"><span class="foe-empty-title">The Inner lies quiet</span><span class="foe-empty-sub">Nothing is being hunted here.</span></div> -->
    </div>
  </div>
  <div class="hunt-foot">
    <div class="kpis">...Kills, XP/hr, Threat (with a bar), Time left...</div>     <!-- not hunting here: <p class="hunt-hint">Choose a zone below to take up the hunt.</p> -->
    <div class="hunt-actions">
      <label class="switch"><input type="checkbox"> Hide when Threat peaks</label>
      <div class="btn-row"><button class="btn btn-quiet" type="button">Pull back</button><button class="btn btn-ember" type="button">Change hunt</button></div>
    </div>
  </div>
</section>
```

- Floats: append `<span class="float {kind} lane{0|1|2}">14!</span>` to the target's `.fx-layer` and remove it after 1 second. Kinds: `hit`, `crit` (gold), `strike`, `ambush`, `empowered`, `veil`, `volley` (violet), `bleed`, `thorns`, `hurt`, `ambushed` (ember), `heal` (green), `block`, `dodge`, `glance`, `join`, `enrage` (small caps words). Cycle the lane so blows do not overlap. Show at most the last 8 per frame.
- Struck: remove `.struck` from the art, read `offsetWidth`, add `.struck` (a 260ms shake).
- Monster drawings: `monsterArt(mob, elite)` from `popups/foe.js` draws the foe's own plate from `ui/monster-art.js` (`MONSTER_ART` by monster id; v4's five `KIND_ART` drawings are the fallback) inside `svg.m-art` (`.elite`, `.sovereign` set the rim through `--m-rim`; `--m-line` thickens it in small tiles). Parts are classes: `m-body`, `m-shade` (the far limbs), `m-cloth`, `m-bark`, `m-plate`, `m-lit`, `m-void`, `m-eye`, `m-glow`, `m-ivory`, `m-steel`, `m-edge`, `m-crack`, `m-bone`, `m-rope`, `m-shadow`, and the regions' own `m-ash`, `m-moss`, `m-sallow`, `m-ice`, `m-star`, `m-veil`, `m-fire`, `m-ghost`, `m-blood`, `m-rust`, `m-wood`, `m-water` (with `-glow` halos for ice, star and the Veil).
- Foe cards are keyed by foe uid: add new ones, update health in place, give fallen ones `.is-gone` and remove them after 700ms.

3. Zones, two across:

```html
<div class="grid-cards max-2">
  <button class="zone-card is-active" type="button">                           <!-- .is-peaked at 100 Threat -->
    <div class="art" data-tone="ember" aria-hidden="true"><svg>zoneInner</svg></div>
    <span class="zone-main"><span class="zone-name">Inner</span><span class="zone-sub">2 or 3 at once · ×1.7 XP</span></span>
    <span class="tag tag-ember">Hunting</span>                                  <!-- "Peaked" (tag-sovereign) at 100, or an empty span -->
    <span class="meter"><span class="meter-top"><span>Threat</span><b>64 / 100</b></span><div class="bar bar-ember bar-thin"><i></i></div></span>
  </button>
</div>
```

4. Quarry: `.grid-cards` of three `button.foe-tile` (`span.foe-art` with the drawing, `span.foe-tile-main` > `.foe-tile-name` + `.foe-tile-sub` "Stalker · 48 health · swings every 2.4s") and one `button.foe-tile.is-sovereign` spanning the row, with a `tag-sovereign` at its end.

Phones (below 768px): the arena is one column: you in a strip (72px portrait beside your bars), the status and timer on one ruled line, then the foe cards at full width with names that wrap rather than truncate. KPIs go two by two; the switch and buttons share a line.

Added with the live page (pages.css, The Hunt), for the party's shared fight:

```html
<div class="arena is-party">                                <!-- the shared fight, never your own -->
  <div class="arena-you">
    ...portrait, name, your hpbar...
    <div class="arena-band">                                <!-- the rest of the warband; hidden when alone -->
      <div class="band-mate is-down">                       <!-- .is-down dims a fallen or absent member -->
        <span class="band-name">Thane</span>
        <div class="hpbar hpbar-sm"><i></i><span>25 / 25</span></div>
      </div>
    </div>
  </div>
  ...
  <div class="arena-foes">
    <div class="foe-card">
      ...art, name, hpbar...
      <div class="small muted mt-1">On Thane</div>           <!-- who the foe is on; existing utilities -->
    </div>
  </div>
</div>
```

`.arena-band` is a column of rows under your own bars (240px at most, in the same column as your hpbar on phones). `.band-mate` is a 72px name beside the bar; `.band-name` truncates rather than wraps. `.arena.is-party` is the one state class: it turns `.arena-foes` into an `auto-fit` grid of 230px cards, because a party's roster scales with it (up to a dozen) and they should stand two abreast rather than run down the page. One foe still gets one wide card, and below 768px it is one column again. Nothing else about the arena changes.

### 8.8 Atlas (`?page=atlas`)

```html
<div class="atlas">
  <section class="card atlas-regions">
    <div class="card-head">...Regions · "2 of 9 open" chip...</div>
    <div class="pick-list" role="listbox" aria-label="Regions">
      <button class="pick-row is-current" role="option" aria-selected="false">...tier, name, sub, <span class="tag tag-violet">Here</span></button>
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
      <div class="atlas-block"><div class="eyebrow">Lives here</div><div class="chip-row">...foe chips, the Sovereign as chip-ember with skull...</div></div>
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
    <div class="chip-row"><span class="chip chip-gold"><svg>coin</svg>Pays 27g</span><span class="chip chip-violet"><svg>sparkle</svg>An hour of double XP</span></div>
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

`.grid-cards` of `.card.comp-card` (`.is-active` for the one at your side): `.comp-top` (art `art-lg`, neutral tone when not owned; `.comp-name`; `.comp-sub` "Rank II · Bond 7" or the price; `tag-violet` "At your side"), `p.comp-blurb`, `.well.comp-trait` (`.t-name`, `.t-val` green), a `.meter` for Bond when owned, `ul.comp-unlocks` (`li.is-open` for unlocked: `span.g` with a check icon, `span.req` "Bond 10" or "Rank III", then the text), and `.comp-actions`: "Take along" (`btn-primary btn-soft`), "Leave at camp" (`btn-quiet`) or "Buy · 300g" (`btn-gold btn-soft`, confirm with cost). Page actions: "Tunnel Rat walks with you" chip.

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

  Below 768px each listing becomes a card: item and price on top, "Left", the bands and Buy below (the `.listing-l` labels appear).
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

  `member-doing` tones: `ember` for hunting, `violet` for crafting and gathering, none for offline ("Last seen 2h ago"). Bonus chip: "Counts toward your bonus" (good), "Not hunting", "Other ground", "Offline". Your own card: "+20% to your Hunt XP". Kick only for the leader, never on yourself.
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
- Added with the live page (pages.css, Party): a refusal from chat (the rate limit, a message too long) shows for four seconds between the log and the composer as `<div class="chat-alert" role="alert"><svg>alert</svg><span>You are sending messages too quickly.</span></div>` (hidden otherwise). The "Found a party" form inside the `.empty` is `form.btn-row.empty-form`: centred, and its button drops the lone-button top margin `.empty .btn` gives, so the input and the button line up. The bonus summary is one chip under the page sub (`chip-violet` with `party` "+10% Hunt XP · 1 of your party here", or plain "No party bonus · nobody else here"); keep chip text short, chips never wrap.

### 8.16 Hiscores (`?page=hiscores`)

A `.hs-skills` row of chip tabs (`role="tablist"`, `aria-selected`): Total, then each skill with its icon. Then a card with the table from 7.21: `.hs-rank` (`.is-1` gold, `.is-2` silver, `.is-3` bronze), `.hs-name` with an avatar and the name, level and XP (`fmt`). Your row `tr.is-me`; `chip-violet` "You are #7" in the card head. Top 50. Phones: the XP column (`.hs-hide-sm`) and avatars hide.

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
- Focus is always visible: a 2px `--focus` outline with a 2px offset on `:focus-visible` (pills draw it inside the pill; inputs use a violet ring). Never remove it.
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
