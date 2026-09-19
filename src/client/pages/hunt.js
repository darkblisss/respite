/* ============================================================
   Respite · pages/hunt.js · The Field
   ------------------------------------------------------------
   #/skill/warfare. The hunt as it happens, drawn as a place and
   not as a panel: your commander stands on the ground at the
   left, up to three foes loom out of the smoke at the right, and
   what the fight is doing is written between them. Nothing in
   the field is boxed. A fighter is a figure with a name and a
   line of health under it; the one you are on stands nearest and
   largest, the rest hang back in the dark. Under the field, the
   four zones of the region as one descent from Outer to Core
   (each opens the zone popup, where a hunt is taken up) and the
   quarry that lives there, stood in a line.

   Built once, then updated in place about ten times a second.
   Foes are keyed by hunt and uid: reinforcements come in from the
   dark, the fallen sink into it. Blows arrive as hunt:fx events
   while the store plays a frame; they are queued and drawn after
   the figures have caught up, the way v4 drained its combatFx.

   While the party is out and this player is on it, the same field
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
import { statsOf, canPickClass, recovering, myClass, xpProgress } from "../../shared/stats.js";
import { currentRegion } from "../../shared/world.js";

const H = CONFIG.hunt;
const IDLE_CAP = CONFIG.time.idleCapMs;

const FLOAT_MS = 1000;
const FLOATS_MAX = 12;          // on screen at once, across the whole arena
const FLOATS_PER_FRAME = 8;     // a long frame (a slow device, a burst) shows only its last few blows
const FX_STALE_MS = 1500;       // simulated age past which a blow is not worth drawing
const FX_QUEUE_MAX = 60;
const GONE_MS = 700;            // the fade in pages.css, then the figure goes
const VEIL_STEPS = 10;          // the mist at your feet thickens in tenths (data-veil, read by pages.css)
const DEAD_MS = 1400;

/* What floats up for each kind of blow. No damage number floats any more, in
   either direction: a health bar winding down says how the fight is going, and the
   DPS on the run bar says how fast. What is left here is the things a number could
   never say -- that a blow was a critical, that armour turned one, that a technique
   landed -- and healing, which is not damage and is worth counting. Kinds with no
   text (hit, volley, bleed, thorns, hurt, kill, spawn, leave, fall) only move things. */
const FLOAT_TEXT = {
  crit: () => "Crit",
  strike: () => "Devastating",
  ambush: () => "Ambush",
  empowered: () => "Empowered",
  ambushed: () => "Ambushed",
  block: () => "Blunted",
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
    const sigs = { tags: null, next: null, company: null, zones: null, quarry: null, band: null };
    const mates = new Map();   // the party's other hunters, by user id
    let wasParty = false;      // which fight the arena was last drawn for

    /* ================= THE HEAD OF THE FIELD ================= */

    /* Every other skill page opens on a masthead. This one does not: the field is the
       page, so what the masthead carried (the level, the way to the next, what is bending
       XP) is written into the top of the scene, and the ground you are on is the title. */
    const heroEyebrow = h("div.eyebrow");
    const heroLv = document.createTextNode("");
    const heroLvSub = h("span.scene-xp-sub");
    const heroFill = h("i");
    const heroNext = h("span.scene-xp-next");
    const heroTags = h("div.chip-row.scene-tags");
    const rank = h("div.scene-rank",
      h("div.scene-lv", h("small", "Hunt Lv"), heroLv),
      h("div.bar.bar-thin", heroFill),
      h("div.scene-xp-meta", heroLvSub, heroNext),
      heroTags);

    // Only built while a discipline can be chosen: before Hunt level 5 there is nothing to say.
    let discipline = null;
    // One row: on phones the button drops under the words (list-row stack-sm).
    const buildDiscipline = () => h("section.card.card-flush", { "data-tone": "veil" },
      h("div.list-row.stack-sm",
        h("div.art", { "aria-hidden": "true" }, iconEl("sparkle")),
        h("div.lr-main",
          h("h2.lr-title.display", "Choose your discipline"),
          h("p.lr-sub", "Warrior, Rogue or Mage. It opens the Veil and shapes every fight after. Set once.")),
        h("div.lr-end", h("button.btn.btn-primary", { type: "button", onClick: () => openPopup("class", ctx) }, "Choose"))));

    /* ================= THE FIELD ================= */

    /* Where the fight is: written into the top of the scene, not set above it in a card head. */
    const huntTitle = h("h1.scene-title");
    const huntSub = h("p.scene-sub");
    const company = h("div.scene-company");
    const huntHead = h("header.scene-head", h("div.scene-where", heroEyebrow, huntTitle, huntSub, company), rank);

    /* A fighter is a figure, a name and a line of health. `vital()` is the line and its
       figures side by side (components.css): nothing is painted on top of a bar. */
    const vital = (kind) => {
      const fill = h("i");
      const text = h("span.vital-text");
      return { fill, text, node: h("div.vital", { class: kind && `vital-${kind}` }, h("div.vital-line", fill), text) };
    };

    const youFx = h("div.fx-layer");
    // The Veil as weather at your feet: it thickens as the charge builds (data-veil on `you`).
    const youMist = h("div.fighter-mist", { "aria-hidden": "true" });
    const youPortrait = h("div.portrait.fighter-art", youMist, h("img", { src: "assets/commander-default.webp", alt: "" }));
    const youName = h("div.fighter-name");
    const youVital = vital(null);
    const youFill = youVital.fill;
    const youText = youVital.text;
    const youPlate = h("div.fighter-plate", youName, youVital.node);
    const you = h("div.fighter.fighter-you", youFx, youPortrait, youPlate);
    let veil = null;   // { fill, note, node }, only once a discipline is held

    /* The warband, while the party is out: a figure each, you first. It stands where you
       stand, as your sibling and not inside you, so hiding your own figure leaves it up. */
    const band = h("div.scene-band", { hidden: true });
    const side = h("div.scene-side", you, band);

    // What the fight is doing, set between the two sides where "VS" used to be.
    const status = h("div.scene-status");
    const timer = h("div.scene-timer");
    const emptyTitle = h("span.scene-empty-title");
    const emptySub = h("span.scene-empty-sub");
    const empty = h("div.scene-empty", emptyTitle, emptySub);
    const foesBox = h("div.scene-foes", empty);
    const stage = h("div.scene-stage",
      side,
      h("div.scene-state", { role: "status" }, status, timer),
      foesBox);

    // The label is a node too: the party's fight has different numbers to report in the same line.
    const kpi = (label, withBar) => {
      const l = h("span.l", label);
      const v = h("span.v");
      const fill = withBar ? h("i") : null;
      return { l, v, fill, node: h("div.kpi", l, v, withBar ? h("div.bar.bar-neutral.bar-thin", fill) : null) };
    };
    const kKills = kpi("Kills");
    const kRate = kpi("XP/hr");
    const kDps = kpi("DPS");
    const kSov = kpi("Sovereign", true);
    const kLeft = kpi("Time left");
    const kpis = h("div.kpis", kKills.node, kRate.node, kDps.node, kSov.node, kLeft.node);
    const hint = h("p.scene-hint");

    const pullBtn = h("button.btn.btn-quiet", { type: "button" }, "Pull back");
    const goBtn = h("button.btn", { type: "button" }, "Change hunt");
    /* data-state is what the scene reads: quiet | search | fight | sovereign | down.
       The light, the smoke and the ground all turn on it (pages.css). */
    const arena = h("section.scene", { "data-state": "quiet", "aria-label": "The field" },
      h("div.scene-sky", { "aria-hidden": "true" }),
      huntHead,
      stage,
      h("footer.scene-foot", kpis, hint, h("div.scene-actions", pullBtn, goBtn)));

    /* ================= THE DESCENT AND THE QUARRY ================= */

    const awayText = document.createTextNode("");
    const away = h("span.chip.chip-ember", iconEl("swords"), awayText);
    /* The four zones are one road going down, so they are drawn as one: Outer at the
       left, the Core at the right, a line through all four, darker and hotter as it goes. */
    const zonesGrid = h("ol.descent");
    const zones = h("section.section",
      h("div.section-head",
        h("div",
          h("h2.section-title", "The descent"),
          h("p.section-sub", "Deeper zones field more foes, hit harder and pay more XP. The Inner and the Core are the only ground a Sovereign walks, and the only ground whose Elites carry the Veil.")),
        h("div.section-end", away)),
      zonesGrid);
    const zoneRefs = new Map();

    const quarrySub = h("p.section-sub");
    // Stood in a line on one floor, the way a field guide plates its specimens.
    const quarryGrid = h("div.lineup");
    const quarry = h("section.section",
      h("div.section-head", h("div", h("h2.section-title", "Quarry"), quarrySub)),
      quarryGrid);

    view.appendChild(h("div.page.hunt-page", arena, zones, quarry));

    function buildZones(tier) {
      zoneRefs.clear();
      // No Threat meter per stop: one region, one counter, shown in the section head.
      zonesGrid.replaceChildren(...GameData.ZONES.map((z, i) => {
        const tag = h("span.descent-tag");
        const node = h("button.descent-stop", { type: "button", dataset: { tier: String(tier), zone: z.id, depth: String(i + 1) } },
          h("span.descent-mark", { "aria-hidden": "true" }),
          h("span.descent-name", z.name),
          h("span.descent-sub", `${z.foesText} at once`),
          h("span.descent-sub", `×${z.xp} XP · ×${z.power} foes`),
          tag);
        zoneRefs.set(z.id, { node, tag });
        return h("li", node);
      }));
    }

    function buildQuarry(tier) {
      const region = regionOfTier(tier);
      setText(quarrySub, `What lives in ${region.name}. Pick one to see what it hits for and what it drops.`);
      const tile = (mob) => {
        const sov = mob.archetype === "sovereign";
        const sub = sov
          ? `Comes on its own odds, with ${GameData.SOVEREIGN.escorts} Elites · enrages every ${GameData.SOVEREIGN.enrageMs / 1000}s`
          : `${fmt(mob.hp)} health · swings every ${(mob.speed / 1000).toFixed(1)}s`;
        return h("button.specimen", { type: "button", class: { "is-sovereign": sov }, dataset: { monster: mob.id } },
          h("span.foe-art", { html: monsterArt(mob) }),
          h("span.specimen-kind", sov ? "Sovereign" : GameData.ARCHETYPES[mob.archetype].name),
          h("span.specimen-name", mob.name),
          h("span.specimen-sub", sub));
      };
      quarryGrid.replaceChildren(...foesOf(tier).map(tile), tile(sovereignOf(tier)));
    }

    /* ================= FOES ================= */

    const cards = new Map();   // `${hunt}:${uid}` -> { node, art, fx, fill, text, on, gone }

    function buildCard(f, shared) {
      const mob = getMonster(f.id);
      const sov = mob.archetype === "sovereign";
      const hp = vital("foe");
      const fx = h("div.fx-layer");
      // Who a foe is on only matters when there is more than one of you for it to choose between.
      const on = shared ? h("div.fighter-on") : null;
      const art = h("button.fighter-art.foe-art", { type: "button", "aria-label": `${mob.name}: details`, dataset: { monster: mob.id }, html: monsterArt(mob, f.elite) });
      const node = h("div.fighter.fighter-foe", { class: { "is-elite": f.elite && !sov, "is-sovereign": sov } },
        fx,
        art,
        h("div.fighter-plate",
          h("div.fighter-name", h("span", mob.name), sov ? h("span.tag.tag-sovereign", "Sovereign") : f.elite ? h("span.tag.tag-elite", "Elite") : null),
          hp.node,
          on));
      return { node, art, fx, fill: hp.fill, text: hp.text, on, gone: false };
    }

    /* One roster of foes for both fights. `shared` is null for your own hunt, where the
       first foe is the one you are on; for the party's it says who each foe is on, which is the
       thing that makes the fight read as shared. */
    function syncFoes(foes, hunt, shared) {
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
          card = buildCard(f, !!shared);
          cards.set(key, card);
          foesBox.appendChild(card.node);
        }
        toggleClass(card.node, "is-target", shared ? sameId(f.target, shared.me) : i === 0);
        setWidth(card.fill, (f.hp / f.max) * 100);
        setText(card.text, `${fmt(Math.max(0, Math.ceil(f.hp)))} / ${fmt(f.max)}`);
        if (card.on) setText(card.on, sameId(f.target, shared.me) ? "On you" : `On ${shared.names.get(String(f.target).toLowerCase()) || "the party"}`);
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
    on(zonesGrid, "click", ".descent-stop", (e, b) => {
      lastZone = b.dataset.zone;
      openPopup("zone", ctx, Number(b.dataset.tier), b.dataset.zone);
    });
    on(quarryGrid, "click", ".specimen", (e, b) => openPopup("foe", ctx, b.dataset.monster));

    /* ================= UPDATE ================= */

    function paintHero(ctx, region, c, kls, party) {
      const state = ctx.state;
      setText(heroEyebrow, "The Field · Hunt");
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
        // A discipline is what you do with the Veil, so it is the one violet word up here.
        if (kls) nodes.unshift(h("span.tag.tag-veil", kls.name));
        heroTags.replaceChildren(...nodes);
      }
    }

    /* The Veil is your own fight's: the party's view carries none (no stat lines leave the
       server), so the line goes while they are out rather than sitting there at nothing. */
    function setVeil(want) {
      if (want && !veil) {
        const v = vital("veil");
        veil = { fill: v.fill, note: v.text, node: v.node };
        youPlate.append(veil.node);
      } else if (!want && veil) {
        veil.node.remove();
        veil = null;
        setAttr(you, "data-veil", null);
        toggleClass(you, "is-charged", false);
      }
    }

    function paintArena(ctx, region, c, kls, down) {
      const state = ctx.state;
      const zone = c ? getZone(c.zone) : null;

      /* The scene is always somewhere: the ground you hunt, or the region you stand in. */
      if (c) {
        setText(huntTitle, `The ${zone.name} of ${regionOfTier(c.tier).name}`);
        setText(huntSub, `${atOnce(zone)} at once · ×${zone.xp} XP a kill`);
        const line = companyLine(partyHere(ctx, c.tier, c.zone).names);
        if (line !== sigs.company) {
          sigs.company = line;
          company.replaceChildren(...(line ? [h("span.chip.chip-good", iconEl("party"), line)] : []));
        }
        setAttr(company, "hidden", !line);
      } else {
        setText(huntTitle, region.name);
        setText(huntSub, down ? "You were carried back to camp." : getSkill("warfare").note);
        setAttr(company, "hidden", true);
      }

      // ---- you ----
      const s = statsOf(state);
      // At camp health comes back over five minutes; the save keeps what you came home with.
      const rest = c ? null : campPlan(state, ctx.now);
      const hp = Math.max(0, Math.min(s.maxHp, Math.ceil(rest ? rest.hp : state.player.hp)));
      setText(youName, commanderName(ctx));
      setWidth(youFill, (hp / s.maxHp) * 100);
      setText(youText, `${fmt(hp)} / ${fmt(s.maxHp)}`);
      toggleClass(youVital.node, "is-low", s.maxHp > 0 && hp / s.maxHp <= 0.35);
      toggleClass(you, "is-down", down);

      setVeil(!!kls);
      if (veil) {
        const v = c ? Math.max(0, Math.min(H.veilMax, c.veil)) : 0;
        const full = !!c && v >= H.veilMax;
        setWidth(veil.fill, (v / H.veilMax) * 100);
        setText(veil.note, !c ? kls.veilName
          : c.volley > 0 ? `Volley · ${c.volley} to come`
          : full ? `${kls.veilName} · ready`
          : `${kls.veilName} · ${Math.floor(v)} of ${H.veilMax}`);
        // The mist thickens in tenths, and flares once the charge is whole.
        setAttr(you, "data-veil", String(Math.round((v / H.veilMax) * VEIL_STEPS)));
        toggleClass(you, "is-charged", full || (!!c && c.volley > 0));
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
      setAttr(arena, "data-state", down ? "down" : !c ? "quiet" : c.phase === "search" ? (c.sovereignNext ? "sovereign" : "search")
        : c.kind === "sovereign" ? "sovereign" : "fight");

      syncFoes(c && c.phase === "fight" ? c.foes : [], c ? huntKey(c) : null, null);
      drainFx(ctx.now);

      // ---- the numbers ----
      setAttr(kpis, "hidden", !c);
      setAttr(hint, "hidden", !!c);
      // The strip reports the party's fight while one is out, so its labels come back here.
      setText(kKills.l, "Kills");
      setText(kRate.l, "XP/hr");
      setText(kDps.l, "DPS");
      setText(kSov.l, "Sovereign");
      setText(kLeft.l, "Time left");
      if (c) {
        setText(kKills.v, fmt(c.done));
        // Live off a rolling window: both figures move every second instead of
        // sitting still for five minutes and then jumping.
        const rates = huntRates(c);
        setText(kRate.v, rates.xpRate == null ? "Reckoning" : fmt(Math.round(rates.xpRate)));
        setText(kDps.v, rates.dps == null ? "Reckoning" : fmtStat(rates.dps));
        // Not a counter filling any more: the flat odds this ground shows it, per encounter cleared.
        const sovChance = getZone(c.zone).sovereign || 0;
        setText(kSov.v, sovChance > 0 ? `${+(sovChance * 100).toFixed(2)}%` : "-");
        setWidth(kSov.fill, sovChance > 0 ? Math.min(100, sovChance * 100 * 20) : 0);
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
      // Setting out is the one solid plate the field ever shows; changing ground is not.
      toggleClass(goBtn, "btn-ember", !c && !down);
      setAttr(band, "hidden", true);
      // Back to your own figure when the party's fight is not what is on screen.
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

      setText(huntTitle, `The ${zone.name} of ${region.name}`);
      setText(huntSub, "The party's hunt · XP by your share, gold and drops the same for everyone");
      const chip = `${hunters.length} out together`;
      if (chip !== sigs.company) {
        sigs.company = chip;
        company.replaceChildren(h("span.chip.chip-good", iconEl("party"), chip));
      }
      setAttr(company, "hidden", false);

      // Your own figure gives way: in a party you are one of the warband, drawn with the rest.
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
      setAttr(arena, "data-state", !enc ? "search" : enc.kind === "sovereign" ? "sovereign" : "fight");

      // A foe this build cannot name is left out rather than drawn as an unknown.
      syncFoes(enc ? enc.foes.filter((f) => getMonster(f.id)) : [], enc ? `p${view.partyId}:${enc.id}` : null, { me, names });
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
      setText(kSov.v, `${Math.round(share)}%`);
      setWidth(kSov.fill, share);
      setText(kLeft.l, "Time out");
      setText(kLeft.v, fmtTime(view.elapsed));

      setAttr(pullBtn, "hidden", false);
      setText(pullBtn, "Break away");
      setAttr(goBtn, "hidden", true);
      toggleClass(goBtn, "btn-ember", false);
    }

    /* The whole warband, you first, stood together on the same ground: a figure, a name
       and a line of health each. Everyone is on screen at once, which is the point of
       hunting together. `data-n` is what the layout reads to size them (pages.css). */
    function syncBand(all, names, inEnc, me) {
      const sig = all.map((u) => `${u.userId}:${u.down ? 1 : 0}`).join("|");
      if (sig !== sigs.band) {
        sigs.band = sig;
        mates.clear();
        band.replaceChildren(...all.map((u) => {
          const hp = vital("sm");
          const isMe = sameId(u.userId, me);
          const label = isMe ? "You" : (names.get(String(u.userId).toLowerCase()) || "Someone");
          const node = h("div.fighter.band-mate", { class: { "is-down": u.down, "is-me": isMe } },
            h("div.portrait.fighter-art", h("img", { src: "assets/commander-default.webp", alt: "" })),
            h("div.fighter-plate", h("div.fighter-name", label), hp.node));
          mates.set(String(u.userId).toLowerCase(), { fill: hp.fill, text: hp.text, node: hp.node });
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
        toggleClass(row.node, "is-low", !u.down && u.hp / max <= 0.35);
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
        toggleClass(r.node, "is-active", active);
        toggleClass(r.node, "is-peaked", peaked);
        setAttr(r.node, "aria-current", active ? "true" : null);
        setText(r.tag, active ? "You hunt here" : peaked ? "Peaked" : "");
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
        arena.after(discipline);
      } else if (!can && discipline) {
        discipline.remove();
        discipline = null;
      }

      // Figures outlive neither fight: a change of ground clears the roster the other built.
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
