/* ============================================================
   Respite — ui.js · The Paintbrush
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
let eqTab = "pack";          // Equipment & Pack page: "pack" | "bank"
let campTab = "stores";      // Camp Stores page: "stores" | "bank"
let gridFilter = "all";
let gridSort = "custom";
let navOpen = { vanguard: true, camp: true, trades: true, workshops: true, field: true };

let craftTierTab = 1;
let craftTierTabSkill = null;
let craftCatTab = "all";

let pendingTask = null;      // { skillId, actionId } waiting on the task popup
let popItem = null;          // { key, from } shown in the item popup
let popReturnFocus = null;   // whatever had focus before the popup opened

let keys = {};               // render signatures, cleared by render()
let liveRefs = { nodes: [], recipes: [], monster: null };
let navRefs = {};

/* ================= 2. ROUTING ================= */

const PAGES = ["character", "equipment", "camp", "kennel", "atlas", "shop", "bounty", "skill", "requisitions", "forecast"];

function parseHash() {
  const raw = (location.hash || "").replace(/^#\/?/, "");
  const [page, arg] = raw.split("/");
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
  liveRefs = { nodes: [], recipes: [], monster: null };
  renderAll();
  refreshItemPopup();
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
  if (route.page === "equipment") renderStorePage("eq");
  if (route.page === "camp") renderStorePage("camp");
  if (route.page === "bounty") renderBounty();
  if (route.page === "shop") setText(el("smugglerTimer"), `Moves on in ${fmtTime(windowEndsIn())}`);
  renderSidebar();
  renderLog();
}

function toast(msg) {
  const stack = el("toastStack");
  if (!stack) return;
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  t.onclick = () => t.remove();
  stack.appendChild(t);
  setTimeout(() => { if (t.parentNode) t.remove(); }, 7000);
}

/* ================= 4. TOPBAR ================= */

function renderTopbar() {
  setText(el("goldText"), fmt(state.player.gold));
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

    let line = `${fmt(sp.done)} / ${fmt(sp.target)} acts · ${fmtTime(sp.timeLeft)}`;
    if (sp.capped) line += " (stock)";
    if (state.tasks.skilling.queued) line += state.tasks.skilling.queued === "stop" ? " · stopping" : " · switching";

    setText(el("tbTradesMeta"), line);
    el("tbTradesClear").classList.toggle("queued", !!state.tasks.skilling.queued);
  } else {
    setText(el("tbTradesName"), "Idle");
    sBar.style.width = "0";
    setText(el("tbTradesMeta"), "No crews tasked.");
    el("tbTradesClear").classList.remove("queued");
  }

  const cp = combatPlan();
  const cBar = el("tbFieldBar");

  if (cp) {
    setText(el("tbFieldName"), cp.mob.name);
    cBar.style.width = cp.pct + "%";

    let line = `${fmt(cp.done)} / ${fmt(cp.target)} kills · ${fmtTime(cp.timeLeft)}`;
    line += cp.food ? ` · food ${fmt(cp.foodHave)}/${fmt(cp.foodNeed)}` : " · no food";
    if (state.tasks.combat.queued) line += " · changing";

    setText(el("tbFieldMeta"), line);
    el("tbFieldClear").classList.toggle("queued", !!state.tasks.combat.queued);
  } else {
    setText(el("tbFieldName"), recovering() ? "Recovering" : "Idle");
    cBar.style.width = "0";
    setText(el("tbFieldMeta"), recovering() ? `Back in ${fmtTime(state.player.recoveryUntil - Date.now())}.` : "Take the field.");
    el("tbFieldClear").classList.remove("queued");
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
  const eqItem = mkItem({ label: "Equipment & Pack", page: "equipment", active: route.page === "equipment" });
  navRefs.pack = eqItem.children[1];
  van.appendChild(eqItem);

  const camp = el("navCamp");
  camp.innerHTML = "";
  const storesItem = mkItem({ label: "Camp Stores", page: "camp", active: route.page === "camp" });
  navRefs.stores = storesItem.children[1];
  camp.appendChild(storesItem);
  camp.appendChild(mkItem({ label: "The Kennel", page: "kennel", active: route.page === "kennel" }));
  const boardItem = mkItem({ label: "The Board", page: "bounty", active: route.page === "bounty" });
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

  const spoilTag = el("spoilsTag");
  if (spoilTag) {
    setText(spoilTag, state.spoils.length ? `${state.spoils.length} unclaimed spoils` : "");
    spoilTag.hidden = !state.spoils.length;
  }
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
  if (route.page === "equipment") renderStorePage("eq");
  if (route.page === "camp") renderStorePage("camp");
  if (route.page === "kennel") renderKennel();
  if (route.page === "atlas") renderAtlas();
  if (route.page === "shop") renderShop();
  if (route.page === "requisitions") renderRequisitions();
  if (route.page === "forecast") renderForecast();
  if (route.page === "bounty") renderBounty();
}

function crumbText() {
  const r = currentRegion();
  if (route.page === "skill") {
    const s = skillDef(route.arg);
    const group = s.kind === "gather" ? "Gathering" : s.kind === "craft" ? "Crafting" : "The Field";
    return `Respite &nbsp;/&nbsp; ${group} &nbsp;/&nbsp; <b>${s.name}</b>`;
  }
  return `Respite &nbsp;/&nbsp; ${r.name} &nbsp;/&nbsp; <b>${titleCase(route.page)}</b>`;
}

/* ================= 7. SKILL PAGE ================= */

function renderSkill() {
  const s = skillDef(route.arg) || skillDef("delving");
  const region = currentRegion();
  renderSkillHero(s, region);

  const sig = skillSig(s, region);
  if (keys.skill !== sig) {
    keys.skill = sig;
    liveRefs = { nodes: [], recipes: [], monster: null };
    keys.spoils = null;

    el("skYield").hidden = s.kind === "craft";
    el("skSeams").hidden = s.kind === "craft";
    el("skSpoils").hidden = s.kind !== "war";

    renderMasteryTip(s);
    if (s.kind === "war") renderFieldBody(region);
    else if (s.kind === "gather") renderGatherBody(s, region);
    else renderCraftBody(s);
    renderYieldFeed();
  }

  if (s.kind === "war") renderSpoils();
  updateLive();
}

// Everything that changes what the skill page's buttons and chips say.
function skillSig(s, region) {
  const t = state.tasks.skilling;
  const c = state.tasks.combat;
  const parts = [
    s.id, skillLevel(s.id), region.id, dayIndex(), state.travel.unlocked.length,
    t ? `${t.skillId}:${t.actionId}:${t.queued ? "q" : ""}` : "-",
    state.tools[s.id] || "-", state.pets.golem ? "golem" : "-",
  ];
  if (s.kind === "war") {
    parts.push(c ? `${c.tier}:${c.monsterId}:${c.queued ? "q" : ""}` : "-", recovering(),
      JSON.stringify(state.equipment), state.player.klass || "-");
  }
  if (s.kind === "craft") parts.push(craftTierTab, craftCatTab);
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

// Weather and Bountiful Weekend chips. Nothing shows when nothing applies.
function xpChips(skillId) {
  let html = "";
  const w = currentWeather();
  const pct = w.mods[skillId];
  if (pct) html += `<div class="chip ${pct > 0 ? "good" : "warn"}">${signedPct(pct)} XP · ${w.label}</div>`;
  if (w.bountiful && isTrade(skillId)) html += `<div class="chip good">+${Math.round(BOUNTIFUL_XP * 100)}% XP · Bountiful Weekend</div>`;
  return html;
}

const chancePct = (chance) => `${+(chance * 100).toFixed(2)}%`;

function renderGatherBody(s, region) {
  const defs = GATHER_ACTIONS[s.id].filter((a) => a.tier === region.tier);
  const lvl = skillLevel(s.id);
  const t = state.tasks.skilling;

  el("skWorkLabel").textContent = `Working · ${region.name}`;
  const box = el("skWorkBody");
  box.innerHTML = "";

  if (!defs.length) {
    box.innerHTML = `<div class="muted">No ground here for ${s.name}.</div>`;
    el("skYield").hidden = true;
    renderOtherSeams(s.id);
    return;
  }

  const grid = document.createElement("div");
  grid.className = "node-grid";

  defs.forEach((def) => {
    const active = !!(t && t.skillId === s.id && t.actionId === def.id);
    const locked = lvl < def.level;
    const dbl = doubleChance(s.id);

    const card = document.createElement("div");
    card.className = "node-card" + (active ? " active" : "");
    card.innerHTML = `<div class="node-icon">${icon(def.icon, "ico-lg")}</div>`;

    const info = document.createElement("div");
    info.className = "node-info";

    const h = document.createElement("h3");
    h.textContent = titleCase(def.name);
    info.appendChild(h);

    const chips = document.createElement("div");
    chips.className = "stat-chips";
    chips.innerHTML =
      `<div class="chip">${(actionTime(def) / 1000).toFixed(1)}s / action</div>` +
      `<div class="chip">${fmt(def.xp)} XP base</div>` +
      xpChips(s.id) +
      (dbl > 0 ? `<div class="chip good">${Math.round(dbl * 100)}% double yield</div>` : "") +
      (locked ? `<div class="chip warn">Needs Lv ${def.level}</div>` : "");
    info.appendChild(chips);

    const prog = document.createElement("div");
    prog.className = "node-progress";
    prog.innerHTML = '<div class="bar"><i></i></div><div class="meta"><span></span><b></b></div>';
    info.appendChild(prog);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-primary node-btn";
    btn.textContent = active ? (t.queued === "stop" ? "Stopping..." : "Stop working") : "Put crews to work";
    btn.disabled = locked;
    btn.onclick = () => {
      const live = state.tasks.skilling;
      if (live && live.skillId === s.id && live.actionId === def.id) selectSkillAction(s.id, def.id);   // stop, no ceremony
      else openTaskPop(s.id, def.id);
    };
    info.appendChild(btn);

    card.appendChild(info);
    grid.appendChild(card);

    liveRefs.nodes.push({ def, skillId: s.id, bar: prog.querySelector("i"), left: prog.querySelector("span"), right: prog.querySelector("b") });
  });

  box.appendChild(grid);
  renderYieldTable(defs, s.id);
  renderOtherSeams(s.id);
}

function renderCraftBody(s) {
  const lvl = skillLevel(s.id);
  el("skWorkLabel").textContent = "The Bench";
  const box = el("skWorkBody");
  box.innerHTML = "";

  const availableTiers = [...new Set(actionsFor(s.id).map((a) => a.tier))].sort((a, b) => a - b);
  if (craftTierTabSkill !== s.id) {
    craftTierTabSkill = s.id;
    craftTierTab = availableTiers.reduce((best, i) => (TIERS[i - 1].level <= lvl ? i : best), availableTiers[0]);
  }

  const tabs = document.createElement("div");
  tabs.className = "tabs craft-tier-tabs";
  availableTiers.forEach((i) => {
    const tier = TIERS[i - 1];
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tab-btn" + (craftTierTab === i ? " active" : "") + (lvl < tier.level ? " locked" : "");
    b.textContent = "Lv." + tier.level;
    b.title = stratumOf(i).name;
    b.onclick = () => { craftTierTab = i; keys.skill = ""; renderSkill(); };
    tabs.appendChild(b);
  });
  box.appendChild(tabs);

  // Second row: what kind of thing you're making, so the bench isn't a wall.
  const inTier = actionsFor(s.id).filter((a) => a.tier === craftTierTab);
  const catOf = (def) => {
    if (def.craftGear) {
      const g = GEAR[def.craftGear];
      return (g && (g.slot === "weapon" || g.slot === "offhand")) ? "weapons" : "armour";
    }
    if (def.out && TOOLS[Object.keys(def.out)[0]]) return "tools";
    const outId = def.out ? Object.keys(def.out)[0] : null;
    const cat = outId && MATERIALS[outId] ? MATERIALS[outId].category : null;
    if (cat && ["Bars", "Planks", "Weave", "Leather", "Inlays"].includes(cat)) return "refined";
    return "components";
  };

  const cats = [
    { id: "all", label: "All" },
    { id: "refined", label: "Refined" },
    { id: "components", label: "Components" },
    { id: "weapons", label: "Weapons" },
    { id: "armour", label: "Armour" },
    { id: "tools", label: "Tools" },
  ].filter((c) => c.id === "all" || inTier.some((d) => catOf(d) === c.id));

  if (!cats.some((c) => c.id === craftCatTab)) craftCatTab = "all";

  const catTabs = document.createElement("div");
  catTabs.className = "tabs craft-cat-tabs";
  cats.forEach((c) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tab-btn" + (craftCatTab === c.id ? " active" : "");
    b.textContent = c.label;
    b.onclick = () => { craftCatTab = c.id; keys.skill = ""; renderSkill(); };
    catTabs.appendChild(b);
  });
  box.appendChild(catTabs);

  const list = document.createElement("div");
  list.className = "recipe-list";
  const t = state.tasks.skilling;

  inTier.filter((a) => craftCatTab === "all" || catOf(a) === craftCatTab).forEach((def) => {
    const locked = lvl < def.level;
    const active = !!(t && t.skillId === s.id && t.actionId === def.id);
    const row = document.createElement("button");
    row.type = "button";
    row.className = "recipe" + (locked ? " locked" : "") + (active ? " active" : "");
    row.disabled = locked;

    row.innerHTML = `<span class="r-ico">${icon(def.icon, "ico-sm")}</span><span class="r-name"></span><span class="r-cost"></span><span class="r-meta"></span>`;
    row.children[1].textContent = titleCase(def.name);
    row.children[3].textContent = `${(actionTime(def) / 1000).toFixed(0)}s · ${fmt(def.xp)} XP`;
    row.onclick = () => {
      const live = state.tasks.skilling;
      if (live && live.skillId === s.id && live.actionId === def.id) selectSkillAction(s.id, def.id);
      else openTaskPop(s.id, def.id);
    };
    list.appendChild(row);

    const names = {};
    Object.keys(def.cost || {}).forEach((k) => { names[k] = itemName(k); });
    liveRefs.recipes.push({ def, locked, names, cost: row.children[2] });
  });
  box.appendChild(list);

  const activeDef = t && t.skillId === s.id ? findAction(t.skillId, t.actionId) : null;
  if (activeDef) {
    const prog = document.createElement("div");
    prog.className = "node-progress craft-progress";
    prog.innerHTML = '<div class="bar"><i></i></div><div class="meta"><span></span><b></b></div>';
    box.appendChild(prog);
    liveRefs.nodes.push({ def: activeDef, skillId: s.id, bar: prog.querySelector("i"), left: prog.querySelector("span"), right: prog.querySelector("b") });
  }

  // Picking a default tab above can change the signature; record the final one.
  keys.skill = skillSig(s, currentRegion());
}

function renderFieldBody(region) {
  const tier = region.tier;
  const t = state.tasks.combat;
  const engaged = !!(t && t.tier === tier);
  const live = (engaged && getMonster(t.monsterId)) || rankOf(tier, "grunt");

  el("skWorkLabel").textContent = `The Field · ${region.name}`;
  const box = el("skWorkBody");
  box.innerHTML = "";

  const grid = document.createElement("div");
  grid.className = "node-grid";

  // ---- the quarry ----
  const card = document.createElement("div");
  card.className = "node-card" + (engaged ? " active" : "");
  card.innerHTML = `<div class="node-icon war">${icon(live.icon, "ico-lg")}</div>`;

  const info = document.createElement("div");
  info.className = "node-info";

  const h = document.createElement("h3");
  h.textContent = live.name;
  if (live.rank !== "grunt") {
    const tag = document.createElement("span");
    tag.className = "rank-tag " + live.rank;
    tag.textContent = live.rank === "boss" ? "Sovereign" : "Elite";
    h.appendChild(tag);
  }
  info.appendChild(h);

  const sub = document.createElement("div");
  sub.className = "node-sub";
  sub.textContent = recovering() ? "Recovering..." : "Lead the vanguard.";
  info.appendChild(sub);

  const chips = document.createElement("div");
  chips.className = "stat-chips";
  const atk = attackPower();
  const avg = Math.max(1, (atk * 0.55 + atk) / 2 - live.defence * 0.35);
  const killMs = (live.hp / avg) * swingSpeed() + RESPAWN_MS;
  const incoming = Math.max(1, (live.attack * 0.55 + live.attack) / 2 - defencePower() * 0.4);
  const survive = maxHp() / (incoming / live.speed * 1000);

  chips.innerHTML =
    `<div class="chip">${fmt(live.hp)} HP</div>` +
    `<div class="chip">${fmt(live.attack)} attack</div>` +
    `<div class="chip">${fmt(live.xp)} XP</div>` +
    `<div class="chip${survive < 30 ? " warn" : ""}">~${fmtTime(killMs)} a kill</div>` +
    `<div class="chip${survive < 30 ? " warn" : " good"}">${survive < 30 ? "You will not last here" : "Survivable"}</div>`;
  info.appendChild(chips);

  const bar = document.createElement("div");
  bar.className = "node-progress";
  bar.innerHTML = '<div class="bar mob"><i></i></div><div class="meta"><span></span><b></b></div>';
  info.appendChild(bar);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-primary node-btn";
  btn.textContent = recovering() ? "Recovering" : engaged ? (t.queued === "stop" ? "Pulling back after this" : "Pull back") : "Take the field";
  btn.disabled = recovering();
  btn.onclick = () => engageRegion(tier);
  info.appendChild(btn);

  card.appendChild(info);
  grid.appendChild(card);

  // ---- threat and the regional roster ----
  const side = document.createElement("div");
  side.className = "node-card node-stack";
  side.innerHTML =
    '<div class="threat-block">' +
      '<div class="threat-head"><span class="label">Regional Threat</span><span class="threat-num"></span></div>' +
      '<div class="bar threat"><i></i></div><div class="threat-note"></div>' +
    '</div>' +
    '<div class="roster"><div class="label">Regional Roster</div></div>';

  const roster = side.querySelector(".roster");
  rosterFor(tier).forEach((m) => {
    const row = document.createElement("div");
    row.className = "roster-row" + (m.id === live.id ? " on" : "");
    row.innerHTML =
      `<div class="left">${icon(m.icon, "ico-sm")}<div><div class="rname"></div><div class="rsub"></div></div></div>` +
      `<div class="rrank ${m.rank}"></div>`;
    row.querySelector(".rname").textContent = m.name;
    row.querySelector(".rsub").textContent = `${fmt(m.hp)} HP · ${fmt(m.xp)} XP`;
    row.querySelector(".rrank").textContent = m.rank === "grunt" ? "80%" : m.rank === "elite" ? "20%" : "Threat " + THREAT_CAP;
    roster.appendChild(row);
  });
  grid.appendChild(side);
  box.appendChild(grid);

  liveRefs.monster = {
    tier,
    bar: bar.querySelector("i"),
    left: bar.querySelector("span"),
    right: bar.querySelector("b"),
    threatNum: side.querySelector(".threat-num"),
    threatBar: side.querySelector(".bar.threat i"),
    threatNote: side.querySelector(".threat-note"),
  };

  // ---- drops ----
  el("skYieldLabel").textContent = "Drops";
  const drops = el("skYieldBody");
  drops.innerHTML = "";
  live.drops.forEach(([k, qty, chance]) => drops.appendChild(yieldRow(k, `${Math.round(chance * 100)}% · ${qty}`)));
  if (live.rank === "boss") {
    const row = document.createElement("div");
    row.className = "yield-item";
    row.innerHTML = '<span class="left"><span class="rar-epic">Epic gear</span></span><span class="chance">Guaranteed</span>';
    drops.appendChild(row);
  }

  // ---- other ground ----
  el("skSeamsLabel").textContent = "Other Ground";
  const seams = el("skSeamsBody");
  seams.innerHTML = "";

  REGIONS.forEach((r) => {
    if (r.tier === tier) return;
    const unlocked = state.travel.unlocked.includes(r.id);
    const grunt = rankOf(r.tier, "grunt");
    const row = document.createElement("button");
    row.type = "button";
    row.className = "seam-row";
    row.innerHTML = '<div class="name"></div><div class="region"></div>';
    row.children[0].textContent = grunt.name;
    row.children[1].textContent = `Lv ${grunt.level} · ${r.name}${unlocked ? "" : ` · ${fmt(r.toll)}g`}`;
    row.onclick = () => travelTo(r.id);
    seams.appendChild(row);
  });
}

// One clickable line in a yield or drop table. Opens the item's details.
function yieldRow(key, label) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "yield-item";
  row.innerHTML = `<span class="left">${icon(itemDef(key).icon, "ico-sm")}<span></span></span><span class="chance"></span>`;
  row.querySelector(".left span").textContent = itemName(key);
  row.querySelector(".chance").textContent = label;
  row.onclick = () => openItemPopup(key, "view");
  return row;
}

function renderYieldTable(defs, skillId) {
  el("skYieldLabel").textContent = "Yield Table";
  const box = el("skYieldBody");
  box.innerHTML = "";

  const dbl = doubleChance(skillId);
  defs.forEach((def) => {
    const mainKey = Object.keys(def.out)[0];
    box.appendChild(yieldRow(mainKey, "Every action"));
    if (dbl > 0) box.appendChild(yieldRow(mainKey, `${Math.round(dbl * 100)}% doubled`));
    if (def.reagentId) box.appendChild(yieldRow(def.reagentId, `${chancePct(def.reagentChance)} chance`));
  });
}

function renderOtherSeams(skillId) {
  el("skSeamsLabel").textContent = `Other ${skillName(skillId)} Grounds`;
  const box = el("skSeamsBody");
  box.innerHTML = "";
  const lvl = skillLevel(skillId);

  GATHER_ACTIONS[skillId].forEach((def) => {
    if (def.tier === currentRegion().tier) return;
    const r = regionOfTier(def.tier);
    const unlocked = state.travel.unlocked.includes(r.id);
    const row = document.createElement("button");
    row.type = "button";
    row.className = "seam-row" + (lvl < def.level ? " dim" : "");
    row.innerHTML = '<div class="name"></div><div class="region"></div>';
    row.children[0].textContent = titleCase(def.name);
    row.children[1].textContent = `Lv ${def.level} · ${r.name}${unlocked ? "" : ` · ${fmt(r.toll)}g toll`}`;
    row.onclick = () => travelTo(r.id);
    box.appendChild(row);
  });
}

// Rebuilds only when a new kind of loot lands; counts update in place.
function renderSpoils() {
  const list = el("skSpoilsBody");
  setText(el("skSpoilsCount"), state.spoils.length ? `${state.spoils.length} lots waiting` : "");
  el("skSpoilsActions").hidden = !state.spoils.length;

  const sig = state.spoils.map((s) => s.key).join(",");
  if (keys.spoils !== sig) {
    keys.spoils = sig;
    list.innerHTML = "";

    if (!state.spoils.length) {
      list.innerHTML = '<div class="muted tiny">Nothing on the field.</div>';
      return;
    }

    state.spoils.slice().reverse().forEach((s) => {
      const d = itemDef(s.key);
      const row = document.createElement("div");
      row.className = "spoil-row";
      row.dataset.key = s.key;
      row.innerHTML =
        `<button type="button" class="left sp-open">${icon(d.icon, "ico-sm")}<span class="sp-name"></span></button>` +
        '<div class="sp-qty"></div>' +
        '<button type="button" class="minibtn sp-take">Take</button>' +
        '<button type="button" class="minibtn sp-sell"></button>';
      const nm = row.querySelector(".sp-name");
      nm.textContent = itemName(s.key);
      if (d.rarity && d.rarity !== "common") nm.classList.add("rar-" + d.rarity);
      list.appendChild(row);
    });
  }

  list.querySelectorAll(".spoil-row").forEach((row) => {
    const s = state.spoils.find((x) => x.key === row.dataset.key);
    if (!s) return;
    setText(row.querySelector(".sp-qty"), "×" + fmt(s.qty));
    setText(row.querySelector(".sp-sell"), fmt(itemDef(s.key).value * s.qty) + "g");
  });
}

function renderYieldFeed() {
  const box = el("skYieldFeed");
  box.innerHTML = "";
  if (!state.yields.length) {
    box.innerHTML = '<div class="log-item muted">Nothing yet.</div>';
    return;
  }

  state.yields.slice().reverse().forEach((y) => {
    const d = document.createElement("div");
    d.className = "log-item";
    d.innerHTML = '<span class="t"></span><span></span>';
    const ago = Date.now() - y.t;
    d.children[0].textContent = ago < 4000 ? "now" : fmtTime(ago);
    d.children[1].textContent = y.m;
    box.appendChild(d);
  });
}

function updateLive() {
  const t = state.tasks.skilling;

  liveRefs.nodes.forEach((n) => {
    const active = t && t.skillId === n.skillId && t.actionId === n.def.id;
    const time = actionTime(n.def);

    if (active) {
      const pct = clamp((t.progress / time) * 100, 0, 100);
      n.bar.classList.toggle("nojump", pct < 6);
      n.bar.style.width = pct + "%";
      const plan = skillPlan();
      setText(n.left, `${fmt(plan.done)} / ${fmt(plan.target)} actions`);
      setText(n.right, fmtTime(plan.timeLeft) + " left");
    } else {
      n.bar.style.width = "0";
      const per12 = Math.floor(IDLE_CAP_MS / time);
      setText(n.left, `${fmt(per12)} actions per 12h`);
      setText(n.right, fmt(per12 * n.def.xp * xpMult(n.skillId)) + " XP");
    }
  });

  liveRefs.recipes.forEach((r) => {
    if (r.locked) {
      setText(r.cost, `Needs Lv ${r.def.level}`);
      return;
    }
    const cost = r.def.cost || {};
    const ids = Object.keys(cost);
    setText(r.cost, ids.map((k) => `${cost[k]}× ${r.names[k]} (${fmt(haveQty(k))})`).join(", "));
    r.cost.classList.toggle("short", ids.some((k) => haveQty(k) < cost[k]));
  });

  const m = liveRefs.monster;
  if (m) {
    const c = state.tasks.combat;
    const plan = c && c.tier === m.tier ? combatPlan() : null;

    if (plan) {
      m.bar.style.width = clamp(c.respawn > 0 ? 0 : (c.mobHp / c.mobMax) * 100, 0, 100) + "%";
      setText(m.left, `${fmt(plan.done)} / ${fmt(plan.target)} kills`);
      setText(m.right, fmtTime(plan.timeLeft) + " left");
    } else {
      m.bar.style.width = "100%";
      setText(m.left, "Not engaged");
      setText(m.right, "");
    }

    const threat = threatIn(m.tier);
    const boss = rankOf(m.tier, "boss").name;
    setText(m.threatNum, `${threat} / ${THREAT_CAP}`);
    m.threatBar.style.width = (threat / THREAT_CAP) * 100 + "%";
    setText(m.threatNote, threat >= THREAT_CAP ? `${boss} is waiting.` : `At ${THREAT_CAP}, ${boss} comes out.`);
  }
}

/* ================= 8. CHARACTER ================= */

function renderCharacter() {
  const region = currentRegion();
  setText(el("chName"), state.meta.name || "Commander");
  setText(el("chRegionTag"), `In ${region.name}`);
  setText(el("chTotal"), "Lv " + totalLevel());

  if (keys.chTags !== region.id) {
    keys.chTags = region.id;
    const tags = el("chTags");
    tags.innerHTML = "<span>Commander</span><span></span>";
    tags.children[1].textContent = region.name;
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
      : idleBlock("No crews tasked", "Your people are standing around.", "Open Delving", () => go("skill", "delving")));
  }

  if (sp) {
    box.querySelector(".bar i").style.width = sp.pct + "%";
    setText(box.querySelector(".task-meta span"), `${fmt(sp.done)} / ${fmt(sp.target)} actions`);
    setText(box.querySelector(".task-meta b"), fmtTime(sp.timeLeft) + " left");
  }
}

function renderCharacterField() {
  const box = el("chField");
  const cp = combatPlan();
  const sig = cp ? "fight:" + cp.mob.id : recovering() ? "recovering" : "idle";

  if (keys.chField !== sig) {
    keys.chField = sig;
    box.innerHTML = "";
    if (cp) box.appendChild(taskBlock(cp.mob.icon, cp.mob.name, true));
    else if (recovering()) box.appendChild(idleBlock("Recovering", "", "Open The Field", () => go("skill", "warfare")));
    else box.appendChild(idleBlock("No quarry chosen", "Take the field yourself.", "Open The Field", () => go("skill", "warfare")));
  }

  if (cp) {
    box.querySelector(".bar i").style.width = cp.pct + "%";
    setText(box.querySelector(".task-meta span"), `${fmt(cp.done)} / ${fmt(cp.target)} kills`);
    setText(box.querySelector(".task-meta b"), fmtTime(cp.timeLeft) + " left");
  } else if (recovering()) {
    setText(box.querySelector(".idle-block .sub"), `Back in ${fmtTime(state.player.recoveryUntil - Date.now())}.`);
  }
}

function renderCharacterStats() {
  const rows = [
    ["Health", maxHp()], ["Attack", Math.round(attackPower())], ["Defence", Math.round(defencePower())],
    ["Kills", fmt(state.stats.kills)], ["Deaths", fmt(state.stats.deaths)], ["Gold Earned", fmt(state.stats.goldEarned)],
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

/* ================= 9. STORES (Pack, Camp Stores, Bank) ================= */

const FILTERS = [
  { id: "all",       label: "ALL",  test: () => true },
  { id: "gear",      label: "Gear", icon: "blade", test: (d) => d.kind === "gear" },
  { id: "material",  label: "Mats", icon: "ore",   test: (d) => d.kind === "material" && !d.heal && !d.forSkill },
  { id: "provision", label: "Food", icon: "ration", test: (d) => !!d.heal },
  { id: "tool",      label: "Tools", icon: "pick", test: (d) => d.kind === "tool" },
];

function scopeTab(scope) {
  return scope === "eq" ? eqTab : campTab;
}

// Which pool a page is showing: its own (Pack / Camp Stores) or the shared Bank.
function scopeStore(scope) {
  const tab = scopeTab(scope);
  if (tab === "bank") return "vault";
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
    b.innerHTML = f.icon ? icon(f.icon, "ico-sm") : f.label;
    b.title = f.label;
    b.dataset.filter = f.id;
    box.appendChild(b);
  });
}

function itemKindLabel(d) {
  if (d.kind === "gear") return `${rarityDef(d.rarity).name} ${SLOT_LABELS[d.slot]}`;
  if (d.kind === "tool") return "Tool";
  if (d.heal) return "Provision";
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
        cell.innerHTML = '<div class="art"></div><div class="info"><div class="n">Empty</div><div class="r">Empty Slot</div></div>';
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

  setText(el("dollName"), state.meta.name || "Commander");
  setText(el("dollSub"), `Commander · ${currentRegion().name}`);
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
  renderStatRows("dollStanding", [
    ["Discipline", kls ? kls.name : (canPickClass() ? "Choose one" : `Combat ${CLASS_PICK_LEVEL}`), kls ? "good" : "gold"],
    ["Health", fmt(maxHp())],
    ["Attack Power", Math.round(attackPower()), "gold"],
    ["Defence", Math.round(defencePower())],
    ["Attack Speed", (swingSpeed() / 1000).toFixed(1) + "s"],
    ["Crit Chance", Math.round(critChance() * 100) + "%"],
    ["Crit Damage", Math.round(critDamage() * 100) + "%"],
    ["Block", Math.round(blockChance() * 100) + "%"],
    ["Dodge", Math.round(dodgeChance() * 100) + "%"],
    ["Defence Pen.", Math.round(defencePen() * 100) + "%"],
    ["Combat", "Lv " + skillLevel("warfare"), "good"],
    ["Pack Space", `${slotsUsed("inv")} / ${packSlots()}`],
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
    ["Gold on Hand", fmt(state.player.gold), "gold"],
    ["Camp Stores", `${slotsUsed("bank")} / ${slotCap("bank")}`],
    ["Bank", `${slotsUsed("vault")} / ${slotCap("vault")}`],
    ["Actions Worked", fmt(state.stats.actions)],
    ["Sovereigns Felled", fmt(state.stats.bosses || 0)],
  ]);
}

/* ================= 10. ITEM POPUP ================= */
/* One popup for every item. `from` says where the item is:
     "inv" | "bank" | "vault"  in storage: equip, move, sell, break down
     "equip:<slot>"            worn: unequip, repair
     "tool:<skillId>"          in the tool rack: stow
     "view"                    just looking (yield tables, drops, spoils) */

function openItemPopup(key, from) {
  if (!itemDef(key)) return;
  if (el("itemModal").hidden) popReturnFocus = document.activeElement;
  popItem = { key, from };
  fillItemPopup();
  el("itemModal").hidden = false;
  el("ipClose").focus({ preventScroll: true });
}

function closeItemPopup() {
  el("itemModal").hidden = true;
  popItem = null;
  if (popReturnFocus && popReturnFocus.isConnected && popReturnFocus.focus) popReturnFocus.focus({ preventScroll: true });
  popReturnFocus = null;
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

function describeItem(d) {
  const maker = (MADE_BY[d.base] || [])[0];
  const makerName = maker ? skillName(maker.skillId) : null;

  if (d.kind === "gear") {
    return `Made by the ${skillName(d.prof)}.${d.twoHanded ? " Takes both hands." : ""} ` +
      `Wears down in the field and is repaired with ${itemName(d.repairMat)}.`;
  }
  if (d.kind === "tool") {
    return `Makes every ${skillName(d.forSkill)} action ${Math.round(d.speed * 100)}% quicker while it's in hand.`;
  }
  if (d.heal) return "Eaten automatically when you drop low in the field.";
  if (d.chest) return `Open it to widen Camp Stores by ${d.chest} slots, up to ${BANK_MAX}.`;
  if (d.reagent) return "A reagent. Most recipes take one for each tier they belong to.";
  if (GATHERED_BY[d.base] && d.category) return `Raw ${d.category.toLowerCase()} from ${regionOfTier(d.tier).name}.`;
  if (["Bars", "Planks", "Weave", "Leather", "Inlays"].includes(d.category) && makerName) return `Refined by the ${makerName}.`;
  if (makerName) return `A component, made by the ${makerName}.`;
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

function itemSourceRows(d) {
  const rows = [];

  const gathered = GATHERED_BY[d.base] || [];
  if (gathered.length) {
    const lv = Math.min(...gathered.map((a) => a.level));
    rows.push(["Gathered", `${skillName(gathered[0].skillId)} · from Lv ${lv}`]);
  }

  const made = MADE_BY[d.base] || [];
  if (made.length) rows.push(["Made by", `${skillName(made[0].skillId)} · Lv ${made[0].level}`]);

  const used = [...new Set((USED_IN[d.base] || []).map((a) => titleCase(a.name)))];
  if (used.length) rows.push(["Used in", used.slice(0, 4).join(", ") + (used.length > 4 ? ` +${used.length - 4} more` : "")]);

  const drops = [...new Set((DROPPED_BY[d.base] || []).map((m) => m.name))];
  if (drops.length) rows.push(["Dropped by", drops.join(", ")]);

  return rows;
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

  const desc = describeItem(d);
  el("ipDesc").textContent = desc;
  el("ipDesc").hidden = !desc;

  // ---- stats, with the change against what it would replace ----
  const stats = el("ipStats");
  stats.innerHTML = "";
  const displaced = worn ? [] : displacedBy(d);
  const sum = (stat) => displaced.reduce((n, k) => n + (itemDef(k)[stat] || 0), 0);

  const statRow = (label, value, delta) => {
    const r = document.createElement("div");
    r.className = "pop-stat";
    r.innerHTML = '<div class="l"></div><div class="v"><span></span></div>';
    r.children[0].textContent = label;
    r.querySelector(".v span").textContent = value;
    if (delta) {
      const chip = document.createElement("span");
      chip.className = "delta " + (delta > 0 ? "up" : "down");
      chip.textContent = delta > 0 ? `+${fmt(delta)}` : `−${fmt(-delta)}`;
      r.children[1].appendChild(chip);
    }
    stats.appendChild(r);
  };

  if (d.kind === "gear") {
    const cmp = displaced.length > 0;
    [["attack", "Attack"], ["defence", "Defence"], ["health", "Max Health"]].forEach(([stat, label]) => {
      if (d[stat] || (cmp && sum(stat))) statRow(label, `+${fmt(d[stat])}`, cmp ? d[stat] - sum(stat) : 0);
    });
    if (d.slot === "weapon") statRow("Grip", d.twoHanded ? "Two-handed" : "One-handed");
    if (from.startsWith("equip:")) statRow("Condition", `${wearPct(key)}%`);
    else statRow("Durability", fmt(d.maxDur));
  }
  if (d.kind === "tool") {
    const pct = Math.round(d.speed * 100);
    const oldPct = displaced.length ? Math.round(itemDef(displaced[0]).speed * 100) : null;
    statRow(`${skillName(d.forSkill)} speed`, `+${pct}%`, oldPct === null ? 0 : pct - oldPct);
  }
  if (d.heal) statRow("Restores", `${fmt(d.heal)} HP`);
  if (d.chest) statRow("Camp Stores", `+${d.chest} slots`);
  statRow("Value", qty > 1 ? `${fmt(d.value)}g each · ${fmt(d.value * qty)}g` : `${fmt(d.value)}g`);
  if (inStore && haveQty(key) > qty) statRow("Held in all", fmt(haveQty(key)));

  const effect = el("ipEffect");
  effect.hidden = !d.effect;
  effect.textContent = d.effect ? `${prefixDef(d.prefix).name}: ${d.effect}` : "";

  // ---- where it comes from and what it feeds ----
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
  if (!worn && (d.kind === "gear" || d.kind === "tool")) {
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
  box.innerHTML = "";

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
  };

  if (from === "view") {
    box.hidden = true;
    return;
  }
  box.hidden = false;

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
    add("Stow in Camp Stores", "btn-primary", () => unequipTool(from.slice(5)), { wide: true });
    return;
  }

  // In storage.
  if (d.kind === "gear") {
    add(`Equip · ${SLOT_LABELS[d.slot]}`, "btn-primary", () => equipItem(key, from),
      { wide: true, disabled: blocked, title: blocked ? "Your weapon takes both hands" : "" });
  }
  if (d.kind === "tool") add(`Take up · ${skillName(d.forSkill)}`, "btn-primary", () => equipItem(key, from), { wide: true });
  if (d.chest) {
    add(`Open · +${d.chest} Camp Stores slots`, "btn-primary", () => useChest(key, from),
      { wide: true, disabled: state.bank.slots >= BANK_MAX });
  }

  ["inv", "bank", "vault"].filter((w) => w !== from).forEach((w) => {
    const full = !store(w).items[key] && storeFull(w);
    add(`${qty > 1 ? "Move all" : "Move"} to ${STORE_NAMES[w]}`, "", () => moveItem(key, from, w),
      { disabled: full, title: full ? `${STORE_NAMES[w]} is full` : "" });
  });

  add(`Sell 1 · ${fmt(d.value)}g`, "btn-gold", () => sellItem(key, from, 1), { wide: qty <= 1 });
  if (qty > 1) add(`Sell all · ${fmt(d.value * qty)}g`, "btn-gold", () => sellItem(key, from));

  const sv = salvageValue(key);
  if (sv) add(`Break down · ${sv.qty}× ${itemName(sv.mat)}`, "btn-quiet", () => salvage(key, from), { wide: true });
}

/* ================= 11. ATLAS, SHOP, BOARD, KENNEL, LOG ================= */

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
      foot.textContent = `Toll ${fmt(r.toll)} gold`;
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
    card.querySelector(".shop-sub").textContent = `Restores ${fmt(d.heal)} HP · ${fmt(entry.price)}g each`;

    const row = document.createElement("div");
    row.className = "btnrow";
    [1, 10, 50].forEach((n) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn btn-gold";
      b.textContent = `${n} · ${fmt(entry.price * n)}g`;
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
    card.querySelector(".shop-sub").textContent = `Tier ${d.tier} · ${fmt(entry.price)}g the lot`;

    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn btn-gold";
    b.textContent = bought ? "Dealt" : `Buy · ${fmt(entry.price)}g`;
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
  setText(card.querySelector(".bounty-reward"), `${fmt(Math.min(b.progress, b.amount))} of ${fmt(b.amount)} · pays ${fmt(b.gold)} gold and an hour double XP.`);
  const btn = card.querySelector("button");
  const done = b.progress >= b.amount;
  setText(btn, b.claimed ? "Paid out" : (done ? "Claim" : "Not finished"));
  btn.disabled = b.claimed || !done;
}

function renderKennel() {
  const box = el("petList");
  box.innerHTML = "";

  PETS.forEach((pet) => {
    const owned = state.pets[pet.id];
    const card = document.createElement("div");
    card.className = "pet-card" + (owned ? " owned" : "");
    card.innerHTML = `<div class="pet-art">${icon(pet.icon, "ico-xl")}</div><div class="pet-body"><div class="pet-name"></div><div class="pet-note"></div><div class="pet-effect"></div></div>`;
    card.querySelector(".pet-name").textContent = pet.name;
    card.querySelector(".pet-note").textContent = pet.note;
    card.querySelector(".pet-effect").textContent = pet.effect;

    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn " + (owned ? "btn-quiet" : "btn-gold");
    b.textContent = owned ? "In the kennel" : `Buy · ${fmt(pet.cost)}g`;
    b.disabled = owned || state.player.gold < pet.cost;
    b.onclick = () => buyPet(pet.id);
    card.appendChild(b);
    box.appendChild(card);
  });

  el("kennelNote").textContent = Object.values(state.pets).some(Boolean) ? "Bound to the camp permanently." : "Nothing bound yet.";
}

function renderLog() {
  const last = state.log[state.log.length - 1];
  const sig = `${state.log.length}|${last ? last.t : 0}|${Math.floor(Date.now() / 1000)}`;
  if (keys.log === sig) return;
  keys.log = sig;

  const box = el("eventLog");
  box.innerHTML = "";

  state.log.slice(-8).forEach((e) => {
    const d = document.createElement("div");
    d.className = "log-item";
    d.innerHTML = '<span class="t"></span><span></span>';
    const ago = Date.now() - e.t;
    d.children[0].textContent = ago < 4000 ? "now" : fmtTime(ago);
    d.children[1].textContent = e.m;
    box.appendChild(d);
  });
}

/* ================= 12. TASK CONFIRM POPUP ================= */
/* Before committing crews, show exactly what 12 hours of it buys. */

function openTaskPop(skillId, actionId) {
  const def = findAction(skillId, actionId);
  if (!def) return;
  pendingTask = { skillId, actionId };

  const time = actionTime(def);
  const per12 = Math.floor(IDLE_CAP_MS / time);

  el("taskPopArt").innerHTML = icon(def.icon, "ico-lg");
  el("taskPopTitle").textContent = titleCase(def.name);
  el("taskPopSub").textContent = `${skillName(skillId)} · ${(time / 1000).toFixed(0)}s an action`;

  const stats = el("taskPopStats");
  stats.innerHTML = "";
  const row = (l, v) => {
    const r = document.createElement("div");
    r.className = "pop-stat";
    r.innerHTML = '<div class="l"></div><div class="v"></div>';
    r.children[0].textContent = l;
    r.children[1].textContent = v;
    stats.appendChild(r);
  };

  // Materials cap the run before the clock does, quite often.
  let capped = per12;
  if (def.cost) {
    Object.keys(def.cost).forEach((k) => {
      capped = Math.min(capped, Math.floor(haveQty(k) / def.cost[k]));
    });
  }

  row("Actions in 12 hours", fmt(per12));
  if (def.cost && capped < per12) row("Your stock covers", fmt(capped) + " actions");
  row("Experience", fmt(Math.round(per12 * def.xp * xpMult(skillId))) + " XP");

  if (def.out) {
    Object.keys(def.out).forEach((k) => {
      const dbl = GATHER_ACTIONS[skillId] ? (1 + doubleChance(skillId)) : 1;
      row(itemName(k), "~" + fmt(Math.round(per12 * def.out[k] * dbl)));
    });
  }
  if (def.craftGear) row(GEAR[def.craftGear].name, fmt(per12));
  if (def.reagentId) row(itemName(def.reagentId), "~" + fmt(Math.round(per12 * def.reagentChance)));
  if (def.cost) {
    Object.keys(def.cost).forEach((k) => {
      row("Consumes " + itemName(k), `${fmt(def.cost[k] * Math.min(per12, capped))} (have ${fmt(haveQty(k))})`);
    });
  }

  el("taskPop").hidden = false;
}

function closeTaskPop() {
  el("taskPop").hidden = true;
  pendingTask = null;
}

/* ================= 13. CLASS PICKER ================= */

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
    [`${c.health} health`, `${c.attack} attack`, `${c.defence} defence`,
     `${(c.speed / 1000).toFixed(1)}s swing`, `${Math.round(c.crit * 100)}% crit`]
      .forEach((txt) => { const s = document.createElement("span"); s.textContent = txt; st.appendChild(s); });
    card.querySelector(".cc-veil").textContent = `Veil — ${c.veilName}: ${c.veilNote}`;
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

/* ================= 14. FORECAST (Sky) ================= */

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

/* ================= 15. REQUISITIONS ================= */

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
      row.children[1].textContent = `${fmt(r.qty)} × ${itemName(r.itemKey)} — returns at reset`;
      pend.appendChild(row);
    });
  }

  const roster = el("agentRoster");
  roster.innerHTML = "";
  const hire = el("hireAgentBtn");
  hire.textContent = `Hire an Agent · ${fmt(AGENT_HIRE_COST)}g`;
  hire.disabled = state.player.gold < AGENT_HIRE_COST || state.agents.length >= AGENT_ROSTER_MAX;

  if (!state.agents.length) {
    roster.innerHTML = '<div class="muted tiny">No Agents on the books. Hiring is a gamble — rarity is rolled.</div>';
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

/* ================= 16. SETTINGS & ACCOUNT ================= */

function refreshAccountUi() {
  const a = state.meta.account;
  const cloud = !!sb;

  el("acctStatus").textContent = !cloud ? "Cloud not configured." : a ? `Signed in as ${a}.` : "Not signed in.";
  el("acctFields").hidden = !!a;
  el("acctCreate").hidden = !!a;
  el("acctLogin").hidden = !!a;
  el("acctLogout").hidden = !a;
  el("nameField").value = state.meta.name || "Commander";
}

/* ================= 17. WIRING & BOOT ================= */

el("brandMark").innerHTML = `<img class="mark-img" src="assets/respite-logo.webp" alt="Respite">`;
el("coinIcon").innerHTML = icon("coin", "ico-sm");
el("skMasteryIcon").innerHTML = icon("info", "ico-sm");

window.addEventListener("hashchange", () => {
  route = parseHash();
  closeItemPopup();
  render();
});

document.querySelectorAll(".icon-btn").forEach((b) => {
  b.onclick = () => go(b.dataset.page);
});

document.querySelectorAll(".pill-head").forEach((b) => {
  b.onclick = () => toggleNav(b.dataset.nav);
});

// The Pack / Bank and Camp Stores / Bank tabs.
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

// Unclaimed spoils: the row's key is looked up at click time, so new loot
// landing mid-click can't shift which lot you take.
el("skSpoilsBody").addEventListener("click", (e) => {
  const row = e.target.closest(".spoil-row");
  if (!row) return;
  const idx = state.spoils.findIndex((s) => s.key === row.dataset.key);
  if (idx < 0) return;
  if (e.target.closest(".sp-take")) claimSpoil(idx);
  else if (e.target.closest(".sp-sell")) sellSpoil(idx);
  else if (e.target.closest(".sp-open")) openItemPopup(row.dataset.key, "view");
});

el("spoilsClaimAll").onclick = claimAllSpoils;
el("spoilsSellAll").onclick = sellAllSpoils;
el("spoilsTag").onclick = () => go("skill", "warfare");

// Trades stop the moment you ask — crews down tools immediately.
el("tbTradesClear").onclick = () => {
  if (!state.tasks.skilling) return;
  state.tasks.skilling = null;
  render();
};

// You can't walk out mid-swing — combat disengages after the current fight.
el("tbFieldClear").onclick = () => {
  const t = state.tasks.combat;
  if (!t) return;
  t.queued = t.queued === "stop" ? null : "stop";
  toast(t.queued ? "Pulling back after this fight" : "Pull-back cancelled");
  render();
};

// Item popup.
el("ipClose").onclick = closeItemPopup;
el("itemModal").addEventListener("click", (e) => { if (e.target === el("itemModal")) closeItemPopup(); });

el("taskPopGo").onclick = () => {
  if (pendingTask) selectSkillAction(pendingTask.skillId, pendingTask.actionId);
  closeTaskPop();
};
el("taskPopCancel").onclick = closeTaskPop;
el("taskPop").onclick = (e) => { if (e.target === el("taskPop")) closeTaskPop(); };
el("classPop").onclick = (e) => { if (e.target === el("classPop")) el("classPop").hidden = true; };
el("hireAgentBtn").onclick = hireAgent;

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!el("itemModal").hidden) closeItemPopup();
  else if (!el("taskPop").hidden) closeTaskPop();
  else if (!el("settingsModal").hidden) el("settingsModal").hidden = true;
});

el("settingsBtn").onclick = () => {
  refreshAccountUi();
  el("settingsModal").hidden = false;
};

el("settingsClose").onclick = () => {
  el("settingsModal").hidden = true;
};

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
};

el("nameSave").onclick = async () => {
  const v = (el("nameField").value || "").trim().slice(0, 18);
  if (v) {
    state.meta.name = v;
    await save();
    toast("Name set");
    render();
  }
};

el("saveBtn").onclick = async () => {
  toast((await save()) ? "Saved" : "Save failed");
};

el("wipeBtn").onclick = async () => {
  if (!confirm("Reset character completely?")) return;
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

setInterval(() => {
  if (route.page === "skill") renderYieldFeed();
}, 2000);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    resetTickClock();
    render();
  }
});

setInterval(save, 10000);
window.addEventListener("beforeunload", save);
