/* ============================================================
   Respite · pages/hunt.js · The Field
   ------------------------------------------------------------
   #/skill/warfare. The hunt as it happens: your commander and up
   to three foes, every blow floating off whoever took it, what
   the fight is doing and its numbers. Under it the four zones of
   the region you stand in (each opens the zone popup, where a hunt
   is taken up) and the quarry that lives there.

   Built once, then updated in place about ten times a second.
   Foe cards are keyed by hunt and uid: reinforcements slide in,
   the fallen fade out. Blows arrive as hunt:fx events while the
   store plays a frame; they are queued and drawn after the cards
   have caught up, the way v4 drained its combatFx.
   ============================================================ */

import { h, on, setAttr, setText, setWidth, toggleClass } from "../ui/dom.js";
import { iconEl } from "../ui/icons.js";
import { fmt, fmtWhole, fmtTime } from "../ui/format.js";
import { openPopup } from "../ui/widgets.js";
import { monsterArt } from "../ui/popups/foe.js";
import { huntChips, chipNode, partyHere, ZONE_ICONS } from "../ui/popups/zone.js";
import { CONFIG } from "../../shared/config.js";
import { GameData, getMonster, getZone, getSkill, foesOf, sovereignOf, regionOfTier } from "../../shared/registry.js";
import { campPlan, threatIn } from "../../shared/combat.js";
import { statsOf, canPickClass, recovering, myClass, xpProgress } from "../../shared/stats.js";
import { currentRegion } from "../../shared/world.js";

const H = CONFIG.hunt;
const IDLE_CAP = CONFIG.time.idleCapMs;

const FLOAT_MS = 1000;
const FLOATS_MAX = 12;          // on screen at once, across the whole arena
const FLOATS_PER_FRAME = 8;     // a long frame (a slow device, a burst) shows only its last few blows
const FX_STALE_MS = 1500;       // simulated age past which a blow is not worth drawing
const FX_QUEUE_MAX = 60;
const GONE_MS = 700;            // the fade in pages.css, then the card goes
const DEAD_MS = 1400;

// What floats up for each kind of blow. Kinds with no text (kill, spawn, leave, fall) only move things.
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
const STRUCK = new Set(["hit", "crit", "strike", "ambush", "volley", "empowered", "hurt", "ambushed", "block", "kill"]);

const WORDS = { 1: "one", 2: "two", 3: "three" };
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
// "Two or three", from the zone's "2 or 3".
const atOnce = (zone) => cap(zone.foesText.replace(/\d/g, (d) => WORDS[d] || d));
const huntKey = (c) => (c.id != null ? c.id : c.startedAt);
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// The zone last looked at this session: the quiet arena offers to hunt it again.
let lastZone = "outer";

function commanderName(ctx) {
  const a = ctx.account;
  const name = (a && a.username) || ctx.state.meta.account;
  return name ? cap(String(name)) : "Commander";
}

// "Thane hunts here too", "Thane and Edda hunt here too", "3 of your party hunt here too".
function companyLine(names) {
  const n = names.map((x) => cap(String(x)));
  if (!n.length) return "";
  if (n.length === 1) return `${n[0]} hunts here too`;
  if (n.length === 2) return `${n[0]} and ${n[1]} hunt here too`;
  return `${n.length} of your party hunt here too`;
}

export default {
  id: "hunt",
  title: () => "Hunt",
  group: "The Field",

  mount(view, ctx) {
    const timers = new Set();
    const later = (fn, ms) => {
      const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
      timers.add(t);
    };
    const sigs = { tags: null, next: null, company: null, zones: null, quarry: null };

    /* ================= HERO ================= */

    const heroEyebrow = h("div.eyebrow.hero-eyebrow");
    const heroLv = document.createTextNode("");
    const heroLvSub = h("div.hero-lv-sub");
    const heroFill = h("i");
    const heroNext = h("span");
    const heroTags = h("div.chip-row.hero-tags");
    const heroXp = h("div.hero-xp",
      h("div.bar.bar-ember", heroFill),
      h("div.hero-xp-meta", h("span", getSkill("warfare").note), heroNext));
    const hero = h("section.hero", { "data-tone": "ember" },
      h("div.art.art-xl", { "data-tone": "ember", "aria-hidden": "true" }, iconEl("swords")),
      h("div.hero-main", heroEyebrow, h("h1.hero-title", "Hunt")),
      h("div.hero-level", h("div.hero-lv", h("small", "Lv"), heroLv), heroLvSub),
      heroXp);

    // Only built while a discipline can be chosen: before Hunt level 5 there is nothing to say.
    let discipline = null;
    // One row: on phones the button drops under the words (list-row stack-sm).
    const buildDiscipline = () => h("section.card.card-flush",
      h("div.list-row.stack-sm",
        h("div.art", { "aria-hidden": "true" }, iconEl("sparkle")),
        h("div.lr-main",
          h("h2.lr-title.display", "Choose your discipline"),
          h("p.lr-sub", "Warrior, Rogue or Mage. It opens the Veil and shapes every fight after. Set once.")),
        h("div.lr-end", h("button.btn.btn-primary", { type: "button", onClick: () => openPopup("class", ctx) }, "Choose"))));

    /* ================= THE FIGHT ================= */

    const huntTitle = h("h2.card-title");
    const huntSub = h("p.card-sub");
    const company = h("div.card-actions");
    const huntHead = h("div.card-head", h("div", huntTitle, huntSub), company);

    const youFx = h("div.fx-layer");
    const youPortrait = h("div.portrait.arena-portrait", h("img", { src: "assets/commander-default.webp", alt: "" }));
    const youName = h("div.arena-name");
    const youFill = h("i");
    const youText = h("span");
    const you = h("div.arena-you", youFx, youPortrait, youName, h("div.hpbar", youFill, youText));
    let veil = null;   // { bar, fill, note }, only once a discipline is held

    const status = h("div.arena-status");
    const timer = h("div.arena-timer");
    const emptyTitle = h("span.foe-empty-title");
    const emptySub = h("span.foe-empty-sub");
    const empty = h("div.foe-empty", emptyTitle, emptySub);
    const foesBox = h("div.arena-foes", empty);
    const arena = h("div.arena",
      you,
      h("div.arena-mid", h("div.arena-vs", { "aria-hidden": "true" }, "VS"), status, timer),
      foesBox);

    const kpi = (label, withBar) => {
      const v = h("span.v");
      const fill = withBar ? h("i") : null;
      return { v, fill, node: h("div.kpi", h("span.l", label), v, withBar ? h("div.bar.bar-ember.bar-thin", fill) : null) };
    };
    const kKills = kpi("Kills");
    const kRate = kpi("XP/hr");
    const kThreat = kpi("Threat", true);
    const kLeft = kpi("Time left");
    const kpis = h("div.kpis", kKills.node, kRate.node, kThreat.node, kLeft.node);
    const hint = h("p.hunt-hint");

    const hideInput = h("input", { type: "checkbox" });
    const hideSwitch = h("label.switch", hideInput, "Hide when Threat peaks");
    const pullBtn = h("button.btn.btn-quiet", { type: "button" }, "Pull back");
    const goBtn = h("button.btn.btn-ember", { type: "button" }, "Change hunt");
    const huntCard = h("section.card.hunt-card",
      huntHead,
      arena,
      h("div.hunt-foot", kpis, hint, h("div.hunt-actions", hideSwitch, h("div.btn-row", pullBtn, goBtn))));

    /* ================= ZONES AND QUARRY ================= */

    const awayText = document.createTextNode("");
    const away = h("span.chip.chip-ember", iconEl("swords"), awayText);
    const zonesGrid = h("div.grid-cards.max-2");
    const zones = h("section.section",
      h("div.section-head",
        h("div",
          h("h2.section-title", "Zones"),
          h("p.section-sub", "Deeper zones field more foes, call reinforcements sooner and pay more XP. At 100 Threat the Sovereign may come for you.")),
        away),
      zonesGrid);
    const zoneRefs = new Map();

    const quarrySub = h("p.section-sub");
    const quarryGrid = h("div.grid-cards");
    const quarry = h("section.section",
      h("div.section-head", h("div", h("h2.section-title", "Quarry"), quarrySub)),
      quarryGrid);

    view.appendChild(h("div.page", hero, huntCard, zones, quarry));

    function buildZones(tier) {
      zoneRefs.clear();
      zonesGrid.replaceChildren(...GameData.ZONES.map((z) => {
        const tag = h("span");
        const value = h("b");
        const fill = h("i");
        const node = h("button.zone-card", { type: "button", dataset: { tier: String(tier), zone: z.id } },
          h("span.art", { "data-tone": "ember", "aria-hidden": "true" }, iconEl(ZONE_ICONS[z.id])),
          h("span.zone-main", h("span.zone-name", z.name), h("span.zone-sub", `${z.foesText} at once · ×${z.xp} XP`)),
          tag,
          h("span.meter", h("span.meter-top", h("span", "Threat"), value), h("span.bar.bar-ember.bar-thin", fill)));
        zoneRefs.set(z.id, { node, tag, value, fill });
        return node;
      }));
    }

    function buildQuarry(tier) {
      const region = regionOfTier(tier);
      setText(quarrySub, `What lives in ${region.name}. Pick one to see what it hits for and what it drops.`);
      const tile = (mob) => {
        const sov = mob.archetype === "sovereign";
        const sub = sov
          ? `Sovereign · comes when Threat peaks · enrages every ${GameData.SOVEREIGN.enrageMs / 1000}s`
          : `${GameData.ARCHETYPES[mob.archetype].name} · ${fmt(mob.hp)} health · swings every ${(mob.speed / 1000).toFixed(1)}s`;
        return h("button.foe-tile", { type: "button", class: { "is-sovereign": sov }, dataset: { monster: mob.id } },
          h("span.foe-art", { html: monsterArt(mob) }),
          h("span.foe-tile-main", h("span.foe-tile-name", mob.name), h("span.foe-tile-sub", sub)),
          sov ? h("span.tag.tag-sovereign", "Sovereign") : null);
      };
      quarryGrid.replaceChildren(...foesOf(tier).map(tile), tile(sovereignOf(tier)));
    }

    /* ================= FOE CARDS ================= */

    const cards = new Map();   // `${hunt}:${uid}` -> { node, art, fx, fill, text, gone }

    function buildCard(f) {
      const mob = getMonster(f.id);
      const sov = mob.archetype === "sovereign";
      const fill = h("i");
      const text = h("span");
      const fx = h("div.fx-layer");
      const art = h("button.foe-art", { type: "button", "aria-label": `${mob.name}: details`, dataset: { monster: mob.id }, html: monsterArt(mob, f.elite) });
      const node = h("div.foe-card", { class: { "is-elite": f.elite && !sov, "is-sovereign": sov } },
        fx,
        art,
        h("div.foe-body",
          h("div.foe-name", h("span", mob.name), sov ? h("span.tag.tag-sovereign", "Sovereign") : f.elite ? h("span.tag.tag-elite", "Elite") : null),
          h("div.hpbar.hpbar-foe", fill, text)));
      return { node, art, fx, fill, text, gone: false };
    }

    function syncFoes(c) {
      const foes = c && c.phase === "fight" ? c.foes : [];
      const hunt = c ? huntKey(c) : null;
      const standing = new Set(foes.map((f) => `${hunt}:${f.uid}`));

      cards.forEach((card, key) => {
        if (card.gone || standing.has(key)) return;
        card.gone = true;
        toggleClass(card.node, "is-gone", true);
        later(() => {
          card.node.remove();
          if (cards.get(key) === card) cards.delete(key);
        }, GONE_MS);
      });

      foes.forEach((f, i) => {
        const key = `${hunt}:${f.uid}`;
        let card = cards.get(key);
        if (!card) {
          card = buildCard(f);
          cards.set(key, card);
          foesBox.appendChild(card.node);
        }
        toggleClass(card.node, "is-target", i === 0);
        setWidth(card.fill, (f.hp / f.max) * 100);
        setText(card.text, `${fmt(Math.max(0, Math.ceil(f.hp)))} / ${fmt(f.max)}`);
      });

      let fading = false;
      cards.forEach((card) => { if (card.gone) fading = true; });
      setAttr(empty, "hidden", foes.length > 0 || fading);
    }

    /* ================= FLOATS ================= */

    const fxQueue = [];
    const floats = [];
    let lane = 0;

    ctx.on("hunt:fx", (p) => {
      if (document.hidden) return;
      const c = p.state && p.state.tasks ? p.state.tasks.combat : null;
      fxQueue.push({ who: p.who, kind: p.kind, amount: p.amount || 0, at: p.at, hunt: c ? huntKey(c) : null });
      if (fxQueue.length > FX_QUEUE_MAX) fxQueue.shift();
    });

    function strike(node) {
      node.classList.remove("struck");
      void node.offsetWidth;   // restart the shake
      node.classList.add("struck");
    }

    function showFx(ev) {
      if (ev.kind === "fall") {
        toggleClass(you, "is-dead", true);
        later(() => toggleClass(you, "is-dead", false), DEAD_MS);
        return;
      }
      const card = ev.who === "you" ? null : cards.get(`${ev.hunt}:${ev.who}`);
      if (ev.who !== "you" && !card) return;
      if (STRUCK.has(ev.kind)) strike(card ? card.art : youPortrait);
      const text = FLOAT_TEXT[ev.kind];
      if (!text) return;
      const f = h("span.float", { class: [ev.kind, `lane${lane++ % 3}`] }, text(ev.amount));
      (card ? card.fx : youFx).appendChild(f);
      floats.push(f);
      while (floats.length > FLOATS_MAX) floats.shift().remove();
      later(() => {
        f.remove();
        const i = floats.indexOf(f);
        if (i >= 0) floats.splice(i, 1);
      }, FLOAT_MS);
    }

    function drainFx(now) {
      if (!fxQueue.length) return;
      const events = fxQueue.splice(0);
      if (document.hidden || reducedMotion()) return;
      events.filter((ev) => now - ev.at < FX_STALE_MS).slice(-FLOATS_PER_FRAME).forEach(showFx);
    }

    /* ================= WIRING ================= */

    let hidePending = false;
    hideInput.addEventListener("change", () => {
      hidePending = true;
      Promise.resolve(ctx.dispatch("setHide", { on: hideInput.checked })).finally(() => {
        hidePending = false;
        hideInput.checked = !!ctx.state.settings.hideSovereign;
      });
    });
    pullBtn.addEventListener("click", () => ctx.dispatch("pullBack"));
    goBtn.addEventListener("click", () => {
      const state = ctx.state;
      const c = state.tasks.combat;
      if (c) openPopup("zone", ctx, c.tier, c.zone);
      else openPopup("zone", ctx, currentRegion(state).tier, lastZone);
    });
    on(foesBox, "click", ".foe-art", (e, b) => openPopup("foe", ctx, b.dataset.monster));
    on(zonesGrid, "click", ".zone-card", (e, b) => {
      lastZone = b.dataset.zone;
      openPopup("zone", ctx, Number(b.dataset.tier), b.dataset.zone);
    });
    on(quarryGrid, "click", ".foe-tile", (e, b) => openPopup("foe", ctx, b.dataset.monster));

    /* ================= UPDATE ================= */

    function paintHero(ctx, region, c, kls) {
      const state = ctx.state;
      setText(heroEyebrow, `The Field · ${region.name}`);
      const xp = xpProgress(state, "warfare");
      setText(heroLv, String(xp.level));
      setText(heroLvSub, xp.maxed ? "Mastered" : `${fmtWhole(xp.xp)} / ${fmtWhole(xp.next)} XP`);
      setWidth(heroFill, xp.pct);
      const next = xp.maxed ? "" : `${Math.ceil(xp.toNext)}|${xp.level + 1}`;
      if (next !== sigs.next) {
        sigs.next = next;
        heroNext.replaceChildren(...(xp.maxed ? [] : [h("b", fmtWhole(Math.ceil(xp.toNext))), ` to Lv ${xp.level + 1}`]));
      }

      // The discipline, once held, then whatever bends Hunt XP right now.
      const chips = huntChips(ctx, c ? { tier: c.tier, zoneId: c.zone } : {});
      const tags = `${kls ? kls.name : ""}|${chips.map((x) => x.text).join("|")}`;
      if (tags !== sigs.tags) {
        sigs.tags = tags;
        const nodes = chips.map(chipNode);
        if (kls) nodes.unshift(h("span.tag.tag-violet", kls.name));
        heroTags.replaceChildren(...nodes);
        // The hero lays out differently without a tags row, so the row comes and goes.
        if (nodes.length && !heroTags.isConnected) hero.insertBefore(heroTags, heroXp);
        if (!nodes.length && heroTags.isConnected) heroTags.remove();
      }
    }

    function paintArena(ctx, region, c, kls, down) {
      const state = ctx.state;
      const zone = c ? getZone(c.zone) : null;

      setAttr(huntHead, "hidden", !c);
      if (c) {
        setText(huntTitle, `The ${zone.name} of ${regionOfTier(c.tier).name}`);
        setText(huntSub, `${atOnce(zone)} at once · ×${zone.xp} XP a kill`);
        const line = companyLine(partyHere(ctx, c.tier, c.zone).names);
        if (line !== sigs.company) {
          sigs.company = line;
          company.replaceChildren(...(line ? [h("span.chip.chip-violet", iconEl("party"), line)] : []));
        }
        setAttr(company, "hidden", !line);
      }

      // ---- you ----
      const s = statsOf(state);
      // At camp health comes back over five minutes; the save keeps what you came home with.
      const rest = c ? null : campPlan(state, ctx.now);
      const hp = Math.max(0, Math.min(s.maxHp, Math.ceil(rest ? rest.hp : state.player.hp)));
      setText(youName, commanderName(ctx));
      setWidth(youFill, (hp / s.maxHp) * 100);
      setText(youText, `${fmt(hp)} / ${fmt(s.maxHp)}`);
      toggleClass(you, "is-down", down);

      if (kls && !veil) {
        const fill = h("i");
        veil = { fill, bar: h("div.veilbar", fill), note: h("div.veil-note") };
        you.append(veil.bar, veil.note);
      } else if (!kls && veil) {
        veil.bar.remove();
        veil.note.remove();
        veil = null;
      }
      if (veil) {
        const v = c ? Math.max(0, Math.min(H.veilMax, c.veil)) : 0;
        setWidth(veil.fill, (v / H.veilMax) * 100);
        setText(veil.note, !c ? kls.veilName
          : c.volley > 0 ? `Volley · ${c.volley} to come`
          : `${kls.veilName} · ${Math.floor(v)} of ${H.veilMax}`);
      }

      // ---- what is happening ----
      let st = "Not hunting";
      let tm = "";
      let et = `${region.name} lies quiet`;
      let es = "Nothing is being hunted here.";
      if (down) {
        st = "Recovering";
        tm = `Back in ${fmtTime(state.player.recoveryLeft)}`;
        es = "You are in no state to hunt.";
      } else if (c) {
        et = `The ${zone.name} lies quiet`;
        if (c.phase === "hide") {
          st = "Hiding";
          tm = `${fmtTime(c.wait)} left`;
          et = "Lying low";
          es = `Something vast is searching the ${zone.name}.`;
        } else if (c.phase === "search") {
          st = c.sovereignNext ? "Something vast approaches" : "Searching";
          tm = c.sovereignNext ? `Here in ${fmtTime(c.wait)}` : `Next encounter in ${fmtTime(c.wait)}`;
          et = c.sovereignNext ? sovereignOf(c.tier).name : `Searching the ${zone.name}`;
          es = c.sovereignNext ? "It has found you." : "The next encounter is close.";
        } else if (c.kind === "sovereign") {
          st = "A Sovereign";
          tm = c.enrage ? `Enraged ×${c.enrage}` : `Enrages in ${fmtTime(c.enrageAt - c.clock)}`;
        } else {
          st = "Fighting";
          tm = c.foes.length >= H.maxFoes ? `${cap(WORDS[H.maxFoes] || String(H.maxFoes))} at once` : `Reinforcements in ${fmtTime(c.reinforceAt - c.clock)}`;
        }
      }
      setText(status, st);
      setText(timer, tm);
      setText(emptyTitle, et);
      setText(emptySub, es);

      syncFoes(c);
      drainFx(ctx.now);

      // ---- the numbers ----
      setAttr(kpis, "hidden", !c);
      setAttr(hint, "hidden", !!c);
      if (c) {
        setText(kKills.v, c.limit == null ? fmt(c.done) : `${fmt(c.done)} of ${fmt(c.limit)}`);
        setText(kRate.v, c.xpRate == null ? "Soon" : fmt(Math.round(c.xpRate)));
        const threat = threatIn(state, c.tier, c.zone);
        setText(kThreat.v, `${threat} / ${H.threatCap}`);
        setWidth(kThreat.fill, (threat / H.threatCap) * 100);
        setText(kLeft.v, fmtTime(Math.max(0, IDLE_CAP - c.elapsed)));
      } else {
        // The time left is already on the arena's status line.
        setText(hint, down ? "You fell. Choose a zone below once you are back on your feet." : "Choose a zone below to take up the hunt.");
      }

      setAttr(hideSwitch, "hidden", !c);
      const hide = !!state.settings.hideSovereign;
      if (!hidePending && hideInput.checked !== hide) hideInput.checked = hide;
      setAttr(pullBtn, "hidden", !c);
      setAttr(goBtn, "disabled", down);
      setText(goBtn, down ? "Recovering" : c ? "Change hunt" : `Hunt the ${getZone(lastZone).name}`);
    }

    function paintGround(ctx, region, c) {
      const state = ctx.state;
      const tier = region.tier;
      if (sigs.zones !== tier) {
        sigs.zones = tier;
        buildZones(tier);
      }
      GameData.ZONES.forEach((z) => {
        const r = zoneRefs.get(z.id);
        const threat = threatIn(state, tier, z.id);
        const active = !!(c && c.tier === tier && c.zone === z.id);
        const peaked = threat >= H.threatCap;
        toggleClass(r.node, "is-active", active);
        toggleClass(r.node, "is-peaked", peaked);
        toggleClass(r.tag, "tag", active || peaked);
        toggleClass(r.tag, "tag-ember", active);
        toggleClass(r.tag, "tag-sovereign", !active && peaked);
        setText(r.tag, active ? "Hunting" : peaked ? "Peaked" : "");
        setText(r.value, `${threat} / ${H.threatCap}`);
        setWidth(r.fill, (threat / H.threatCap) * 100);
      });

      // Travel doesn't end a hunt: say where it is when that isn't here.
      const elsewhere = !!(c && c.tier !== tier);
      setAttr(away, "hidden", !elsewhere);
      if (elsewhere) setText(awayText, `The hunt is out in ${regionOfTier(c.tier).name}`);

      if (sigs.quarry !== tier) {
        sigs.quarry = tier;
        buildQuarry(tier);
      }
    }

    function update(ctx) {
      const state = ctx.state;
      const region = currentRegion(state);
      const c = state.tasks.combat;
      const kls = myClass(state);
      const down = recovering(state);
      if (c) lastZone = c.zone;

      paintHero(ctx, region, c, kls);

      const can = canPickClass(state);
      if (can && !discipline) {
        discipline = buildDiscipline();
        hero.after(discipline);
      } else if (!can && discipline) {
        discipline.remove();
        discipline = null;
      }

      paintArena(ctx, region, c, kls, down);
      paintGround(ctx, region, c);
    }

    update(ctx);
    return {
      update,
      unmount() {
        timers.forEach((t) => clearTimeout(t));
        timers.clear();
      },
    };
  },
};
