/* ============================================================
   Respite — engine.js · The Brains
   ------------------------------------------------------------
   The save (state), the tick loop, and everything that changes
   what the player has: storage, gathering and crafting, weather,
   bounties, requisitions, the shop, travel and equipment.
   ============================================================ */

/* ================= 1. STATE ================= */

function freshState() {
  const skills = {};
  SKILLS.forEach((s) => { skills[s.id] = 0; });
  const equipment = {};
  EQUIP_SLOTS.forEach((s) => { equipment[s] = null; });

  return {
    schema: SCHEMA,
    meta: { createdAt: Date.now(), lastSeen: Date.now(), playtimeMs: 0, account: null, userId: null, name: "Commander" },
    player: { gold: 0, hp: 20, recoveryUntil: 0, klass: null },
    skills,
    inv:   { slots: PACK_SLOTS,   items: {}, order: [] },
    bank:  { slots: STORES_SLOTS, items: {}, order: [] },
    vault: { slots: BANK_SLOTS,   items: {}, order: [] },
    spoils: [],
    uid: 1,
    equipment,
    tools: {},
    wear: {},
    tasks: { skilling: null, combat: null },
    region: "region_1",
    travel: { unlocked: ["region_1"] },
    pets: { golem: false, sprite: false, mule: false },
    threat: {},
    agents: [],        // hired requisition agents
    requisitions: [],  // deployments awaiting the daily reset
    reqDay: 0,
    bounty: null,
    buff: null,
    smugglerBought: {},
    yields: [],
    stats: { kills: 0, actions: 0, deaths: 0, crafted: 0, epics: 0, goldEarned: 0 },
    log: [],
  };
}

let state = freshState();

/* ================= 2. CORE ================= */

function skillLevel(id) {
  return levelFromXp(state.skills[id] || 0);
}

function totalLevel() {
  return SKILLS.reduce((n, s) => n + skillLevel(s.id), 0);
}

function currentRegion() {
  return regionById(state.region);
}

function recovering() {
  return state.player.recoveryUntil > Date.now();
}

function say(msg) {
  state.log.push({ t: Date.now(), m: msg });
  if (state.log.length > 60) state.log.shift();
}

function logYield(text) {
  state.yields.push({ t: Date.now(), m: text });
  if (state.yields.length > 12) state.yields.shift();
}

function addGold(n) {
  state.player.gold += n;
  state.stats.goldEarned += n;
}

/* ================= 3. STORAGE ================= */
/* Three pools: "inv" is the Pack, "bank" is Camp Stores, "vault" is the Bank. */

function store(w) {
  return w === "vault" ? state.vault : w === "bank" ? state.bank : state.inv;
}

function packSlots() {
  return PACK_SLOTS + (state.pets.mule ? 8 : 0);
}

function slotCap(w) {
  return w === "vault" ? state.vault.slots : w === "bank" ? state.bank.slots : packSlots();
}

function qtyIn(w, k) {
  return store(w).items[k] || 0;
}

function haveQty(k) {
  return qtyIn("inv", k) + qtyIn("bank", k) + qtyIn("vault", k);
}

function slotsUsed(w) {
  return Object.keys(store(w).items).length;
}

function storeFull(w) {
  return slotsUsed(w) >= slotCap(w);
}

function addTo(w, key, qty) {
  const s = store(w);
  if (!s.items[key] && storeFull(w)) return false;
  s.items[key] = (s.items[key] || 0) + qty;
  if (!s.order.includes(key)) s.order.push(key);
  return true;
}

function removeFrom(w, key, qty) {
  const s = store(w);
  const left = (s.items[key] || 0) - qty;
  if (left > 0) {
    s.items[key] = left;
  } else {
    delete s.items[key];
    s.order = s.order.filter((k) => k !== key);
  }
}

function deposit(key, qty) {
  return addTo("bank", key, qty) || addTo("vault", key, qty) || addTo("inv", key, qty);
}

function spend(key, qty) {
  let left = qty;
  ["bank", "vault", "inv"].forEach((w) => {
    if (left <= 0) return;
    const take = Math.min(left, qtyIn(w, key));
    if (take) {
      removeFrom(w, key, take);
      left -= take;
    }
  });
}

function canAfford(cost) {
  return !cost || Object.keys(cost).every((k) => haveQty(k) >= cost[k]);
}

function payCost(cost) {
  if (cost) Object.keys(cost).forEach((k) => spend(k, cost[k]));
}

function orderedKeys(w) {
  const s = store(w);
  const have = Object.keys(s.items);
  const out = s.order.filter((k) => have.includes(k));
  have.forEach((k) => {
    if (!out.includes(k)) out.push(k);
  });
  return out;
}

// Common gear stacks. Uncommon and above gets a unique instance id.
// Key shapes are described in data.js, section 8.
function makeKey(base, rarity, prefix) {
  if (!rarity) return base;
  if (rarity === "common") return `${base}|common`;
  const uid = state.uid++;
  if (rarity === "relic") return `${base}|relic|${uid}|${prefix || rollPrefix(base)}`;
  return `${base}|${rarity}|${uid}`;
}

/* ================= 4. WEATHER ================= */
/* Deterministic from the UTC day number, so the sky is the same for
   everyone. Weeks start on Sunday: that is when the next seven days are
   revealed. Tables and the effect formula live in data.js, section 11. */

const dayIndex = () => Math.floor(Date.now() / DAY_MS);

// 0 = Sunday … 6 = Saturday. Day 0 of the epoch (1 Jan 1970) was a Thursday.
const weekdayOf = (dayNum) => (((dayNum + 4) % 7) + 7) % 7;

// Day number of the Sunday that opens the week containing dayNum.
const weekStartOf = (dayNum) => dayNum - weekdayOf(dayNum);

const isBountiful = (dayNum) => BOUNTIFUL_WEEKDAYS.includes(weekdayOf(dayNum));

// Gathering and artisan skills. Combat is not a trade.
const isTrade = (skillId) => GATHER_SKILLS.some((s) => s.id === skillId) || PROFESSIONS.some((p) => p.id === skillId);

// Effect = 5% + (roll - 1) × 1.67%, rounded to a whole percent.
function weatherEffect(roll) {
  return Math.round(WEATHER_EFFECT_BASE + (roll - 1) * WEATHER_EFFECT_STEP);
}

function weatherForDay(dayNum) {
  const type = WEATHER_TYPES[Math.floor(seedFrom(dayNum * 12.9898 + 78.233) * WEATHER_TYPES.length)];
  const roll = 1 + Math.floor(seedFrom(dayNum * 39.3468 + 11.1351) * 10);   // 1-10, never shown
  const effect = weatherEffect(roll);
  const severity = WEATHER_SEVERITIES.find((s) => effect >= s.min && effect <= s.max) || WEATHER_SEVERITIES[0];

  return {
    day: dayNum, id: type.id, name: type.name, icon: type.icon,
    effect, severity: severity.name, label: `${severity.name} ${type.name}`,
    favoured: type.favoured, hindered: type.hindered,
    mods: { [type.favoured]: effect, [type.hindered]: -effect },   // whole percent XP
    bountiful: isBountiful(dayNum),
  };
}

function weatherOn(dayOffset) { return weatherForDay(dayIndex() + (dayOffset || 0)); }
const currentWeather = () => weatherOn(0);

// The week revealed last Sunday at 00:00 UTC, Sunday through Saturday.
function weekForecast() {
  const today = dayIndex();
  const start = weekStartOf(today);
  const out = [];
  for (let i = 0; i < 7; i++) {
    const day = start + i;
    out.push({ day, weekday: i, today: day === today, past: day < today, w: weatherForDay(day) });
  }
  return out;
}

// Saturday's tomorrow belongs to next week, which isn't revealed yet.
function tomorrowRevealed() {
  const today = dayIndex();
  return weekStartOf(today + 1) === weekStartOf(today);
}

function weatherXpMult(skillId) {
  const pct = currentWeather().mods[skillId];
  return pct ? 1 + pct / 100 : 1;
}

function bountifulXpMult(skillId) {
  return isBountiful(dayIndex()) && isTrade(skillId) ? 1 + BOUNTIFUL_XP : 1;
}

/* ================= 5. MASTERY, TOOLS & SPEED ================= */

function mastery(skillId) {
  // Gathering only — artisan benches get nothing from this.
  if (!GATHER_ACTIONS[skillId]) return { double: 0 };
  const lvl = skillLevel(skillId);
  let dbl = 0;
  MASTERY_TRACK.forEach((m) => { if (lvl >= m.level) dbl += m.double; });
  return { double: dbl };
}

function toolFor(skillId) {
  const id = state.tools && state.tools[skillId];
  return id ? TOOLS[id] : null;
}

// Speed comes from tools and the golem only. Weather is XP, mastery is yield.
function speedMod(skillId) {
  let m = 1;
  const tool = toolFor(skillId);
  if (tool) m *= (1 - tool.speed);
  if (state.pets && state.pets.golem && GATHER_SKILLS.some((s) => s.id === skillId)) m *= 0.9;
  return Math.max(0.35, m);
}

function actionTime(def) {
  return Math.max(1000, Math.round(def.time * speedMod(def.skillId)));
}

function doubleChance(skillId) {
  let c = mastery(skillId).double;
  if (state.pets && state.pets.golem && GATHER_SKILLS.some((s) => s.id === skillId)) c += 0.1;
  return Math.min(0.75, c);
}

/* ================= 6. PROGRESSION ================= */

function xpMult(skillId) {
  let m = skillId ? weatherXpMult(skillId) * bountifulXpMult(skillId) : 1;
  if (state.buff && state.buff.until > Date.now()) m *= state.buff.mult;
  return m;
}

function grantXp(skillId, amount) {
  const gain = Math.max(1, Math.round(amount * xpMult(skillId)));
  const before = skillLevel(skillId);
  state.skills[skillId] = (state.skills[skillId] || 0) + gain;
  const after = skillLevel(skillId);

  if (after > before) {
    say(`${skillName(skillId)} reaches level ${after}.`);
    if (skillId === "warfare" && canPickClass()) setTimeout(maybeOfferClass, 60);
    if (skillId === "warfare") state.player.hp = maxHp();
    const hit = GATHER_ACTIONS[skillId] ? MASTERY_TRACK.find((m) => m.level === after) : null;
    if (hit) toast(`${skillName(skillId)} ${after} — ${hit.label}`);
    else if (after % 10 === 0) toast(`${skillName(skillId)} — level ${after}`);
  }
}

/* ================= 7. TICK ================= */

function tick(dt) {
  resolveRequisitions();
  if (state.tasks.skilling) skillTick(dt);
  if (state.tasks.combat) combatTick(dt);
  if (state.buff && state.buff.until <= Date.now()) state.buff = null;
}

function skillTick(dt) {
  const task = state.tasks.skilling;
  const def = findAction(task.skillId, task.actionId);
  if (!def) {
    state.tasks.skilling = null;
    return;
  }

  const time = actionTime(def);
  task.progress += dt;
  let guard = 0;

  while (task.progress >= time && guard++ < 200000) {
    if (!canAfford(def.cost)) {
      say(`Work stopped — no materials left for ${def.name.toLowerCase()}.`);
      toast("Out of materials");
      state.tasks.skilling = null;
      return;
    }

    if (storeFull("bank") && storeFull("inv")) {
      say("Work stopped — camp stores and pack are both full.");
      toast("Nowhere to put anything");
      state.tasks.skilling = null;
      return;
    }

    task.progress -= time;
    payCost(def.cost);
    produce(def);
    grantXp(task.skillId, def.xp);
    task.done++;
    state.stats.actions++;
    bountyProgress("gather", def);

    if (task.queued) {
      const q = task.queued;
      if (q === "stop") {
        state.tasks.skilling = null;
        return;
      }
      state.tasks.skilling = newSkillTask(q.skillId, q.actionId);
      say(`Crews moved to ${findAction(q.skillId, q.actionId).name.toLowerCase()}.`);
      return;
    }
  }
}

function produce(def) {
  if (def.out) {
    Object.keys(def.out).forEach((k) => {
      let qty = def.out[k];
      if (GATHER_ACTIONS[def.skillId] && Math.random() < doubleChance(def.skillId)) {
        qty *= 2;
      }

      let deposited = false;
      const d = itemDef(k);

      if (d && d.kind === "tool") {
        deposited = addTo("bank", k, qty) || addTo("vault", k, qty) || addTo("inv", k, qty);
      } else {
        deposited = deposit(k, qty);
      }

      if (deposited) {
        logYield(`+${qty} ${itemName(k)}`);
      } else {
        say(`Nowhere to put ${itemName(k)}.`);
      }
    });

    if (def.reagentId && Math.random() < def.reagentChance) {
      if (deposit(def.reagentId, 1)) {
        logYield(`+1 ${itemName(def.reagentId)}`);
      }
    }
  }

  if (def.craftGear) {
    const rarity = rollRarity();
    const key = makeKey(def.craftGear, rarity);
    const d = itemDef(key);

    // Weapons/gear prefer inventory -> bank -> vault. Tools prefer bank.
    let deposited = false;
    if (d && d.kind === "gear") {
      deposited = addTo("inv", key, 1) || addTo("bank", key, 1) || addTo("vault", key, 1);
    } else if (d && d.kind === "tool") {
      deposited = addTo("bank", key, 1) || addTo("vault", key, 1) || addTo("inv", key, 1);
    } else {
      deposited = deposit(key, 1);
    }

    if (deposited) {
      state.stats.crafted++;
      logYield(`+1 ${itemName(key)}`);
      bountyProgress("craft", def);

      // Only genuinely rare outcomes are worth a log line; the rest toast.
      if (rarity === "relic" || rarity === "legendary") {
        state.stats.epics++;
        say(`${itemName(key)} comes off the bench.`);
        toast(`${rarityDef(rarity).name}: ${itemName(key)}`);
      } else if (rarity === "epic") {
        state.stats.epics++;
        toast(`Epic: ${itemName(key)}`);
      } else if (rarity !== "common") {
        toast(`${rarityDef(rarity).name}: ${itemName(key)}`);
      }
    } else {
      say(`Nowhere to put the ${GEAR[def.craftGear].name.toLowerCase()}.`);
    }
  }
}

/* ================= 8. TASKS ================= */

function newSkillTask(skillId, actionId) {
  return { skillId, actionId, progress: 0, done: 0, startedAt: Date.now(), queued: null };
}

function selectSkillAction(skillId, actionId) {
  const def = findAction(skillId, actionId);
  if (!def || skillLevel(skillId) < def.level) return;
  const t = state.tasks.skilling;
  if (!t) {
    state.tasks.skilling = newSkillTask(skillId, actionId);
    render();
    return;
  }

  if (t.skillId === skillId && t.actionId === actionId) {
    state.tasks.skilling = null;          // clicking the live action stops it, now
  } else {
    state.tasks.skilling = newSkillTask(skillId, actionId);   // instant switch
  }
  render();
}

function skillPlan() {
  const t = state.tasks.skilling;
  if (!t) return null;
  const def = findAction(t.skillId, t.actionId);
  if (!def) return null;

  const time = actionTime(def);
  const windowLeft = Math.max(0, IDLE_CAP_MS - (Date.now() - t.startedAt));
  let remaining = Math.floor(windowLeft / time);
  let capped = null;

  if (def.cost) {
    let byMats = Infinity;
    Object.keys(def.cost).forEach((k) => {
      byMats = Math.min(byMats, Math.floor(haveQty(k) / def.cost[k]));
    });
    if (byMats < remaining) {
      remaining = byMats;
      capped = true;
    }
  }
  return { def, time, done: t.done, target: t.done + remaining, timeLeft: remaining * time - t.progress, capped, pct: clamp((t.progress / time) * 100, 0, 100) };
}

/* ================= 9. BOUNTY ================= */

function currentWindow() {
  return Math.floor(Date.now() / WINDOW_MS);
}

function windowEndsIn() {
  return WINDOW_MS - (Date.now() % WINDOW_MS);
}

function makeBounty() {
  const w = currentWindow();
  const region = currentRegion();
  const t = TIERS[region.tier - 1];
  const roll = seedFrom(w * 3.31 + region.tier);

  if (roll < 0.45) {
    const mob = monsterOfTier(region.tier);
    const amount = 10 + Math.floor(seedFrom(w * 5.5) * 15);
    return { window: w, region: region.id, kind: "slay", targetTier: region.tier, label: `Put down ${amount} of whatever holds ${region.name}`, amount, progress: 0, claimed: false, gold: Math.round(mob.gold[1] * amount * 0.8) };
  }

  const skill = GATHER_SKILLS[Math.floor(seedFrom(w * 9.13 + region.tier) * GATHER_SKILLS.length)];
  const amount = 20 + Math.floor(seedFrom(w * 2.7) * 30);
  return { window: w, region: region.id, kind: "gather", targetId: matId(t, skill.mat), label: `Bring in ${amount} ${titleCase(t[skill.mat])}`, amount, progress: 0, claimed: false, gold: Math.round(MATERIALS[matId(t, skill.mat)].value * amount * 1.5) };
}

function refreshBounty() {
  const w = currentWindow();
  if (!state.bounty || state.bounty.window !== w || state.bounty.region !== state.region) {
    state.bounty = makeBounty();
  }
}

function bountyProgress(kind, thing) {
  const b = state.bounty;
  if (!b || b.claimed || b.kind !== kind) return;
  if (kind === "slay" && thing.tier === b.targetTier) b.progress++;
  if (kind === "gather" && thing.out && thing.out[b.targetId]) b.progress += thing.out[b.targetId];
  if (b.progress >= b.amount && !b.claimed) toast("Bounty complete");
}

function claimBounty() {
  const b = state.bounty;
  if (!b || b.claimed || b.progress < b.amount) return;
  b.claimed = true;
  addGold(b.gold);
  state.buff = { until: Date.now() + 60 * 60 * 1000, mult: 2 };
  say(`Bounty paid: ${fmt(b.gold)} gold.`);
  toast("Double experience for one hour");
  render();
}

/* ================= 10. REQUISITIONS ================= */

function hireAgent() {
  if (state.player.gold < AGENT_HIRE_COST) { say(`Hiring costs ${fmt(AGENT_HIRE_COST)} gold.`); render(); return; }
  if (state.agents.length >= AGENT_ROSTER_MAX) { say("The roster is full."); render(); return; }
  state.player.gold -= AGENT_HIRE_COST;
  const rarity = rollAgentRarity();
  const used = state.agents.map((a) => a.name);
  const pool = AGENT_NAMES.filter((n) => !used.includes(n));
  const name = pool.length ? pool[randInt(0, pool.length - 1)] : AGENT_NAMES[randInt(0, AGENT_NAMES.length - 1)];
  state.agents.push({ id: "agent_" + (state.uid++), name, rarity });
  say(`${name} signs on — ${agentRarityDef(rarity).name}.`);
  toast(`Agent hired: ${name}`);
  render();
}

// A requisition is a promise for tomorrow, not an instant reward.
function deployAgent(agentId, itemKey) {
  const agent = state.agents.find((a) => a.id === agentId);
  if (!agent) return;
  if (state.requisitions.filter((r) => !r.resolved).length >= REQUISITIONS_PER_DAY) {
    say(`Only ${REQUISITIONS_PER_DAY} deployments a day.`); render(); return;
  }
  if (state.requisitions.some((r) => !r.resolved && r.agentId === agentId)) {
    say(`${agent.name} is already out.`); render(); return;
  }
  const qty = Math.max(1, Math.round(12 * agentRarityDef(agent.rarity).mult));
  state.requisitions.push({ agentId, agentName: agent.name, itemKey, qty, day: dayIndex(), resolved: false });
  say(`${agent.name} sets out for ${itemName(itemKey)}.`);
  render();
}

// Runs on load and on tick when the world day rolls over.
function resolveRequisitions() {
  if (state.reqDay === dayIndex()) return;
  const pending = state.requisitions.filter((r) => !r.resolved);
  if (pending.length) {
    const lines = [];
    pending.forEach((r) => {
      r.resolved = true;
      if (deposit(r.itemKey, r.qty)) lines.push(`${fmt(r.qty)} ${itemName(r.itemKey)}`);
      else lines.push(`${itemName(r.itemKey)} (no room)`);
    });
    say(`Requisitions returned: ${lines.join(", ")}.`);
    toast("Requisitions returned");
  }
  state.requisitions = [];
  state.reqDay = dayIndex();
}

function requisitionTargets() {
  // Anything you've actually seen is fair game to ask an agent for.
  const out = [];
  REAGENTS.forEach((r) => out.push(r.id));
  TIERS.forEach((t) => {
    GATHER_SKILLS.forEach((s) => {
      if (t.level <= skillLevel(s.id)) out.push(matId(t, s.mat));
    });
  });
  return out;
}

/* ================= 11. SHOP, PETS & TRAVEL ================= */

function shopStock() {
  return RATIONS.map((r) => ({ key: r.id, price: Math.round(r.value * 1.6) }));
}

function smugglerStock() {
  const w = currentWindow();
  const picks = [];
  const pool = Object.keys(MATERIALS).filter((k) => MATERIALS[k].tier && !MATERIALS[k].heal && k !== "vault_chest");
  for (let i = 0; i < 3; i++) {
    const key = pool[Math.floor(seedFrom(w * (i + 2) * 1.77) * pool.length)];
    const qty = 5 + Math.floor(seedFrom(w * (i + 3) * 4.2) * 20);
    picks.push({ key, qty, price: Math.round(MATERIALS[key].value * qty * 2.4), slot: i });
  }
  return picks;
}

function buyShop(key, price, qty) {
  if (state.player.gold < price) {
    say("Not enough gold.");
    render();
    return;
  }
  if (!addTo("inv", key, qty) && !addTo("bank", key, qty)) {
    say("Nowhere to put it.");
    render();
    return;
  }
  state.player.gold -= price;
  say(`Bought ${qty} ${itemName(key).toLowerCase()}.`);
  render();
}

function buySmuggler(entry) {
  const tag = `${currentWindow()}_${entry.slot}`;
  if (state.smugglerBought[tag]) return;
  if (state.player.gold < entry.price) {
    say("The smuggler doesn't haggle.");
    render();
    return;
  }
  if (!deposit(entry.key, entry.qty)) {
    say("Nowhere to put it.");
    render();
    return;
  }
  state.player.gold -= entry.price;
  state.smugglerBought[tag] = true;
  say(`Bought ${entry.qty} ${itemName(entry.key)}.`);
  render();
}

function buyPet(id) {
  const pet = PETS.find((p) => p.id === id);
  if (!pet || state.pets[id]) return;
  if (state.player.gold < pet.cost) {
    say("Not enough gold.");
    render();
    return;
  }
  state.player.gold -= pet.cost;
  state.pets[id] = true;
  say(`${pet.name} joins.`);
  toast(`${pet.name} acquired`);
  render();
}

function travelTo(regionId) {
  const r = regionById(regionId);
  if (!state.travel.unlocked.includes(regionId)) {
    if (state.player.gold < r.toll) {
      say(`Need ${fmt(r.toll)} gold.`);
      render();
      return;
    }
    state.player.gold -= r.toll;
    state.travel.unlocked.push(regionId);
    say(`Road to ${r.name} open.`);
    toast(`${r.name} unlocked`);
  }
  state.region = regionId;
  refreshBounty();
  render();
}

/* ================= 12. ITEMS & EQUIPMENT ================= */
/* `from` is the pool an item sits in: "inv", "bank" or "vault".
   Every action returns true when it went through and calls render(),
   which also refreshes or closes the item popup. */

// Puts an item somewhere: the preferred pool first, then Pack, Stores, Bank.
// Returns the pool it landed in, or null if everything is full.
function stow(key, preferred) {
  const order = [preferred, "inv", "bank", "vault"].filter((w, i, all) => w && all.indexOf(w) === i);
  return order.find((w) => addTo(w, key, 1)) || null;
}

function refuse(msg) {
  say(msg);
  toast(msg);
  render();
  return false;
}

function equipItem(key, from) {
  const d = itemDef(key);
  if (!d || qtyIn(from, key) <= 0) return false;

  // Tools go in the tool rack, one per gathering skill.
  if (d.kind === "tool") {
    const old = state.tools[d.forSkill];
    removeFrom(from, key, 1);
    if (old && !stow(old, from)) {
      addTo(from, key, 1);
      return refuse("Nowhere to stow the old tool.");
    }
    state.tools[d.forSkill] = d.base;
    say(`${itemName(key)} taken up.`);
    render();
    return true;
  }

  if (!d.slot) return false;

  if (d.slot === "offhand") {
    const w = state.equipment.weapon;
    if (w && itemDef(w).twoHanded) return refuse(`Hands are on the ${itemName(w)}.`);
  }

  // Whatever this replaces goes back where the new piece came from.
  const displaced = [state.equipment[d.slot]];
  if (d.slot === "weapon" && d.twoHanded) displaced.push(state.equipment.offhand);

  removeFrom(from, key, 1);
  const placed = [];
  for (const old of displaced.filter(Boolean)) {
    const where = stow(old, from);
    if (!where) {
      placed.forEach(([k, w]) => removeFrom(w, k, 1));
      addTo(from, key, 1);
      return refuse("No room to stow what you're wearing.");
    }
    placed.push([old, where]);
  }

  if (d.slot === "weapon" && d.twoHanded) state.equipment.offhand = null;
  state.equipment[d.slot] = key;
  render();
  return true;
}

// Worn gear comes off into the Pack first.
function unequip(slot) {
  const key = state.equipment[slot];
  if (!key) return false;
  if (!stow(key, "inv")) return refuse("Nowhere to put it.");
  state.equipment[slot] = null;
  render();
  return true;
}

// Tools go back to Camp Stores first, where the crews keep them.
function unequipTool(skillId) {
  const id = state.tools[skillId];
  if (!id) return false;
  if (!stow(id, "bank")) return refuse("Nowhere to put it.");
  delete state.tools[skillId];
  render();
  return true;
}

// Moves `qty` (default: the whole stack) between pools.
function moveItem(key, from, to, qty) {
  const have = qtyIn(from, key);
  const n = qty == null ? have : Math.min(have, qty);
  if (n <= 0 || from === to) return false;
  if (!store(to).items[key] && storeFull(to)) return refuse(`${STORE_NAMES[to]} is full.`);
  removeFrom(from, key, n);
  addTo(to, key, n);
  render();
  return true;
}

// Sells `qty` (default: the whole stack).
function sellItem(key, from, qty) {
  const have = qtyIn(from, key);
  const n = qty == null ? have : Math.min(have, qty);
  if (n <= 0) return false;
  addGold(itemDef(key).value * n);
  removeFrom(from, key, n);
  render();
  return true;
}

function useChest(key, from) {
  if (parseKey(key).base !== "vault_chest" || qtyIn(from, key) <= 0) return false;
  if (state.bank.slots >= BANK_MAX) return refuse("Stores are full depth.");
  removeFrom(from, key, 1);
  state.bank.slots = Math.min(BANK_MAX, state.bank.slots + MATERIALS.vault_chest.chest);
  say(`Stores widened to ${state.bank.slots} slots.`);
  render();
  return true;
}

function salvageValue(key) {
  const d = itemDef(key);
  if (!d || (d.kind !== "gear" && d.kind !== "tool")) return null;
  const matchProf = PROFESSIONS.find((p) => p.id === d.prof) || PROFESSIONS.find((p) => d.name.includes(p.name));
  if (!matchProf) return null;
  const ref = CRAFT_ACTIONS[d.prof]?.find((a) => a.craftGear === d.base || (a.out && a.out[d.base]));
  if (!ref || !ref.cost) return null;
  const mainKey = Object.keys(ref.cost)[0];
  return { mat: mainKey, qty: Math.max(1, Math.floor(ref.cost[mainKey] * 0.4)) };
}

function salvage(key, from) {
  const out = salvageValue(key);
  if (!out || qtyIn(from, key) <= 0) return false;
  removeFrom(from, key, 1);
  if (!deposit(out.mat, out.qty)) {
    addTo(from, key, 1);
    return refuse("No room for what it breaks down into.");
  }
  say(`Broke down ${itemName(key)} for ${out.qty} ${itemName(out.mat)}.`);
  render();
  return true;
}

/* ================= 13. THE LOOP ================= */

let lastTick = Date.now();
let loopTimer = null;

function loop() {
  const now = Date.now();
  const dt = now - lastTick;
  lastTick = now;

  if (dt > 0) {
    tick(Math.min(dt, 60000));
    state.meta.playtimeMs += Math.min(dt, 60000);
  }

  renderFrame();
}

function startLoop() {
  lastTick = Date.now();
  if (!loopTimer) loopTimer = setInterval(loop, 60);
}

// Called when the tab comes back into view.
function resetTickClock() {
  lastTick = Date.now();
}
