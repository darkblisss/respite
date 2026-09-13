/* ============================================================
   Sleeping Forest — Idle
   A menu-driven incremental RPG. No canvas, no engine, no build step.
   ============================================================ */

/* ---------------- 1. ITEMS ---------------- */

const ITEMS = {
  // logs
  log:         { name: "Log",          icon: "\u{1FAB5}", value: 4 },
  oak_log:     { name: "Oak log",      icon: "\u{1FAB5}", value: 12 },
  willow_log:  { name: "Willow log",   icon: "\u{1FAB5}", value: 26 },
  ash:         { name: "Ash",          icon: "\u{2728}",  value: 2 },

  // ores + bars
  copper_ore:  { name: "Copper ore",   icon: "\u{1FAA8}", value: 5 },
  iron_ore:    { name: "Iron ore",     icon: "\u{1FAA8}", value: 14 },
  coal:        { name: "Coal",         icon: "\u{26AB}",  value: 20 },
  bronze_bar:  { name: "Bronze bar",   icon: "\u{1F7EB}", value: 26 },
  iron_bar:    { name: "Iron bar",     icon: "\u{2B1C}",  value: 60 },
  steel_bar:   { name: "Steel bar",    icon: "\u{1F535}", value: 130 },

  // fish
  raw_shrimp:  { name: "Raw shrimp",   icon: "\u{1F990}", value: 3 },
  raw_trout:   { name: "Raw trout",    icon: "\u{1F41F}", value: 10 },
  raw_salmon:  { name: "Raw salmon",   icon: "\u{1F41F}", value: 22 },
  shrimp:      { name: "Shrimp",       icon: "\u{1F35B}", value: 6,  heal: 4 },
  trout:       { name: "Trout",        icon: "\u{1F35B}", value: 20, heal: 9 },
  salmon:      { name: "Salmon",       icon: "\u{1F35B}", value: 44, heal: 16 },

  // combat drops
  bones:       { name: "Bones",        icon: "\u{1F9B4}", value: 4 },
  pelt:        { name: "Wolf pelt",    icon: "\u{1F43A}", value: 30 },
  troll_tooth: { name: "Troll tooth",  icon: "\u{1F9B7}", value: 120 },

  // equipment
  bronze_sword: { name: "Bronze sword", icon: "\u{1F5E1}", value: 90,  slot: "weapon", attack: 4 },
  iron_sword:   { name: "Iron sword",   icon: "\u{1F5E1}", value: 220, slot: "weapon", attack: 9 },
  steel_sword:  { name: "Steel sword",  icon: "\u{1F5E1}", value: 520, slot: "weapon", attack: 17 },
  bronze_armour:{ name: "Bronze armour",icon: "\u{1F6E1}", value: 120, slot: "armour", defence: 4 },
  iron_armour:  { name: "Iron armour",  icon: "\u{1F6E1}", value: 300, slot: "armour", defence: 9 },
  steel_armour: { name: "Steel armour", icon: "\u{1F6E1}", value: 700, slot: "armour", defence: 17 },
};

/* ---------------- 2. SKILLS + ACTIONS ---------------- */

const SKILLS = [
  { id: "woodcutting", name: "Woodcutting", icon: "\u{1FA93}", note: "Cut trees for logs. Logs burn for Firemaking xp." },
  { id: "mining",      name: "Mining",      icon: "\u{26CF}",  note: "Swing for ore. Ore becomes bars, bars become weapons." },
  { id: "fishing",     name: "Fishing",     icon: "\u{1F3A3}", note: "Catch raw fish. Cook them before you fight anything." },
  { id: "firemaking",  name: "Firemaking",  icon: "\u{1F525}", note: "Burns logs for fast xp. The ash sells for almost nothing." },
  { id: "cooking",     name: "Cooking",     icon: "\u{1F373}", note: "Turns raw fish into food. Food is eaten automatically in combat." },
  { id: "smithing",    name: "Smithing",    icon: "\u{1F528}", note: "Smelt ore into bars, then hammer bars into gear." },
  { id: "combat",      name: "Combat",      icon: "\u{2694}",  note: "Pick a target and the fight runs itself. You eat when you get low." },
];

const ACTIONS = {
  woodcutting: [
    { id: "wc_normal", name: "Forest tree", icon: "\u{1F333}", level: 1,  time: 6000, xp: 10, out: { log: 1 } },
    { id: "wc_oak",    name: "Oak",         icon: "\u{1F333}", level: 15, time: 8000, xp: 25, out: { oak_log: 1 } },
    { id: "wc_willow", name: "Willow",      icon: "\u{1F332}", level: 30, time: 10000, xp: 48, out: { willow_log: 1 } },
  ],
  mining: [
    { id: "mi_copper", name: "Copper vein", icon: "\u{1F7E4}", level: 1,  time: 6000, xp: 10, out: { copper_ore: 1 } },
    { id: "mi_iron",   name: "Iron vein",   icon: "\u{26AA}",  level: 15, time: 8000, xp: 26, out: { iron_ore: 1 } },
    { id: "mi_coal",   name: "Coal seam",   icon: "\u{26AB}",  level: 30, time: 10000, xp: 45, out: { coal: 1 } },
  ],
  fishing: [
    { id: "fi_shrimp", name: "Shrimp pool", icon: "\u{1F990}", level: 1,  time: 6000, xp: 10, out: { raw_shrimp: 1 } },
    { id: "fi_trout",  name: "River bend",  icon: "\u{1F41F}", level: 15, time: 9000, xp: 30, out: { raw_trout: 1 } },
    { id: "fi_salmon", name: "Deep water",  icon: "\u{1F420}", level: 30, time: 12000, xp: 52, out: { raw_salmon: 1 } },
  ],
  firemaking: [
    { id: "fm_log",    name: "Burn log",        icon: "\u{1F525}", level: 1,  time: 4000, xp: 20, cost: { log: 1 },        out: { ash: 1 } },
    { id: "fm_oak",    name: "Burn oak log",    icon: "\u{1F525}", level: 15, time: 5000, xp: 48, cost: { oak_log: 1 },    out: { ash: 1 } },
    { id: "fm_willow", name: "Burn willow log", icon: "\u{1F525}", level: 30, time: 6000, xp: 85, cost: { willow_log: 1 }, out: { ash: 2 } },
  ],
  cooking: [
    { id: "ck_shrimp", name: "Cook shrimp", icon: "\u{1F35B}", level: 1,  time: 4000, xp: 12, cost: { raw_shrimp: 1 }, out: { shrimp: 1 } },
    { id: "ck_trout",  name: "Cook trout",  icon: "\u{1F35B}", level: 15, time: 5000, xp: 32, cost: { raw_trout: 1 },  out: { trout: 1 } },
    { id: "ck_salmon", name: "Cook salmon", icon: "\u{1F35B}", level: 30, time: 6000, xp: 55, cost: { raw_salmon: 1 }, out: { salmon: 1 } },
  ],
  smithing: [
    { id: "sm_bronze_bar", name: "Bronze bar",   icon: "\u{1F7EB}", level: 1,  time: 6000, xp: 15, cost: { copper_ore: 2 },            out: { bronze_bar: 1 } },
    { id: "sm_bronze_sw",  name: "Bronze sword", icon: "\u{1F5E1}", level: 5,  time: 8000, xp: 30, cost: { bronze_bar: 2 },            out: { bronze_sword: 1 } },
    { id: "sm_bronze_ar",  name: "Bronze armour",icon: "\u{1F6E1}", level: 8,  time: 9000, xp: 40, cost: { bronze_bar: 3 },            out: { bronze_armour: 1 } },
    { id: "sm_iron_bar",   name: "Iron bar",     icon: "\u{2B1C}",  level: 15, time: 7000, xp: 35, cost: { iron_ore: 1, coal: 1 },     out: { iron_bar: 1 } },
    { id: "sm_iron_sw",    name: "Iron sword",   icon: "\u{1F5E1}", level: 20, time: 10000, xp: 70, cost: { iron_bar: 2 },              out: { iron_sword: 1 } },
    { id: "sm_iron_ar",    name: "Iron armour",  icon: "\u{1F6E1}", level: 23, time: 11000, xp: 90, cost: { iron_bar: 3 },              out: { iron_armour: 1 } },
    { id: "sm_steel_bar",  name: "Steel bar",    icon: "\u{1F535}", level: 30, time: 8000, xp: 60, cost: { iron_ore: 1, coal: 2 },     out: { steel_bar: 1 } },
    { id: "sm_steel_sw",   name: "Steel sword",  icon: "\u{1F5E1}", level: 35, time: 12000, xp: 130, cost: { steel_bar: 2 },            out: { steel_sword: 1 } },
    { id: "sm_steel_ar",   name: "Steel armour", icon: "\u{1F6E1}", level: 38, time: 13000, xp: 160, cost: { steel_bar: 3 },            out: { steel_armour: 1 } },
  ],
  combat: [
    { id: "mo_rat",    name: "Sewer rat",   icon: "\u{1F400}", level: 1,  hp: 10,  attack: 3,  defence: 0,  speed: 3000, xp: 12,  gold: [1, 3],     drops: [["bones", 1, 1.0]] },
    { id: "mo_goblin", name: "Goblin",      icon: "\u{1F47A}", level: 5,  hp: 26,  attack: 7,  defence: 2,  speed: 2800, xp: 30,  gold: [3, 10],    drops: [["bones", 1, 1.0], ["copper_ore", 2, 0.4]] },
    { id: "mo_wolf",   name: "Grey wolf",   icon: "\u{1F43A}", level: 15, hp: 60,  attack: 14, defence: 6,  speed: 2400, xp: 70,  gold: [8, 22],    drops: [["bones", 1, 1.0], ["pelt", 1, 0.35]] },
    { id: "mo_bandit", name: "Bandit",      icon: "\u{1F977}", level: 28, hp: 130, attack: 26, defence: 14, speed: 2600, xp: 150, gold: [25, 60],   drops: [["iron_ore", 2, 0.5], ["coal", 1, 0.3]] },
    { id: "mo_troll",  name: "Forest troll",icon: "\u{1F9CC}", level: 42, hp: 300, attack: 44, defence: 26, speed: 3200, xp: 340, gold: [70, 160],  drops: [["willow_log", 2, 0.6], ["troll_tooth", 1, 0.2]] },
  ],
};

/* ---------------- 3. LEVELS ---------------- */

const MAX_LEVEL = 99;
const XP_TABLE = (() => {
  // Gentle polynomial curve instead of an exponential one, so totals stay
  // small (level 99 needs ~62k total xp, not millions) even after long play.
  const table = [0, 0];
  for (let lvl = 2; lvl <= MAX_LEVEL; lvl++) {
    table[lvl] = Math.floor(50 * Math.pow(lvl, 1.55));
  }
  return table;
})();

function levelFromXp(xp) {
  let lvl = 1;
  while (lvl < MAX_LEVEL && xp >= XP_TABLE[lvl + 1]) lvl++;
  return lvl;
}

/* ---------------- 4. STATE ---------------- */

const SAVE_KEY = "respite_save_v1";
const CATCHUP_CAP_MS = 24 * 60 * 60 * 1000; // 24 hours — bounds the silent catch-up loop
const BANK_CAP = 999; // materials never stack past this; overflow auto-sells for gold

let state = freshState();

function freshState() {
  const skills = {};
  SKILLS.forEach((s) => { skills[s.id] = 0; });
  return {
    version: 1,
    lastSeen: Date.now(),
    gold: 0,
    hp: 10,
    skills,                 // skillId -> xp
    bank: {},               // itemId -> qty
    equipment: { weapon: null, armour: null },
    current: null,          // { skill, actionId }
    progress: 0,            // ms into the current action
    combat: { mobHp: 0, mobMax: 0, playerTimer: 0, mobTimer: 0, respawn: 0 },
    unlocked: { woodcutting: true, mining: true, fishing: true, firemaking: false, cooking: false, smithing: false, combat: false },
    log: [],
  };
}

let view = "woodcutting"; // which skill tab is on screen

/* ---------------- 5. HELPERS ---------------- */

function skillLevel(id) { return levelFromXp(state.skills[id] || 0); }
function totalLevel() { return SKILLS.reduce((n, s) => n + skillLevel(s.id), 0); }
function bankQty(id) { return state.bank[id] || 0; }

function addItem(id, qty) {
  let total = bankQty(id) + qty;
  if (total > BANK_CAP) {
    const overflow = total - BANK_CAP;
    state.gold += overflow * (ITEMS[id].value || 0); // auto-sold quietly, no popup
    total = BANK_CAP;
  }
  if (total > 0) state.bank[id] = total;
  else delete state.bank[id];
}

function removeItem(id, qty) {
  const left = bankQty(id) - qty;
  if (left > 0) state.bank[id] = left;
  else delete state.bank[id];
}

function canAfford(cost) {
  if (!cost) return true;
  return Object.keys(cost).every((id) => bankQty(id) >= cost[id]);
}

function payCost(cost) {
  if (!cost) return;
  Object.keys(cost).forEach((id) => removeItem(id, cost[id]));
}

function maxHp() { return 10 + skillLevel("combat") * 3; }

function attackPower() {
  const w = state.equipment.weapon;
  return 3 + skillLevel("combat") * 1.4 + (w ? ITEMS[w].attack : 0);
}

function defencePower() {
  const a = state.equipment.armour;
  return skillLevel("combat") * 0.7 + (a ? ITEMS[a].defence : 0);
}

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function fmt(n) {
  n = Math.floor(n);
  if (n < 10000) return n.toLocaleString();
  if (n < 1e6) return (n / 1e3).toFixed(1) + "K";
  if (n < 1e9) return (n / 1e6).toFixed(2) + "M";
  return (n / 1e9).toFixed(2) + "B";
}

function say(msg) {
  state.log.push(msg);
  if (state.log.length > 40) state.log.shift();
}

function getAction(skillId, actionId) {
  return (ACTIONS[skillId] || []).find((a) => a.id === actionId) || null;
}

/* ---------------- 6. PROGRESSION ---------------- */

function grantXp(skillId, amount) {
  const before = skillLevel(skillId);
  state.skills[skillId] = (state.skills[skillId] || 0) + amount;
  const after = skillLevel(skillId);
  if (after > before) {
    say(`${skillName(skillId)} level ${after}.`);
    if (skillId === "combat") state.hp = maxHp();
  }
}

function skillName(id) {
  const s = SKILLS.find((x) => x.id === id);
  return s ? s.name : id;
}

function checkUnlocks() {
  const u = state.unlocked;
  const has = (ids) => ids.some((id) => bankQty(id) > 0);

  if (!u.firemaking && has(["log", "oak_log", "willow_log"])) {
    u.firemaking = true; say("Firemaking unlocked. Logs burn well.");
  }
  if (!u.cooking && has(["raw_shrimp", "raw_trout", "raw_salmon"])) {
    u.cooking = true; say("Cooking unlocked. Raw fish is not food yet.");
  }
  if (!u.smithing && has(["copper_ore", "iron_ore", "coal"])) {
    u.smithing = true; say("Smithing unlocked. Ore wants a furnace.");
  }
  if (!u.combat && totalLevel() >= 9) {
    u.combat = true; say("Combat unlocked. Something is moving in the trees.");
  }
}

/* ---------------- 7. THE TICK ---------------- */

function tick(dt) {
  if (!state.current) return;
  if (state.current.skill === "combat") combatTick(dt);
  else gatherTick(dt);
}

function gatherTick(dt) {
  const def = getAction(state.current.skill, state.current.actionId);
  if (!def) { state.current = null; return; }

  if (!canAfford(def.cost)) {
    say(`Stopped ${def.name.toLowerCase()} — out of materials.`);
    state.current = null;
    state.progress = 0;
    return;
  }

  state.progress += dt;

  while (state.progress >= def.time) {
    state.progress -= def.time;
    if (!canAfford(def.cost)) {
      say(`Stopped ${def.name.toLowerCase()} — out of materials.`);
      state.current = null;
      state.progress = 0;
      return;
    }
    payCost(def.cost);
    Object.keys(def.out).forEach((id) => addItem(id, def.out[id]));
    grantXp(state.current.skill, def.xp);
    checkUnlocks();
  }
}

function bestFood() {
  let pick = null;
  Object.keys(state.bank).forEach((id) => {
    const item = ITEMS[id];
    if (item && item.heal && (!pick || item.heal > ITEMS[pick].heal)) pick = id;
  });
  return pick;
}

function combatTick(dt) {
  const mob = getAction("combat", state.current.actionId);
  if (!mob) { state.current = null; return; }
  const c = state.combat;

  if (c.respawn > 0) {
    c.respawn -= dt;
    if (c.respawn <= 0) {
      c.mobMax = mob.hp;
      c.mobHp = mob.hp;
      c.mobTimer = mob.speed;
      c.playerTimer = 2400;
    }
    return;
  }

  if (c.mobHp <= 0) { c.respawn = 1200; return; }

  // player swings
  c.playerTimer -= dt;
  if (c.playerTimer <= 0) {
    c.playerTimer += 2400;
    const atk = attackPower();
    let dmg = randInt(Math.max(1, Math.floor(atk * 0.4)), Math.ceil(atk));
    dmg = Math.max(1, Math.round(dmg - mob.defence * 0.3));
    c.mobHp -= dmg;
    if (c.mobHp <= 0) { killMob(mob); return; }
  }

  // monster swings
  c.mobTimer -= dt;
  if (c.mobTimer <= 0) {
    c.mobTimer += mob.speed;
    let dmg = randInt(Math.max(1, Math.floor(mob.attack * 0.5)), mob.attack);
    dmg = Math.max(1, Math.round(dmg - defencePower() * 0.35));
    state.hp -= dmg;

    if (state.hp <= maxHp() * 0.45) {
      const food = bestFood();
      if (food) {
        removeItem(food, 1);
        state.hp = Math.min(maxHp(), state.hp + ITEMS[food].heal);
      }
    }

    if (state.hp <= 0) {
      state.hp = maxHp();
      state.current = null;
      c.mobHp = 0;
      say(`The ${mob.name.toLowerCase()} knocked you out. Nothing lost — bring food.`);
    }
  }
}

function killMob(mob) {
  const c = state.combat;
  grantXp("combat", mob.xp);
  state.gold += randInt(mob.gold[0], mob.gold[1]);
  mob.drops.forEach(([id, qty, chance]) => {
    if (Math.random() < chance) addItem(id, qty);
  });
  checkUnlocks();
  c.respawn = 1200;
}

/* ---------------- 8. SAVE / LOAD / OFFLINE ---------------- */

function save() {
  state.lastSeen = Date.now();
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    document.getElementById("saveNote").textContent =
      "Saving is blocked on file:// in this browser. Run the folder with a local server to keep progress.";
    return false;
  }
}

function load() {
  let raw = null;
  try { raw = localStorage.getItem(SAVE_KEY); } catch (e) { raw = null; }
  if (!raw) return null;

  let loaded;
  try { loaded = JSON.parse(raw); } catch (e) { return null; }

  const base = freshState();
  state = Object.assign(base, loaded);
  state.skills = Object.assign(base.skills, loaded.skills || {});
  state.unlocked = Object.assign(base.unlocked, loaded.unlocked || {});
  state.equipment = Object.assign(base.equipment, loaded.equipment || {});
  state.combat = Object.assign(base.combat, loaded.combat || {});

  const away = Math.min(Date.now() - (loaded.lastSeen || Date.now()), CATCHUP_CAP_MS);
  return away > 30000 ? away : null;
}

// Quietly fast-forwards whatever action was running when the tab closed.
// No modal, no gains list — the game is meant to feel like it never stopped.
function catchUpSilently(ms) {
  const step = 250;
  let left = ms;
  while (left > 0 && state.current) {
    tick(Math.min(step, left));
    left -= step;
  }
  if (ms > 5 * 60 * 1000) {
    say("Time passed quietly while you were away.");
  }
}

/* ---------------- 9. PLAYER ACTIONS ---------------- */

function selectAction(skillId, actionId) {
  const def = getAction(skillId, actionId);
  if (!def) return;
  if (skillLevel(skillId) < def.level) return;

  if (state.current && state.current.skill === skillId && state.current.actionId === actionId) {
    state.current = null;          // click again to stop
    state.progress = 0;
    render();
    return;
  }

  state.current = { skill: skillId, actionId: actionId };
  state.progress = 0;

  if (skillId === "combat") {
    state.combat = { mobHp: def.hp, mobMax: def.hp, playerTimer: 2400, mobTimer: def.speed, respawn: 0 };
    state.hp = maxHp();
  }
  render();
}

function equip(itemId) {
  const item = ITEMS[itemId];
  if (!item || !item.slot) return;
  const old = state.equipment[item.slot];
  if (old) addItem(old, 1);
  removeItem(itemId, 1);
  state.equipment[item.slot] = itemId;
  render();
}

function unequip(slot) {
  const id = state.equipment[slot];
  if (!id) return;
  addItem(id, 1);
  state.equipment[slot] = null;
  render();
}

function sell(itemId, all) {
  const qty = all ? bankQty(itemId) : 1;
  if (qty <= 0) return;
  state.gold += ITEMS[itemId].value * qty;
  removeItem(itemId, qty);
  render();
}

/* ---------------- 10. RENDER ---------------- */

const el = (id) => document.getElementById(id);

// DOM is only rebuilt when its contents actually change. Rebuilding every
// tick would swallow clicks, because the button would be replaced between
// mousedown and mouseup.
let navKey = "";
let stageKey = "";
let bankKey = "";
let logKey = "";
let stageRefs = [];

function render() {
  navKey = stageKey = bankKey = logKey = "";
  renderVitals();
  renderNav();
  renderStage();
  renderEquip();
  renderBank();
  renderLog();
}

function renderVitals() {
  el("goldText").textContent = fmt(state.gold);
  el("totalLevelText").textContent = totalLevel();
  const pct = Math.max(0, Math.min(100, (state.hp / maxHp()) * 100));
  el("hpFill").style.width = pct + "%";
  el("hpText").textContent = `${Math.max(0, Math.ceil(state.hp))} / ${maxHp()}`;
}

function renderNav() {
  const key = SKILLS.map((s) => `${s.id}:${state.unlocked[s.id] ? 1 : 0}:${skillLevel(s.id)}`).join(",") +
    "|" + view + "|" + (state.current ? state.current.skill : "-");
  if (key === navKey) return;
  navKey = key;

  const nav = el("skillNav");
  nav.innerHTML = "";
  SKILLS.forEach((s) => {
    if (!state.unlocked[s.id]) return;
    const b = document.createElement("button");
    b.className = "navbtn" + (view === s.id ? " on" : "") +
      (state.current && state.current.skill === s.id ? " busy" : "");
    b.innerHTML =
      `<span class="navbtn-icon"></span><span class="navbtn-name"></span><span class="navbtn-lvl"></span>`;
    b.children[0].textContent = s.icon;
    b.children[1].textContent = s.name;
    b.children[2].textContent = skillLevel(s.id);
    b.onclick = () => { view = s.id; render(); };
    nav.appendChild(b);
  });
}

function renderStage() {
  const skill = SKILLS.find((s) => s.id === view);
  const lvl = skillLevel(view);
  const xp = state.skills[view] || 0;
  const base = XP_TABLE[lvl];
  const next = XP_TABLE[Math.min(lvl + 1, MAX_LEVEL)];
  const pct = lvl >= MAX_LEVEL ? 100 : ((xp - base) / (next - base)) * 100;

  el("stageTitle").textContent = skill.name;
  el("stageNote").textContent = skill.note;
  el("stageLevel").textContent = "Level " + lvl;
  el("stageXpFill").style.width = Math.max(0, Math.min(100, pct)) + "%";
  el("stageXpText").textContent = `${fmt(xp)} / ${fmt(next)} xp`;

  const key = `${view}|${lvl}|${state.current ? state.current.skill + state.current.actionId : "-"}`;
  if (key === stageKey) { updateStage(); return; }
  stageKey = key;
  stageRefs = [];

  const list = el("actionList");
  list.innerHTML = "";

  ACTIONS[view].forEach((def) => {
    const locked = lvl < def.level;
    const active = state.current && state.current.skill === view && state.current.actionId === def.id;

    const card = document.createElement("button");
    card.className = "card" + (locked ? " locked" : "") + (active ? " on" : "");
    card.disabled = locked;

    const top = document.createElement("div");
    top.className = "card-top";
    const icon = document.createElement("span");
    icon.className = "card-icon";
    icon.textContent = def.icon;
    const name = document.createElement("span");
    name.className = "card-name";
    name.textContent = def.name;
    top.appendChild(icon);
    top.appendChild(name);
    card.appendChild(top);

    const meta = document.createElement("div");
    meta.className = "card-meta";
    if (view === "combat") {
      meta.textContent = locked
        ? `Needs combat level ${def.level}`
        : `${def.hp} hp \u00B7 ${def.attack} attack \u00B7 ${fmt(def.xp)} xp`;
    } else {
      meta.textContent = locked
        ? `Needs level ${def.level}`
        : `${(def.time / 1000).toFixed(1)}s \u00B7 ${fmt(def.xp)} xp`;
    }
    card.appendChild(meta);

    let costEl = null;
    if (def.cost) {
      costEl = document.createElement("div");
      costEl.className = "card-cost";
      card.appendChild(costEl);
    }

    let hpFill = null;
    if (view === "combat" && active) {
      const bar = document.createElement("div");
      bar.className = "card-hp";
      hpFill = document.createElement("div");
      hpFill.className = "card-hp-fill";
      bar.appendChild(hpFill);
      card.appendChild(bar);
    }

    const prog = document.createElement("div");
    prog.className = "card-prog";
    card.appendChild(prog);

    card.onclick = () => selectAction(view, def.id);
    list.appendChild(card);

    stageRefs.push({ def: def, active: active, costEl: costEl, hpFill: hpFill, prog: prog });
  });

  updateStage();
}

// Cheap per-tick pass: only touches text and bar widths, never rebuilds nodes.
function updateStage() {
  stageRefs.forEach((ref) => {
    const def = ref.def;

    if (ref.costEl) {
      ref.costEl.innerHTML = "";
      ref.costEl.appendChild(document.createTextNode("Uses "));
      Object.keys(def.cost).forEach((id, i) => {
        const span = document.createElement("span");
        if (bankQty(id) < def.cost[id]) span.className = "short";
        span.textContent = `${i ? ", " : ""}${def.cost[id]} ${ITEMS[id].name} (${fmt(bankQty(id))})`;
        ref.costEl.appendChild(span);
      });
    }

    if (ref.hpFill) {
      const hpPct = state.combat.mobMax ? (state.combat.mobHp / state.combat.mobMax) * 100 : 0;
      ref.hpFill.style.width = Math.max(0, Math.min(100, hpPct)) + "%";
    }

    if (ref.active && view !== "combat") {
      ref.prog.style.width = Math.min(100, (state.progress / def.time) * 100) + "%";
    } else if (ref.active && view === "combat") {
      const c = state.combat;
      const swing = c.respawn > 0 ? 0 : (1 - c.playerTimer / 2400) * 100;
      ref.prog.style.width = Math.max(0, Math.min(100, swing)) + "%";
    } else {
      ref.prog.style.width = "0";
    }
  });
}

function renderEquip() {
  const box = el("equipList");
  box.innerHTML = "";
  ["weapon", "armour"].forEach((slot) => {
    const id = state.equipment[slot];
    const row = document.createElement("div");
    row.className = "equip-row";

    const slotLabel = document.createElement("span");
    slotLabel.className = "equip-slot";
    slotLabel.textContent = slot === "weapon" ? "Weapon" : "Armour";

    const name = document.createElement("span");
    name.className = "equip-name";
    name.textContent = id ? `${ITEMS[id].icon} ${ITEMS[id].name}` : "Empty";
    if (!id) name.classList.add("muted");

    row.appendChild(slotLabel);
    row.appendChild(name);

    if (id) {
      const bonus = document.createElement("span");
      bonus.className = "equip-bonus";
      bonus.textContent = slot === "weapon" ? `+${ITEMS[id].attack}` : `+${ITEMS[id].defence}`;
      row.appendChild(bonus);

      const off = document.createElement("button");
      off.className = "minibtn";
      off.textContent = "Remove";
      off.onclick = () => unequip(slot);
      row.appendChild(off);
    }
    box.appendChild(row);
  });
}

function renderBank() {
  const box = el("bankList");
  const ids = Object.keys(state.bank).filter((id) => state.bank[id] > 0);

  const key = ids.map((id) => id + state.bank[id]).join(",");
  if (key === bankKey) return;
  bankKey = key;

  el("bankCount").textContent = ids.length ? `${ids.length} kinds` : "";
  box.innerHTML = "";

  if (ids.length === 0) {
    box.innerHTML = '<div class="bank-empty">Empty. Start an action and things will pile up here.</div>';
    return;
  }

  ids.sort((a, b) => ITEMS[a].name.localeCompare(ITEMS[b].name));

  ids.forEach((id) => {
    const item = ITEMS[id];
    const row = document.createElement("div");
    row.className = "bank-row";

    const icon = document.createElement("span");
    icon.className = "bank-icon";
    icon.textContent = item.icon;

    const name = document.createElement("span");
    name.className = "bank-name";
    name.textContent = item.name;

    const qty = document.createElement("span");
    qty.className = "bank-qty";
    qty.textContent = fmt(state.bank[id]);

    row.appendChild(icon);
    row.appendChild(name);
    row.appendChild(qty);

    if (item.slot) {
      const eq = document.createElement("button");
      eq.className = "minibtn";
      eq.textContent = "Equip";
      eq.onclick = () => equip(id);
      row.appendChild(eq);
    }

    const sellBtn = document.createElement("button");
    sellBtn.className = "minibtn";
    sellBtn.textContent = `Sell ${fmt(item.value)}g`;
    sellBtn.title = "Click to sell one, shift-click to sell all";
    sellBtn.onclick = (e) => sell(id, e.shiftKey);
    row.appendChild(sellBtn);

    box.appendChild(row);
  });
}

function renderLog() {
  const key = state.log.length + "|" + (state.log[state.log.length - 1] || "");
  if (key === logKey) return;
  logKey = key;

  const box = el("eventLog");
  box.innerHTML = "";
  state.log.slice(-8).forEach((line) => {
    const d = document.createElement("div");
    d.textContent = line;
    box.appendChild(d);
  });
}

/* ---------------- 11. BOOT ---------------- */

el("saveBtn").onclick = () => {
  if (save()) el("saveNote").textContent = "Saved at " + new Date().toLocaleTimeString() + ".";
};

el("wipeBtn").onclick = () => {
  if (!confirm("Delete your save and start over?")) return;
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
  location.reload();
};

const away = load();
if (away) catchUpSilently(away);
if (!state.unlocked[view]) view = "woodcutting";
if (state.log.length === 0) say("You wake under a black pine. The forest is quiet and full of wood.");

render();

let last = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(now - last, 5000);
  last = now;
  tick(dt);
  renderVitals();
  renderNav();
  renderStage();
  renderBank();
  renderLog();
}, 100);

setInterval(save, 15000);
window.addEventListener("beforeunload", save);
