/* ============================================================
   Respite — combat.js · The Battlefield
   ------------------------------------------------------------
   Combat maths only: derived stats, class and relic effects, the
   Veil, spawns and threat, the fight tick, spoils, durability.
   ============================================================ */

/* ================= 1. STATS ================= */

function equipStat(stat) {
  let total = 0;
  EQUIP_SLOTS.forEach((slot) => {
    const key = state.equipment[slot];
    if (key && itemDef(key) && typeof itemDef(key)[stat] === "number") {
      total += itemDef(key)[stat];
    }
  });
  return total;
}

const myClass = () => classDef(state.player.klass);
const canPickClass = () => !state.player.klass && skillLevel("warfare") >= CLASS_PICK_LEVEL;

function classStat(field, fallback) {
  const c = myClass();
  return c ? c[field] : fallback;
}

function maxHp() {
  const base = classStat("health", 20);
  return Math.round(base + skillLevel("warfare") * 5 + equipStat("health"));
}

function attackPower() {
  const base = classStat("attack", 4);
  return base + skillLevel("warfare") * 1.6 + equipStat("attack");
}

function defencePower() {
  const base = classStat("defence", 1);
  return base * 0.5 + skillLevel("warfare") * 0.9 + equipStat("defence");
}

function swingSpeed() { return classStat("speed", PLAYER_SWING_MS); }
function critChance() { return classStat("crit", 0.05); }
function critDamage() { return classStat("critDmg", 1.5); }
function blockChance() { return classStat("block", 0.05) + (hasPrefix("stalwart") ? 0.08 : 0); }
function dodgeChance() { return classStat("dodge", 0.05); }
function defencePen() { return classStat("pen", 0.05) + (hasPrefix("sundering") ? 0.15 : 0); }

// Relic prefixes are read straight off worn gear.
function hasPrefix(id) {
  return EQUIP_SLOTS.some((s) => {
    const k = state.equipment[s];
    return k && parseKey(k).prefix === id;
  });
}

/* ================= 2. THREAT & SPAWNS ================= */

function threatIn(tier) { return (state.threat && state.threat[tier]) || 0; }

function rollSpawn(tier) {
  if (threatIn(tier) >= THREAT_CAP) return rankOf(tier, "boss");
  return rankOf(tier, Math.random() < 0.2 ? "elite" : "grunt");
}

/* ================= 3. TAKING THE FIELD ================= */

function newCombatTask(tier) {
  const mob = rollSpawn(tier);
  return { tier, monsterId: mob.id, mobHp: mob.hp, mobMax: mob.hp,
    playerTimer: swingSpeed(), mobTimer: mob.speed, respawn: 0, done: 0,
    startedAt: Date.now(), queued: null, veil: 0, streak: 0, bleed: 0, bleedTimer: 0 };
}

function engageRegion(tier) {
  if (recovering()) {
    say("You're still recovering.");
    render();
    return;
  }
  const t = state.tasks.combat;
  if (!t) {
    state.tasks.combat = newCombatTask(tier);
    state.player.hp = maxHp();
    render();
    return;
  }

  if (t.tier === tier) {
    t.queued = t.queued === "stop" ? null : "stop";
  } else {
    // INSTANT switch
    state.tasks.combat = newCombatTask(tier);
    state.player.hp = maxHp();
    say(`Moved to new ground in ${regionById(`region_${tier}`).name}.`);
  }
  render();
}

function combatPlan() {
  const t = state.tasks.combat;
  if (!t) return null;
  const mob = getMonster(t.monsterId);
  if (!mob) return null;

  const atk = attackPower();
  const avgHit = Math.max(1, (atk * 0.55 + atk) / 2 - mob.defence * 0.35);
  const killMs = (mob.hp / avgHit) * swingSpeed() + RESPAWN_MS;
  const windowLeft = Math.max(0, IDLE_CAP_MS - (Date.now() - t.startedAt));
  const remaining = Math.floor(windowLeft / killMs);
  const incoming = Math.max(1, (mob.attack * 0.55 + mob.attack) / 2 - defencePower() * 0.4);
  const food = bestFood();
  const foodNeed = food ? Math.ceil((incoming / mob.speed * windowLeft) / itemDef(food).heal) : null;

  return { mob, done: t.done, target: t.done + remaining, timeLeft: remaining * killMs, killMs, pct: t.respawn > 0 ? 0 : clamp((t.mobHp / t.mobMax) * 100, 0, 100), food, foodNeed, foodHave: food ? haveQty(food) : 0 };
}

function bestFood() {
  let pick = null;
  let best = 0;

  ["inv", "bank", "vault"].forEach((w) => {
    Object.keys(store(w).items).forEach((k) => {
      const d = itemDef(k);
      if (d && d.heal && d.heal > best) {
        best = d.heal;
        pick = k;
      }
    });
  });

  return pick;
}

/* ================= 4. THE FIGHT ================= */

function combatTick(dt) {
  const c = state.tasks.combat;
  const mob = getMonster(c.monsterId);

  if (!mob) {
    state.tasks.combat = null;
    return;
  }

  if (c.respawn > 0) {
    c.respawn -= dt;
    if (c.respawn <= 0) {
      if (c.queued === "stop") {
        state.tasks.combat = null;
        return;
      }
      if (c.queued) {
        state.tasks.combat = newCombatTask(c.queued);
        return;
      }

      const next = rollSpawn(c.tier);
      c.monsterId = next.id;
      c.mobHp = next.hp;
      c.mobMax = next.hp;
      c.mobTimer = next.speed;
      c.playerTimer = swingSpeed();

      if (next.rank === "boss") {
        say(`${next.name} comes up out of the dark.`);
        toast(`Sovereign: ${next.name}`);
      }
    }
    return;
  }

  // ---- your swing ----
  c.playerTimer -= dt;
  if (c.playerTimer <= 0) {
    c.playerTimer += swingSpeed();
    let dmg = rollPlayerHit(mob, false);

    // Echoing relics sometimes land a second blow.
    if (hasPrefix("echoing") && Math.random() < 0.12) dmg += rollPlayerHit(mob, false);

    // Furious relics build up over a streak of uninterrupted hits.
    if (hasPrefix("furious")) {
      c.streak = (c.streak || 0) + 1;
      dmg = Math.round(dmg * (1 + Math.min(0.25, c.streak * 0.03)));
    }
    // Executioner's leans on wounded targets.
    if (hasPrefix("executioner") && c.mobHp / c.mobMax < 0.3) dmg = Math.round(dmg * 1.3);
    // Wounding leaves something behind.
    if (hasPrefix("wounding") && Math.random() < 0.2) c.bleed = (c.bleed || 0) + Math.max(1, Math.round(dmg * 0.15));

    c.veil = Math.min(VEIL_MAX, (c.veil || 0) + VEIL_PER_HIT);

    // Veil full — spend it on the class technique.
    if (c.veil >= VEIL_MAX) {
      c.veil = 0;
      dmg += veilTechnique(mob);
    }

    c.mobHp -= dmg;
    if (c.mobHp <= 0) { killMob(mob); return; }
  }

  // ---- bleed ticks ----
  if (c.bleed) {
    c.bleedTimer = (c.bleedTimer || 0) + dt;
    if (c.bleedTimer >= 1000) {
      c.bleedTimer = 0;
      c.mobHp -= c.bleed;
      c.bleed = Math.max(0, c.bleed - 1);
      if (c.mobHp <= 0) { killMob(mob); return; }
    }
  }

  // ---- its swing ----
  c.mobTimer -= dt;
  if (c.mobTimer <= 0) {
    c.mobTimer += mob.speed;

    if (Math.random() < dodgeChance()) {
      c.streak = c.streak || 0;
    } else {
      let dmg = randInt(Math.max(1, Math.floor(mob.attack * 0.55)), mob.attack);
      dmg = Math.max(1, Math.round(dmg - defencePower() * 0.4));
      if (Math.random() < blockChance()) dmg = Math.round(dmg * 0.5);
      if (hasPrefix("resilient") && state.player.hp < maxHp() * 0.35) dmg = Math.round(dmg * 0.8);
      state.player.hp -= dmg;
      if (hasPrefix("thorned")) c.mobHp -= Math.max(1, Math.round(dmg * 0.15));
      if (hasPrefix("furious")) c.streak = 0;

      if (c.mobHp <= 0) { killMob(mob); return; }
    }

    if (state.player.hp <= maxHp() * 0.45) {
      const food = bestFood();
      if (food) {
        spend(food, 1);
        const heal = itemDef(food).heal * (hasPrefix("vital") ? 1.2 : 1);
        state.player.hp = Math.min(maxHp(), state.player.hp + heal);
      }
    }

    if (state.player.hp <= 0) die(mob);
  }
}

// One basic hit, with crit and Defence penetration folded in.
function rollPlayerHit(mob, guaranteedCrit) {
  const atk = attackPower();
  let dmg = randInt(Math.max(1, Math.floor(atk * 0.55)), Math.ceil(atk));
  const effDef = mob.defence * (1 - defencePen());
  dmg = Math.max(1, Math.round(dmg - effDef * 0.35));
  if (guaranteedCrit || Math.random() < critChance()) dmg = Math.round(dmg * critDamage());
  return dmg;
}

// Class-specific payoff when the Veil fills.
function veilTechnique(mob) {
  const klass = state.player.klass;
  if (klass === "warrior") {
    const atk = attackPower();
    const dmg = Math.round(randInt(Math.floor(atk * 0.8), Math.ceil(atk * 1.4)) - mob.defence * 0.17);
    return Math.max(1, dmg);
  }
  if (klass === "rogue") {
    return rollPlayerHit(mob, true) + rollPlayerHit(mob, true);
  }
  if (klass === "mage") {
    return Math.max(1, Math.round(attackPower() * 2.2 - mob.defence * 0.1));
  }
  return rollPlayerHit(mob, false);
}

function die(mob) {
  state.player.hp = maxHp();
  state.tasks.combat = null;
  state.stats.deaths++;
  state.player.recoveryUntil = Date.now() + RECOVERY_MS;

  EQUIP_SLOTS.forEach((slot) => {
    const key = state.equipment[slot];
    if (key && itemDef(key).maxDur) damageItem(key, DEATH_WEAR);
  });

  say(`The ${mob.name.toLowerCase()} put you down. Recovering for five minutes.`);
  toast("You fell.");
}

function killMob(mob) {
  const c = state.tasks.combat;
  grantXp("warfare", mob.xp);
  addGold(randInt(mob.gold[0], mob.gold[1]));
  state.stats.kills++;
  c.done++;
  bountyProgress("slay", mob);

  mob.drops.forEach(([k, qty, chance]) => {
    if (Math.random() < chance) addSpoil(k, qty);
  });

  if (mob.rank === "boss") {
    state.threat[mob.tier] = 0;
    state.stats.bosses = (state.stats.bosses || 0) + 1;
    const pool = Object.values(GEAR).filter((g) => g.tier === mob.tier);
    const key = makeKey(pool[randInt(0, pool.length - 1)].id, "epic");
    addSpoil(key, 1);
    state.stats.epics++;
    say(`${mob.name} is down.`);
    toast(`Sovereign felled · ${itemName(key)}`);
  } else {
    state.threat[mob.tier] = Math.min(THREAT_CAP, threatIn(mob.tier) + 1);
    if (threatIn(mob.tier) === THREAT_CAP) {
      say("Something bigger has noticed you.");
      toast("Threat at boiling point");
    }
  }
  applyWear();
  c.respawn = RESPAWN_MS;
}

/* ================= 5. SPOILS ================= */
/* Battlefield loot waits on the field, outside your pack, until claimed. */

function addSpoil(key, qty) {
  const existing = stacks(key) ? state.spoils.find((s) => s.key === key) : null;
  if (existing) {
    existing.qty += qty;
    existing.t = Date.now();
  } else {
    state.spoils.push({ key, qty, t: Date.now() });
    if (state.spoils.length > SPOILS_CAP) {
      state.spoils.shift();
    }
  }
  logYield(`+${qty} ${itemName(key)} (spoils)`);
}

function claimSpoil(index) {
  const s = state.spoils[index];
  if (!s) return;
  const target = state.pets.sprite ? "bank" : "inv";
  if (!addTo(target, s.key, s.qty) && !addTo("inv", s.key, s.qty) && !addTo("vault", s.key, s.qty)) {
    say("Nowhere to put it.");
    toast("Nowhere to put it");
    render();
    return;
  }
  state.spoils.splice(index, 1);
  render();
}

function claimAllSpoils() {
  let stuck = 0;
  for (let i = state.spoils.length - 1; i >= 0; i--) {
    const s = state.spoils[i];
    const target = state.pets.sprite ? "bank" : "inv";
    if (addTo(target, s.key, s.qty) || addTo("inv", s.key, s.qty) || addTo("vault", s.key, s.qty)) {
      state.spoils.splice(i, 1);
    } else {
      stuck++;
    }
  }
  if (stuck) {
    say(`${stuck} lot${stuck > 1 ? "s" : ""} left on the field.`);
    toast("Not everything fit");
  }
  render();
}

function sellSpoil(index) {
  const s = state.spoils[index];
  if (!s) return;
  addGold(itemDef(s.key).value * s.qty);
  state.spoils.splice(index, 1);
  render();
}

function sellAllSpoils() {
  if (!state.spoils.length) return;
  state.spoils.forEach((s) => addGold(itemDef(s.key).value * s.qty));
  state.spoils = [];
  toast("Spoils sold");
  render();
}

/* ================= 6. DURABILITY ================= */

function wearPct(key) {
  const d = itemDef(key);
  if (!d || !d.maxDur) return null;
  return clamp(Math.round((1 - (state.wear[key] || 0) / d.maxDur) * 100), 0, 100);
}

function applyWear() {
  const w = state.equipment.weapon;
  if (w && itemDef(w).maxDur) damageItem(w, 1);
  const armour = EQUIP_SLOTS.filter((s) => !["weapon", "ring", "neck"].includes(s)).map((s) => state.equipment[s]).filter((k) => k && itemDef(k).maxDur);
  if (armour.length) damageItem(armour[randInt(0, armour.length - 1)], 1);
}

function damageItem(key, amount) {
  const d = itemDef(key);
  state.wear[key] = (state.wear[key] || 0) + amount;
  if (state.wear[key] >= d.maxDur) {
    state.equipment[d.slot] = null;
    state.wear[key] = 0;
    say(`${itemName(key)} broke.`);
    toast(`${itemName(key)} broke`);
  }
}

function repairCost(key) {
  const d = itemDef(key), dmg = state.wear[key] || 0;
  if (!d.maxDur || dmg <= 0) return null;
  return { mat: d.repairMat, qty: Math.max(1, Math.ceil(dmg / 80)) };
}

function repairItem(key) {
  const cost = repairCost(key);
  if (!cost) return;
  if (haveQty(cost.mat) < cost.qty) {
    say(`Need ${cost.qty} ${itemName(cost.mat)}.`);
    toast(`Need ${cost.qty} ${itemName(cost.mat)}`);
    render();
    return;
  }
  spend(cost.mat, cost.qty);
  state.wear[key] = 0;
  say(`Patched up ${itemName(key)}.`);
  render();
}
