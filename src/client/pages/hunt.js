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

   While the party is out and this player is on it, the same arena
   draws the shared fight instead (store.partyHunt, which is the
   server's sessionView and nothing else). That fight is not played
   here and cannot be: two members are at different clocks and hold
   dice that cannot be synchronised, so the page renders what came
   back in the last answer and no more.
   ============================================================ */

import { h, on, setAttr, setText, setWidth, toggleClass } from "../ui/dom.js";
import { iconEl } from "../ui/icons.js";
import { fmt, fmtStat, fmtWhole, fmtTime } from "../ui/format.js";
import { openPopup } from "../ui/widgets.js";
import { monsterArt } from "../ui/popups/foe.js";
import { huntChips, chipNode, partyHere, ZONE_ICONS } from "../ui/popups/zone.js";
import { CONFIG } from "../../shared/config.js";
import { GameData, getMonster, getZone, getSkill, foesOf, sovereignOf, regionOfTier } from "../../shared/registry.js";
import { campPlan, huntRates } from "../../shared/combat.js";
import { itemDef, itemName } from "../../shared/items.js";
import { statsOf, canPickClass, recovering, myClass, xpProgress } from "../../shared/stats.js";
import { currentRegion } from "../../shared/world.js";

const H = CONFIG.hunt;
const IDLE_CAP = CONFIG.time.idleCapMs;

const FX_STALE_MS = 1500;       // simulated age past which a blow is not worth drawing
const FX_QUEUE_MAX = 60;
const GONE_MS = 700;            // the fade in pages.css, then the card goes
const DEAD_MS = 1400;

// No floating text of any kind any more (no "Crit", "Glance", damage numbers):
// a health bar winding down says how the fight is going, and the DPS on the run
// bar says how fast. A struck card still shakes (see strike() below), which is
// the one bit of hit feedback that's left.
const STRUCK = new Set(["hit", "crit", "strike", "ambush", "volley", "empowered", "hurt", "ambushed", "block", "kill"]);

const WORDS = { 1: "one", 2: "two", 3: "three" };
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
// "Two or three", from the zone's "2 or 3".
const atOnce = (zone) => cap(zone.foesText.replace(/\d/g, (d) => WORDS[d] || d));
const huntKey = (c) => (c.id != null ? c.id : c.startedAt);
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const sameId = (a, b) => a != null && b != null && String(a).toLowerCase() === String(b).toLowerCase();

/* The party's fight, when the server says this player is out on one. It only ever comes off an
   answer, never off the save, and it is absent the moment they are not in it. */
function partyFight(ctx) {
  const view = ctx.store ? ctx.store.partyHunt : null;
  if (!view || view.over || !Array.isArray(view.hunters)) return null;
  // A ground this build has never heard of belongs to a newer engine: leave the arena alone.
  if (!regionOfTier(view.tier)) return null;
  const me = ctx.account ? ctx.account.userId : null;
  return me && view.hunters.some((u) => u && sameId(u.userId, me)) ? view : null;
}

// Party ids are the realm's; only the party roster knows what to call them.
function namesOf(ctx) {
  const members = ctx.party && Array.isArray(ctx.party.members) ? ctx.party.members : [];
  const out = new Map();
  members.forEach((m) => {
    if (m && m.user_id) out.set(String(m.user_id).toLowerCase(), cap(String(m.username || "Someone")));
  });
  return out;
}

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
    const sigs = { tags: null, next: null, company: null, zones: null, quarry: null, band: null, drops: null };
    // XP/hr and DPS eased toward their true value each tick, so a combat system that
    // only actually changes these numbers at a swing or a kill still reads as live
    // instead of sitting still between hits and then jumping.
    let dispXp = null;
    let dispDps = null;
    const mates = new Map();   // the party's other hunters, by user id
    let wasParty = false;      // which fight the arena was last drawn for

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
    // No art box, as on every other skill page: the swords live in the sidebar.
    const hero = h("section.hero", { "data-tone": "ember" },
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

    const youPortrait = h("div.portrait.arena-portrait", h("img", { src: "assets/commander-default.webp", alt: "" }));
    const youName = h("div.arena-name");
    const youFill = h("i");
    const youText = h("span");
    // The rest of the warband, only while the party is out: name and health, one row each.
    const band = h("div.arena-band", { hidden: true });
    const you = h("div.arena-you", youPortrait, youName, h("div.hpbar", youFill, youText), band);
    let veil = null;   // { bar, fill, note }, only once a discipline is held

    const status = h("div.arena-status");
    const timer = h("div.arena-timer");
    const emptyTitle = h("span.foe-empty-title");
    const emptySub = h("span.foe-empty-sub");
    const empty = h("div.foe-empty", emptyTitle, emptySub);
    const foesBox = h("div.arena-foes", empty);
    const arena = h("div.arena",
      you,
      h("div.arena-mid", status, timer),
      foesBox);

    // The label is a node too: the party's fight has different numbers to report in the same strip.
    const kpi = (label, withBar) => {
      const l = h("span.l", label);
      const v = h("span.v");
      const fill = withBar ? h("i") : null;
      return { l, v, fill, node: h("div.kpi", l, v, withBar ? h("div.bar.bar-ember.bar-thin", fill) : null) };
    };
    const kKills = kpi("Kills");
    const kRate = kpi("XP/hr");
    const kDps = kpi("DPS");
    // The fourth box is shared: solo shows what this run has turned up (a stack of
    // icons, not a chance meter -- that number never told you anything useful);
    // the party fight still shows your share of the group's damage in it instead.
    const kSov = kpi("Sovereign", true);
    const kSovBar = kSov.node.querySelector(".bar");
    const dropsList = h("div.kpi-drops", { hidden: true });
    kSov.node.append(dropsList);
    const kLeft = kpi("Time left");
    const kpis = h("div.kpis", kKills.node, kRate.node, kDps.node, kSov.node, kLeft.node);
    const hint = h("p.hunt-hint");

    const pullBtn = h("button.btn.btn-quiet", { type: "button" }, "Pull back");
    const goBtn = h("button.btn.btn-ember", { type: "button" }, "Change hunt");
    const huntCard = h("section.card.hunt-card",
      huntHead,
      arena,
      h("div.hunt-foot", kpis, hint, h("div.hunt-actions", h("div.btn-row", pullBtn, goBtn))));

    /* ================= ZONES AND QUARRY ================= */

    const awayText = document.createTextNode("");
    const away = h("span.chip.chip-ember", iconEl("swords"), awayText);
    const zonesGrid = h("div.grid-cards.max-2");
    const zones = h("section.section",
      h("div.section-head",
        h("div",
          h("h2.section-title", "Zones"),
          h("p.section-sub", "Deeper zones field more foes, hit harder and pay more XP. The Inner and the Core are the only ground a Sovereign walks, and the only ground whose Elites carry the Veil.")),
        h("div.section-end", away)),
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
      // No Threat meter per card: one region, one counter, shown in the section head.
      zonesGrid.replaceChildren(...GameData.ZONES.map((z) => {
        const tag = h("span");
        const node = h("button.zone-card", { type: "button", dataset: { tier: String(tier), zone: z.id } },
          h("span.art", { "data-tone": "ember", "aria-hidden": "true" }, iconEl(ZONE_ICONS[z.id])),
          h("span.zone-main", h("span.zone-name", z.name), h("span.zone-sub", `${z.foesText} at once · ×${z.xp} XP · ×${z.power} foes`)),
          tag);
        zoneRefs.set(z.id, { node, tag });
        return node;
      }));
    }

    function buildQuarry(tier) {
      const region = regionOfTier(tier);
      setText(quarrySub, `What lives in ${region.name}. Pick one to see what it hits for and what it drops.`);
      const tile = (mob) => {
        const sov = mob.archetype === "sovereign";
        const sub = sov
          ? `Sovereign · comes on its own odds, with ${GameData.SOVEREIGN.escorts} Elites · enrages every ${GameData.SOVEREIGN.enrageMs / 1000}s`
          : `${GameData.ARCHETYPES[mob.archetype].name} · ${fmt(mob.hp)} health · swings every ${(mob.speed / 1000).toFixed(1)}s`;
        return h("button.foe-tile", { type: "button", class: { "is-sovereign": sov }, dataset: { monster: mob.id } },
          h("span.foe-art", { html: monsterArt(mob) }),
          h("span.foe-tile-main", h("span.foe-tile-name", mob.name), h("span.foe-tile-sub", sub)),
          sov ? h("span.tag.tag-sovereign", "Sovereign") : null);
      };
      quarryGrid.replaceChildren(...foesOf(tier).map(tile), tile(sovereignOf(tier)));
    }

    /* ================= FOE CARDS ================= */

    const cards = new Map();   // `${hunt}:${uid}` -> { node, art, fill, text, on, gone }

    function buildCard(f) {
      const mob = getMonster(f.id);
      const sov = mob.archetype === "sovereign";
      const fill = h("i");
      const text = h("span");
      const art = h("button.foe-art", { type: "button", "aria-label": `${mob.name}: details`, dataset: { monster: mob.id }, html: monsterArt(mob, f.elite) });
      const node = h("div.foe-card", { class: { "is-elite": f.elite && !sov, "is-sovereign": sov } },
        art,
        h("div.foe-body",
          h("div.foe-name", h("span", mob.name), sov ? h("span.tag.tag-sovereign", "Sovereign") : f.elite ? h("span.tag.tag-elite", "Elite") : null),
          h("div.hpbar.hpbar-foe", fill, text)));
      return { node, art, fill, text, gone: false };
    }

    /* One roster of foe cards for both fights, and the same one either way: a party's
       encounter is one shared roster (up to CONFIG.hunt.maxFoes, scaled, never one per
       hunter), so it draws exactly like your own with no per-player targeting shown --
       nobody sees who a foe happens to be swinging at, or the numbers behind it. */
    function syncFoes(foes, hunt) {
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

    /* ================= FX ================= */

    const fxQueue = [];

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

    // No floating text any more (no "Crit", "Glance", damage numbers, ...): a
    // struck card still shakes, which says a blow landed without printing it.
    function showFx(ev) {
      if (ev.kind === "fall") {
        toggleClass(you, "is-dead", true);
        later(() => toggleClass(you, "is-dead", false), DEAD_MS);
        return;
      }
      const card = ev.who === "you" ? null : cards.get(`${ev.hunt}:${ev.who}`);
      if (ev.who !== "you" && !card) return;
      if (STRUCK.has(ev.kind)) strike(card ? card.art : youPortrait);
    }

    function drainFx(now) {
      if (!fxQueue.length) return;
      const events = fxQueue.splice(0);
      if (document.hidden || reducedMotion()) return;
      events.filter((ev) => now - ev.at < FX_STALE_MS).forEach(showFx);
    }

    /* ================= WIRING ================= */

    /* One button, two fights: walking away from the party's is a server-only command, and the
       answer to it is what takes the shared arena off the page. A refusal toasts itself. */
    pullBtn.addEventListener("click", () => {
      if (partyFight(ctx)) {
        pullBtn.disabled = true;
        Promise.resolve(ctx.dispatch("partyHuntLeave")).finally(() => { pullBtn.disabled = false; });
        return;
      }
      ctx.dispatch("pullBack");
    });
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

    function paintHero(ctx, region, c, kls, party) {
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

      /* The discipline, once held, then whatever bends Hunt XP right now. The party's ground
         counts the same as your own: the server pays a share through partyMult as well. */
      const ground = c || party;
      const chips = huntChips(ctx, ground ? { tier: ground.tier, zoneId: ground.zone } : {});
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

    /* The Veil is your own fight's: the party's view carries none (no stat lines leave the
       server), so the bar goes while they are out rather than sitting there at nothing. */
    function setVeil(want) {
      if (want && !veil) {
        const fill = h("i");
        veil = { fill, bar: h("div.veilbar", fill) };
        you.append(veil.bar);
      } else if (!want && veil) {
        veil.bar.remove();
        veil = null;
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

      setVeil(!!kls);
      if (veil) {
        const v = c ? Math.max(0, Math.min(H.veilMax, c.veil)) : 0;
        setWidth(veil.fill, (v / H.veilMax) * 100);
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
        if (c.phase === "search") {
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

      syncFoes(c && c.phase === "fight" ? c.foes : [], c ? huntKey(c) : null);
      drainFx(ctx.now);

      // ---- the numbers ----
      setAttr(kpis, "hidden", !c);
      setAttr(hint, "hidden", !!c);
      // The strip reports the party's fight while one is out, so its labels come back here.
      setText(kKills.l, "Kills");
      setText(kRate.l, "XP/hr");
      setText(kDps.l, "DPS");
      setText(kSov.l, "Drops");
      setAttr(kSov.v, "hidden", true);
      setAttr(kSovBar, "hidden", true);
      setAttr(dropsList, "hidden", false);
      setText(kLeft.l, "Time left");
      if (c) {
        setText(kKills.v, fmt(c.done));
        // Eased toward the true rate each tick: combat only actually moves xp/dmg
        // at a swing or a kill, so snapping straight to the new value on every read
        // looked frozen between hits and then jumped. This glides instead.
        const rates = huntRates(c);
        dispXp = rates.xpRate == null ? null : dispXp == null ? rates.xpRate : dispXp + (rates.xpRate - dispXp) * 0.2;
        dispDps = rates.dps == null ? null : dispDps == null ? rates.dps : dispDps + (rates.dps - dispDps) * 0.2;
        setText(kRate.v, dispXp == null ? "Reckoning" : fmt(Math.round(dispXp)));
        setText(kDps.v, dispDps == null ? "Reckoning" : fmtStat(dispDps));
        // What this run has actually turned up, not the flat odds of a Sovereign.
        const drops = c.drops || {};
        const keys = Object.keys(drops);
        const dsig = keys.map((k) => `${k}:${drops[k]}`).join(",");
        if (dsig !== sigs.drops) {
          sigs.drops = dsig;
          dropsList.replaceChildren(...(keys.length
            ? keys.map((k) => h("span.drop-pip", { "data-tip": itemName(k) }, iconEl(itemDef(k).icon), fmt(drops[k])))
            : [h("span.drop-pip.is-empty", "Nothing yet")]));
        }
        setText(kLeft.v, fmtTime(Math.max(0, IDLE_CAP - c.elapsed)));
      } else {
        // The time left is already on the arena's status line.
        setText(hint, down ? "You fell. Choose a zone below once you are back on your feet." : "Choose a zone below to take up the hunt.");
      }

      setAttr(pullBtn, "hidden", !c);
      setText(pullBtn, "Pull back");
      setAttr(goBtn, "hidden", false);
      setAttr(goBtn, "disabled", down);
      setText(goBtn, down ? "Recovering" : c ? "Change hunt" : `Hunt the ${getZone(lastZone).name}`);
      setAttr(band, "hidden", true);
      // Back to your own card when the party's fight is not what is on screen.
      setAttr(you, "hidden", false);
      toggleClass(arena, "is-party", false);
    }

    /* The party's fight. Nothing below is worked out here: every number comes off the last
       answer, which is what makes a disagreement with the server impossible rather than
       merely unlikely. There is no float or shake layer either, because those come off
       hunt:fx events raised by a local simulation, and for a shared fight there is no local
       simulation to raise them. The arena is quieter for it, and that is the right trade. */
    function paintParty(ctx, view) {
      const zone = getZone(view.zone);
      const region = regionOfTier(view.tier);
      const me = ctx.account ? ctx.account.userId : null;
      const names = namesOf(ctx);
      const hunters = Array.isArray(view.hunters) ? view.hunters : [];
      const mine = hunters.find((u) => sameId(u.userId, me)) || null;
      const e = view.phase === "fight" ? view.enc : null;
      const enc = e && Array.isArray(e.foes) && Array.isArray(e.hunters) ? e : null;

      setAttr(huntHead, "hidden", false);
      setText(huntTitle, `The ${zone.name} of ${region.name}`);
      setText(huntSub, "The party's hunt · XP by your share, gold and drops the same for everyone");
      const chip = `${hunters.length} out together`;
      if (chip !== sigs.company) {
        sigs.company = chip;
        company.replaceChildren(h("span.chip.chip-violet", iconEl("party"), chip));
      }
      setAttr(company, "hidden", false);

      // Your own card gives way: in a party you are one square among the others.
      setAttr(you, "hidden", true);
      setVeil(false);

      /* Whoever joined after an encounter had begun is in the session but not in that fight:
         the roster of foes was drawn for the party that walked into it. They are in on the
         next one, and saying so is the only way their nothing-happening makes sense. */
      const inEnc = (u) => !enc || enc.hunters.some((x) => sameId(x.userId, u.userId));
      const fighting = !!(enc && mine && inEnc(mine));

      // ---- the warband, you first ----
      const band4 = hunters.slice().sort((a, b) => (sameId(a.userId, me) ? -1 : sameId(b.userId, me) ? 1 : 0));
      syncBand(band4, names, inEnc, me);

      // ---- what is happening ----
      let st = "Walking";
      let tm = `Next encounter in ${fmtTime(view.wait)}`;
      let et = `Searching the ${zone.name}`;
      let es = "The party walks on to the next one.";
      if (enc && !fighting) {
        st = "Waiting";
        tm = "In on the next encounter";
        et = `The ${zone.name} lies quiet`;
        es = "This one was drawn for the party that walked into it.";
      } else if (enc) {
        st = enc.kind === "sovereign" ? "A Sovereign" : "Fighting";
        tm = `Encounter ${fmtWhole(view.encounters)}`;
        et = `The ${zone.name} lies quiet`;
        es = "Nothing is left standing here.";
      }
      setText(status, st);
      setText(timer, tm);
      setText(emptyTitle, et);
      setText(emptySub, es);

      // A foe this build cannot name is left out rather than drawn as an unknown.
      syncFoes(enc ? enc.foes.filter((f) => getMonster(f.id)) : [], enc ? `p${view.partyId}:${enc.id}` : null);
      toggleClass(arena, "is-party", true);

      // ---- the numbers ----
      /* A share is the damage you dealt over the damage the party dealt, which is the one
         figure worth watching in a fight whose spoils are split that way. */
      const total = hunters.reduce((n, u) => n + (u.dmg || 0), 0);
      // The server's own figure: 70% of damage dealt, 30% of damage taken.
      const share = mine && mine.share != null ? mine.share : 0;
      setAttr(kpis, "hidden", false);
      setAttr(hint, "hidden", true);
      setText(kKills.l, "Encounters");
      setText(kKills.v, fmtWhole(view.encounters));
      setText(kRate.l, "Your damage");
      setText(kRate.v, fmt(Math.round(mine ? mine.dmg : 0)));
      setText(kDps.l, "Party damage");
      setText(kDps.v, fmt(Math.round(total)));
      setText(kSov.l, "Your share");
      setAttr(kSov.v, "hidden", false);
      setAttr(kSovBar, "hidden", false);
      setAttr(dropsList, "hidden", true);
      setText(kSov.v, `${Math.round(share)}%`);
      setWidth(kSov.fill, share);
      setText(kLeft.l, "Time out");
      setText(kLeft.v, fmtTime(view.elapsed));

      setAttr(pullBtn, "hidden", false);
      setText(pullBtn, "Break away");
      setAttr(goBtn, "hidden", true);
    }

    // One row a member: their name, their health, and a mark on whoever has fallen or is waiting.
/* The whole warband, you first, as squares: two across for a pair, two over one for
   a three, two by two for a four. Everyone is on screen at once, which is the point
   of hunting together, and a square each is the only shape that stays readable at
   four. `data-n` is what the grid reads to lay them out. */
    function syncBand(all, names, inEnc, me) {
      const sig = all.map((u) => `${u.userId}:${u.down ? 1 : 0}`).join("|");
      if (sig !== sigs.band) {
        sigs.band = sig;
        mates.clear();
        band.replaceChildren(...all.map((u) => {
          const fill = h("i");
          const text = h("span");
          const isMe = sameId(u.userId, me);
          const label = isMe ? "You" : (names.get(String(u.userId).toLowerCase()) || "Someone");
          const node = h("div.band-mate", { class: { "is-down": u.down, "is-me": isMe } },
            h("div.band-art", h("img", { src: "assets/commander-default.webp", alt: "" })),
            h("span.band-name", label),
            h("div.hpbar.hpbar-sm", fill, text));
          mates.set(String(u.userId).toLowerCase(), { fill, text });
          return node;
        }));
      }
      setAttr(band, "data-n", String(all.length));
      all.forEach((u) => {
        const row = mates.get(String(u.userId).toLowerCase());
        if (!row) return;
        const max = u.max > 0 ? u.max : 1;
        setWidth(row.fill, (Math.max(0, u.hp) / max) * 100);
        setText(row.text, u.down ? "Fallen" : inEnc(u) ? `${fmt(Math.max(0, u.hp))} / ${fmt(max)}` : "Waiting");
      });
      setAttr(band, "hidden", !all.length);
    }

    function paintGround(ctx, region, c) {
      const state = ctx.state;
      const tier = region.tier;
      if (sigs.zones !== tier) {
        sigs.zones = tier;
        buildZones(tier);
      }
      // Nothing accumulates any more: each zone simply carries its own odds.
      const peaked = false;

      GameData.ZONES.forEach((z) => {
        const r = zoneRefs.get(z.id);
        const active = !!(c && c.tier === tier && c.zone === z.id);
        // A hunt already under way locks every other zone: pull back before picking a new one.
        const locked = !!c && !active;
        toggleClass(r.node, "is-active", active);
        toggleClass(r.node, "is-peaked", peaked);
        toggleClass(r.node, "is-locked", locked);
        setAttr(r.node, "disabled", locked);
        setAttr(r.node, "aria-disabled", locked);
        toggleClass(r.tag, "tag", active || peaked);
        toggleClass(r.tag, "tag-ember", active);
        toggleClass(r.tag, "tag-sovereign", !active && peaked);
        setText(r.tag, active ? "Hunting" : peaked ? "Peaked" : "");
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
      // The server allows one fight a hunter, so these two are never both on.
      const party = c ? null : partyFight(ctx);
      if (c) lastZone = c.zone;
      if (party) lastZone = party.zone;

      paintHero(ctx, region, c, kls, party);

      const can = canPickClass(state);
      if (can && !discipline) {
        discipline = buildDiscipline();
        hero.after(discipline);
      } else if (!can && discipline) {
        discipline.remove();
        discipline = null;
      }

      // Cards outlive neither fight: a change of ground clears the roster the other built.
      if (!!party !== wasParty) {
        wasParty = !!party;
        sigs.band = null;
        sigs.company = null;
        cards.forEach((card) => card.node.remove());
        cards.clear();
        // Blows queued off the fight that just ended have nothing left to float from.
        fxQueue.length = 0;
      }
      if (party) paintParty(ctx, party);
      else paintArena(ctx, region, c, kls, down);
      // Both fights hold a tier and a zone, so the ground below marks either one.
      paintGround(ctx, region, c || party);
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
