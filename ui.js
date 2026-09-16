/* ============================================================
   Respite · ui.js · The Paintbrush
   ------------------------------------------------------------
   Everything that touches the screen: routing, rendering, popups
   and button wiring. Loaded last, so it also boots the game.

   Rendering rule: interactive elements (buttons, item cells) are
   only rebuilt when their signature changes. Numbers that move
   every tick are updated in place, so clicks are never lost to a
   rebuild mid-press.
   ============================================================ */

/* ================= 1. VIEW STATE ================= */

let route = { page: "character", arg: null };
let eqTab = "pack";          // Armaments page: "pack" (Belongings) | "vault"
let campTab = "stores";      // Provisions page: "stores" (Provisions) | "vault"
let gridFilter = "all";
let gridSort = "custom";
let navOpen = { vanguard: true, camp: true, trades: true, workshops: true, field: true };

let benchTab = "components"; // Artisan pages: "components" | "wares"
let benchTier = 1;
let benchTierSkill = null;

let popItem = null;          // { key, from, pick } shown in the item popup
let popAction = null;        // { kind, skillId, actionId, tier, zone, monsterId, back, pick } in the action popup
let huntZone = "outer";      // the zone the Hunt page's main button offers
let lastPick = {};           // the amount last chosen for each skill, this session only

let keys = {};               // render signatures, cleared by render()
let liveRefs = { nodes: [], recipes: [], hunt: null };
let navRefs = {};
let floatSeq = 0;

/* ================= 2. ROUTING ================= */

const PAGES = ["character", "armaments", "provisions", "companions", "atlas", "shop", "bounties", "skill", "requisitions", "forecast"];

// Old links still land on the right page.
const PAGE_ALIASES = { equipment: "armaments", camp: "provisions", kennel: "companions", bounty: "bounties" };

const PAGE_TITLES = {
  character: "Character", armaments: "Armaments", provisions: "Provisions", companions: "Companions",
  atlas: "Atlas", shop: "Shop", bounties: "Bounties", requisitions: "Requisitions", forecast: "Sky",
};

function parseHash() {
  const raw = (location.hash || "").replace(/^#\/?/, "");
  const parts = raw.split("/");
  const page = PAGE_ALIASES[parts[0]] || parts[0];
  const arg = parts[1];
  if (!PAGES.includes(page)) return { page: "character", arg: null };
  if (page === "skill" && !skillDef(arg)) return { page: "skill", arg: "delving" };
  return { page, arg: arg || null };
}

function go(page, arg) {
  const hash = "#/" + page + (arg ? "/" + arg : "");
  if (location.hash === hash) {
    route = parseHash();
    render();
  } else {
    location.hash = hash;
  }
}

/* ================= 3. RENDER CORE ================= */

// Full redraw. Call after anything the player does.
function render() {
  keys = {};
  liveRefs = { nodes: [], recipes: [], hunt: null };
  renderAll();
  refreshItemPopup();
  refreshActionPopup();
  scheduleSave();
}

function renderAll() {
  renderTopbar();
  renderSidebar();
  renderPage();
  renderLog();
}

// Called by loop() in engine.js every 60ms. Keyed and in-place only.
function renderFrame() {
  renderTopbar();
  if (route.page === "skill") renderSkill();
  if (route.page === "character") renderCharacter();
  if (route.page === "armaments") renderStorePage("eq");
  if (route.page === "provisions") renderStorePage("camp");
  if (route.page === "companions") renderCompanions();
  if (route.page === "bounties") renderBounty();
  if (route.page === "shop") setText(el("smugglerTimer"), `Moves on in ${fmtTime(windowEndsIn())}`);
  renderSidebar();
  renderLog();
  if (popAction) updateActionPopup();
  drainCombatFx();
}

function toast(msg) {
  const stack = el("toastStack");
  if (!stack || catchingUp) return;
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  t.onclick = () => t.remove();
  stack.appendChild(t);
  setTimeout(() => { if (t.parentNode) t.remove(); }, 7000);
}

// "12 / 200" for a batch, "12 / ∞" for an open-ended task.
const countOf = (done, limit) => `${fmt(done)} / ${limit == null ? "∞" : fmt(limit)}`;

/* ================= 4. TOPBAR ================= */

function renderTopbar() {
  setText(el("goldText"), fmtWhole(state.player.gold));
  setText(el("clockText"), serverClock());

  const hp = Math.max(0, Math.ceil(state.player.hp));
  el("hpFill").style.width = clamp((hp / maxHp()) * 100, 0, 100) + "%";
  setText(el("hpText"), `${hp}/${maxHp()}`);

  const sp = skillPlan();
  const sBar = el("tbTradesBar");

  if (sp) {
    setText(el("tbTradesName"), titleCase(sp.def.name));
    sBar.classList.toggle("nojump", sp.pct < 6);
    sBar.style.width = sp.pct + "%";

    let line = `${countOf(sp.done, sp.limit)} · ${fmtTime(sp.timeLeft)} left`;
    if (sp.capped === "stock") line += " · stock runs out";
    setText(el("tbTradesMeta"), line);
  } else {
    setText(el("tbTradesName"), "Idle");
    sBar.style.width = "0";
    setText(el("tbTradesMeta"), "No crews at work.");
  }

  const cp = combatPlan();
  const cBar = el("tbFieldBar");

  if (cp) {
    setText(el("tbFieldName"), `${cp.zone.name} · ${cp.region.name}`);
    cBar.style.width = cp.pct + "%";
    const doing = cp.phase === "hide" ? "hiding" : cp.phase === "search" ? "searching" : cp.kind === "sovereign" ? "a Sovereign" : `${cp.c.foes.length} on you`;
    const rate = cp.xpRate == null ? "XP/hr soon" : `${fmt(Math.round(cp.xpRate))} XP/hr`;
    setText(el("tbFieldMeta"), `${countOf(cp.done, cp.limit)} kills · ${rate} · Threat ${cp.threat} · ${doing}`);
  } else {
    setText(el("tbFieldName"), recovering() ? "Recovering" : "Idle");
    cBar.style.width = "0";
    setText(el("tbFieldMeta"), recovering() ? `Back in ${fmtTime(state.player.recoveryLeft)}.` : "Nobody is hunting.");
  }
}

/* ================= 5. SIDEBAR ================= */

function toggleNav(group) {
  navOpen[group] = !navOpen[group];
  keys.side = "";
  renderSidebar();
}

function renderSidebar() {
  const sig = [route.page, route.arg, JSON.stringify(navOpen)].join("|");
  if (keys.side !== sig) {
    keys.side = sig;
    buildSidebar();
  }
  updateSidebar();
  renderWeatherPanel();
}

function buildSidebar() {
  Object.keys(navOpen).forEach((g) => {
    const box = el("pill-" + g);
    if (box) box.classList.toggle("open", navOpen[g]);
  });

  navRefs = { skills: {} };

  const mkItem = ({ label, page, arg, active, locked, tag, onclick }) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "nav-item" + (active ? " active" : "") + (locked ? " locked" : "");
    b.innerHTML = '<span class="nav-name"></span><span class="lvl"></span>';
    b.children[0].textContent = label;
    if (tag) {
      b.children[1].className = "soon";
      b.children[1].textContent = tag;
    }
    if (!locked) b.onclick = onclick || (() => go(page, arg));
    return b;
  };

  const van = el("navVanguard");
  van.innerHTML = "";
  van.appendChild(mkItem({ label: "Character", page: "character", active: route.page === "character" }));
  const armItem = mkItem({ label: "Armaments", page: "armaments", active: route.page === "armaments" });
  navRefs.pack = armItem.children[1];
  van.appendChild(armItem);

  const camp = el("navCamp");
  camp.innerHTML = "";
  const storesItem = mkItem({ label: "Provisions", page: "provisions", active: route.page === "provisions" });
  navRefs.stores = storesItem.children[1];
  camp.appendChild(storesItem);
  camp.appendChild(mkItem({ label: "Companions", page: "companions", active: route.page === "companions" }));
  const boardItem = mkItem({ label: "Bounties", page: "bounties", active: route.page === "bounties" });
  navRefs.board = boardItem.children[1];
  camp.appendChild(boardItem);
  const reqItem = mkItem({ label: "Requisitions", page: "requisitions", active: route.page === "requisitions" });
  navRefs.req = reqItem.children[1];
  camp.appendChild(reqItem);

  const mkSkills = (box, kind) => {
    box.innerHTML = "";
    SKILLS.filter((s) => s.kind === kind).forEach((s) => {
      const item = mkItem({ label: s.name, page: "skill", arg: s.id, active: route.page === "skill" && route.arg === s.id });
      navRefs.skills[s.id] = { item, lvl: item.children[1], kind };
      box.appendChild(item);
    });
  };

  mkSkills(el("navTrades"), "gather");
  mkSkills(el("navWorkshops"), "craft");
  mkSkills(el("navField"), "war");
  el("navField").appendChild(mkItem({ label: "Dungeons", locked: true, tag: "Soon" }));
}

// Labels that move while you play, updated without rebuilding the buttons.
function updateSidebar() {
  setText(navRefs.pack, `${slotsUsed("inv")}/${packSlots()}`);
  setText(navRefs.stores, `${slotsUsed("bank")}/${slotCap("bank")}`);

  const b = state.bounty;
  setText(navRefs.board, b ? `${fmt(Math.min(b.progress, b.amount))}/${fmt(b.amount)}` : "");

  const reqLeft = REQUISITIONS_PER_DAY - state.requisitions.filter((r) => !r.resolved).length;
  setText(navRefs.req, `${reqLeft}/${REQUISITIONS_PER_DAY}`);

  Object.keys(navRefs.skills).forEach((id) => {
    const ref = navRefs.skills[id];
    setText(ref.lvl, "Lv." + skillLevel(id));
    const busy = ref.kind === "war" ? !!state.tasks.combat : !!(state.tasks.skilling && state.tasks.skilling.skillId === id);
    ref.item.classList.toggle("busy", busy);
  });
}

function modSpan(pct, skillId) {
  const s = document.createElement("span");
  s.className = pct > 0 ? "up" : "down";
  s.textContent = `${signedPct(pct)} ${skillName(skillId)}`;
  return s;
}

function renderWeatherPanel() {
  const sig = dayIndex();
  if (keys.weather === sig) return;
  keys.weather = sig;

  const w = currentWeather();
  setText(el("weatherTag"), w.label);

  const note = el("weatherNote");
  note.innerHTML = "";
  note.append(modSpan(w.mods[w.favoured], w.favoured), document.createTextNode(", "), modSpan(w.mods[w.hindered], w.hindered));

  setText(el("weatherXp"), w.bountiful ? `Bountiful Weekend · +${Math.round(BOUNTIFUL_XP * 100)}% XP to every trade` : "");
  setText(el("weatherNext"), tomorrowRevealed() ? `Tomorrow: ${weatherOn(1).label}` : "Tomorrow: revealed Sunday, 00:00 UTC");
}

/* ================= 6. PAGES ================= */

function renderPage() {
  document.querySelectorAll(".page").forEach((p) => {
    p.hidden = p.dataset.page !== route.page;
  });
  document.querySelectorAll(".icon-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.page === route.page);
  });

  el("crumbs").innerHTML = crumbText();

  if (route.page === "character") renderCharacter();
  if (route.page === "skill") renderSkill();
  if (route.page === "armaments") renderStorePage("eq");
  if (route.page === "provisions") renderStorePage("camp");
  if (route.page === "companions") renderCompanions();
  if (route.page === "atlas") renderAtlas();
  if (route.page === "shop") renderShop();
  if (route.page === "requisitions") renderRequisitions();
  if (route.page === "forecast") renderForecast();
  if (route.page === "bounties") renderBounty();
}

function crumbText() {
  const r = currentRegion();
  if (route.page === "skill") {
    const s = skillDef(route.arg);
    const group = s.kind === "gather" ? "Trades" : s.kind === "craft" ? "Artisans" : "The Field";
    return `Respite &nbsp;/&nbsp; ${group} &nbsp;/&nbsp; <b>${s.name}</b>`;
  }
  return `Respite &nbsp;/&nbsp; ${r.name} &nbsp;/&nbsp; <b>${PAGE_TITLES[route.page]}</b>`;
}

/* ================= 7. SKILL PAGES ================= */
/* Gathering: resource pills and the camp. Artisans: the bench, in pills.
   Hunt: the arena and the regional quarry. Every pill opens the action
   popup (section 14), which is where work is started. */

function renderSkill() {
  const s = skillDef(route.arg) || skillDef("delving");
  const region = currentRegion();
  renderSkillHero(s, region);

  const sig = skillSig(s, region);
  if (keys.skill !== sig) {
    keys.skill = sig;
    liveRefs = { nodes: [], recipes: [], hunt: null };
    keys.skillChips = null;

    el("skCamp").hidden = s.kind !== "gather";
    el("skZones").hidden = s.kind !== "war";
    el("skFoes").hidden = s.kind !== "war";

    renderMasteryTip(s);
    if (s.kind === "war") renderHuntBody(region);
    else if (s.kind === "gather") renderGatherBody(s, region);
    else renderBenchBody(s);
  }

  renderSkillChips(s);
  updateLive();
}

// Everything that changes which pills and panels the skill page shows.
function skillSig(s, region) {
  const t = state.tasks.skilling;
  const parts = [s.id, skillLevel(s.id), region.id, t ? `${t.skillId}:${t.actionId}` : "-"];
  if (s.kind === "craft") parts.push(benchTab, benchTier);
  if (s.kind === "war") {
    const c = state.tasks.combat;
    parts.push(c ? `${c.tier}:${c.zone}` : "-", recovering(), state.player.klass || "-");
  }
  return parts.join("|");
}

function renderSkillHero(s, region) {
  const lvl = skillLevel(s.id);
  const xp = state.skills[s.id] || 0;
  const base = XP_TABLE[lvl];
  const next = XP_TABLE[Math.min(lvl + 1, MAX_LEVEL)];
  const pct = lvl >= MAX_LEVEL ? 100 : ((xp - base) / (next - base)) * 100;

  setText(el("skHeroTag"), s.kind === "gather" ? `In ${region.name}` : s.kind === "war" ? "The Field" : "At Camp");
  setText(el("skHeroName"), s.name);
  if (keys.heroIcon !== s.id) {
    keys.heroIcon = s.id;
    el("skHeroIcon").innerHTML = icon(s.icon, "ico-xl");
  }
  setText(el("skHeroLvl"), "Lv " + lvl);
  setText(el("skHeroXp"), lvl >= MAX_LEVEL ? "Mastered" : `${fmt(xp)} / ${fmt(next)} XP`);
  el("skHeroBar").style.width = clamp(pct, 0, 100) + "%";
  setText(el("skHeroNote"), s.note || "");
  setText(el("skHeroNext"), lvl >= MAX_LEVEL ? "" : `${fmt(next - xp)} to next level`);
}

// The "i" in the hero's top-right corner. Gathering skills only.
function renderMasteryTip(s) {
  const wrap = el("skMastery");
  if (s.kind !== "gather") {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;

  const g = gatherSkillDef(s.id);
  const lvl = skillLevel(s.id);
  const dbl = Math.round(mastery(s.id).double * 100);
  setText(el("skMasteryLabel"), dbl ? `Mastery · +${dbl}% double yield` : "Mastery");

  const panel = el("skMasteryTip");
  panel.innerHTML = "";

  const title = document.createElement("div");
  title.className = "tip-title";
  title.textContent = `${s.name} Mastery`;
  panel.appendChild(title);

  const list = document.createElement("ul");
  list.className = "tip-list";
  g.lore.concat(["Every ten levels adds to the chance an action yields double."]).forEach((line) => {
    const li = document.createElement("li");
    li.textContent = line;
    list.appendChild(li);
  });
  panel.appendChild(list);

  const track = document.createElement("div");
  track.className = "tip-track";
  MASTERY_TRACK.forEach((step) => {
    const done = lvl >= step.level;
    const row = document.createElement("div");
    row.className = "tip-step" + (done ? " done" : "");
    row.innerHTML = '<span class="tip-glyph"></span><span class="tip-lv"></span><span class="tip-name"></span><span class="tip-val"></span>';
    row.children[0].textContent = done ? "✓" : "·";
    row.children[1].textContent = "Lv " + step.level;
    row.children[2].textContent = step.label;
    row.children[3].textContent = `+${Math.round(step.double * 100)}%`;
    track.appendChild(row);
  });
  panel.appendChild(track);

  const next = MASTERY_TRACK.find((step) => lvl < step.level);
  const foot = document.createElement("div");
  foot.className = "tip-foot";
  foot.textContent = next
    ? `Now +${dbl}% double yield. ${next.label} at Lv ${next.level}.`
    : `Every mastery earned: +${dbl}% double yield.`;
  panel.appendChild(foot);
}

// Everything bending a skill's XP right now. Nothing shows when nothing applies.
function xpMods(skillId) {
  const out = [];
  const w = currentWeather();
  const pct = w.mods[skillId];
  if (pct) out.push({ good: pct > 0, text: `${signedPct(pct)} XP · ${w.label}` });
  if (w.bountiful && isTrade(skillId)) out.push({ good: true, text: `+${Math.round(BOUNTIFUL_XP * 100)}% XP · Bountiful Weekend` });
  const comp = activeCompanion();
  const bonus = companionBonus("xp", skillId);
  if (comp && bonus) out.push({ good: true, text: `+${Math.round(bonus * 100)}% XP · ${comp.name}` });
  if (state.buff && state.buff.until > Date.now()) out.push({ good: true, text: `×${state.buff.mult} XP · Bounty reward` });
  return out;
}

function fillChips(box, mods) {
  box.innerHTML = "";
  mods.forEach((m) => {
    const chip = document.createElement("div");
    chip.className = "chip " + (m.good ? "good" : "warn");
    chip.textContent = m.text;
    box.appendChild(chip);
  });
}

function renderSkillChips(s) {
  const mods = xpMods(s.id);
  const sig = s.id + JSON.stringify(mods);
  if (keys.skillChips === sig) return;
  keys.skillChips = sig;
  fillChips(el("skWorkChips"), mods);
}

// A big clickable pill: art, name and one quiet status line.
function actionPill(def, locked, extraClass) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "node-pill" + (extraClass ? " " + extraClass : "") + (locked ? " locked" : "");
  b.dataset.action = def.id;
  b.innerHTML =
    `<span class="np-art">${icon(def.icon, "ico-lg")}</span>` +
    '<span class="np-body"><span class="np-name"></span><span class="np-state"></span></span>' +
    '<span class="np-bar"><i></i></span>';
  b.querySelector(".np-name").textContent = titleCase(def.name);
  return b;
}

function renderGatherBody(s, region) {
  const defs = GATHER_ACTIONS[s.id].filter((a) => a.tier === region.tier);
  const lvl = skillLevel(s.id);

  el("skWorkLabel").textContent = `Working · ${region.name}`;
  const box = el("skWorkBody");
  box.innerHTML = "";

  const grid = document.createElement("div");
  grid.className = "node-pills";

  defs.forEach((def) => {
    const locked = lvl < def.level;
    const pill = actionPill(def, locked, "");
    grid.appendChild(pill);
    liveRefs.nodes.push({ def, skillId: s.id, locked, pill, status: pill.querySelector(".np-state"), bar: pill.querySelector(".np-bar i") });
  });

  box.appendChild(grid);
  renderCampScene(s);
}

function renderBenchBody(s) {
  const lvl = skillLevel(s.id);
  const all = actionsFor(s.id);
  const tiers = [...new Set(all.map((a) => a.tier))].sort((a, b) => a - b);

  if (benchTierSkill !== s.id) {
    benchTierSkill = s.id;
    benchTier = tiers.reduce((best, i) => (TIERS[i - 1].level <= lvl ? i : best), tiers[0]);
  }

  el("skWorkLabel").textContent = "The Bench";
  const box = el("skWorkBody");
  box.innerHTML = "";

  // ---- the two tabs and the tier pills ----
  const bar = document.createElement("div");
  bar.className = "bench-bar";

  const inTier = all.filter((a) => a.tier === benchTier);
  const tabs = document.createElement("div");
  tabs.className = "pill-tabs";
  BENCH_TABS.forEach((tab) => {
    const count = inTier.filter((d) => benchGroupOf(d).tab === tab.id).length;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pill-tab big" + (benchTab === tab.id ? " active" : "");
    b.dataset.benchTab = tab.id;
    b.innerHTML = '<span></span><span class="count"></span>';
    b.children[0].textContent = tab.label;
    b.children[1].textContent = count;
    tabs.appendChild(b);
  });
  bar.appendChild(tabs);

  const tierRow = document.createElement("div");
  tierRow.className = "pill-tabs";
  tiers.forEach((i) => {
    const tier = TIERS[i - 1];
    const locked = lvl < tier.level;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pill-tab" + (benchTier === i ? " active" : "") + (locked ? " locked" : "");
    b.dataset.benchTier = i;
    b.title = `${stratumOf(i).name}, tier ${i}`;
    b.innerHTML = (locked ? icon("lock", "ico-sm") : "") + "<span></span>";
    b.querySelector("span").textContent = "Lv " + tier.level;
    tierRow.appendChild(b);
  });
  bar.appendChild(tierRow);
  box.appendChild(bar);

  // ---- recipes, grouped ----
  const tab = BENCH_TABS.find((t) => t.id === benchTab) || BENCH_TABS[0];
  let shown = 0;

  tab.groups.forEach((group) => {
    const defs = inTier.filter((d) => {
      const g = benchGroupOf(d);
      return g.tab === tab.id && g.group === group;
    });
    if (!defs.length) return;

    const section = document.createElement("div");
    section.className = "bench-group";
    const label = document.createElement("div");
    label.className = "bench-group-label";
    label.textContent = group;
    section.appendChild(label);

    const grid = document.createElement("div");
    grid.className = "node-pills";
    defs.forEach((def) => {
      const locked = lvl < def.level;
      const pill = actionPill(def, locked, "craft");
      grid.appendChild(pill);
      const names = {};
      Object.keys(def.cost || {}).forEach((k) => { names[k] = itemName(k); });
      liveRefs.recipes.push({ def, skillId: s.id, locked, names, pill, status: pill.querySelector(".np-state"), bar: pill.querySelector(".np-bar i") });
      shown++;
    });
    section.appendChild(grid);
    box.appendChild(section);
  });

  if (!shown) {
    const empty = document.createElement("div");
    empty.className = "muted tiny";
    empty.textContent = "Nothing to make here at this tier.";
    box.appendChild(empty);
  }

  // Picking a default tier above can change the signature; record the final one.
  keys.skill = skillSig(s, currentRegion());
}

// Missing components, by name, for a recipe that can't be paid for once.
function missingFor(def, names) {
  const cost = def.cost || {};
  return Object.keys(cost).filter((k) => haveQty(k) < cost[k]).map((k) => names[k] || itemName(k));
}

function updateLive() {
  const t = state.tasks.skilling;

  const paintPill = (n, extraShort) => {
    const active = !!(t && t.skillId === n.skillId && t.actionId === n.def.id);
    n.pill.classList.toggle("active", active);

    if (active) {
      const pct = clamp((t.progress / actionTime(n.def)) * 100, 0, 100);
      n.bar.classList.toggle("nojump", pct < 6);
      n.bar.style.width = pct + "%";
      setText(n.status, countOf(t.done, t.limit));
      n.status.classList.remove("short");
      return;
    }

    n.bar.style.width = "0";
    if (n.locked) {
      setText(n.status, `Needs Lv ${n.def.level}`);
      n.status.classList.remove("short");
      return;
    }
    extraShort(n);
  };

  liveRefs.nodes.forEach((n) => paintPill(n, () => {
    setText(n.status, "");
    n.status.classList.remove("short");
  }));

  liveRefs.recipes.forEach((r) => paintPill(r, () => {
    const missing = missingFor(r.def, r.names);
    setText(r.status, missing.length ? `Missing ${missing.join(", ")}` : `${(actionTime(r.def) / 1000).toFixed(0)}s · ${fmt(xpEach(r.skillId, r.def.xp))} XP`);
    r.status.classList.toggle("short", missing.length > 0);
  }));

  if (liveRefs.hunt) updateHunt();
}

/* ================= 8. THE CAMP ================= */
/* A drawn scene under each gathering page. It gains a piece each time the
   skill reaches a new tier: the first at Lv 1, the last at Lv 80. */

const CAMP_STAGES = [
  "A lean-to and a fire",
  "A tent for the crew",
  "Crates and barrels",
  "A proper work site",
  "A second crew and a cart",
  "A palisade",
  "A watchtower",
  "Banners and lanterns",
  "The great hall",
];

function campStage(skillId) {
  return TIERS.filter((t) => t.level <= skillLevel(skillId)).length;
}

// A cloaked worker standing on ground line y, holding the tool of the trade.
function campFigure(x, y, skillId) {
  const hand = `${x + 5} ${y - 22}`;
  const tools = {
    delving:    `<path class="c-tool" d="M${hand} L${x + 15} ${y - 39}"/><path class="c-tool" d="M${x + 8} ${y - 41} Q${x + 15} ${y - 41} ${x + 21} ${y - 34}"/>`,
    felling:    `<path class="c-tool" d="M${hand} L${x + 15} ${y - 39}"/><path class="c-toolhead" d="M${x + 12} ${y - 42} l8 2 -2 8Z"/>`,
    harvesting: `<path class="c-tool" d="M${hand} L${x + 11} ${y - 33}"/><path class="c-tool" d="M${x + 11} ${y - 33} q10 -4 9 8"/>`,
    flaying:    `<path class="c-tool" d="M${hand} L${x + 12} ${y - 28}"/><path class="c-toolhead" d="M${x + 11} ${y - 27} l7 -5 1 2Z"/>`,
    dredging:   `<path class="c-tool" d="M${x + 4} ${y - 20} L${x + 30} ${y - 58}"/>`,
  };
  return `<g class="c-fig"><circle cx="${x}" cy="${y - 34}" r="4.5"/>` +
    `<path d="M${x - 6} ${y - 28} H${x + 6} L${x + 8} ${y - 12} H${x + 4} L${x + 3} ${y} H${x + 0.5} L${x} ${y - 9} L${x - 0.5} ${y} H${x - 3} L${x - 4} ${y - 12} H${x - 8}Z"/></g>` +
    (tools[skillId] || "");
}

// The part of the camp that belongs to the trade. Returns its drawing and
// where the first worker stands.
function campWorksite(skillId, big) {
  if (skillId === "delving") {
    const heap = '<path class="c-dark" d="M612 186 L630 172 L642 177 L656 166 L674 180 L684 186Z"/><path class="c-rim" d="M630 172 L642 177 L656 166"/>';
    if (!big) return { svg: heap, worker: [700, 186] };
    return {
      svg: '<path class="c-hill-mid" d="M690 186 C720 152 770 124 830 124 C890 124 940 150 980 186Z"/>' +
        '<path class="c-void" d="M810 186 V160 Q835 140 860 160 V186Z"/>' +
        '<path class="c-wood" d="M804 186 V154 H866 V186"/><circle class="c-lamp-glow" cx="804" cy="150" r="9"/><circle class="c-lamp" cx="804" cy="150" r="3"/>' +
        heap +
        '<path class="c-sil" d="M730 166 H768 L762 180 H736Z"/><path class="c-dark" d="M734 166 L742 158 L750 162 L758 156 L766 166Z"/>' +
        '<circle class="c-wheel" cx="742" cy="182" r="5"/><circle class="c-wheel" cx="758" cy="182" r="5"/>',
      worker: [786, 186],
    };
  }

  if (skillId === "felling") {
    const stump = '<path class="c-sil" d="M620 186 V170 H648 V186Z"/><ellipse class="c-dark" cx="634" cy="170" rx="14" ry="4"/>' +
      '<path class="c-wood thin" d="M640 170 L654 150"/><path class="c-toolhead" d="M650 147 l10 3 -3 8Z"/>';
    const log = '<rect class="c-sil" x="664" y="176" width="70" height="10" rx="5"/><circle class="c-rim" cx="669" cy="181" r="3"/>';
    if (!big) return { svg: stump + log, worker: [752, 186] };
    let pile = "";
    [[0, 3], [1, 2], [2, 1]].forEach(([row, count]) => {
      for (let i = 0; i < count; i++) {
        const cx = 830 + row * 10 + i * 20;
        const cy = 177 - row * 17;
        pile += `<circle class="c-sil" cx="${cx}" cy="${cy}" r="9"/><circle class="c-rim" cx="${cx}" cy="${cy}" r="3.5"/>`;
      }
    });
    return {
      svg: stump + log + pile + '<path class="c-wood thin" d="M742 186 L756 164 M770 186 L756 164 M736 166 H790"/>' +
        '<rect class="c-sil" x="728" y="156" width="74" height="9" rx="4.5"/>',
      worker: [704, 186],
    };
  }

  if (skillId === "harvesting") {
    const sheaf = (x) => `<path class="c-herb" d="M${x} 186 L${x + 7} 150 L${x + 14} 186Z"/><path class="c-wood thin" d="M${x + 1} 172 H${x + 13}"/>`;
    const small = sheaf(630) + sheaf(652) + '<path class="c-sil" d="M676 172 H700 L696 186 H680Z"/>';
    if (!big) return { svg: small, worker: [720, 186] };
    let bundles = "";
    for (let x = 770; x <= 910; x += 20) bundles += `<path class="c-herb" d="M${x} 142 l-5 18 h10Z"/>`;
    return {
      svg: small + '<path class="c-wood thin" d="M750 186 L764 138 L778 186 M902 186 L916 138 L930 186"/><path class="c-rope" d="M764 140 H916"/>' + bundles,
      worker: [724, 186],
    };
  }

  if (skillId === "flaying") {
    const frame = (x) => `<path class="c-wood thin" d="M${x} 186 V146 M${x + 50} 186 V146 M${x - 4} 150 H${x + 54}"/>` +
      `<path class="c-hide" d="M${x + 6} 153 C${x + 18} 151 ${x + 32} 151 ${x + 44} 153 C${x + 46} 167 ${x + 42} 177 ${x + 25} 183 C${x + 8} 177 ${x + 4} 167 ${x + 6} 153Z"/>`;
    if (!big) return { svg: frame(640), worker: [720, 186] };
    return {
      svg: frame(640) + frame(760) + frame(880) + '<path class="c-sil" d="M712 186 V176 H736 V186Z"/><ellipse class="c-dark" cx="724" cy="176" rx="12" ry="3"/>',
      worker: [742, 186],
    };
  }

  // dredging
  const water = '<path class="c-water" d="M560 220 C588 202 610 193 642 189 C700 183 780 186 1000 180 V220Z"/><path class="c-shine" d="M630 202 H690 M730 208 H810 M850 199 H940"/>';
  if (!big) {
    return {
      svg: water + '<path class="c-wood thin" d="M664 190 L700 140"/><path class="c-rim" d="M700 140 Q716 158 706 180"/><path class="c-sil" d="M612 176 H636 L632 188 H616Z"/>',
      worker: [648, 188],
    };
  }
  return {
    svg: water + '<path class="c-plank" d="M640 179 H900"/><path class="c-wood thin" d="M660 181 V204 M730 181 V204 M800 181 V204 M870 181 V204"/>' +
      '<path class="c-wood thin" d="M886 176 V126 M884 128 H934 M930 128 V158"/><path class="c-rim" d="M890 132 L930 156 M930 132 L890 156 M890 144 H930"/>' +
      '<path class="c-sil" d="M612 176 H636 L632 188 H616Z"/>',
    worker: [800, 176],
  };
}

function campScene(skillId, stage) {
  const has = (n) => stage >= n;
  const out = [];

  out.push(
    '<defs>' +
      '<linearGradient id="campSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1e1629"/><stop offset="1" stop-color="#0d0a12"/></linearGradient>' +
      '<radialGradient id="campGlow"><stop offset="0" stop-color="#c1613a" stop-opacity=".5"/><stop offset="1" stop-color="#c1613a" stop-opacity="0"/></radialGradient>' +
      '<linearGradient id="campFog" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8d6fd1" stop-opacity="0"/><stop offset="1" stop-color="#8d6fd1" stop-opacity=".08"/></linearGradient>' +
      '<linearGradient id="campHorizon" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8d6fd1" stop-opacity="0"/><stop offset=".7" stop-color="#8d6fd1" stop-opacity=".1"/><stop offset="1" stop-color="#8d6fd1" stop-opacity="0"/></linearGradient>' +
    '</defs>',
    '<rect width="1000" height="220" fill="url(#campSky)"/>',
    '<rect y="96" width="1000" height="60" fill="url(#campHorizon)"/>',
    '<path class="c-star" d="M120 58h1.5M236 76h1.5M388 52h1.5M548 66h1.5M702 50h1.5M942 82h1.5M60 90h1.5M640 88h1.5"/>',
    '<circle class="c-moon-glow" cx="860" cy="74" r="22"/><circle class="c-moon" cx="860" cy="74" r="9"/>',
    '<path class="c-hill-far" d="M0 142 C110 112 210 128 320 118 C430 108 520 134 640 122 C760 110 880 126 1000 112 V220 H0Z"/>',
    '<path class="c-tree" d="M168 122 V100 M168 108 L158 98 M168 104 L177 94 M724 116 V92 M724 102 L713 91 M724 98 L734 88 M724 108 L733 101 M930 112 V94 M930 102 L921 94"/>',
    '<path class="c-hill-near" d="M0 170 C140 156 260 168 400 160 C540 152 660 166 800 158 C880 154 950 158 1000 156 V220 H0Z"/>'
  );

  if (has(6)) {
    let stakes = "";
    for (let x = 6; x < 1000; x += 15) {
      const top = 138 + ((x * 7) % 11);
      stakes += `M${x} 178 V${top + 6} L${x + 4} ${top} L${x + 8} ${top + 6} V178Z `;
    }
    out.push(`<path class="c-stake" d="${stakes}"/><path class="c-wood thin" d="M0 160 H1000"/>`);
  }

  out.push('<rect class="c-ground" y="186" width="1000" height="34"/>');

  if (has(7)) {
    out.push(
      '<path class="c-wood" d="M70 186 L82 92 M114 186 L102 92 M76 150 H108 M80 118 H104 M76 150 L104 118 M108 150 L80 118"/>' +
      '<rect class="c-sil" x="70" y="80" width="44" height="14"/><path class="c-sil" d="M64 80 L92 58 L120 80Z"/>' +
      '<rect class="c-light" x="88" y="83" width="8" height="8"/>'
    );
  }

  if (has(9)) {
    out.push(
      '<path class="c-dark" d="M136 186 V142 L230 102 L324 142 V186Z"/><path class="c-rim" d="M126 146 L230 98 L334 146"/>' +
      '<path class="c-wood thin" d="M230 98 V84 M220 92 L230 80 L240 92"/>' +
      '<rect class="c-light" x="156" y="152" width="10" height="14"/><rect class="c-light" x="196" y="152" width="10" height="14"/>'
    );
  }

  const site = campWorksite(skillId, has(4));
  out.push(site.svg);

  if (has(2)) {
    out.push(
      '<path class="c-sil" d="M455 186 L500 124 L545 186Z"/><path class="c-rim" d="M500 124 L545 186"/>' +
      '<path class="c-door" d="M491 186 L500 150 L509 186Z"/><path class="c-wood thin" d="M500 124 V112"/>'
    );
  }

  out.push('<path class="c-sil" d="M270 186 L322 128 L350 186Z"/><path class="c-wood thin" d="M262 186 L326 122"/><path class="c-rim" d="M322 128 L350 186"/>');

  if (has(8)) {
    let lamps = '<path class="c-rope" d="M326 124 Q413 150 500 116"/>';
    [[369, 133], [413, 136], [457, 130]].forEach(([x, y]) => {
      lamps += `<circle class="c-lamp-glow" cx="${x}" cy="${y + 5}" r="8"/><rect class="c-lamp" x="${x - 2}" y="${y + 2}" width="4" height="6"/>`;
    });
    out.push(lamps);
  }

  if (has(3)) {
    out.push(
      '<rect class="c-sil" x="352" y="168" width="20" height="18"/><rect class="c-sil" x="370" y="174" width="14" height="12"/>' +
      '<path class="c-rim" d="M352 168 L372 186 M372 168 L352 186"/>' +
      '<rect class="c-sil" x="560" y="170" width="14" height="16" rx="3"/><path class="c-rim" d="M560 175 H574 M560 181 H574"/>'
    );
  }

  out.push(
    '<ellipse cx="413" cy="182" rx="84" ry="30" fill="url(#campGlow)"/>' +
    '<path class="c-wood" d="M398 188 L428 180 M400 180 L428 188"/>' +
    '<g class="camp-fire"><path class="c-ember" d="M413 184 C402 174 414 166 410 152 C424 162 426 174 413 184Z"/>' +
    '<path class="c-flame" d="M413 184 C407 178 413 173 412 165 C419 171 420 178 413 184Z"/></g>'
  );

  if (has(5)) {
    out.push(
      '<path class="c-sil" d="M150 164 H206 L200 180 H156Z"/><path class="c-dark" d="M156 164 L166 152 L178 158 L190 150 L204 164Z"/>' +
      '<path class="c-wood thin" d="M206 168 L230 160"/><circle class="c-wheel" cx="166" cy="182" r="6"/><circle class="c-wheel" cx="192" cy="182" r="6"/>' +
      campFigure(240, 186, skillId)
    );
  }

  out.push(campFigure(site.worker[0], site.worker[1], skillId));

  if (has(8)) {
    out.push(
      (has(7) ? '<path class="c-wood thin" d="M92 58 V36"/><path class="c-cloth" d="M92 37 H114 L107 44 L114 51 H92Z"/>' : "") +
      '<path class="c-wood thin" d="M590 186 V120"/><path class="c-cloth" d="M590 122 H612 L605 130 L612 138 H590Z"/>'
    );
  }

  out.push('<rect y="140" width="1000" height="80" fill="url(#campFog)"/>');
  return out.join("");
}

function renderCampScene(s) {
  const stage = campStage(s.id);
  setText(el("skCampMeta"), `Tier ${stage} of ${TIERS.length}`);
  el("skCampScene").innerHTML =
    `<svg viewBox="0 34 1000 186" preserveAspectRatio="xMidYMax slice" role="img" aria-label="The ${s.name} camp">${campScene(s.id, stage)}</svg>`;
  setText(el("skCampNow"), CAMP_STAGES[stage - 1]);
  setText(el("skCampNext"), stage < TIERS.length
    ? `Next at Lv ${TIERS[stage].level}: ${CAMP_STAGES[stage].toLowerCase()}`
    : "Nothing left to build.");
}

/* ================= 9. THE HUNT ================= */
/* The arena: your commander on the left and up to three foes on the right,
   each with its own health bar and every blow floating up off whoever took
   it. Under it, the region's four zones and the quarry that lives there.
   Zone pills open the zone popup, where a hunt is started. */

const MONSTER_ART = {
  beast:
    '<path class="m-body" d="M26 78 C30 58 48 46 70 46 C90 46 104 58 108 76 C110 86 106 96 100 100 V108 H92 L90 96 C78 100 58 100 48 96 L44 108 H36 V94 C30 92 26 86 26 78Z"/>' +
    '<path class="m-body" d="M48 50 L50 36 L57 48 M62 46 L66 32 L71 46 M76 46 L82 34 L85 48 M90 52 L99 42 L99 57"/>' +
    '<path class="m-body" d="M32 70 C22 63 12 66 8 74 C6 80 10 84 16 86 L30 90 C35 84 35 76 32 70Z"/>' +
    '<path class="m-body" d="M24 66 L19 51 L32 64Z"/>' +
    '<path class="m-edge" d="M106 80 C116 76 118 64 112 56"/><path class="m-bone" d="M10 81 L12 86 L14 81 M16 83 L18 88 L20 83"/>' +
    '<circle class="m-eye" cx="17" cy="74" r="2.4"/>',
  man:
    '<path class="m-body" d="M60 18 C44 18 36 32 36 46 C36 54 38 58 42 62 C30 72 24 88 22 110 H98 C96 88 90 72 78 62 C82 58 84 54 84 46 C84 32 76 18 60 18Z"/>' +
    '<path class="m-void" d="M48 44 C48 36 53 31 60 31 C67 31 72 36 72 44 C72 53 66 59 60 59 C54 59 48 53 48 44Z"/>' +
    '<circle class="m-eye" cx="55" cy="45" r="1.9"/><circle class="m-eye" cx="65" cy="45" r="1.9"/>' +
    '<path class="m-edge" d="M40 82 Q60 88 80 82"/>' +
    '<path class="m-steel" d="M30 92 L8 58 L12 55 L34 88Z"/><path class="m-edge" d="M26 90 L38 82"/>',
  golemMob:
    '<path class="m-body" d="M22 58 L8 70 L10 98 L22 96Z M98 58 L112 70 L110 98 L98 96Z"/>' +
    '<path class="m-body" d="M30 40 H90 L98 60 V84 L90 92 V110 H72 V94 H48 V110 H30 V92 L22 84 V60Z"/>' +
    '<path class="m-body" d="M46 16 H74 V38 H46Z"/><path class="m-eye" d="M50 25 H70 V30 H50Z"/>' +
    '<path class="m-crack" d="M40 50 L52 62 L48 76 M78 48 L70 64 L74 74 M58 96 V104"/>',
  horror:
    '<path class="m-body" d="M60 14 C90 14 106 38 104 62 C102 80 92 90 96 108 C84 104 80 96 72 100 C68 112 54 112 50 100 C42 96 38 104 26 108 C30 90 18 80 16 62 C14 38 30 14 60 14Z"/>' +
    '<ellipse class="m-void" cx="58" cy="54" rx="20" ry="14"/><circle class="m-eye" cx="54" cy="54" r="7"/><ellipse class="m-void" cx="54" cy="54" rx="2" ry="5"/>' +
    '<circle class="m-eye" cx="36" cy="34" r="2"/><circle class="m-eye" cx="82" cy="31" r="2"/><circle class="m-eye" cx="88" cy="70" r="1.6"/>' +
    '<path class="m-edge" d="M38 80 Q58 92 78 80"/><path class="m-bone" d="M46 84 V89 M54 86 V92 M62 86 V92 M70 84 V89"/>',
  drakeMob:
    '<path class="m-body" d="M84 54 L97 45 L93 58 M95 65 L109 58 L103 71 M103 79 L117 74 L109 87"/>' +
    '<path class="m-body" d="M116 118 C110 86 100 66 84 54 C74 46 62 42 50 44 L26 50 C16 52 12 58 16 62 L36 64 L22 72 C18 76 22 80 28 78 L52 72 C64 74 72 82 78 94 C84 106 86 114 86 118Z"/>' +
    '<path class="m-body" d="M68 46 L88 24 L78 48Z M58 44 L66 20 L64 46Z"/>' +
    '<circle class="m-eye" cx="44" cy="52" r="2.7"/><path class="m-bone" d="M24 62 L26 66 L28 62 M30 63 L32 67"/>',
};

function monsterArt(mob, elite) {
  const cls = mob.archetype === "sovereign" ? "sovereign" : elite ? "elite" : "";
  return `<svg class="m-art ${cls}" viewBox="0 0 120 120" aria-hidden="true">${MONSTER_ART[mob.icon] || MONSTER_ART.horror}</svg>`;
}

const ZONE_ICONS = { outer: "zoneOuter", middle: "zoneMiddle", inner: "zoneInner", core: "zoneCore" };

const pctOf = (x) => `${Math.round(x * 100)}%`;

// "the Outer of The Ashen Verge"
const zonePlace = (zoneId, tier) => `the ${zoneDef(zoneId).name} of ${regionOfTier(tier).name}`;

function renderHuntBody(region) {
  el("skWorkLabel").textContent = `The Hunt · ${region.name}`;
  const box = el("skWorkBody");
  box.innerHTML = "";

  const arena = document.createElement("div");
  arena.className = "arena";
  arena.innerHTML =
    '<div class="arena-side you">' +
      '<div class="fx-layer"></div>' +
      '<div class="arena-art"><img src="assets/commander-default.webp" alt=""></div>' +
      '<div class="arena-name"></div>' +
      '<div class="hpbar"><i></i><span></span></div>' +
      '<div class="veilbar" title="The Veil"><i></i></div>' +
      '<div class="veil-note"></div>' +
    '</div>' +
    '<div class="arena-mid"><div class="arena-vs">VS</div><div class="arena-status"></div><div class="arena-timer"></div></div>' +
    '<div class="arena-foes"><div class="foe-empty"><span class="fe-title"></span><span class="fe-sub"></span></div></div>';
  box.appendChild(arena);

  const foot = document.createElement("div");
  foot.className = "arena-foot";
  foot.innerHTML =
    '<div class="arena-stats">' +
      '<div class="arena-stat"><span class="l">Kills</span><b data-stat="kills"></b></div>' +
      '<div class="arena-stat"><span class="l">XP/hr</span><b data-stat="xp"></b></div>' +
      '<div class="arena-stat"><span class="l">Threat</span><b data-stat="threat"></b></div>' +
      '<div class="arena-stat"><span class="l">Time left</span><b data-stat="left"></b></div>' +
    '</div>' +
    '<div class="arena-hint">Choose a zone below to take up the hunt.</div>' +
    '<div class="arena-actions">' +
      '<label class="hide-toggle"><input type="checkbox" data-hunt="hide"><span>Hide when Threat peaks</span></label>' +
      '<div class="btnrow"><button type="button" class="btn" data-hunt="pull">Pull back</button><button type="button" class="btn btn-primary" data-hunt="open"></button></div>' +
    '</div>';
  box.appendChild(foot);

  const you = arena.querySelector(".you");
  const stat = (k) => foot.querySelector(`[data-stat="${k}"]`);
  liveRefs.hunt = {
    tier: region.tier,
    youSide: you, youArt: you.querySelector(".arena-art"), youName: you.querySelector(".arena-name"),
    youHp: you.querySelector(".hpbar i"), youHpText: you.querySelector(".hpbar span"), youFx: you.querySelector(".fx-layer"),
    veilBar: you.querySelector(".veilbar"), veil: you.querySelector(".veilbar i"), veilNote: you.querySelector(".veil-note"),
    status: arena.querySelector(".arena-status"), timer: arena.querySelector(".arena-timer"),
    foes: arena.querySelector(".arena-foes"), foeCards: new Map(),
    empty: arena.querySelector(".foe-empty"), emptyTitle: arena.querySelector(".fe-title"), emptySub: arena.querySelector(".fe-sub"),
    stats: foot.querySelector(".arena-stats"), hint: foot.querySelector(".arena-hint"),
    kills: stat("kills"), xp: stat("xp"), threat: stat("threat"), left: stat("left"),
    hideWrap: foot.querySelector(".hide-toggle"), hide: foot.querySelector('[data-hunt="hide"]'),
    pull: foot.querySelector('[data-hunt="pull"]'), open: foot.querySelector('[data-hunt="open"]'),
    zones: {},
  };

  renderZones();
  renderQuarry(region);
}

function renderZones() {
  const body = el("skZonesBody");
  body.innerHTML = "";

  const caption = document.createElement("p");
  caption.className = "panel-caption";
  caption.textContent = "Deeper zones field more foes at once, call reinforcements sooner, turn up more Elites and pay more XP a kill. Every kill builds that zone's Threat, and at 100 its Sovereign may come for you.";
  body.appendChild(caption);

  const pills = document.createElement("div");
  pills.className = "node-pills zone-pills";
  ZONES.forEach((z) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "node-pill war zone";
    b.dataset.zone = z.id;
    b.innerHTML =
      `<span class="np-art">${icon(ZONE_ICONS[z.id], "ico-lg")}</span>` +
      '<span class="np-body"><span class="np-name"></span><span class="np-state"></span></span>' +
      '<span class="np-bar threat"><i></i></span>';
    b.querySelector(".np-name").textContent = z.name;
    pills.appendChild(b);
    liveRefs.hunt.zones[z.id] = { pill: b, state: b.querySelector(".np-state"), bar: b.querySelector(".np-bar i") };
  });
  body.appendChild(pills);
}

function renderQuarry(region) {
  const body = el("skFoesBody");
  body.innerHTML = "";

  const pills = document.createElement("div");
  pills.className = "node-pills";
  foesOf(region.tier).concat([sovereignOf(region.tier)]).forEach((m) => {
    const sov = m.archetype === "sovereign";
    const b = document.createElement("button");
    b.type = "button";
    b.className = "node-pill war" + (sov ? " sovereign" : "");
    b.dataset.monster = m.id;
    b.innerHTML =
      `<span class="np-art">${icon(m.icon, "ico-lg")}</span>` +
      '<span class="np-body"><span class="np-name"></span><span class="np-state"></span></span>';
    b.querySelector(".np-name").textContent = m.name;
    b.querySelector(".np-state").textContent = sov
      ? "Sovereign · comes when Threat peaks"
      : `${ARCHETYPES[m.archetype].name} · ${fmt(m.hp)} health · swings every ${(m.speed / 1000).toFixed(1)}s`;
    pills.appendChild(b);
  });
  body.appendChild(pills);
}

function buildFoeCard(f) {
  const mob = getMonster(f.id);
  const sov = mob.archetype === "sovereign";
  const node = document.createElement("div");
  node.className = "foe-card" + (sov ? " sovereign" : f.elite ? " elite" : "");
  node.innerHTML =
    '<div class="fx-layer"></div>' +
    `<button type="button" class="foe-art" data-monster="${mob.id}">${monsterArt(mob, f.elite)}</button>` +
    '<div class="foe-body"><div class="foe-name"><span class="fn"></span></div><div class="hpbar foe"><i></i><span></span></div></div>';
  node.querySelector(".foe-art").setAttribute("aria-label", `${mob.name}: details`);
  node.querySelector(".fn").textContent = mob.name;
  if (sov || f.elite) {
    const tag = document.createElement("span");
    tag.className = "rank-tag " + (sov ? "boss" : "elite");
    tag.textContent = sov ? "Sovereign" : "Elite";
    node.querySelector(".foe-name").appendChild(tag);
  }
  return {
    node, art: node.querySelector(".foe-art"), fx: node.querySelector(".fx-layer"),
    hp: node.querySelector(".hpbar i"), hpText: node.querySelector(".hpbar span"), gone: false,
  };
}

// Foe cards are keyed by uid: new foes get a card, the fallen fade out.
function syncFoeCards(h, c) {
  const foes = c && c.phase === "fight" ? c.foes : [];
  const standing = new Set(foes.map((f) => f.uid));

  h.foeCards.forEach((card, uid) => {
    if (standing.has(uid) || card.gone) return;
    card.gone = true;
    card.node.classList.add("gone");
    setTimeout(() => {
      card.node.remove();
      if (h.foeCards.get(uid) === card) h.foeCards.delete(uid);
    }, 700);
  });

  foes.forEach((f, i) => {
    let card = h.foeCards.get(f.uid);
    if (!card) {
      card = buildFoeCard(f);
      h.foeCards.set(f.uid, card);
      h.foes.appendChild(card.node);
    }
    card.node.classList.toggle("target", i === 0);
    card.hp.style.width = clamp(f.hp / f.max, 0, 1) * 100 + "%";
    setText(card.hpText, `${fmt(Math.max(0, Math.ceil(f.hp)))} / ${fmt(f.max)}`);
  });

  const fading = [...h.foeCards.values()].some((card) => card.gone);
  h.empty.hidden = foes.length > 0 || fading;
}

function updateHunt() {
  const h = liveRefs.hunt;
  const c = state.tasks.combat;
  const here = !!(c && c.tier === h.tier);
  const s = combatStats();
  if (here) huntZone = c.zone;

  // ---- you ----
  setText(h.youName, commanderName());
  const hp = clamp(Math.ceil(state.player.hp), 0, s.maxHp);
  h.youHp.style.width = (hp / s.maxHp) * 100 + "%";
  setText(h.youHpText, `${fmt(hp)} / ${fmt(s.maxHp)}`);
  h.youSide.classList.toggle("down", recovering());

  const kls = myClass();
  h.veilBar.classList.toggle("locked", !kls);
  h.veil.style.width = (kls && here ? clamp(c.veil / VEIL_MAX, 0, 1) * 100 : 0) + "%";
  let veilText = kls ? kls.veilName : canPickClass() ? "Choose a discipline" : `The Veil opens at Hunt ${CLASS_PICK_LEVEL}`;
  if (kls && here && c.volley > 0) veilText = `Volley · ${c.volley} to come`;
  setText(h.veilNote, veilText);

  // ---- the foes ----
  syncFoeCards(h, here ? c : null);

  // ---- what is happening ----
  let status = "Not hunting";
  let timer = "";
  let emptyTitle = `${zoneDef(huntZone).name} lies quiet`;
  let emptySub = "Nothing is being hunted here.";

  if (recovering()) {
    status = "Recovering";
    timer = `Back in ${fmtTime(state.player.recoveryLeft)}`;
    emptySub = "You are in no state to hunt.";
  } else if (c && !here) {
    status = `Hunting ${zonePlace(c.zone, c.tier)}`;
  } else if (here) {
    const zone = zoneDef(c.zone);
    if (c.phase === "hide") {
      status = "Hiding";
      timer = `${fmtTime(c.wait)} left`;
      emptyTitle = "Lying low";
      emptySub = `Something vast is searching the ${zone.name}.`;
    } else if (c.phase === "search") {
      status = c.sovereignNext ? "Something vast approaches" : "Searching";
      timer = `${fmtTime(c.wait)}`;
      emptyTitle = c.sovereignNext ? sovereignOf(c.tier).name : `Searching the ${zone.name}`;
      emptySub = c.sovereignNext ? "It has found you." : "The next encounter is close.";
    } else if (c.kind === "sovereign") {
      status = "A Sovereign";
      timer = c.enrage ? `Enraged ×${c.enrage}` : `Enrages in ${fmtTime(c.enrageAt - c.clock)}`;
    } else {
      status = "Fighting";
      timer = c.foes.length >= MAX_FOES ? "Three at once" : `Reinforcements in ${fmtTime(c.reinforceAt - c.clock)}`;
    }
  }
  setText(h.status, status);
  setText(h.timer, timer);
  setText(h.emptyTitle, emptyTitle);
  setText(h.emptySub, emptySub);

  // ---- the numbers ----
  h.stats.hidden = !here;
  h.hint.hidden = here;
  h.hideWrap.hidden = !here;
  if (here) {
    setText(h.kills, countOf(c.done, c.limit));
    setText(h.xp, c.xpRate == null ? `In ${fmtTime(c.nextMark - c.elapsed)}` : fmt(Math.round(c.xpRate)));
    setText(h.threat, `${threatIn(c.tier, c.zone)} / ${THREAT_CAP}`);
    setText(h.left, fmtTime(Math.max(0, IDLE_CAP_MS - c.elapsed)));
    if (document.activeElement !== h.hide) h.hide.checked = !!state.settings.hideSovereign;
  } else if (c) {
    h.hint.textContent = `The hunt is out in ${zonePlace(c.zone, c.tier)}.`;
  } else {
    h.hint.textContent = "Choose a zone below to take up the hunt.";
  }

  h.pull.hidden = !here;
  h.open.disabled = recovering();
  setText(h.open, recovering() ? "Recovering" : here ? "Change hunt" : `Hunt the ${zoneDef(huntZone).name}`);

  // ---- zones ----
  ZONES.forEach((z) => {
    const ref = h.zones[z.id];
    if (!ref) return;
    const threat = threatIn(h.tier, z.id);
    ref.pill.classList.toggle("active", here && c.zone === z.id);
    setText(ref.state, `${z.foesText} at once · ×${z.xp} XP · Threat ${threat}`);
    ref.bar.style.width = (threat / THREAT_CAP) * 100 + "%";
  });
}

const FLOAT_TEXT = {
  hit: (n) => fmt(n),
  crit: (n) => `${fmt(n)}!`,
  strike: (n) => `${fmt(n)}!`,
  ambush: (n) => `${fmt(n)}!`,
  volley: (n) => fmt(n),
  empowered: (n) => `${fmt(n)}!`,
  bleed: (n) => fmt(n),
  thorns: (n) => fmt(n),
  hurt: (n) => fmt(n),
  ambushed: (n) => `${fmt(n)}!`,
  block: (n) => `Blunted ${fmt(n)}`,
  glance: () => "Glance",
  heal: (n) => `+${fmt(n)}`,
  join: () => "Joins",
  enrage: () => "Enraged",
};
const STRUCK = ["hit", "crit", "strike", "ambush", "volley", "empowered", "hurt", "ambushed", "block", "kill"];

function spawnFloat(h, ev) {
  const card = ev.who === "you" ? null : h.foeCards.get(ev.who);
  if (ev.who !== "you" && !card) return;
  const art = card ? card.art : h.youArt;

  if (STRUCK.includes(ev.kind)) {
    art.classList.remove("struck");
    void art.offsetWidth;   // restart the animation
    art.classList.add("struck");
  }

  const text = FLOAT_TEXT[ev.kind];
  if (!text) return;
  const f = document.createElement("span");
  f.className = `float ${ev.kind} lane${floatSeq++ % 3}`;
  f.textContent = text(ev.amount);
  (card ? card.fx : h.youFx).appendChild(f);
  setTimeout(() => f.remove(), 1000);
}

// Shows what the fight did since the last frame, when the arena is on screen.
function drainCombatFx() {
  if (!combatFx.length) return;
  const events = combatFx.splice(0);
  const h = liveRefs.hunt;
  const c = state.tasks.combat;
  if (!h || route.page !== "skill" || document.hidden || (c && c.tier !== h.tier)) return;
  const now = Date.now();
  // A burst (a long frame, a slow device) shows only its last few blows.
  events.filter((ev) => now - ev.t < 1500).slice(-8).forEach((ev) => spawnFloat(h, ev));
}

/* ================= 10. CHARACTER ================= */

// Your account name, or "Commander" until you sign in.
function commanderName() {
  const a = state.meta.account;
  return a ? a.charAt(0).toUpperCase() + a.slice(1) : "Commander";
}

function renderCharacter() {
  const region = currentRegion();
  const name = commanderName();
  setText(el("chName"), name);
  setText(el("chPortrait"), name.charAt(0));
  setText(el("chRegionTag"), `In ${region.name}`);
  setText(el("chTotal"), "Lv " + totalLevel());

  const kls = myClass();
  const comp = activeCompanion();
  const tagSig = [region.id, kls ? kls.id : "-", comp ? comp.id : "-"].join("|");
  if (keys.chTags !== tagSig) {
    keys.chTags = tagSig;
    const tags = el("chTags");
    tags.innerHTML = "";
    [kls && kls.name, region.name, comp && comp.name].filter(Boolean).forEach((text) => {
      const span = document.createElement("span");
      span.textContent = text;
      tags.appendChild(span);
    });
  }

  const b = state.bounty;
  const bounty = b ? `Bounty <b>${fmt(Math.min(b.progress, b.amount))} / ${fmt(b.amount)}</b> · resets in ${fmtTime(windowEndsIn())}` : "";
  if (keys.chBounty !== bounty) {
    keys.chBounty = bounty;
    el("chBounty").innerHTML = bounty;
  }

  renderCharacterLabour();
  renderCharacterField();
  renderCharacterStats();
  renderCharacterSkills();
}

function idleBlock(title, sub, label, onClick) {
  const wrap = document.createElement("div");
  wrap.className = "idle-block";
  wrap.innerHTML = '<div class="big"></div><div class="sub"></div><button type="button" class="btn"></button>';
  wrap.children[0].textContent = title;
  wrap.children[1].textContent = sub;
  wrap.children[2].textContent = label;
  wrap.children[2].onclick = onClick;
  return wrap;
}

function taskBlock(iconName, name, mob) {
  const wrap = document.createElement("div");
  wrap.innerHTML = `<div class="task-name">${icon(iconName, "ico-sm")}<span></span></div><div class="bar${mob ? " mob" : ""}"><i></i></div><div class="task-meta"><span></span><b></b></div>`;
  wrap.querySelector(".task-name span").textContent = name;
  return wrap;
}

function renderCharacterLabour() {
  const box = el("chLabour");
  const sp = skillPlan();
  const sig = sp ? "task:" + sp.def.id : "idle";

  if (keys.chLabour !== sig) {
    keys.chLabour = sig;
    box.innerHTML = "";
    box.appendChild(sp
      ? taskBlock(sp.def.icon, titleCase(sp.def.name), false)
      : idleBlock("No crews at work", "Your people are standing around.", "Open Delving", () => go("skill", "delving")));
  }

  if (sp) {
    box.querySelector(".bar i").style.width = sp.pct + "%";
    setText(box.querySelector(".task-meta span"), `${countOf(sp.done, sp.limit)} actions`);
    setText(box.querySelector(".task-meta b"), fmtTime(sp.timeLeft) + " left");
  }
}

function renderCharacterField() {
  const box = el("chField");
  const cp = combatPlan();
  const sig = cp ? `hunt:${cp.c.tier}:${cp.c.zone}` : recovering() ? "recovering" : "idle";

  if (keys.chField !== sig) {
    keys.chField = sig;
    box.innerHTML = "";
    if (cp) box.appendChild(taskBlock(ZONE_ICONS[cp.zone.id], `${cp.zone.name} · ${cp.region.name}`, true));
    else if (recovering()) box.appendChild(idleBlock("Recovering", "", "Open the Hunt", () => go("skill", "warfare")));
    else box.appendChild(idleBlock("Nothing hunted", "Take up the hunt yourself.", "Open the Hunt", () => go("skill", "warfare")));
  }

  if (cp) {
    box.querySelector(".bar i").style.width = cp.pct + "%";
    setText(box.querySelector(".task-meta span"), `${countOf(cp.done, cp.limit)} kills · ${cp.xpRate == null ? "XP/hr soon" : `${fmt(Math.round(cp.xpRate))} XP/hr`}`);
    setText(box.querySelector(".task-meta b"), fmtTime(cp.timeLeft) + " left");
  } else if (recovering()) {
    setText(box.querySelector(".idle-block .sub"), `Back in ${fmtTime(state.player.recoveryLeft)}.`);
  }
}

function renderCharacterStats() {
  const s = combatStats();
  const rows = [
    ["Health", fmt(s.maxHp)], ["Attack", fmtStat(s.attack)], ["Defence", fmtStat(s.defence)],
    ["Kills", fmt(state.stats.kills)], ["Deaths", fmt(state.stats.deaths)], ["Gold Earned", fmtWhole(state.stats.goldEarned)],
  ];
  const sig = JSON.stringify(rows);
  if (keys.chStats === sig) return;
  keys.chStats = sig;

  const strip = el("chStats");
  strip.innerHTML = "";
  rows.forEach(([l, v]) => {
    const d = document.createElement("div");
    d.className = "stat-box";
    d.innerHTML = '<div class="v"></div><div class="l"></div>';
    d.children[0].textContent = v;
    d.children[1].textContent = l;
    strip.appendChild(d);
  });
}

function renderCharacterSkills() {
  const grid = el("chSkills");

  if (keys.chSkills !== "built") {
    keys.chSkills = "built";
    grid.innerHTML = "";
    SKILLS.forEach((s) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "skill-card";
      card.dataset.skill = s.id;
      card.innerHTML = `<div class="top"><div class="name">${icon(s.icon, "ico-sm")}<span></span></div><div class="lvl"></div></div><div class="xp"></div><div class="bar"><i></i></div>`;
      card.querySelector(".name span").textContent = s.name;
      card.onclick = () => go("skill", s.id);
      grid.appendChild(card);
    });
  }

  [...grid.children].forEach((card) => {
    const id = card.dataset.skill;
    const lvl = skillLevel(id);
    const xp = state.skills[id] || 0;
    const base = XP_TABLE[lvl];
    const next = XP_TABLE[Math.min(lvl + 1, MAX_LEVEL)];
    setText(card.querySelector(".lvl"), "Lv " + lvl);
    setText(card.querySelector(".xp"), lvl >= MAX_LEVEL ? "Mastered" : `${fmt(xp)} / ${fmt(next)} XP`);
    card.querySelector(".bar i").style.width = clamp(lvl >= MAX_LEVEL ? 100 : ((xp - base) / (next - base)) * 100, 0, 100) + "%";
  });
}

/* ================= 11. STORES (Belongings, Provisions, Vault) ================= */

const FILTERS = [
  { id: "all",       label: "All",       test: () => true },
  { id: "gear",      label: "Gear",      icon: "blade",  test: (d) => d.kind === "gear" },
  { id: "material",  label: "Materials", icon: "ore",    test: (d) => d.kind === "material" && !d.heal && !d.forSkill },
  { id: "provision", label: "Remedies",  icon: "ration", test: (d) => !!d.heal },
  { id: "tool",      label: "Tools",     icon: "pick",   test: (d) => d.kind === "tool" },
];

function scopeTab(scope) {
  return scope === "eq" ? eqTab : campTab;
}

// Which pool a page is showing: its own (Belongings or Provisions) or the shared Vault.
function scopeStore(scope) {
  if (scopeTab(scope) === "vault") return "vault";
  return scope === "eq" ? "inv" : "bank";
}

function renderStorePage(scope) {
  const w = scopeStore(scope);

  document.querySelectorAll(`.tab-btn[data-scope="${scope}"]`).forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === scopeTab(scope));
  });

  setText(el(scope + "Cap"), `Capacity ${slotsUsed(w)} / ${slotCap(w)}`);
  renderFilters(scope);
  renderPillGrid(scope, w);

  if (scope === "eq") {
    renderPaperdoll();
    renderStanding();
  } else {
    renderLedger();
  }
}

function sortedKeys(w) {
  let ids = orderedKeys(w);
  const f = FILTERS.find((x) => x.id === gridFilter) || FILTERS[0];

  ids = ids.filter((k) => {
    const d = itemDef(k);
    return d && f.test(d);
  });

  if (gridSort === "rarity") {
    const order = { relic: 0, legendary: 1, epic: 2, rare: 3, uncommon: 4, common: 5 };
    ids.sort((a, bb) => {
      const da = itemDef(a);
      const db = itemDef(bb);
      const ra = order[da.rarity] != null ? order[da.rarity] : 6;
      const rb = order[db.rarity] != null ? order[db.rarity] : 6;
      return ra - rb || itemName(a).localeCompare(itemName(bb));
    });
  } else if (gridSort === "name") {
    ids.sort((a, bb) => itemName(a).localeCompare(itemName(bb)));
  }
  return ids;
}

function renderFilters(scope) {
  const sel = el(scope + "Sort");
  if (sel && sel.value !== gridSort) sel.value = gridSort;

  if (keys["filters_" + scope] === gridFilter) return;
  keys["filters_" + scope] = gridFilter;

  const box = el(scope + "Filters");
  box.innerHTML = "";
  FILTERS.forEach((f) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ficon" + (gridFilter === f.id ? " active" : "");
    b.innerHTML = f.icon ? icon(f.icon, "ico-sm") : f.label.toUpperCase();
    b.title = f.label;
    b.setAttribute("aria-label", f.label);
    b.dataset.filter = f.id;
    box.appendChild(b);
  });
}

function itemKindLabel(d) {
  if (d.kind === "gear") return `${rarityDef(d.rarity).name} ${SLOT_LABELS[d.slot]}`;
  if (d.kind === "tool") return "Tool";
  if (d.heal) return "Remedy";
  if (d.chest) return "Container";
  return d.category || "Material";
}

function reorder(w, fromKey, toKey) {
  const ids = orderedKeys(w);
  const a = ids.indexOf(fromKey);
  const b = ids.indexOf(toKey);

  if (a < 0 || b < 0) return;
  ids.splice(a, 1);
  ids.splice(b, 0, fromKey);

  store(w).order = ids;
  gridSort = "custom";
  render();
}

// Cells are rebuilt only when the set or order of items changes.
// Clicks are handled once, on the grid itself (see Wiring).
function renderPillGrid(scope, w) {
  const grid = el(scope + "Grid");
  const s = store(w);
  const ids = sortedKeys(w);
  const cap = slotCap(w);
  const sig = [w, cap, gridFilter, gridSort, ids.join(",")].join("|");

  if (keys["grid_" + scope] !== sig) {
    keys["grid_" + scope] = sig;
    grid.innerHTML = "";

    for (let i = 0; i < Math.max(cap, ids.length); i++) {
      const key = ids[i];
      const cell = document.createElement("div");

      if (!key) {
        cell.className = "item-pill empty";
        cell.innerHTML = '<div class="art"></div><div class="info"><div class="n">Empty</div><div class="r">Empty slot</div></div>';
        grid.appendChild(cell);
        continue;
      }

      const d = itemDef(key);
      cell.className = `item-pill ${d.rarity || "common"}`;
      cell.tabIndex = 0;
      cell.draggable = true;
      cell.setAttribute("role", "button");
      cell.dataset.key = key;
      cell.dataset.store = w;
      cell.innerHTML = `<div class="qty"></div><div class="art">${icon(d.icon, "ico-lg")}</div><div class="info"><div class="n"></div><div class="r"></div></div>`;
      cell.querySelector(".n").textContent = itemName(key);
      cell.querySelector(".r").textContent = itemKindLabel(d);
      grid.appendChild(cell);
    }
  }

  grid.querySelectorAll(".item-pill[data-key]").forEach((cell) => {
    const qty = s.items[cell.dataset.key] || 0;
    setText(cell.querySelector(".qty"), fmt(qty));
    const title = `${cell.querySelector(".n").textContent} × ${qty}`;
    if (cell.title !== title) cell.title = title;
  });
}

function renderPaperdoll() {
  const eq = state.equipment;
  const sig = DOLL_ORDER.map((slot) => (eq[slot] ? `${eq[slot]}:${wearPct(eq[slot])}` : "-")).join(",");

  if (keys.doll !== sig) {
    keys.doll = sig;
    const twoH = eq.weapon && itemDef(eq.weapon).twoHanded;
    const grid = el("dollGrid");
    grid.innerHTML = "";

    DOLL_ORDER.forEach((slot) => {
      if (slot === "offhand" && twoH) return;
      const key = eq[slot];
      const d = key ? itemDef(key) : null;
      const box = document.createElement("div");
      box.className = `eq-slot slot-${slot} ` + (key ? (d.rarity || "common") : "empty") + (slot === "weapon" && twoH ? " merged" : "");
      box.innerHTML = `<span class="type">${SLOT_LABELS[slot]}</span><div class="art">${icon(d ? d.icon : SLOT_GLYPHS[slot], twoH && slot === "weapon" ? "ico-xl" : "ico-lg")}</div><div class="name"></div>`;
      box.querySelector(".name").textContent = key ? itemName(key) : "Empty";

      if (key) {
        box.dataset.slot = slot;
        box.tabIndex = 0;
        box.setAttribute("role", "button");
        box.title = itemName(key);
        const pct = wearPct(key);
        if (pct !== null) {
          const w = document.createElement("div");
          w.className = "eq-wear " + (pct > 60 ? "fine" : pct > 25 ? "worn" : "bad");
          w.textContent = pct + "%";
          box.appendChild(w);
        }
      }
      grid.appendChild(box);
    });
  }

  const kls = myClass();
  setText(el("dollName"), commanderName());
  setText(el("dollSub"), [kls && kls.name, currentRegion().name].filter(Boolean).join(" · "));
}

function renderStatRows(boxId, rows) {
  const sig = JSON.stringify(rows);
  if (keys[boxId] === sig) return;
  keys[boxId] = sig;

  const box = el(boxId);
  box.innerHTML = "";
  rows.forEach(([l, v, cls]) => {
    const r = document.createElement("div");
    r.className = "stat-row";
    r.innerHTML = '<div class="l"></div><div class="v"></div>';
    r.children[0].textContent = l;
    r.children[1].textContent = v;
    if (cls) r.children[1].classList.add(cls);
    box.appendChild(r);
  });
}

function renderStanding() {
  const kls = myClass();
  const s = combatStats();
  const tier = currentRegion().tier;
  let veil = `Opens at Hunt ${CLASS_PICK_LEVEL}`;
  if (kls) veil = s.absorb ? `+${fmtStat(s.absorb)} a second` : `+${s.veilGain} a blow`;
  else if (canPickClass()) veil = "Choose a discipline";
  renderStatRows("dollStanding", [
    ["Discipline", kls ? kls.name : (canPickClass() ? "Choose one" : `Unlocks at Hunt ${CLASS_PICK_LEVEL}`), kls ? "good" : "gold"],
    ["Health", fmt(s.maxHp)],
    ["Attack", fmtStat(s.attack), "gold"],
    ["Defence", `${fmtStat(s.defence)} · stops ${pctOf(mitigation(s.defence, tier))} here`],
    ["Swing", (s.speed / 1000).toFixed(1) + "s"],
    ["Crit Chance", pctOf(s.crit)],
    ["Crit Damage", pctOf(s.critDmg)],
    ["Penetration", pctOf(s.pen)],
    ["Veil", veil],
    ["Hunt", "Lv " + skillLevel("warfare"), "good"],
    ["Belongings", `${slotsUsed("inv")} / ${packSlots()}`],
  ]);
}

function renderLedger() {
  const toolSig = GATHER_SKILLS.map((s) => state.tools[s.id] || "-").join(",");
  if (keys.ledgerTools !== toolSig) {
    keys.ledgerTools = toolSig;
    const tools = el("dollTools");
    tools.innerHTML = "";

    GATHER_SKILLS.forEach((s) => {
      const tool = toolFor(s.id);
      const box = document.createElement("div");
      box.className = "tool-slot" + (tool ? " filled" : "");
      box.innerHTML = `<span class="type">${skillName(s.id)}</span><div class="art">${icon(tool ? tool.icon : s.matIcon, "ico-lg")}</div><div class="name"></div>`;
      box.querySelector(".name").textContent = tool ? tool.name : "Bare hands";
      if (tool) {
        box.dataset.skill = s.id;
        box.tabIndex = 0;
        box.setAttribute("role", "button");
        box.title = tool.name;
      }
      tools.appendChild(box);
    });

    const res = document.createElement("div");
    res.className = "tool-slot reserved";
    res.innerHTML = `<span class="type">Reserved</span><div class="art">${icon("unknown", "ico-lg")}</div><div class="name">Scavenging</div>`;
    tools.appendChild(res);
  }

  renderStatRows("dollLedger", [
    ["Total Level", totalLevel(), "good"],
    ["Gold on Hand", fmtWhole(state.player.gold), "gold"],
    ["Provisions", `${slotsUsed("bank")} / ${slotCap("bank")}`],
    ["Vault", `${slotsUsed("vault")} / ${slotCap("vault")}`],
    ["Actions Worked", fmt(state.stats.actions)],
    ["Sovereigns Felled", fmt(state.stats.bosses || 0)],
  ]);
}

/* ================= 12. QUANTITY PICKER ================= */
/* One control for every "how many": Min, −, a box you can type in, +, Max,
   and ∞ where no limit makes sense. `pick` is { n, inf } and belongs to the
   caller, so the choice survives the popup being redrawn. */

function qtyPicker(pick, opts) {
  const wrap = document.createElement("div");
  wrap.className = "qty-pick" + (opts.allowInf ? "" : " no-inf");
  wrap.innerHTML =
    '<button type="button" class="qty-btn" data-q="min">Min</button>' +
    '<button type="button" class="qty-btn" data-q="dec" aria-label="One fewer">−</button>' +
    '<input class="qty-input" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" aria-label="Amount">' +
    '<button type="button" class="qty-btn" data-q="inc" aria-label="One more">+</button>' +
    '<button type="button" class="qty-btn" data-q="max">Max</button>' +
    (opts.allowInf ? '<button type="button" class="qty-btn qty-inf" data-q="inf" aria-label="No limit" title="No limit">∞</button>' : "");

  const input = wrap.querySelector(".qty-input");
  const infBtn = wrap.querySelector(".qty-inf");
  const cap = () => Math.max(1, Math.floor(opts.max()));

  // Clamp, then show. `notify` is false for redraws, so they never loop back.
  const show = (notify, keepTyping) => {
    if (!opts.allowInf) pick.inf = false;
    pick.n = clamp(Math.floor(pick.n) || 1, 1, cap());
    if (!keepTyping) input.value = pick.inf ? "∞" : String(pick.n);
    input.classList.toggle("inf", pick.inf);
    if (infBtn) {
      infBtn.classList.toggle("active", pick.inf);
      infBtn.setAttribute("aria-pressed", String(pick.inf));
    }
    if (notify && opts.onChange) opts.onChange();
  };

  wrap.addEventListener("click", (e) => {
    const b = e.target.closest(".qty-btn");
    if (!b) return;
    const q = b.dataset.q;
    if (q === "min") { pick.inf = false; pick.n = 1; }
    if (q === "dec") { pick.n = (pick.inf ? cap() : pick.n) - 1; pick.inf = false; }
    if (q === "inc" && !pick.inf) pick.n += 1;
    if (q === "max") { pick.inf = false; pick.n = cap(); }
    if (q === "inf") pick.inf = true;
    show(true, false);
  });

  input.addEventListener("focus", () => input.select());
  input.addEventListener("input", () => {
    const digits = input.value.replace(/[^0-9]/g, "");
    if (digits !== input.value) input.value = digits;
    const n = parseInt(digits, 10);
    if (!digits || n < 1) return;   // let the box sit empty while they type
    pick.inf = false;
    pick.n = n;
    const over = n > cap();
    show(true, !over);              // a number past the most possible snaps to it
  });
  input.addEventListener("blur", () => show(true, false));
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    show(true, false);
    if (opts.onEnter) opts.onEnter();
  });

  show(false, false);

  return {
    node: wrap,
    // The most possible can change underneath (stock used up); keep the box honest.
    refresh() {
      if (document.activeElement === input) return;
      show(false, false);
    },
  };
}

/* ================= 13. ITEM POPUP ================= */
/* One popup for every item. `from` says where the item is:
     "inv" | "bank" | "vault"  in storage: equip, move, sell, break down
     "equip:<slot>"            worn: unequip, repair
     "tool:<skillId>"          in the tool rack: stow
     "view"                    just looking (costs and drops) */

let itemReturnFocus = null;

function openItemPopup(key, from) {
  if (!itemDef(key)) return;
  if (el("itemModal").hidden) itemReturnFocus = document.activeElement;
  // The amount starts at the whole stack: moving everything is the usual ask.
  const whole = STORE_NAMES[from] ? qtyIn(from, key) : 1;
  popItem = { key, from, pick: { n: whole, inf: false }, picker: null, pickerSig: null, labels: [], sellSome: null };
  fillItemPopup();
  el("itemModal").hidden = false;
  el("ipClose").focus({ preventScroll: true });
}

function closeItemPopup() {
  el("itemModal").hidden = true;
  popItem = null;
  if (itemReturnFocus && itemReturnFocus.isConnected && itemReturnFocus.focus) itemReturnFocus.focus({ preventScroll: true });
  itemReturnFocus = null;
}

function itemStillThere(p) {
  if (!p || !itemDef(p.key)) return false;
  if (p.from === "view") return true;
  if (p.from.startsWith("equip:")) return state.equipment[p.from.slice(6)] === p.key;
  if (p.from.startsWith("tool:")) return state.tools[p.from.slice(5)] === p.key;
  return qtyIn(p.from, p.key) > 0;
}

// Runs at the end of every render(): keeps the popup true, or closes it.
function refreshItemPopup() {
  if (!popItem) return;
  if (el("itemModal").hidden || !itemStillThere(popItem)) {
    closeItemPopup();
    return;
  }
  fillItemPopup();
}

// What equipping this would push out of its slot (or tool rack).
function displacedBy(d) {
  if (d.kind === "tool") return state.tools[d.forSkill] ? [state.tools[d.forSkill]] : [];
  if (d.kind !== "gear") return [];
  const out = [state.equipment[d.slot]];
  if (d.slot === "weapon" && d.twoHanded) out.push(state.equipment.offhand);
  return out.filter(Boolean);
}

// The practical line under an item's description.
function itemNote(d) {
  if (d.kind === "gear") return `${d.twoHanded ? "Takes both hands. " : ""}Wears down on the hunt and is repaired with ${itemName(d.repairMat)}.`;
  if (d.heal) return "Taken automatically when you drop low on the hunt.";
  if (d.chest) return `Open it to widen Provisions by ${d.chest} slots, up to ${BANK_MAX}.`;
  if (d.reagent) return "Recipes take one for each tier they belong to.";
  return "";
}

function itemSubline(d, from, qty) {
  const parts = [itemKindLabel(d)];
  if (d.tier && !d.reagent) parts.push(`Tier ${d.tier}`);
  if (from.startsWith("equip:")) parts.push("Equipped");
  else if (from.startsWith("tool:")) parts.push("In hand");
  else if (STORE_NAMES[from]) parts.push(`${STORE_NAMES[from]} ×${fmt(qty)}`);
  return parts.join(" · ");
}

// Where a thing comes from and who works with it, by skill rather than recipe.
function itemSourceRows(d) {
  const rows = [];
  const skillsOf = (actions) => [...new Set((actions || []).map((a) => a.skillId))].map(skillName);

  const gathered = skillsOf(GATHERED_BY[d.base]);
  if (gathered.length) rows.push(["Gathered", gathered.join(", ")]);

  const made = skillsOf(MADE_BY[d.base]);
  if (made.length) rows.push(["Made by", made.join(", ")]);

  const users = PROFESSIONS.filter((p) => (USED_IN[d.base] || []).some((a) => a.skillId === p.id)).map((p) => p.name);
  if (users.length) rows.push(["Used by", users.join(", ")]);

  const drops = [...new Set((DROPPED_BY[d.base] || []).map((m) => m.name))];
  if (drops.length) rows.push(["Dropped by", drops.join(", ")]);

  return rows;
}

function statRowInto(box, label, value, delta, cls) {
  const r = document.createElement("div");
  r.className = "pop-stat";
  r.innerHTML = '<div class="l"></div><div class="v"><span></span></div>';
  r.children[0].textContent = label;
  const v = r.querySelector(".v span");
  v.textContent = value;
  if (cls) v.className = cls;
  if (delta) {
    const chip = document.createElement("span");
    chip.className = "delta " + (delta > 0 ? "up" : "down");
    chip.textContent = delta > 0 ? `+${fmt(delta)}` : `−${fmt(-delta)}`;
    r.children[1].appendChild(chip);
  }
  box.appendChild(r);
  return v;
}

function fillItemPopup() {
  const { key, from } = popItem;
  const d = itemDef(key);
  const inStore = !!STORE_NAMES[from];
  const worn = from.startsWith("equip:") || from.startsWith("tool:");
  const qty = inStore ? qtyIn(from, key) : 1;

  // ---- head ----
  const art = el("ipArt");
  art.className = "ip-art" + (d.rarity ? " rar-" + d.rarity : "");
  art.innerHTML = icon(d.icon, "ico-lg");
  const name = el("ipName");
  name.className = "ip-name" + (d.rarity && d.rarity !== "common" ? " rar-" + d.rarity : "");
  name.textContent = itemName(key);
  el("ipSub").textContent = itemSubline(d, from, qty);

  const lore = itemLore(d);
  el("ipDesc").textContent = lore;
  el("ipDesc").hidden = !lore;
  const note = itemNote(d);
  el("ipNote").textContent = note;
  el("ipNote").hidden = !note;

  // ---- stats, with the change against what it would replace ----
  const stats = el("ipStats");
  stats.innerHTML = "";
  const displaced = worn ? [] : displacedBy(d);
  const sum = (stat) => displaced.reduce((n, k) => n + (itemDef(k)[stat] || 0), 0);

  if (d.kind === "gear") {
    const cmp = displaced.length > 0;
    [["attack", "Attack"], ["defence", "Defence"], ["health", "Max Health"], ["veil", "Veil a blow"]].forEach(([stat, label]) => {
      if (d[stat] || (cmp && sum(stat))) statRowInto(stats, label, `+${fmt(d[stat])}`, cmp ? d[stat] - sum(stat) : 0);
    });
    if (d.crit || (cmp && sum("crit"))) {
      const delta = cmp ? Math.round((d.crit - sum("crit")) * 1000) / 10 : 0;
      const row = statRowInto(stats, "Crit Chance", `+${+(d.crit * 100).toFixed(1)}%`, 0);
      if (delta) {
        const chip = document.createElement("span");
        chip.className = "delta " + (delta > 0 ? "up" : "down");
        chip.textContent = `${delta > 0 ? "+" : "−"}${Math.abs(delta)}%`;
        row.parentNode.appendChild(chip);
      }
    }
    if (d.slot === "weapon") statRowInto(stats, "Grip", d.twoHanded ? "Two-handed" : "One-handed");
    if (from.startsWith("equip:")) statRowInto(stats, "Condition", `${wearPct(key)}%`);
    else statRowInto(stats, "Durability", fmt(d.maxDur));
  }
  if (d.kind === "tool") {
    const pct = Math.round(d.speed * 100);
    const oldPct = displaced.length ? Math.round(itemDef(displaced[0]).speed * 100) : null;
    statRowInto(stats, `${skillName(d.forSkill)} speed`, `+${pct}%`, oldPct === null ? 0 : pct - oldPct);
  }
  if (d.heal) statRowInto(stats, "Restores", `${fmt(d.heal)} HP`);
  if (d.chest) statRowInto(stats, "Provisions", `+${d.chest} slots`);
  statRowInto(stats, "Value", qty > 1 ? `${fmtGold(d.value)} each · ${fmtGold(d.value * qty)}` : fmtGold(d.value));
  if (inStore && haveQty(key) > qty) statRowInto(stats, "Held in all", fmt(haveQty(key)));

  const effect = el("ipEffect");
  effect.hidden = !d.effect;
  effect.textContent = d.effect ? `${prefixDef(d.prefix).name}: ${d.effect}` : "";

  // ---- where it comes from and who works with it ----
  const sources = el("ipSources");
  sources.innerHTML = "";
  itemSourceRows(d).forEach(([label, value]) => {
    const r = document.createElement("div");
    r.className = "ip-source";
    r.innerHTML = '<span class="l"></span><span class="v"></span>';
    r.children[0].textContent = label;
    r.children[1].textContent = value;
    sources.appendChild(r);
  });
  sources.hidden = !sources.children.length;

  // ---- comparison line ----
  const compare = el("ipCompare");
  const weapon = state.equipment.weapon;
  const blocked = d.kind === "gear" && d.slot === "offhand" && weapon && itemDef(weapon).twoHanded;
  let line = "";
  if (!worn && inStore && (d.kind === "gear" || d.kind === "tool")) {
    if (blocked) line = `Your ${itemName(weapon)} takes both hands.`;
    else if (displaced.length) line = `Replaces ${displaced.map((k) => itemName(k)).join(" and ")}.`;
    else line = d.kind === "gear" ? `Your ${SLOT_LABELS[d.slot].toLowerCase()} slot is empty.` : `No ${skillName(d.forSkill)} tool in hand.`;
  }
  compare.textContent = line;
  compare.hidden = !line;

  fillItemActions(d, key, from, qty, blocked);
}

function fillItemActions(d, key, from, qty, blocked) {
  const box = el("ipActions");
  const qtyBox = el("ipQty");
  box.innerHTML = "";
  popItem.labels = [];

  if (from === "view") {
    box.hidden = true;
    qtyBox.hidden = true;
    return;
  }
  box.hidden = false;

  const add = (label, cls, onClick, opts) => {
    const o = opts || {};
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn" + (cls ? " " + cls : "") + (o.wide ? " wide" : "");
    b.textContent = label;
    b.disabled = !!o.disabled;
    if (o.title) b.title = o.title;
    b.onclick = onClick;
    box.appendChild(b);
    return b;
  };

  if (from.startsWith("equip:") || from.startsWith("tool:")) qtyBox.hidden = true;

  if (from.startsWith("equip:")) {
    const slot = from.slice(6);
    const cost = repairCost(key);
    add("Unequip", "btn-primary", () => unequip(slot), { wide: !cost });
    if (cost) {
      const have = haveQty(cost.mat);
      add(`Repair · ${cost.qty}× ${itemName(cost.mat)}`, "", () => repairItem(key),
        { disabled: have < cost.qty, title: `You have ${fmt(have)}` });
    }
    return;
  }

  if (from.startsWith("tool:")) {
    add("Stow in Provisions", "btn-primary", () => unequipTool(from.slice(5)), { wide: true });
    return;
  }

  // ---- in storage ----
  if (d.kind === "gear") {
    add(`Equip · ${SLOT_LABELS[d.slot]}`, "btn-primary", () => equipItem(key, from),
      { wide: true, disabled: blocked, title: blocked ? "Your weapon takes both hands" : "" });
  }
  if (d.kind === "tool") add(`Take up · ${skillName(d.forSkill)}`, "btn-primary", () => equipItem(key, from), { wide: true });
  if (d.chest) {
    add(`Open · +${d.chest} Provisions slots`, "btn-primary", () => useChest(key, from),
      { wide: true, disabled: state.bank.slots >= BANK_MAX });
  }

  // An amount is only worth asking for when there is more than one.
  const many = qty > 1;
  qtyBox.hidden = !many;
  if (many) {
    const sig = `${key}|${from}`;
    const typing = qtyBox.contains(document.activeElement);
    if (popItem.pickerSig !== sig || !popItem.picker || !qtyBox.contains(popItem.picker.node)) {
      popItem.pickerSig = sig;
      qtyBox.innerHTML = "";
      popItem.picker = qtyPicker(popItem.pick, {
        max: () => (popItem ? qtyIn(popItem.from, popItem.key) : 1),
        allowInf: false,
        onChange: updateItemAmountLabels,
      });
      qtyBox.appendChild(popItem.picker.node);
    } else if (!typing) {
      popItem.picker.refresh();
    }
  }

  const amount = () => (many ? clamp(popItem.pick.n, 1, qtyIn(from, key)) : 1);

  ["inv", "bank", "vault"].filter((w) => w !== from).forEach((w) => {
    const full = !store(w).items[key] && storeFull(w);
    const b = add("", "", () => moveItem(key, from, w, amount()), { disabled: full, title: full ? `${STORE_NAMES[w]} is full` : "" });
    popItem.labels.push([b, () => (many ? `Move ${fmt(amount())} to ${STORE_NAMES[w]}` : `Move to ${STORE_NAMES[w]}`)]);
  });

  popItem.sellSome = null;
  if (many) {
    // "Sell 12" only shows for an amount that Sell 1 and Sell all don't already cover.
    const sellSome = add("", "btn-gold", () => sellItem(key, from, amount()), { wide: true });
    popItem.labels.push([sellSome, () => `Sell ${fmt(amount())} · ${fmtGold(d.value * amount())}`]);
    popItem.sellSome = sellSome;
    add(`Sell 1 · ${fmtGold(d.value)}`, "btn-gold", () => sellItem(key, from, 1));
    add(`Sell all · ${fmtGold(d.value * qty)}`, "btn-gold", () => sellItem(key, from));
  } else {
    add(`Sell · ${fmtGold(d.value)}`, "btn-gold", () => sellItem(key, from, 1), { wide: true });
  }

  const sv = salvageValue(key);
  if (sv) add(`Break down · ${sv.qty}× ${itemName(sv.mat)}`, "btn-quiet", () => salvage(key, from), { wide: true });

  updateItemAmountLabels();
}

// The amount buttons say what they'll do with the number in the box.
function updateItemAmountLabels() {
  if (!popItem) return;
  popItem.labels.forEach(([b, text]) => setText(b, text()));
  if (popItem.sellSome) {
    const n = popItem.pick.n;
    popItem.sellSome.hidden = n <= 1 || n >= qtyIn(popItem.from, popItem.key);
  }
}

/* ================= 14. ACTION POPUP ================= */
/* Opens from any resource, recipe or monster pill. Shows what one action
   or kill is worth and what it costs, takes an amount, and starts the work.
   The start button carries the skill's verb: Delve, Forge, Hunt. */

let actionReturnFocus = null;

function openActionPopup(spec) {
  if (el("actionModal").hidden) actionReturnFocus = document.activeElement;
  const memo = lastPick[spec.kind === "hunt" || spec.kind === "foe" ? "warfare" : spec.skillId];
  popAction = Object.assign({}, spec, { pick: memo ? { n: memo.n, inf: memo.inf } : { n: 1, inf: true }, sig: null });
  buildActionPopup();
  el("actionModal").hidden = false;
  el("amClose").focus({ preventScroll: true });
}

function closeActionPopup() {
  el("actionModal").hidden = true;
  popAction = null;
  if (actionReturnFocus && actionReturnFocus.isConnected && actionReturnFocus.focus) actionReturnFocus.focus({ preventScroll: true });
  actionReturnFocus = null;
}

// Runs at the end of every render().
function refreshActionPopup() {
  if (!popAction) return;
  if (el("actionModal").hidden) {
    closeActionPopup();
    return;
  }
  popAction.sig = null;
  updateActionPopup();
}

// What changes the popup's shape, rather than just its numbers.
function actionSig(a) {
  if (a.kind === "hunt") {
    const c = state.tasks.combat;
    return ["hunt", a.tier, a.zone, recovering(), c ? `${c.tier}:${c.zone}` : "-", companionSig()].join("|");
  }
  if (a.kind === "foe") return ["foe", a.monsterId, companionSig()].join("|");
  const t = state.tasks.skilling;
  const def = findAction(a.skillId, a.actionId);
  return [a.kind, a.skillId, a.actionId, skillLevel(a.skillId) < def.level,
    !!(t && t.skillId === a.skillId && t.actionId === a.actionId), toolFor(a.skillId) ? toolFor(a.skillId).id : "-", companionSig()].join("|");
}

function companionSig() {
  const def = activeCompanion();
  if (!def) return "-";
  const i = companionInfo(def.id);
  return `${def.id}:${i.rank}:${i.level}`;
}

function updateActionPopup() {
  const a = popAction;
  if (!a) return;
  if (a.sig !== actionSig(a)) {
    buildActionPopup();
    return;
  }
  if (a.kind === "hunt") updateHuntPopup(a);
  else if (a.kind !== "foe") updateWorkPopup(a);
}

function buildActionPopup() {
  const a = popAction;
  a.sig = actionSig(a);
  a.refs = {};

  el("amStats").innerHTML = "";
  el("amList").innerHTML = "";
  el("amActions").innerHTML = "";
  el("amPlan").innerHTML = '<span></span> <span class="warn"></span>';

  const viewOnly = a.kind === "foe";
  el("amRun").hidden = true;
  el("amQty").hidden = viewOnly;
  el("amPlan").hidden = viewOnly;

  if (a.kind === "hunt") buildHuntPopup(a);
  else if (a.kind === "foe") buildFoePopup(a);
  else buildWorkPopup(a);

  const qtyBox = el("amQty");
  qtyBox.innerHTML = "";
  a.picker = null;
  if (viewOnly) return;

  a.picker = qtyPicker(a.pick, {
    max: () => actionPopupMax(a),
    allowInf: true,
    onChange: () => updateActionPopup(),
    onEnter: startFromPopup,
  });
  qtyBox.appendChild(a.picker.node);

  if (a.kind === "hunt") updateHuntPopup(a);
  else updateWorkPopup(a);
}

function actionPopupMax(a) {
  if (a.kind === "hunt") return a.odds && a.odds.killMs ? Math.max(1, Math.floor(IDLE_CAP_MS / a.odds.killMs)) : 9999;
  return actionMax(findAction(a.skillId, a.actionId));
}

// A clickable line in the popup's list: an item, and a value on the right.
function actionListRow(key, label) {
  const row = document.createElement("div");
  row.className = "am-row";
  row.innerHTML = '<button type="button" class="am-item"></button><span class="am-val"></span>';
  const b = row.querySelector(".am-item");
  if (key) {
    b.dataset.key = key;
    b.innerHTML = `${icon(itemDef(key).icon, "ico-sm")}<span></span>`;
    b.querySelector("span").textContent = label || itemName(key);
  } else {
    b.disabled = true;
    b.innerHTML = "<span></span>";
    b.querySelector("span").textContent = label;
  }
  el("amList").appendChild(row);
  return row.querySelector(".am-val");
}

function setActionHead(artHtml, artClass, name, sub, desc) {
  const art = el("amArt");
  art.className = "ip-art" + (artClass ? " " + artClass : "");
  art.innerHTML = artHtml;
  el("amName").textContent = name;
  el("amSub").textContent = sub;
  el("amDesc").textContent = desc;
  el("amDesc").hidden = !desc;
}

function buildWorkPopup(a) {
  const def = findAction(a.skillId, a.actionId);
  const s = skillDef(a.skillId);
  const craft = s.kind === "craft";
  const outKey = actionOutput(def);
  const locked = skillLevel(a.skillId) < def.level;
  const t = state.tasks.skilling;
  const active = !!(t && t.skillId === a.skillId && t.actionId === a.actionId);

  setActionHead(icon(def.icon, "ico-lg"), craft ? "craft" : "", titleCase(def.name),
    [s.name, `Tier ${def.tier}`, craft ? null : regionOfTier(def.tier).name].filter(Boolean).join(" · "),
    itemLore(itemDef(outKey)));
  fillChips(el("amChips"), xpMods(a.skillId));

  const stats = el("amStats");
  if (locked) statRowInto(stats, "Needs", `${s.name} Lv ${def.level}`, 0, "warn");
  statRowInto(stats, "Time", `${(actionTime(def) / 1000).toFixed(1)}s each`);
  statRowInto(stats, "Experience", `${fmt(xpEach(a.skillId, def.xp))} XP each`);

  if (def.craftGear) {
    statRowInto(stats, "Makes", `${GEAR[def.craftGear].name}, rarity rolled`);
  } else if (craft) {
    statRowInto(stats, "Makes", `${def.out[outKey]} × ${itemName(outKey)}`);
  } else {
    statRowInto(stats, "Yield", `${def.out[outKey]} × ${itemName(outKey)}`);
    const dbl = doubleChance(a.skillId);
    if (dbl) statRowInto(stats, "Double yield", chancePct(dbl));
  }
  if (!def.craftGear) a.refs.held = statRowInto(stats, "Held", fmt(haveQty(outKey)));

  // ---- costs for recipes, side finds for resources ----
  const label = el("amListLabel");
  a.refs.costs = [];
  if (craft) {
    label.textContent = "Needs";
    Object.keys(def.cost || {}).forEach((k) => a.refs.costs.push({ key: k, need: def.cost[k], val: actionListRow(k) }));
  } else {
    label.textContent = "Also turns up";
    const bonus = companionBonus("reagent", a.skillId);
    if (def.reagentId) actionListRow(def.reagentId).textContent = `${chancePct(Math.min(1, def.reagentChance * (1 + bonus)))} each`;
    else if (bonus && REAGENTS.some((r) => r.id === outKey)) actionListRow(outKey, `Extra ${itemName(outKey)}`).textContent = `${chancePct(bonus)} each`;
  }
  el("amListWrap").hidden = !el("amList").children.length;

  // ---- buttons ----
  const box = el("amActions");
  if (active) {
    const stop = document.createElement("button");
    stop.type = "button";
    stop.className = "btn";
    stop.textContent = "Stop";
    stop.onclick = () => { stopSkillTask(); closeActionPopup(); };
    box.appendChild(stop);
  }
  const startBtn = document.createElement("button");
  startBtn.type = "button";
  startBtn.className = "btn btn-primary" + (active ? "" : " wide");
  startBtn.onclick = startFromPopup;
  box.appendChild(startBtn);
  a.refs.go = startBtn;
  a.refs.verb = s.verb;
  a.refs.locked = locked;
}

function updateWorkPopup(a) {
  const def = findAction(a.skillId, a.actionId);
  const craft = skillDef(a.skillId).kind === "craft";
  const time = actionTime(def);
  const xp = xpEach(a.skillId, def.xp);
  const t = state.tasks.skilling;
  const active = !!(t && t.skillId === a.skillId && t.actionId === a.actionId);
  const stock = stockCovers(def);
  const n = a.pick.inf ? null : a.pick.n;

  a.picker.refresh();
  if (a.refs.held) setText(a.refs.held, fmt(haveQty(actionOutput(def))));

  a.refs.costs.forEach((c) => {
    const have = haveQty(c.key);
    const need = c.need * (n || 1);
    setText(c.val, n && n > 1 ? `${fmt(need)} for ${fmt(n)} · ${fmt(have)} held` : `${fmt(c.need)} each · ${fmt(have)} held`);
    c.val.classList.toggle("short", have < need);
  });

  // ---- running now ----
  const run = el("amRun");
  run.hidden = !active;
  if (active) {
    const plan = skillPlan();
    el("amRunBar").style.width = clamp((t.progress / time) * 100, 0, 100) + "%";
    setText(el("amRunLeft"), `Underway · ${countOf(t.done, t.limit)}`);
    setText(el("amRunRight"), plan ? `${fmtTime(plan.timeLeft)} left` : "");
  }

  // ---- what the chosen amount comes to ----
  const plan = el("amPlan");
  const per12 = Math.floor(IDLE_CAP_MS / time);
  let text;
  let warn = "";
  if (n) {
    text = `${fmt(n)} × ${titleCase(def.name)} · ${fmtTime(n * time)} · ${fmt(n * xp)} XP`;
    if (craft && stock < n) warn = `Stock covers ${fmt(stock)}.`;
    else if (n > per12) warn = "Stops at twelve hours.";
  } else {
    text = craft && stock < per12
      ? `No limit · stock covers ${fmt(stock)}`
      : `No limit · up to ${fmt(per12)} in twelve hours`;
  }
  setText(plan.children[0], text);
  setText(plan.children[1], warn);

  // ---- start ----
  const startBtn = a.refs.go;
  if (a.refs.locked) {
    startBtn.disabled = true;
    setText(startBtn, `Needs Lv ${def.level}`);
  } else if (craft && stock < 1) {
    startBtn.disabled = true;
    setText(startBtn, "Missing materials");
  } else {
    startBtn.disabled = false;
    setText(startBtn, a.refs.verb);
  }
}

function buildHuntPopup(a) {
  const zone = zoneDef(a.zone);
  const region = regionOfTier(a.tier);
  const c = state.tasks.combat;
  const here = !!(c && c.tier === a.tier && c.zone === zone.id);
  huntZone = zone.id;

  setActionHead(icon(ZONE_ICONS[zone.id], "ico-lg"), "war zone", `${zone.name} · ${region.name}`, `Hunt · Tier ${a.tier}`, zone.note);
  fillChips(el("amChips"), xpMods("warfare"));

  const stats = el("amStats");
  if (skillLevel("warfare") < region.level) statRowInto(stats, "Suited to", `Hunt Lv ${region.level} and up`, 0, "warn");
  statRowInto(stats, "Foes at once", `${zone.foesText}, never more than ${MAX_FOES}`);
  statRowInto(stats, "Reinforcements", `One every ${zone.windowMs / 1000}s a fight runs on`);
  statRowInto(stats, "Elites", pctOf(zone.elite));
  statRowInto(stats, "XP a kill", `×${zone.xp}`);
  a.refs.threat = statRowInto(stats, "Threat", "");
  a.refs.peak = statRowInto(stats, "At 100 Threat", "");
  a.refs.xp = statRowInto(stats, "XP/hr", "Reckoning");
  a.refs.kill = statRowInto(stats, "A kill", "Reckoning");
  a.refs.last = statRowInto(stats, "You last", "Reckoning");
  a.refs.food = statRowInto(stats, "Remedies", "");

  el("amListLabel").textContent = "Turns up here";
  foesOf(a.tier).forEach((m) => foeListRow(m, `${pctOf(zone.mix[m.archetype])} of foes`));
  const sov = sovereignOf(a.tier);
  foeListRow(sov, zone.engage >= 1 ? "When Threat peaks" : `${pctOf(zone.engage)} of Threat peaks`);
  el("amListWrap").hidden = false;

  const box = el("amActions");
  if (here) {
    const pull = document.createElement("button");
    pull.type = "button";
    pull.className = "btn";
    pull.textContent = "Pull back";
    pull.onclick = () => { pullBack(); closeActionPopup(); };
    box.appendChild(pull);
  }
  const startBtn = document.createElement("button");
  startBtn.type = "button";
  startBtn.className = "btn btn-primary" + (here ? "" : " wide");
  startBtn.onclick = startFromPopup;
  box.appendChild(startBtn);
  a.refs.go = startBtn;

  // The odds are played out just after the popup paints, a run at a time.
  const sig = a.sig;
  a.odds = null;
  huntOddsLater(a.tier, zone.id, (odds) => {
    if (popAction !== a || a.sig !== sig) return;
    a.odds = odds;
    paintHuntOdds(a);
    updateHuntPopup(a);
  });
}

// A foe in a popup list. Opens that foe's own popup.
function foeListRow(mob, value) {
  const row = document.createElement("div");
  row.className = "am-row";
  row.innerHTML = '<button type="button" class="am-item"></button><span class="am-val"></span>';
  const b = row.querySelector(".am-item");
  b.dataset.monster = mob.id;
  b.innerHTML = `${icon(mob.icon, "ico-sm")}<span></span>`;
  b.querySelector("span").textContent = mob.name;
  row.querySelector(".am-val").textContent = value;
  el("amList").appendChild(row);
}

function paintHuntOdds(a) {
  const o = a.odds;
  setText(a.refs.xp, `About ${fmt(Math.round(o.xpPerHour))}`);
  setText(a.refs.kill, o.killMs ? `Every ${fmtTime(o.killMs)} or so` : "Rarely");

  const last = a.refs.last;
  if (o.survivalMs == null) {
    setText(last, "Past twelve hours");
    last.className = "good";
  } else if (o.deaths < o.runs) {
    setText(last, `${fmtTime(o.survivalMs)}, often longer`);
    last.className = "";
  } else {
    setText(last, `About ${fmtTime(o.survivalMs)}`);
    last.className = o.survivalMs < 60 * 60 * 1000 ? "warn" : "";
  }
}

function updateHuntPopup(a) {
  const c = state.tasks.combat;
  const zone = zoneDef(a.zone);
  const here = !!(c && c.tier === a.tier && c.zone === zone.id);
  const n = a.pick.inf ? null : a.pick.n;

  a.picker.refresh();
  setText(a.refs.threat, `${threatIn(a.tier, zone.id)} / ${THREAT_CAP} · ×${zone.threat} a kill`);
  const sov = sovereignOf(a.tier).name;
  setText(a.refs.peak, state.settings.hideSovereign
    ? "You hide for five minutes"
    : zone.engage >= 1 ? `${sov} comes` : `${sov} comes ${pctOf(zone.engage)} of the time`);

  const held = remedyHeals().length;
  const perHour = a.odds ? a.odds.remediesPerHour : 0;
  setText(a.refs.food, held ? `${fmt(held)} held${perHour >= 0.05 ? ` · about ${fmtStat(perHour)} an hour` : ""}` : "None held");
  a.refs.food.className = held ? "" : "warn";

  const run = el("amRun");
  run.hidden = !here;
  if (here) {
    const plan = combatPlan();
    el("amRunBar").style.width = plan.pct + "%";
    setText(el("amRunLeft"), `Underway · ${countOf(c.done, c.limit)} kills`);
    setText(el("amRunRight"), c.xpRate == null ? `XP/hr in ${fmtTime(c.nextMark - c.elapsed)}` : `${fmt(Math.round(c.xpRate))} XP/hr`);
  }

  const plan = el("amPlan");
  const killMs = a.odds && a.odds.killMs;
  setText(plan.children[0], n
    ? `${fmt(n)} kills${killMs ? ` · about ${fmtTime(n * killMs)}` : ""}`
    : "No limit · until you pull back, fall or twelve hours pass");
  setText(plan.children[1], n && killMs && n * killMs > IDLE_CAP_MS ? "Stops at twelve hours." : "");

  a.refs.go.disabled = recovering();
  setText(a.refs.go, recovering() ? "Recovering" : here || !c ? "Hunt" : "Move the hunt here");
}

function buildFoePopup(a) {
  const mob = getMonster(a.monsterId);
  const sov = mob.archetype === "sovereign";
  const arch = ARCHETYPES[mob.archetype];
  const n = foeNumbers(mob, false);
  const s = combatStats();

  setActionHead(monsterArt(mob, false), "war", mob.name, `${sov ? "Sovereign" : arch.name} · ${regionOfTier(mob.tier).name}`, sov ? SOVEREIGN.note : arch.note);
  el("amChips").innerHTML = "";

  const stats = el("amStats");
  statRowInto(stats, "Health", fmt(n.hp));
  statRowInto(stats, "Attack", `${fmtStat(n.attack)} a blow`);
  const perMinute = (n.attack * (1 - mitigation(s.defence, mob.tier)) * 60000) / mob.speed;
  statRowInto(stats, "Against you", `About ${fmtStat(perMinute)} a minute`);
  statRowInto(stats, "Defence", `Stops ${pctOf(mitigation(mob.defence, mob.tier))} of a blow`);
  statRowInto(stats, "Swings every", `${(mob.speed / 1000).toFixed(1)}s`);
  statRowInto(stats, "Experience", `${fmtStat(n.xp * xpMult("warfare"))} a kill, more deeper in`);
  if (!sov) statRowInto(stats, "Threat", `${n.threat} a kill, more deeper in`);
  const goldMult = 1 + companionBonus("gold");
  statRowInto(stats, "Gold", `${fmtGold(Math.round(n.gold[0] * goldMult))} to ${fmtGold(Math.round(n.gold[1] * goldMult))}`);
  if (sov) {
    statRowInto(stats, "Enrages", `+${pctOf(SOVEREIGN.enrage)} attack every ${SOVEREIGN.enrageMs / 1000}s`);
  } else {
    const e = foeNumbers(mob, true);
    statRowInto(stats, "As an Elite", `${fmt(e.hp)} health · ${fmtStat(e.attack)} a blow · ×${ELITE.xp} XP`);
  }

  el("amListLabel").textContent = "Drops";
  const dropMult = 1 + companionBonus("drops");
  mob.drops.forEach(([k, qty, chance]) => {
    actionListRow(k, `${itemName(k)} ×${qty}`).textContent = chancePct(Math.min(1, chance * dropMult));
  });
  if (sov) actionListRow(null, "Epic gear").textContent = "Always";
  else actionListRow(null, "Elites drop").textContent = `×${ELITE.drops}`;
  const rare = companionBonus("rare");
  if (rare) actionListRow(null, "Finer gear").textContent = chancePct(rare);
  el("amListWrap").hidden = false;

  if (a.back) {
    const back = document.createElement("button");
    back.type = "button";
    back.className = "btn wide";
    back.textContent = `Back to the ${zoneDef(a.back.zone).name}`;
    back.onclick = () => openActionPopup(a.back);
    el("amActions").appendChild(back);
  }
}

function startFromPopup() {
  const a = popAction;
  if (!a || a.kind === "foe" || (a.refs.go && a.refs.go.disabled)) return;
  const limit = a.pick.inf ? null : a.pick.n;
  lastPick[a.kind === "hunt" ? "warfare" : a.skillId] = { n: a.pick.n, inf: a.pick.inf };
  const started = a.kind === "hunt" ? startHunt(a.tier, a.zone, limit) : startSkillTask(a.skillId, a.actionId, limit);
  if (started) closeActionPopup();
}

/* ================= 15. CONFIRM DIALOG ================= */
/* The game's own "are you sure", in place of the browser's. Resolves true
   or false. */

let confirmResolve = null;
let confirmReturnFocus = null;

function confirmDialog({ title, body, confirmLabel, danger }) {
  return new Promise((resolve) => {
    if (confirmResolve) confirmResolve(false);
    confirmResolve = resolve;
    confirmReturnFocus = document.activeElement;
    el("cfTitle").textContent = title;
    el("cfBody").textContent = body;
    const ok = el("cfOk");
    ok.textContent = confirmLabel || "Confirm";
    ok.className = "btn " + (danger ? "btn-danger" : "btn-primary");
    el("confirmModal").hidden = false;
    el("cfCancel").focus({ preventScroll: true });
  });
}

function closeConfirm(result) {
  el("confirmModal").hidden = true;
  const resolve = confirmResolve;
  confirmResolve = null;
  if (confirmReturnFocus && confirmReturnFocus.isConnected && confirmReturnFocus.focus) confirmReturnFocus.focus({ preventScroll: true });
  confirmReturnFocus = null;
  if (resolve) resolve(result);
}

/* ================= 16. ATLAS, SHOP, BOUNTIES, COMPANIONS, LOG ================= */

function renderAtlas() {
  const box = el("atlasList");
  box.innerHTML = "";

  REGIONS.forEach((r) => {
    const unlocked = state.travel.unlocked.includes(r.id);
    const here = state.region === r.id;
    const card = document.createElement("button");
    card.type = "button";
    card.className = "atlas-card" + (here ? " on" : "") + (unlocked ? "" : " locked");
    card.innerHTML = `<div class="atlas-top">${icon("atlas", "ico-lg")}<div><div class="atlas-name"></div><div class="atlas-tier"></div></div></div><div class="atlas-note"></div><div class="atlas-foot"></div>`;
    card.querySelector(".atlas-name").textContent = r.name;
    card.querySelector(".atlas-tier").textContent = `Tier ${r.tier} · gear around Lv ${r.level}`;
    card.querySelector(".atlas-note").textContent = r.note;

    const foot = card.querySelector(".atlas-foot");
    if (here) {
      foot.className = "atlas-foot here";
      foot.textContent = "You are here";
    } else if (unlocked) {
      foot.className = "atlas-foot open";
      foot.textContent = "Road open";
    } else {
      foot.className = "atlas-foot cost" + (state.player.gold < r.toll ? " cant" : "");
      foot.textContent = `Toll ${fmtGold(r.toll)}`;
    }
    card.onclick = () => travelTo(r.id);
    box.appendChild(card);
  });
}

function renderShop() {
  setText(el("smugglerTimer"), `Moves on in ${fmtTime(windowEndsIn())}`);
  const stock = el("shopStock");
  stock.innerHTML = "";

  shopStock().forEach((entry) => {
    const d = itemDef(entry.key);
    const card = document.createElement("div");
    card.className = "shop-card";
    card.innerHTML = `<div class="shop-ico">${icon(d.icon, "ico-lg")}</div><div class="shop-body"><div class="shop-name"></div><div class="shop-sub"></div></div>`;
    card.querySelector(".shop-name").textContent = d.name;
    card.querySelector(".shop-sub").textContent = `Restores ${fmt(d.heal)} HP · ${fmtGold(entry.price)} each`;

    const row = document.createElement("div");
    row.className = "btnrow";
    [1, 10, 50].forEach((n) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn btn-gold";
      b.textContent = `${n} · ${fmtGold(entry.price * n)}`;
      b.disabled = state.player.gold < entry.price * n;
      b.onclick = () => buyShop(entry.key, entry.price * n, n);
      row.appendChild(b);
    });
    card.appendChild(row);
    stock.appendChild(card);
  });

  const sm = el("smugglerStock");
  sm.innerHTML = "";

  smugglerStock().forEach((entry) => {
    const d = itemDef(entry.key);
    const bought = !!state.smugglerBought[`${currentWindow()}_${entry.slot}`];
    const card = document.createElement("div");
    card.className = "shop-card";
    card.innerHTML = `<div class="shop-ico">${icon(d.icon, "ico-lg")}</div><div class="shop-body"><div class="shop-name"></div><div class="shop-sub"></div></div>`;
    card.querySelector(".shop-name").textContent = `${entry.qty}× ${d.name}`;
    card.querySelector(".shop-sub").textContent = `Tier ${d.tier} · ${fmtGold(entry.price)} the lot`;

    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn btn-gold";
    b.textContent = bought ? "Dealt" : `Buy · ${fmtGold(entry.price)}`;
    b.disabled = bought || state.player.gold < entry.price;
    b.onclick = () => buySmuggler(entry);
    card.appendChild(b);
    sm.appendChild(card);
  });
}

// The card is built once per posting; progress updates in place.
function renderBounty() {
  refreshBounty();
  setText(el("bountyTimer"), `New posting in ${fmtTime(windowEndsIn())}`);
  const b = state.bounty;
  const box = el("bountyBox");
  const sig = b ? `${b.window}|${b.region}|${b.label}` : "-";

  if (keys.bounty !== sig) {
    keys.bounty = sig;
    box.innerHTML = "";
    if (!b) return;

    const card = document.createElement("div");
    card.className = "bounty-card";
    card.innerHTML = '<h3 class="bounty-title"></h3><div class="muted tiny"></div><div class="bar"><i></i></div><div class="bounty-reward"></div><button type="button" class="btn btn-gold"></button>';
    card.querySelector(".bounty-title").textContent = b.label;
    card.querySelector(".tiny").textContent = `Posted for ${regionById(b.region).name}.`;
    card.querySelector("button").onclick = claimBounty;
    box.appendChild(card);
  }

  const card = box.querySelector(".bounty-card");
  if (!b || !card) return;
  card.querySelector(".bar i").style.width = clamp((b.progress / b.amount) * 100, 0, 100) + "%";
  setText(card.querySelector(".bounty-reward"), `${fmt(Math.min(b.progress, b.amount))} of ${fmt(b.amount)} · pays ${fmtGold(b.gold)} and an hour of double XP.`);
  const btn = card.querySelector("button");
  const done = b.progress >= b.amount;
  setText(btn, b.claimed ? "Paid out" : (done ? "Claim" : "Not finished"));
  btn.disabled = b.claimed || !done;
}

let compRefs = [];

const pctText = (v) => `${+(v * 100).toFixed(1)}%`;

// Cards rebuild when something you can act on changes; Bond ticks in place.
function renderCompanions() {
  const active = activeCompanion();
  setText(el("compActive"), active ? `${active.name} walks with you` : "Nobody walks with you");

  const sig = JSON.stringify(COMPANIONS.map((def) => {
    const i = companionInfo(def.id);
    return [i.owned, i.active, i.rank, i.dupes, i.level, state.player.gold >= def.cost];
  }));
  if (keys.companions !== sig) {
    keys.companions = sig;
    buildCompanions();
  }

  compRefs.forEach((r) => {
    const i = companionInfo(r.id);
    if (!i.owned) return;
    setText(r.bondNum, i.maxed ? "Fully bonded" : `${fmt(i.bondInto)} / ${fmt(i.bondSpan)}`);
    r.bondBar.style.width = (i.maxed ? 100 : clamp((i.bondInto / i.bondSpan) * 100, 0, 100)) + "%";
  });
}

function buildCompanions() {
  const list = el("compList");
  list.innerHTML = "";
  compRefs = [];

  COMPANIONS.forEach((def) => {
    const i = companionInfo(def.id);
    const card = document.createElement("div");
    card.className = "comp-card" + (i.owned ? " owned" : "") + (i.active ? " active" : "");
    card.innerHTML =
      '<div class="comp-top">' +
        `<div class="comp-art">${icon(def.icon, "ico-xl")}</div>` +
        '<div class="comp-titles"><div class="comp-name"></div><div class="comp-sub"></div></div>' +
        '<span class="comp-badge">At your side</span>' +
      '</div>' +
      '<p class="comp-blurb"></p>' +
      '<div class="comp-trait"><span class="t-name"></span><span class="t-val"></span></div>' +
      '<div class="comp-meter"><div class="comp-row"><span class="b-lvl"></span><span class="b-num"></span></div><div class="bar"><i></i></div></div>' +
      '<div class="comp-rank"></div>' +
      '<ul class="comp-unlocks"></ul>' +
      '<div class="comp-actions"></div>';

    card.querySelector(".comp-name").textContent = def.name;
    card.querySelector(".comp-sub").textContent = i.owned ? `Rank ${RANK_NUMERALS[i.rank]} · Bond ${i.level}` : fmtGold(def.cost);
    card.querySelector(".comp-badge").hidden = !i.active;
    card.querySelector(".comp-blurb").textContent = def.blurb;
    card.querySelector(".t-name").textContent = def.trait.name;
    card.querySelector(".t-val").textContent = `+${pctText(i.trait)} ${def.trait.text}`;

    const meter = card.querySelector(".comp-meter");
    meter.hidden = !i.owned;
    card.querySelector(".b-lvl").textContent = `Bond ${i.level}`;

    const rank = card.querySelector(".comp-rank");
    if (!i.owned) rank.textContent = `Once it is yours, more turn up ${def.sourceText}. Each one raises its Rank.`;
    else if (i.rank >= COMPANION_MAX_RANK) rank.textContent = `Rank ${RANK_NUMERALS[i.rank]}. Nothing more to find.`;
    else rank.textContent = `${i.dupes} of ${i.needDupes} found toward Rank ${RANK_NUMERALS[i.rank + 1]}. More turn up ${def.sourceText}.`;

    const unlocks = card.querySelector(".comp-unlocks");
    i.unlocks.forEach((u) => {
      const li = document.createElement("li");
      li.className = u.open ? "open" : "";
      li.innerHTML = '<span class="g"></span><span class="req"></span><span class="txt"></span>';
      li.children[0].textContent = u.open ? "✓" : "·";
      li.children[1].textContent = u.bond ? `Bond ${u.bond}` : `Rank ${RANK_NUMERALS[u.rank]}`;
      li.children[2].textContent = u.text;
      unlocks.appendChild(li);
    });

    const actions = card.querySelector(".comp-actions");
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.comp = def.id;
    if (!i.owned) {
      b.className = "btn btn-gold";
      b.dataset.do = "buy";
      b.textContent = `Buy · ${fmtGold(def.cost)}`;
      b.disabled = state.player.gold < def.cost;
    } else if (i.active) {
      b.className = "btn btn-quiet";
      b.dataset.do = "rest";
      b.textContent = "Leave at camp";
    } else {
      b.className = "btn btn-primary";
      b.dataset.do = "take";
      b.textContent = "Take along";
    }
    actions.appendChild(b);

    list.appendChild(card);
    compRefs.push({ id: def.id, bondNum: card.querySelector(".b-num"), bondBar: meter.querySelector(".bar i") });
  });
}

// Relative times ("2m ago") only move by the minute, so the log redraws twice a minute.
function renderLog() {
  const last = state.log[state.log.length - 1];
  const sig = `${state.log.length}|${last ? last.t : 0}|${Math.floor(Date.now() / 30000)}`;
  if (keys.log === sig) return;
  keys.log = sig;

  const box = el("eventLog");
  box.innerHTML = "";

  state.log.slice(-8).forEach((e) => {
    const d = document.createElement("div");
    d.className = "log-item";
    d.innerHTML = '<span class="t"></span><span></span>';
    d.children[0].textContent = fmtAgo(Date.now() - e.t);
    d.children[1].textContent = e.m;
    box.appendChild(d);
  });
}

/* ================= 17. CLASS PICKER ================= */

function maybeOfferClass() {
  if (!canPickClass()) return;
  if (el("classPop").hidden === false) return;
  renderClassPicker();
  el("classPop").hidden = false;
}

function renderClassPicker() {
  const grid = el("classGrid");
  grid.innerHTML = "";
  CLASSES.forEach((c) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "class-card";
    card.innerHTML =
      `<div class="cc-top">${icon(c.icon, "ico-lg")}<div class="cc-name"></div></div>` +
      '<div class="cc-blurb"></div><div class="cc-stats"></div><div class="cc-veil"></div>';
    card.querySelector(".cc-name").textContent = c.name;
    card.querySelector(".cc-blurb").textContent = c.blurb;
    const st = card.querySelector(".cc-stats");
    [`Health ×${c.health}`, `Attack ×${c.attack}`, `Defence ×${c.defence}`,
     `${(c.speed / 1000).toFixed(1)}s swing`, `${Math.round(c.crit * 100)}% crit`]
      .forEach((txt) => { const s = document.createElement("span"); s.textContent = txt; st.appendChild(s); });
    card.querySelector(".cc-veil").textContent = `${c.veilName}. ${c.veilNote}`;
    card.onclick = () => pickClass(c.id);
    grid.appendChild(card);
  });
}

function pickClass(id) {
  state.player.klass = id;
  state.player.hp = maxHp();
  el("classPop").hidden = true;
  say(`You take up the ${classDef(id).name}'s discipline.`);
  toast(`${classDef(id).name} chosen`);
  render();
}

/* ================= 18. FORECAST (Sky) ================= */

const utcDateLabel = (dayNum) => new Date(dayNum * DAY_MS).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

function renderForecast() {
  const today = dayIndex();
  if (keys.forecast === today) return;
  keys.forecast = today;

  const nextSunday = weekStartOf(today) + 7;
  setText(el("forecastNext"), `Next forecast Sun ${utcDateLabel(nextSunday)}, 00:00 UTC`);

  const grid = el("forecastGrid");
  grid.innerHTML = "";

  weekForecast().forEach((f) => {
    const w = f.w;
    const cell = document.createElement("div");
    cell.className = "fc-day" + (f.today ? " today" : "") + (f.past ? " past" : "");
    cell.innerHTML =
      '<div class="fc-when"></div>' +
      '<div class="fc-head"><span class="fc-ico"></span><span class="fc-name"></span></div>' +
      '<div class="fc-mods"></div>' +
      '<div class="fc-bonus"></div>';

    cell.querySelector(".fc-when").textContent = `${f.today ? "Today" : WEEKDAY_NAMES[f.weekday]} · ${utcDateLabel(f.day)}`;
    cell.querySelector(".fc-ico").innerHTML = icon(w.icon, "ico-sm");
    cell.querySelector(".fc-name").textContent = w.label;

    const mods = cell.querySelector(".fc-mods");
    [w.favoured, w.hindered].forEach((sk) => mods.appendChild(modSpan(w.mods[sk], sk)));

    const bonus = cell.querySelector(".fc-bonus");
    bonus.textContent = w.bountiful ? `Bountiful · +${Math.round(BOUNTIFUL_XP * 100)}% XP` : "";
    bonus.hidden = !w.bountiful;

    grid.appendChild(cell);
  });
}

/* ================= 19. REQUISITIONS ================= */

function renderRequisitions() {
  const key = JSON.stringify(state.agents) + JSON.stringify(state.requisitions) + state.player.gold;
  if (keys.req === key) return;
  keys.req = key;

  const pending = state.requisitions.filter((r) => !r.resolved);
  el("reqSlots").textContent = `${REQUISITIONS_PER_DAY - pending.length} of ${REQUISITIONS_PER_DAY} deployments left today`;

  const pend = el("reqPending");
  pend.innerHTML = "";
  if (!pending.length) {
    pend.innerHTML = '<div class="muted tiny">Nobody is out. Send someone before the day turns.</div>';
  } else {
    pending.forEach((r) => {
      const row = document.createElement("div");
      row.className = "req-row";
      row.innerHTML = '<div class="r-who"></div><div class="r-what"></div>';
      row.children[0].textContent = r.agentName;
      row.children[1].textContent = `${fmt(r.qty)} × ${itemName(r.itemKey)}, back at the daily reset`;
      pend.appendChild(row);
    });
  }

  const roster = el("agentRoster");
  roster.innerHTML = "";
  const hire = el("hireAgentBtn");
  hire.textContent = `Hire an Agent · ${fmtGold(AGENT_HIRE_COST)}`;
  hire.disabled = state.player.gold < AGENT_HIRE_COST || state.agents.length >= AGENT_ROSTER_MAX;

  if (!state.agents.length) {
    roster.innerHTML = '<div class="muted tiny">No Agents on the books. Hiring is a gamble: every hire rolls its own rarity.</div>';
    return;
  }

  const targets = requisitionTargets();
  state.agents.forEach((a) => {
    const out = pending.some((r) => r.agentId === a.id);
    const rd = agentRarityDef(a.rarity);
    const card = document.createElement("div");
    card.className = "agent-card" + (out ? " out" : "");
    card.innerHTML = '<div class="agent-name"></div><div class="agent-rarity"></div><div class="agent-yield"></div>';
    card.querySelector(".agent-name").textContent = a.name;
    const rr = card.querySelector(".agent-rarity");
    rr.textContent = rd.name;
    rr.className = "agent-rarity rar-" + a.rarity;
    card.querySelector(".agent-yield").textContent = out
      ? "Out on a run."
      : `Returns about ${Math.max(1, Math.round(12 * rd.mult))} of whatever you ask for.`;

    if (!out) {
      const sel = document.createElement("select");
      targets.forEach((tk) => {
        const o = document.createElement("option");
        o.value = tk;
        o.textContent = itemName(tk);
        sel.appendChild(o);
      });
      card.appendChild(sel);

      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn btn-gold agent-deploy";
      b.textContent = "Deploy";
      b.disabled = pending.length >= REQUISITIONS_PER_DAY;
      b.onclick = () => deployAgent(a.id, sel.value);
      card.appendChild(b);
    }
    roster.appendChild(card);
  });
}

/* ================= 20. SETTINGS & ACCOUNT ================= */

function refreshAccountUi() {
  const a = state.meta.account;
  const cloud = !!sb;

  el("acctStatus").textContent = !cloud ? "Cloud saves are not set up" : a ? `Signed in as ${a}` : "Not signed in";
  el("acctFields").hidden = !!a;
  el("acctCreate").hidden = !!a;
  el("acctLogin").hidden = !!a;
  el("acctLogout").hidden = !a;
}

/* ================= 21. WIRING & BOOT ================= */

el("brandMark").innerHTML = `<img class="mark-img" src="assets/respite-logo.webp" alt="Respite">`;
el("coinIcon").innerHTML = icon("coin", "ico-sm");
el("skMasteryIcon").innerHTML = icon("info", "ico-sm");

window.addEventListener("hashchange", () => {
  route = parseHash();
  closeItemPopup();
  if (popAction) closeActionPopup();
  setNav(false);
  render();
});

// On narrow screens the sidebar is a drawer: the menu button opens it, and
// choosing a page or tapping the blank space beside it closes it.
function setNav(open) {
  document.body.classList.toggle("nav-open", open);
  el("sideBackdrop").hidden = !open;
  el("menuBtn").setAttribute("aria-expanded", String(open));
}
el("menuBtn").innerHTML = icon("menu", "ico-sm");
el("menuBtn").onclick = () => setNav(!document.body.classList.contains("nav-open"));
el("sideBackdrop").onclick = () => setNav(false);
el("sidebar").addEventListener("click", (e) => {
  if (e.target.closest(".nav-item:not(.locked), .icon-btn")) setNav(false);
});

document.querySelectorAll(".icon-btn").forEach((b) => {
  b.onclick = () => go(b.dataset.page);
});

document.querySelectorAll(".pill-head").forEach((b) => {
  b.onclick = () => toggleNav(b.dataset.nav);
});

// The Belongings / Vault and Provisions / Vault tabs.
document.querySelectorAll(".tab-btn[data-scope]").forEach((b) => {
  b.onclick = () => {
    if (b.dataset.scope === "eq") eqTab = b.dataset.tab;
    else campTab = b.dataset.tab;
    render();
  };
});

// Enter or Space on a focused role="button" tile behaves like a click.
const pressed = (e) => e.key === "Enter" || e.key === " ";

["eq", "camp"].forEach((scope) => {
  const sel = el(scope + "Sort");
  if (sel) {
    sel.onchange = () => {
      gridSort = sel.value;
      render();
    };
  }

  el(scope + "Filters").addEventListener("click", (e) => {
    const b = e.target.closest(".ficon");
    if (!b) return;
    gridFilter = b.dataset.filter;
    render();
  });

  // Item cells: one set of listeners on the grid, never on the cells.
  const grid = el(scope + "Grid");
  const cellOf = (e) => {
    const c = e.target.closest(".item-pill[data-key]");
    return c && grid.contains(c) ? c : null;
  };

  grid.addEventListener("click", (e) => {
    const c = cellOf(e);
    if (c) openItemPopup(c.dataset.key, c.dataset.store);
  });
  grid.addEventListener("keydown", (e) => {
    const c = cellOf(e);
    if (!c || !pressed(e)) return;
    e.preventDefault();
    openItemPopup(c.dataset.key, c.dataset.store);
  });
  grid.addEventListener("dragstart", (e) => {
    const c = cellOf(e);
    if (c) e.dataTransfer.setData("text/plain", c.dataset.key);
  });
  grid.addEventListener("dragover", (e) => {
    const c = cellOf(e);
    if (!c) return;
    e.preventDefault();
    c.classList.add("dragover");
  });
  grid.addEventListener("dragleave", (e) => {
    const c = cellOf(e);
    if (c && !c.contains(e.relatedTarget)) c.classList.remove("dragover");
  });
  grid.addEventListener("drop", (e) => {
    const c = cellOf(e);
    if (!c) return;
    e.preventDefault();
    c.classList.remove("dragover");
    const from = e.dataTransfer.getData("text/plain");
    if (from && from !== c.dataset.key) reorder(c.dataset.store, from, c.dataset.key);
  });
});

// Worn gear on the paperdoll.
const openSlot = (e) => {
  const box = e.target.closest(".eq-slot[data-slot]");
  if (!box) return false;
  const key = state.equipment[box.dataset.slot];
  if (key) openItemPopup(key, "equip:" + box.dataset.slot);
  return true;
};
el("dollGrid").addEventListener("click", openSlot);
el("dollGrid").addEventListener("keydown", (e) => { if (pressed(e) && openSlot(e)) e.preventDefault(); });

// Tools in the Camp Ledger.
const openTool = (e) => {
  const box = e.target.closest(".tool-slot[data-skill]");
  if (!box) return false;
  const id = state.tools[box.dataset.skill];
  if (id) openItemPopup(id, "tool:" + box.dataset.skill);
  return true;
};
el("dollTools").addEventListener("click", openTool);
el("dollTools").addEventListener("keydown", (e) => { if (pressed(e) && openTool(e)) e.preventDefault(); });

// Skill pages: resource and recipe pills, bench tabs, the arena's buttons.
el("skWorkBody").addEventListener("click", (e) => {
  const s = skillDef(route.arg);
  if (!s) return;

  const tab = e.target.closest("[data-bench-tab]");
  if (tab) {
    benchTab = tab.dataset.benchTab;
    keys.skill = "";
    renderSkill();
    return;
  }
  const tier = e.target.closest("[data-bench-tier]");
  if (tier) {
    benchTier = Number(tier.dataset.benchTier);
    keys.skill = "";
    renderSkill();
    return;
  }
  const pill = e.target.closest("[data-action]");
  if (pill) {
    openActionPopup({ kind: s.kind === "craft" ? "craft" : "gather", skillId: s.id, actionId: pill.dataset.action });
    return;
  }
  const foe = e.target.closest("[data-monster]");
  if (foe) {
    openActionPopup({ kind: "foe", monsterId: foe.dataset.monster });
    return;
  }
  const hunt = e.target.closest("button[data-hunt]");
  if (hunt && liveRefs.hunt) {
    if (hunt.dataset.hunt === "pull") pullBack();
    else if (hunt.dataset.hunt === "open") openActionPopup({ kind: "hunt", tier: liveRefs.hunt.tier, zone: huntZone });
  }
});

// The arena's tick box: go to ground when Threat peaks instead of meeting the Sovereign.
el("skWorkBody").addEventListener("change", (e) => {
  const box = e.target.closest('input[data-hunt="hide"]');
  if (!box) return;
  state.settings.hideSovereign = box.checked;
  say(box.checked ? "You'll go to ground when Threat peaks." : "You'll stand and face whatever comes when Threat peaks.");
  render();
});

el("skZonesBody").addEventListener("click", (e) => {
  const pill = e.target.closest("[data-zone]");
  if (pill && liveRefs.hunt) openActionPopup({ kind: "hunt", tier: liveRefs.hunt.tier, zone: pill.dataset.zone });
});

el("skFoesBody").addEventListener("click", (e) => {
  const pill = e.target.closest("[data-monster]");
  if (pill) openActionPopup({ kind: "foe", monsterId: pill.dataset.monster });
});

el("compList").addEventListener("click", (e) => {
  const b = e.target.closest("[data-comp]");
  if (!b || b.disabled) return;
  if (b.dataset.do === "buy") buyCompanion(b.dataset.comp);
  else if (b.dataset.do === "take") setCompanion(b.dataset.comp);
  else setCompanion(null);
});

// Trades stop the moment you ask: crews down tools immediately.
el("tbTradesClear").onclick = () => stopSkillTask();

// Pulling back is immediate.
el("tbFieldClear").onclick = () => {
  if (pullBack()) toast("You pulled back");
};

// Item popup.
el("ipClose").onclick = closeItemPopup;
el("itemModal").addEventListener("click", (e) => { if (e.target === el("itemModal")) closeItemPopup(); });

// Action popup. Items named in its lists open their own details on top.
el("amClose").onclick = closeActionPopup;
el("actionModal").addEventListener("click", (e) => {
  if (e.target === el("actionModal")) {
    closeActionPopup();
    return;
  }
  const item = e.target.closest(".am-item[data-key]");
  if (item) {
    openItemPopup(item.dataset.key, "view");
    return;
  }
  const foe = e.target.closest(".am-item[data-monster]");
  if (foe && popAction) {
    const back = popAction.kind === "hunt" ? { kind: "hunt", tier: popAction.tier, zone: popAction.zone } : null;
    openActionPopup({ kind: "foe", monsterId: foe.dataset.monster, back });
  }
});

el("cfOk").onclick = () => closeConfirm(true);
el("cfCancel").onclick = () => closeConfirm(false);
el("confirmModal").addEventListener("click", (e) => { if (e.target === el("confirmModal")) closeConfirm(false); });

el("classPop").onclick = (e) => { if (e.target === el("classPop")) el("classPop").hidden = true; };
el("hireAgentBtn").onclick = hireAgent;

// Escape closes whatever is on top.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (document.body.classList.contains("nav-open")) setNav(false);
  else if (!el("confirmModal").hidden) closeConfirm(false);
  else if (!el("itemModal").hidden) closeItemPopup();
  else if (!el("actionModal").hidden) closeActionPopup();
  else if (!el("settingsModal").hidden) el("settingsModal").hidden = true;
});

el("settingsBtn").onclick = () => {
  refreshAccountUi();
  el("acctNote").textContent = "";
  el("settingsModal").hidden = false;
};

el("settingsClose").onclick = () => {
  el("settingsModal").hidden = true;
};
el("settingsModal").addEventListener("click", (e) => { if (e.target === el("settingsModal")) el("settingsModal").hidden = true; });

el("acctCreate").onclick = async () => {
  el("acctCreate").disabled = true;
  el("acctNote").textContent = "Working...";
  const err = await createAccount(el("acctUser").value, el("acctPass").value);
  el("acctCreate").disabled = false;
  el("acctNote").textContent = err || "Signed in.";
  if (!err) {
    el("acctPass").value = "";
    refreshAccountUi();
    render();
  }
};

el("acctLogin").onclick = async () => {
  el("acctLogin").disabled = true;
  el("acctNote").textContent = "Working...";
  const err = await loginAccount(el("acctUser").value, el("acctPass").value);
  el("acctLogin").disabled = false;
  el("acctNote").textContent = err || "Signed in.";
  if (!err) {
    el("acctPass").value = "";
    refreshAccountUi();
  }
};

el("acctLogout").onclick = async () => {
  await logoutAccount();
  refreshAccountUi();
  el("acctNote").textContent = "Signed out.";
};

el("saveBtn").onclick = async () => {
  toast((await save()) ? "Saved" : "Save failed");
};

el("wipeBtn").onclick = async () => {
  const ok = await confirmDialog({
    title: "Reset your character?",
    body: "Every skill, item, companion and coin is gone for good. There is no getting it back.",
    confirmLabel: "Reset character",
    danger: true,
  });
  if (!ok) return;
  await resetCharacter();
  toast("Character reset");
};

// ---- boot ----

const away = bootLoad();
if (away) catchUp(away);

refreshBounty();

if (state.log.length === 0) {
  say("You take command of a ruin.");
}

route = parseHash();
render();
resumeCloudSession();
startLoop();

// Back in view: play out any time the page slept through, then redraw.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    loop();
    render();
  }
});

setInterval(save, 10000);
window.addEventListener("beforeunload", save);
