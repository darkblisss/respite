/* ============================================================
   Respite · pages/hunt.js · The Field
   ------------------------------------------------------------
   #/skill/warfare. The hunt as it happens, on one stage. Between
   encounters it is the walk: you, the way on to the next one, what
   the last came to, and what waits at the end of it. In one it is
   the Closing Ring (ui/hunt-ring.js): you in the middle and every
   foe out on the ring at the distance its next swing is away. Under
   it the run's numbers and what it has turned up; under that the
   region you stand in, drawn as a map with its four zones and who
   is out on each (a ring or a row opens the zone popup, where a
   hunt is taken up), and the quarry that lives there, one at a
   time on a plate.

   Built once, then updated in place about ten times a second. The
   ring draws at the screen's rate by itself: the page hands it a
   snapshot of the fight each time the store plays a frame, and
   every blow it hears of (hunt:fx, queued while the store plays and
   passed on once the ring has caught up, the way v4 drained its
   combatFx). The walk and the fight's head are ordinary DOM over it.

   While the party is out and this player is on it, the same stage
   draws the shared fight instead (store.partyHunt, which is the
   server's sessionView and nothing else). That fight is not played
   here and cannot be: two members are at different clocks and hold
   dice that cannot be synchronised, so the page draws what came back
   in the last answer, and the ring runs the swing timers on from it.
   ============================================================ */

import { h, on, setAttr, setText, setWidth, toggleClass } from "../ui/dom.js";
import { iconEl, artEl } from "../ui/icons.js";
import { fmt, fmtStat, fmtWhole, fmtTime, fmtGold, chancePct } from "../ui/format.js";
import { openPopup, portraitImg, paintPortrait } from "../ui/widgets.js";
import { monsterArt } from "../ui/popups/foe.js";
import { huntChips, chipNode, partyHere } from "../ui/popups/zone.js";
import { zoneMap, zoneNotes } from "../ui/zone-map.js";
import { recapTracker } from "../ui/recap.js";
import { huntRing } from "../ui/hunt-ring.js";
import { serverMs } from "../store.js";
import { CONFIG } from "../../shared/config.js";
import {
  GameData, getMonster, getZone, getSkill, getClass, foesOf, sovereignOf, regionOfTier,
  veilBandOfTier, fragmentOfTier, essenceOfTier,
} from "../../shared/registry.js";
import { campPlan, huntRates, foeNumbers } from "../../shared/combat.js";
import { itemDef, itemName } from "../../shared/items.js";
import { statsOf, canPickClass, recovering, myClass, xpProgress } from "../../shared/stats.js";
import { xpMult } from "../../shared/progression.js";
import { companionBonus } from "../../shared/companions.js";
import { currentRegion } from "../../shared/world.js";

const H = CONFIG.hunt;
const IDLE_CAP = CONFIG.time.idleCapMs;

const FX_STALE_MS = 1500;       // simulated age past which a blow is not worth drawing
const FX_QUEUE_MAX = 60;
const GONE_MS = 700;            // the fade in pages.css, then the card goes

// A struck card in the narrow list still shakes: the list is what a phone has instead of plates.
const STRUCK = new Set(["hit", "crit", "strike", "ambush", "volley", "empowered", "thorns", "bleed"]);

const WORDS = { 1: "one", 2: "two", 3: "three" };
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
const lower = (id) => String(id).toLowerCase();

const huntKey = (c) => (c.id != null ? c.id : c.startedAt);
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const sameId = (a, b) => a != null && b != null && String(a).toLowerCase() === String(b).toLowerCase();
const ZONE_INDEX = new Map(GameData.ZONES.map((z, i) => [z.id, i]));

// A countdown: whole seconds, never 0 while it still runs, minutes once it is long.
const secs = (ms) => (ms >= 60000 ? fmtTime(ms) : `${Math.max(1, Math.ceil(Math.max(0, ms) / 1000))}s`);

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
    if (m && m.user_id) out.set(lower(m.user_id), cap(String(m.username || "Someone")));
  });
  return out;
}

/* And what each of them looks like. The realm publishes a member's skin on the
   party roster; one it does not know yet reads as null and wears the default. */
function skinsOf(ctx) {
  const members = ctx.party && Array.isArray(ctx.party.members) ? ctx.party.members : [];
  const out = new Map();
  members.forEach((m) => {
    if (m && m.user_id && typeof m.skin === "string") out.set(lower(m.user_id), m.skin);
  });
  return out;
}

// The zone last looked at this session: the quiet stage offers to hunt it again.
let lastZone = "outer";

/* ================= WHO ELSE IS OUT ================= */
/* The realm's hunters on one region's ground, as ground_hunters() last
   answered (migration 018): how many are on each zone, and the most recently
   seen of them by name. Kept by tier across visits to the page so coming back
   does not ask again at once, and asked again every REALM_MS, and only while
   the page is up and the tab is seen: the page's own tick only ever redraws
   from what is kept here. A realm that has not run 018 answers `missing` and
   the map shows you and your party alone for the rest of the session. */
const REALM_MS = 45 * 1000;
const realmSeen = new Map();   // tier -> { at, rows, counts }
const NOBODY = { rows: [], counts: null };
let realmAsking = false;
let realmMissing = false;

// Who the map shows while in a party, for the session: "everyone" or "party".
let groundView = "everyone";

function realmOn(ctx, tier) {
  const seen = realmSeen.get(tier) || null;
  const net = ctx.net;
  const signedIn = !!(ctx.account && ctx.account.mode === "account");
  if (realmMissing || !signedIn || !net || typeof net.groundHunters !== "function") return seen || NOBODY;
  const idle = typeof document !== "undefined" && document.hidden;
  if (!realmAsking && !idle && (!seen || Date.now() - seen.at >= REALM_MS)) {
    realmAsking = true;
    Promise.resolve()
      .then(() => net.groundHunters(tier))
      .then((res) => {
        if (res && res.missing) realmMissing = true;
        const ok = res && !res.error && Array.isArray(res.rows);
        // A failed ask keeps the last answer and waits out the same interval rather than asking every tick.
        realmSeen.set(tier, {
          at: Date.now(),
          rows: ok ? res.rows : seen ? seen.rows : [],
          counts: ok ? res.counts || null : seen ? seen.counts : null,
        });
      })
      .catch(() => realmSeen.set(tier, { at: Date.now(), rows: seen ? seen.rows : [], counts: seen ? seen.counts : null }))
      .finally(() => { realmAsking = false; });
  }
  return seen || NOBODY;
}

const ZONE_IDS = new Set(GameData.ZONES.map((z) => z.id));

// A roster member's hunt while it still runs, or null. The roster keeps a stopped one with its end.
function liveHunt(hunt, now) {
  if (!hunt || typeof hunt !== "object" || !ZONE_IDS.has(hunt.zone)) return null;
  const end = serverMs(hunt.ended_at ?? hunt.ends_by);
  if (Number.isFinite(end) && end <= now) return null;
  const tier = Number(hunt.tier);
  return Number.isInteger(tier) ? { tier, zone: hunt.zone } : null;
}

// "out 40m", "out 3h 5m": whole minutes, so a tip does not tick over every second.
function outFor(ms) {
  const m = Math.floor(Math.max(0, ms) / 60000);
  if (m < 1) return "just out";
  return m < 60 ? `out ${m}m` : `out ${Math.floor(m / 60)}h ${m % 60}m`;
}

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
    const sigs = { tags: null, next: null, company: null, band: null, drops: null, recap: null, coming: null, plate: null, tabs: null, quarry: null };
    // XP/hr and DPS eased toward their true value each tick, so a combat system that
    // only actually changes these numbers at a swing or a kill still reads as live
    // instead of sitting still between hits and then jumping.
    let dispXp = null;
    let dispDps = null;
    const mates = new Map();   // the party's rows in the walk, by user id
    let wasParty = false;      // which fight the stage was last drawn for
    /* The party's fight while this camp is not on it: after a fall, after breaking away, or
       before ever joining. The server stops sending a camp the fight the moment it is off
       the roster, so this is asked for on its own (party_hunt_view), as the Party page does. */
    let watch = null;
    let watchAt = 0;
    let watchAsking = false;
    let onFight = false;       // drawn on the party's fight last time round
    let fell = false;          // and went down in it: the camp is watching because it fell
    let joinMode = false;      // the card's main press is "Join your party"
    const WATCH_MS = 4000;
    // The last party answer the ring was given, and when it came: its clocks run on from then.
    let partySeen = null;
    let partySeenAt = 0;
    let walkFull = 0;          // the longest this walk has been seen to be, for the trail
    let size = "wide";         // what the ring is drawing at: "wide" or "narrow"
    const offNews = ctx.on("store:news", (e) => {
      // The death is settled in the same answer that takes the camp off the roster.
      if (e && e.type === "hunt:death" && onFight) fell = true;
    });

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

    /* ================= THE STAGE ================= */

    const huntTitle = h("h2.card-title");
    const huntSub = h("p.card-sub");
    const company = h("div.card-actions");
    const huntHead = h("div.card-head", h("div", huntTitle, huntSub), company);

    const ring = huntRing({
      onFoe: (id) => openPopup("foe", ctx, id),
      onMode: (mode) => setSize(mode),
    });

    // Over the ring while it is fought: which encounter, and when the next one steps out.
    const fhTitle = h("b");
    const fhSub = h("span");
    const fhNextLabel = document.createTextNode("");
    const fhNextTime = h("em");
    const fhNext = h("span", fhNextLabel, fhNextTime);
    const fhPillIcon = h("span.hunt-fh-icon");
    const fhPillText = h("span");
    const fhPill = h("span.hunt-fh-pill", { hidden: true }, fhPillIcon, fhPillText);
    const fightHead = h("div.hunt-fight-head",
      h("div.hunt-fh-l", fhTitle, fhSub),
      h("div.hunt-fh-r", fhNext, fhPill));

    /* The walk. Alone: your face, the discipline's glyph before your name, your health, and
       nothing of the Veil, which every encounter opens the same way. With the party: each
       of you, and each one's share of the take so far. */
    const youFace = h("span.hunt-face-in.portrait-bust", portraitImg(ctx.state.player.skin));
    // The face on the stage is yours, so it is the skin on the save.
    let youSkinSig = ctx.state.player.skin;
    const youKlass = h("span.hunt-klass");
    let youKlassSig = null;
    const youName = h("span.hunt-you-text");
    const youFill = h("i");
    const youText = h("span");
    const youHp = h("div.hpbar", youFill, youText);
    const walkYou = h("div.hunt-walk-you",
      h("span.hunt-face", youFace),
      h("div.hunt-you-name", youKlass, youName),
      youHp);
    const bandRows = h("div.hunt-band-rows");
    const band = h("div.hunt-band", { hidden: true }, h("span.eyebrow", "Shares of the take"), bandRows);

    const walkTitle = h("b");
    const walkInLabel = document.createTextNode("");
    const walkIn = h("em");
    const walkWhen = h("span", walkInLabel, " ", walkIn);
    const trailYou = h("span.hunt-trail-you");
    const trailSteps = Array.from({ length: 14 }, (_, i) => h("i", { style: { left: `${5 + i * 6.6}%`, top: `${i % 2 ? 58 : 38}%` } }));
    const trail = h("div.hunt-trail", { "aria-hidden": "true" }, trailSteps, trailYou, h("span.hunt-trail-fog"));
    const walkSub = h("p.hunt-walk-sub");
    // On the walk after an encounter, what it came to (ui/recap.js).
    const recapRow = h("div.chip-row.hunt-recap", { hidden: true });
    const walkMid = h("div.hunt-walk-mid",
      h("div.hunt-walk-state", walkTitle, walkWhen),
      trail, walkSub, recapRow);

    // What waits: the three kinds that walk the zone and how often, or, once it has found you, the Sovereign.
    const comingHead = h("span.eyebrow.hunt-coming-head");
    const comingRows = h("div.hunt-coming-rows");
    const comingOdds = h("div.hunt-odds");
    const coming = h("div.hunt-coming", comingHead, comingRows, comingOdds);

    const walk = h("div.hunt-walk", walkYou, band, walkMid, coming);
    const stage = h("div.hunt-stage", ring.node, fightHead, walk);

    /* A phone has no room for plates beside the foes: under the stage it gets the foes as a
       list (the cards, keyed by hunt and uid: reinforcements slide in, the fallen fade out),
       and What waits moves down here beside them. */
    const foesBox = h("div.arena-foes", { hidden: true });
    const below = h("div.hunt-below", foesBox);

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
    // Your share of the party's take, or while watching, how you stand. Never shown alone.
    const kShare = kpi("Your share", true);
    const kShareBar = kShare.node.querySelector(".bar");
    const kLeft = kpi("Time left");
    const kpis = h("div.kpis", kKills.node, kRate.node, kDps.node, kShare.node, kLeft.node);
    // What this run has turned up, a tile a thing.
    const lootTiles = h("div.hunt-loot-tiles");
    const loot = h("div.hunt-loot", { hidden: true }, h("span.eyebrow", "This run"), lootTiles);

    const pullBtn = h("button.btn.btn-quiet", { type: "button" }, "Pull back");
    const goBtn = h("button.btn.btn-ember", { type: "button" }, "Change hunt");
    const huntCard = h("section.card.hunt-card", { dataset: { size, phase: "quiet" } },
      huntHead,
      stage,
      below,
      h("div.hunt-foot", kpis, loot, h("div.hunt-actions", h("div.btn-row", pullBtn, goBtn))));

    function setSize(mode) {
      size = mode === "narrow" ? "narrow" : "wide";
      huntCard.dataset.size = size;
      // What waits sits in the walk while there is room for it, and under the stage when there is not.
      const host = size === "narrow" ? below : walk;
      if (coming.parentNode !== host) host.appendChild(coming);
    }

    /* ================= ZONES AND QUARRY ================= */

    const awayText = document.createTextNode("");
    const away = h("span.chip.chip-ember", iconEl("swords"), awayText);
    /* The region drawn, its four zones as rings on it and who is out on each: you, your
       party off its roster, and the rest of the realm as it last answered. */
    const map = zoneMap({
      onZone: (tier, zoneId) => {
        lastZone = zoneId;
        openPopup("zone", ctx, tier, zoneId);
      },
      onView: (v) => { groundView = v; },
    });
    const zones = h("section.section",
      h("div.section-head",
        h("div",
          h("h2.section-title", "Zones"),
          h("p.section-sub", "Who from the realm is out on the ground right now. The Inner and the Core are the only ground a Sovereign walks, and the only ground whose Elites carry the Veil.")),
        h("div.section-end", away)),
      h("div.card.zone-map", map.node));

    // The quarry as one plate: a tab for each that lives here, the plate given to the one picked.
    const quarrySub = h("p.section-sub");
    const plateTabs = h("div.quarry-tabs", { role: "tablist", "aria-label": "What lives here" });
    const plateBody = h("div.quarry-body", { role: "tabpanel" });
    const quarry = h("section.section",
      h("div.section-head", h("div", h("h2.section-title", "Quarry"), quarrySub)),
      h("div.card.quarry-plate", plateTabs, plateBody));
    let platePick = null;      // which of the four, by monster id

    view.appendChild(h("div.page", hero, huntCard, zones, quarry));

    /* ================= FOE CARDS (NARROW) ================= */

    const cards = new Map();   // `${hunt}:${uid}` -> { node, art, fill, text, on, gone }

    function buildCard(f) {
      const mob = getMonster(f.id);
      const sov = mob.archetype === "sovereign";
      const fill = h("i");
      const text = h("span");
      const art = h("button.foe-art", { type: "button", "aria-label": `${mob.name}: details`, dataset: { monster: mob.id }, html: monsterArt(mob, f.elite) });
      // In a party, whom it is going for (UI-KIT.md: the line under the bar, in existing utilities).
      const onLine = h("div.small.muted.mt-1", { hidden: true });
      const node = h("div.foe-card", { class: { "is-elite": f.elite && !sov, "is-sovereign": sov } },
        art,
        h("div.foe-body",
          h("div.foe-name", h("span", mob.name), sov ? h("span.tag.tag-sovereign", "Sovereign") : f.elite ? h("span.tag.tag-elite", "Elite") : null),
          h("div.hpbar.hpbar-foe", fill, text),
          onLine));
      return { node, art, fill, text, on: onLine, gone: false };
    }

    /* One roster of foe cards for both fights, and the same one either way: a party's
       encounter is one shared roster (up to CONFIG.hunt.maxFoes, scaled, never one per
       hunter), so it lists like your own. The one thing a party's cards add is whom each
       foe is going for (`onOf`): a foe keeps the hunter it picked until they fall
       (partyHunt.js), so the name holds still long enough to read. */
    function syncFoes(foes, hunt, onOf = null) {
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
        const who = onOf ? onOf(f) : null;
        setAttr(card.on, "hidden", !who);
        if (who) setText(card.on, who);
      });
      setAttr(foesBox, "hidden", size !== "narrow" || (!foes.length && !cards.size));
    }

    /* ================= THE LAST ENCOUNTER ================= */

    /* Fed every frame of your own hunt, so it sees each walk and the fight after it (see
       ui/recap.js). A Sovereign's Essence and a break-away come off their own events. */
    const recap = recapTracker();
    ctx.on("hunt:felled", (p) => recap.felled(p && p.key));
    ctx.on("hunt:retreat", () => recap.broke());

    function recapChips(r) {
      const sov = r.kind === "sovereign";
      return [
        h("span.eyebrow", `Encounter ${fmtWhole(r.n)}`),
        sov ? h("span.chip.chip-violet", iconEl("crown"), r.felled ? "Sovereign felled" : r.broke ? "Broke away" : "A Sovereign") : null,
        h("span.chip", iconEl("skull"), `${fmtWhole(r.slain)} slain`),
        r.xp >= 1 ? h("span.chip.chip-gold", `+${fmtWhole(Math.round(r.xp))} XP`) : null,
        ...Object.keys(r.drops).map((k) => h("span.chip", artEl(itemDef(k)), r.drops[k] > 1 ? `${itemName(k)} ×${fmtWhole(r.drops[k])}` : itemName(k))),
        h("span.chip", iconEl("hourglass"), fmtTime(r.ms)),
      ].filter(Boolean);
    }

    function paintRecap(r) {
      const sig = r ? [r.n, r.slain, Math.round(r.xp), Object.keys(r.drops).map((k) => `${k}:${r.drops[k]}`).join(","), Math.round(r.ms / 1000), r.felled, r.broke].join("|") : "";
      if (sig !== sigs.recap) {
        sigs.recap = sig;
        recapRow.replaceChildren(...(r ? recapChips(r) : []));
      }
      setAttr(recapRow, "hidden", !r);
    }

    /* ================= WHAT WAITS ================= */

    // How many at once, as three diamonds: lit for the fewest, outlined for the most.
    const pips = (lo, hi) => h("span.hunt-pips", { "aria-hidden": "true" },
      [1, 2, 3].map((i) => h("i", { class: { on: i <= lo, may: i > lo && i <= hi } })));

    function paintComing(tier, zoneId, vast, isParty) {
      const sig = `${tier}|${zoneId}|${vast ? 1 : 0}|${isParty ? 1 : 0}`;
      if (sig === sigs.coming) return;
      sigs.coming = sig;
      const z = getZone(zoneId);
      const region = regionOfTier(tier);
      toggleClass(coming, "is-sov", vast);
      setText(comingHead, vast ? "It has found you" : "What waits");
      if (vast) {
        const it = sovereignOf(tier);
        const S = GameData.SOVEREIGN;
        comingRows.replaceChildren(
          h("div.hunt-wc-row.is-sov",
            h("button.hunt-wc-art.is-sov", { type: "button", "aria-label": `${it.name}: details`, dataset: { monster: it.id }, html: monsterArt(it) }),
            h("span.hunt-wc-sov-name", h("b", it.name), h("small", `Sovereign of ${region ? region.name : "this ground"}`))),
          h("div.hunt-sov-line", iconEl("swords"), h("span", `${cap(WORDS[S.escorts] || String(S.escorts))} Elites at its back. No others will come.`)),
          h("div.hunt-sov-line", iconEl("hourglass"), h("span", `Angrier every ${S.enrageMs / 1000}s it stands.`)));
        comingOdds.replaceChildren(
          h("span.hunt-odds-l", pips(3, 3), h("span", `${1 + S.escorts} at once`)),
          h("span.hunt-odds-r",
            h("span.hunt-odd.is-sov", iconEl("crown"), "Felled, its Essence"),
            isParty ? null : h("span.hunt-odd.is-quiet", "At a quarter, you break away")));
        return;
      }
      const mobs = foesOf(tier).slice().sort((a, b) => (z.mix[b.archetype] || 0) - (z.mix[a.archetype] || 0));
      comingRows.replaceChildren(...mobs.map((m) => {
        const pct = Math.round((z.mix[m.archetype] || 0) * 100);
        return h("div.hunt-wc-row",
          h("button.hunt-wc-art", { type: "button", "aria-label": `${m.name}: details`, dataset: { monster: m.id }, html: monsterArt(m) }),
          h("b", m.name),
          h("span.hunt-wc-bar", h("i", { style: { width: `${pct}%` } })),
          h("em", `${pct}%`));
      }));
      const counts = z.sizes.map((s) => s[0]);
      comingOdds.replaceChildren(
        h("span.hunt-odds-l", pips(Math.min(...counts), Math.max(...counts)), h("span", `${z.foesText} at once`)),
        // The odds stacked, the Sovereign's under the Elites'.
        h("span.hunt-odds-r",
          h("span.hunt-odd.is-elite", `Elites ${Math.round(z.elite * 100)}%`),
          z.sovereign > 0 ? h("span.hunt-odd.is-sov", iconEl("crown"), `Sovereign ${Math.round(z.sovereign * 100)}%`) : null));
    }

    /* ================= THE WALK ================= */

    function paintTrail(k, vast) {
      const at = 8 + clamp01(k) * 80;
      trailYou.style.left = `${at.toFixed(2)}%`;
      trailSteps.forEach((d, i) => toggleClass(d, "on", 5 + i * 6.6 < at));
      huntCard.dataset.vast = vast ? "1" : "";
    }
    const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));

    function paintYou(ctx, hp, max, kls, down) {
      setText(youName, commanderName(ctx));
      youSkinSig = paintPortrait(youFace, ctx.state.player.skin, youSkinSig);
      const k = kls ? kls.id : "";
      if (k !== youKlassSig) {
        youKlassSig = k;
        youKlass.replaceChildren(...(kls ? [iconEl(kls.icon || kls.id)] : []));
        setAttr(youKlass, "title", kls ? kls.name : null);
        setAttr(youKlass, "hidden", !kls);
      }
      setWidth(youFill, (hp / max) * 100);
      setText(youText, `${fmt(hp)} / ${fmt(max)}`);
      toggleClass(walkYou, "is-down", down);
    }

    function setWalk({ title, label = "", when = "", sub = "", trailOn = false }) {
      setText(walkTitle, title);
      setText(walkInLabel, label);
      setText(walkIn, when);
      setAttr(walkWhen, "hidden", !label && !when);
      setAttr(trail, "hidden", !trailOn);
      setText(walkSub, sub);
      setAttr(walkSub, "hidden", !sub);
    }

    function setFightHead({ title, sub, label = "", when = "", pill = null, pillIcon = "eye" }) {
      setText(fhTitle, title);
      setText(fhSub, sub);
      setText(fhNextLabel, label);
      setText(fhNextTime, when);
      setAttr(fhNext, "hidden", !label && !when);
      setAttr(fhPill, "hidden", !pill);
      if (pill) {
        if (fhPillIcon.dataset.icon !== pillIcon) {
          fhPillIcon.dataset.icon = pillIcon;
          fhPillIcon.replaceChildren(iconEl(pillIcon));
        }
        setText(fhPillText, pill);
      }
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

    // Every blow goes to the ring; on a phone the struck foe's card shakes as well.
    function drainFx(now) {
      if (!fxQueue.length) return;
      const events = fxQueue.splice(0).filter((ev) => now - ev.at < FX_STALE_MS);
      events.forEach((ev) => {
        ring.blow(ev);
        if (size !== "narrow" || reducedMotion() || ev.who === "you" || !STRUCK.has(ev.kind)) return;
        const card = cards.get(`${ev.hunt}:${ev.who}`);
        if (card) strike(card.art);
      });
    }

    /* ================= WIRING ================= */

    /* One button, two fights: walking away from the party's is a server-only command, and the
       answer to it is what takes the shared fight off the page. A refusal toasts itself. */
    pullBtn.addEventListener("click", () => {
      if (partyFight(ctx)) {
        pullBtn.disabled = true;
        Promise.resolve(ctx.dispatch("partyHuntLeave")).finally(() => { pullBtn.disabled = false; });
        return;
      }
      ctx.dispatch("pullBack");
    });
    goBtn.addEventListener("click", () => {
      /* Back onto the party's ground. The server puts them on the session and the rules keep
         them out of the encounter already drawn, so they come in on the walk after it. */
      if (joinMode) {
        goBtn.disabled = true;
        Promise.resolve(ctx.dispatch("partyHuntJoin")).finally(() => { goBtn.disabled = false; });
        return;
      }
      const state = ctx.state;
      const c = state.tasks.combat;
      if (c) openPopup("zone", ctx, c.tier, c.zone);
      else openPopup("zone", ctx, currentRegion(state).tier, lastZone);
    });
    on(foesBox, "click", ".foe-art", (e, b) => openPopup("foe", ctx, b.dataset.monster));
    on(coming, "click", "[data-monster]", (e, b) => openPopup("foe", ctx, b.dataset.monster));
    on(plateTabs, "click", "[data-monster]", (e, b) => {
      platePick = b.dataset.monster;
      sigs.plate = null;
      paintPlate(ctx);
      const again = plateTabs.querySelector(`[data-monster="${platePick}"]`);
      if (again) again.focus();
    });
    on(plateTabs, "keydown", "[data-monster]", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      const tabs = Array.from(plateTabs.querySelectorAll("[data-monster]"));
      const i = tabs.findIndex((t) => t.dataset.monster === platePick);
      const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      if (!next) return;
      platePick = next.dataset.monster;
      sigs.plate = null;
      paintPlate(ctx);
      const again = plateTabs.querySelector(`[data-monster="${platePick}"]`);
      if (again) again.focus();
    });
    on(plateBody, "click", "[data-monster]", (e, b) => openPopup("foe", ctx, b.dataset.monster));
    on(plateBody, "click", "[data-item]", (e, b) => openPopup("item", ctx, b.dataset.item, { from: null }));

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

    // The strip's labels for your own hunt: the party's fight puts its own in the same boxes.
    function soloStrip() {
      setText(kKills.l, "Kills");
      setText(kRate.l, "XP/hr");
      setText(kDps.l, "DPS");
      setText(kLeft.l, "Time left");
      setAttr(kShare.node, "hidden", true);
    }

    function paintLoot(drops) {
      const keys = drops ? Object.keys(drops) : [];
      const dsig = keys.map((k) => `${k}:${drops[k]}`).join(",");
      if (dsig !== sigs.drops) {
        const was = sigs.drops ? new Map(sigs.drops.split(",").map((p) => p.split(":")).map(([k, n]) => [k, Number(n)])) : new Map();
        sigs.drops = dsig;
        lootTiles.replaceChildren(...(keys.length
          ? keys.map((k) => {
            const tile = h("span.hunt-loot-tile", { "data-tip": itemName(k), dataset: { item: k } }, artEl(itemDef(k)), h("b", fmt(drops[k])));
            // What came in since the last look gives a little pop.
            if (was.size && (was.get(k) || 0) < drops[k] && !reducedMotion()) tile.classList.add("is-new");
            return tile;
          })
          : [h("span.hunt-loot-none", "Nothing yet")]));
      }
      setAttr(loot, "hidden", false);
    }

    function paintSolo(ctx, region, c, kls, down) {
      const state = ctx.state;
      const zone = getZone(c ? c.zone : lastZone) || GameData.ZONES[0];
      joinMode = false;

      /* A hunt on ground this build has never heard of belongs to a newer engine:
         name what can be named and carry on, rather than taking the page down. */
      const reg = c ? regionOfTier(c.tier) : null;
      setAttr(huntHead, "hidden", !c);
      if (c && zone) {
        setText(huntTitle, reg ? `The ${zone.name} of ${reg.name}` : `The ${zone.name}`);
        const notes = zoneNotes(zone).join(" · ");
        setText(huntSub, notes);
        setAttr(huntSub, "hidden", !notes);
        const line = companyLine(partyHere(ctx, c.tier, c.zone).names);
        if (line !== sigs.company) {
          sigs.company = line;
          company.replaceChildren(...(line ? [h("span.chip.chip-violet", iconEl("party"), line)] : []));
        }
        setAttr(company, "hidden", !line);
      }

      // ---- you ----
      const s = statsOf(state);
      // At camp health comes back slowly; the save keeps what you came home with.
      const rest = c ? null : campPlan(state, ctx.now);
      const hp = Math.max(0, Math.min(s.maxHp, Math.ceil(rest ? rest.hp : state.player.hp)));
      paintYou(ctx, hp, s.maxHp, kls, down);
      setAttr(walkYou, "hidden", false);
      setAttr(band, "hidden", true);

      // ---- the stage ----
      const fighting = !!(c && c.phase === "fight");
      huntCard.dataset.phase = fighting ? "fight" : c ? "search" : "quiet";
      huntCard.dataset.vast = "";
      const tier = c ? c.tier : region.tier;
      const vast = !!(c && !fighting && c.sovereignNext);
      if (c && !fighting) walkFull = Math.max(walkFull, c.wait, 1);
      else walkFull = 0;
      if (!c) {
        setWalk(down
          ? { title: "Recovering", label: "Back in", when: fmtTime(state.player.recoveryLeft), sub: "You are in no state to hunt." }
          : { title: `${region.name} lies quiet`, sub: "Nothing is being hunted here. Choose a zone below to take up the hunt." });
      } else if (!fighting) {
        setWalk(vast
          ? { title: "Something vast approaches", label: "Here in", when: secs(c.wait), trailOn: true }
          : { title: `Searching the ${zone.name}`, label: "Next encounter in", when: secs(c.wait), trailOn: true });
        paintTrail(1 - c.wait / walkFull, vast);
      } else {
        const sov = c.kind === "sovereign";
        const up = c.foes.length;
        const where = sov ? "A Sovereign" : `Fighting in the ${zone.name}`;
        if (sov) {
          const again = Math.max(0, c.enrageAt - c.clock);
          setFightHead({ title: `Encounter ${fmtWhole(c.encounters)}`, sub: `${where} · ${up} on you`,
            label: c.enrage ? `Enraged ×${c.enrage} · again in` : "Enrages in", when: secs(again), pill: "No others will come", pillIcon: "eye-off" });
        } else {
          const q = c.queued || 0;
          setFightHead({ title: `Encounter ${fmtWhole(c.encounters)}`, sub: `${where} · ${up} on you`,
            label: "Another steps out in", when: secs(Math.max(0, c.reinforceAt - c.clock)),
            pill: q ? (q === 1 ? "One waits in the dark" : `${cap(WORDS[q] || String(q))} wait in the dark`) : null });
        }
      }
      paintRecap(recap(c, c ? huntKey(c) : null));
      paintComing(tier, zone.id, vast, false);

      ring.sync({
        key: c ? `solo:${huntKey(c)}` : `quiet:${tier}`,
        party: false,
        tier,
        zoneIdx: ZONE_INDEX.get(zone.id) || 0,
        phase: fighting ? "fight" : c ? "search" : "quiet",
        enc: c ? c.encounters : 0,
        kind: c ? c.kind : "normal",
        vast,
        enrage: fighting && c.kind === "sovereign" ? c.enrage : 0,
        reinforceIn: fighting && c.kind === "normal" ? c.reinforceAt - c.clock : null,
        queued: fighting ? c.queued || 0 : 0,
        hunters: [{ id: "me", me: true, name: commanderName(ctx), skin: state.player.skin, klass: kls ? kls.id : null,
          hp, max: s.maxHp, veil: c ? c.veil / H.veilMax : 0, volley: c ? c.volley : 0, down }],
        foes: fighting ? c.foes.map((f) => ({ uid: f.uid, id: f.id, elite: f.elite, hp: Math.max(0, f.hp), max: f.max, timer: f.timer, target: "me" })) : [],
      });
      syncFoes(fighting ? c.foes : [], c ? huntKey(c) : null);
      drainFx(ctx.now);

      // ---- the numbers ----
      setAttr(kpis, "hidden", !c);
      soloStrip();
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
        setText(kLeft.v, fmtTime(Math.max(0, IDLE_CAP - c.elapsed)));
        paintLoot(c.drops || {});
      } else {
        setAttr(loot, "hidden", true);
      }

      setAttr(pullBtn, "hidden", !c);
      setText(pullBtn, "Pull back");
      setAttr(goBtn, "hidden", false);
      setAttr(goBtn, "disabled", down);
      setText(goBtn, down ? "Recovering" : c ? "Change hunt" : `Hunt the ${getZone(lastZone).name}`);
      toggleClass(huntCard, "is-party", false);
    }

    /* The party's fight. Nothing below is worked out here: every number comes off the last
       answer, which is what makes a disagreement with the server impossible rather than
       merely unlikely. Its blows are read off what each answer took, so the ring shows
       where they landed rather than every swing: a quieter fight, and the right trade. */
    function paintParty(ctx, view, { watching = false, fell = false } = {}) {
      const zone = getZone(view.zone);
      const region = regionOfTier(view.tier);
      const me = ctx.account ? ctx.account.userId : null;
      const names = namesOf(ctx);
      const skins = skinsOf(ctx);
      const hunters = Array.isArray(view.hunters) ? view.hunters : [];
      const mine = watching ? null : hunters.find((u) => sameId(u.userId, me)) || null;
      const e = view.phase === "fight" ? view.enc : null;
      const enc = e && Array.isArray(e.foes) && Array.isArray(e.hunters) ? e : null;
      joinMode = watching;

      // A new answer: the clocks in it run on from now, on the ring and on the walk.
      const fresh = view !== partySeen;
      if (fresh) {
        partySeen = view;
        partySeenAt = performance.now();
      }
      const since = performance.now() - partySeenAt;

      setAttr(huntHead, "hidden", false);
      setText(huntTitle, `The ${zone.name} of ${region.name}`);
      /* Watching is either a fall or never having gone. A fall is said plainly, because the
         stage going quiet on somebody who was fighting a second ago reads as the game losing
         them; the party is still out, and the camp can see it and walk back on. */
      setText(huntSub, !watching
        ? "The party's hunt · XP by your share, gold and drops the same for everyone"
        : fell
          ? "You fell. Your party fights on, and you can rejoin on their next walk"
          : "Your party is out without you. Join them and you come in on their next walk");
      setAttr(huntSub, "hidden", false);
      const chip = `${hunters.length} out together`;
      if (chip !== sigs.company) {
        sigs.company = chip;
        company.replaceChildren(h("span.chip.chip-violet", iconEl("party"), chip));
      }
      setAttr(company, "hidden", false);

      /* Whoever joined after an encounter had begun is in the session but not in that fight:
         the roster of foes was drawn for the party that walked into it. They are in on the
         next one, and saying so is the only way their nothing-happening makes sense. */
      const inEnc = (u) => !enc || enc.hunters.some((x) => sameId(x.userId, u.userId));
      const fighting = !!(enc && mine && inEnc(mine));

      // ---- the party, you first ----
      /* A camp watching is not on the session, so it is not in the view either; it is put
         back in the band where it stood, fallen or at camp, so the rows still read as the
         party it belongs to rather than a party of strangers. */
      const all = hunters.slice().sort((a, b) => (sameId(a.userId, me) ? -1 : sameId(b.userId, me) ? 1 : 0));
      if (watching && me) all.unshift({ userId: me, down: fell, hp: 0, max: 1, note: fell ? "Fallen" : "At camp" });
      syncBand(all, names, skins, inEnc, me);
      setAttr(walkYou, "hidden", true);
      setAttr(band, "hidden", false);

      // ---- the stage ----
      huntCard.dataset.phase = enc ? "fight" : "search";
      huntCard.dataset.vast = "";
      const wait = Math.max(0, (view.wait || 0) - since);
      if (!enc) walkFull = Math.max(walkFull, view.wait || 0, 1);
      else walkFull = 0;
      if (!enc && view.muster > 0) {
        // The first walk, held until everyone who marked ready is on the ground.
        setWalk({ title: `Gathering at the ${zone.name}`, label: "Waiting on", when: `${fmtWhole(view.muster)} more`, sub: "Everyone who marked ready walks in together." });
      } else if (!enc && view.vast) {
        // The walk to the ground's Sovereign, said the way your own hunt says it.
        setWalk({ title: "Something vast approaches", label: "Here in", when: secs(wait), trailOn: true });
        paintTrail(1 - wait / walkFull, true);
      } else if (!enc) {
        setWalk({ title: `Searching the ${zone.name}`, label: "Next encounter in", when: secs(wait), trailOn: true });
        paintTrail(1 - wait / walkFull, false);
      } else {
        const sov = enc.kind === "sovereign";
        const up = enc.foes.filter((f) => getMonster(f.id)).length;
        const sub = watching
          ? `${sov ? "A Sovereign" : `Fighting in the ${zone.name}`} · you are watching`
          : !fighting
            ? "In on the next encounter · this one was drawn for the party that walked into it"
            : `${sov ? "A Sovereign" : `Fighting in the ${zone.name}`} · ${up} on the party`;
        if (sov && Number.isFinite(enc.enrageIn)) {
          const again = Math.max(0, enc.enrageIn - since);
          setFightHead({ title: `Encounter ${fmtWhole(view.encounters)}`, sub,
            label: enc.enrage ? `Enraged ×${enc.enrage} · again in` : "Enrages in", when: secs(again), pill: "No others will come", pillIcon: "eye-off" });
        } else if (!sov && Number.isFinite(enc.reinforceIn)) {
          setFightHead({ title: `Encounter ${fmtWhole(view.encounters)}`, sub, label: "Another steps out in", when: secs(Math.max(0, enc.reinforceIn - since)) });
        } else {
          setFightHead({ title: `Encounter ${fmtWhole(view.encounters)}`, sub, pill: sov ? "No others will come" : null, pillIcon: "eye-off" });
        }
      }
      paintRecap(null);
      paintComing(view.tier, zone.id, !enc && !!view.vast, true);

      // Only a new answer is news to the ring: the same one again would set its clocks back.
      if (fresh) {
        const session = new Map(hunters.map((u) => [lower(u.userId), u]));
        const fought = enc ? enc.hunters : hunters;
        ring.sync({
          key: `party:${view.partyId}`,
          party: true,
          tier: view.tier,
          zoneIdx: ZONE_INDEX.get(zone.id) || 0,
          phase: enc ? "fight" : "search",
          enc: enc ? enc.id : 0,
          kind: enc ? enc.kind : "normal",
          vast: !enc && !!view.vast,
          enrage: enc && enc.kind === "sovereign" ? enc.enrage || 0 : 0,
          reinforceIn: enc && Number.isFinite(enc.reinforceIn) ? enc.reinforceIn : null,
          queued: 0,
          hunters: fought.map((u) => {
            const id = lower(u.userId);
            const isMe = !watching && sameId(u.userId, me);
            const s = session.get(id) || u;
            return {
              id, me: isMe,
              name: isMe ? commanderName(ctx) : names.get(id) || "Someone",
              skin: isMe ? ctx.state.player.skin : skins.get(id) || null,
              klass: u.klass || s.klass || null,
              hp: Math.max(0, u.hp || 0), max: Math.max(1, u.max || 1),
              veil: Number.isFinite(u.veil) ? u.veil / H.veilMax : 0, volley: u.volley || 0,
              down: !!u.down, share: Number.isFinite(s.share) ? s.share : null,
            };
          }),
          foes: enc ? enc.foes.filter((f) => getMonster(f.id)).map((f) => ({
            uid: f.uid, id: f.id, elite: !!f.elite, hp: Math.max(0, f.hp), max: Math.max(1, f.max),
            // A realm from before the timers were sent: the foe waits mid-ring and keeps its own time from there.
            timer: Number.isFinite(f.timer) ? f.timer : getMonster(f.id).speed * 0.6,
            target: f.target ? lower(f.target) : null,
          })) : [],
        });
      }
      fxQueue.length = 0;

      // A foe this build cannot name is left out rather than drawn as an unknown.
      const onOf = (f) => {
        if (!f.target) return null;
        if (sameId(f.target, me)) return "On you";
        return `On ${names.get(lower(f.target)) || "someone"}`;
      };
      syncFoes(enc ? enc.foes.filter((f) => getMonster(f.id)) : [], enc ? `p${view.partyId}:${enc.id}` : null, onOf);
      toggleClass(huntCard, "is-party", true);

      // ---- the numbers ----
      const total = hunters.reduce((n, u) => n + (u.dmg || 0), 0);
      setAttr(kpis, "hidden", false);
      setAttr(loot, "hidden", true);
      setAttr(kShare.node, "hidden", false);
      setText(kKills.l, "Encounters");
      setText(kKills.v, fmtWhole(view.encounters));
      setText(kDps.l, "Party damage");
      setText(kDps.v, fmt(Math.round(total)));
      setText(kLeft.l, "Time out");
      setText(kLeft.v, fmtTime(view.elapsed));
      if (watching) {
        // Nothing of this is yours any more: what you did was paid when you fell.
        const standing = hunters.filter((u) => !u.down).length;
        setText(kRate.l, "Standing");
        setText(kRate.v, `${fmtWhole(standing)} of ${fmtWhole(hunters.length)}`);
        setText(kShare.l, "You");
        setAttr(kShareBar, "hidden", true);
        setText(kShare.v, fell ? "Fallen" : "At camp");
      } else {
        /* A share is the payout's own formula over the whole session's damage dealt and
           taken (sessionView), the one figure worth watching in a fight whose spoils are
           split that way. The server sends it as a percent. */
        const share = mine && Number.isFinite(mine.share) ? mine.share : 0;
        setText(kRate.l, "Your damage");
        setText(kRate.v, fmt(Math.round(mine ? mine.dmg : 0)));
        setText(kShare.l, "Your share");
        setAttr(kShareBar, "hidden", false);
        setText(kShare.v, `${Math.round(share)}%`);
        setWidth(kShare.fill, share);
      }

      setAttr(pullBtn, "hidden", watching);
      setText(pullBtn, "Break away");
      setAttr(goBtn, "hidden", !watching);
      if (watching) {
        setText(goBtn, "Join your party");
        setAttr(goBtn, "disabled", recovering(ctx.state) || hunters.length >= CONFIG.party.maxSize);
      }
    }

    /* The party on the walk, you first: a face, the glyph and name, their health and their
       share of the take so far, a row each. */
    function syncBand(all, names, skins, inEnc, me) {
      const sig = all.map((u) => `${u.userId}:${u.down ? 1 : 0}:${u.note || ""}:${u.klass || ""}:${skins.get(lower(u.userId)) || ""}`).join("|");
      if (sig !== sigs.band) {
        sigs.band = sig;
        mates.clear();
        bandRows.replaceChildren(...all.map((u) => {
          const fill = h("i");
          const text = h("span");
          const share = h("em.hunt-mate-share");
          const shareFill = h("i");
          const isMe = sameId(u.userId, me);
          const label = isMe ? "You" : (names.get(lower(u.userId)) || "Someone");
          const kls = u.klass ? getClass(u.klass) : null;
          /* Your own face is yours. A party mate's skin comes off the realm when it knows
             one, and falls back to the default bust when it does not. */
          const node = h("div.band-mate", { class: { "is-down": u.down, "is-me": isMe } },
            h("span.hunt-face.is-sm", h("span.hunt-face-in.portrait-bust", portraitImg(isMe ? ctx.state.player.skin : skins.get(lower(u.userId)) || null))),
            h("div.band-main",
              h("div.band-line", kls ? h("span.hunt-klass", { title: kls.name }, iconEl(kls.icon || kls.id)) : null, h("b.band-name", label), share),
              h("div.hpbar.hpbar-sm", fill, text),
              h("div.hunt-sharebar", shareFill)));
          mates.set(lower(u.userId), { fill, text, share, shareFill });
          return node;
        }));
      }
      all.forEach((u) => {
        const row = mates.get(lower(u.userId));
        if (!row) return;
        const max = u.max > 0 ? u.max : 1;
        setWidth(row.fill, (Math.max(0, u.hp) / max) * 100);
        setText(row.text, u.note || (u.down ? "Fallen" : inEnc(u) ? `${fmt(Math.max(0, u.hp))} / ${fmt(max)}` : "Waiting"));
        const sh = Number.isFinite(u.share) ? u.share : null;
        setText(row.share, sh == null ? "" : `${Math.round(sh)}%`);
        setWidth(row.shareFill, sh || 0);
      });
    }

    /* Everyone standing on this region's ground, once each. You are where your own hunt or
       the party's fight is, or at camp when you are not out at all (a hunt elsewhere is the
       away chip's to say). Your party comes off its roster, the realm off ground_hunters();
       a member the realm also names is drawn as party, and the realm never draws you. */
    function huntersOn(ctx, tier, down) {
      const state = ctx.state;
      const c = state.tasks.combat;
      const mine = c || partyFight(ctx);
      const me = ctx.account ? ctx.account.userId : null;
      const skin = state.player.skin;
      const out = [];
      if (mine && mine.tier === tier) {
        out.push({ id: "me", kind: "me", zone: mine.zone, name: "You", skin, tip: `You · the ${getZone(mine.zone).name}` });
      } else if (!mine) {
        out.push({ id: "me", kind: "me", zone: null, name: "You", skin, down, tip: down ? "You · at camp, recovering" : "You · at camp" });
      }
      const seen = new Set();
      const myName = (ctx.account && ctx.account.username) || state.meta.account;
      if (myName) seen.add(String(myName).toLowerCase());
      const members = ctx.party && Array.isArray(ctx.party.members) ? ctx.party.members : [];
      members.forEach((m) => {
        if (!m || sameId(m.user_id, me)) return;
        const name = String(m.username || "");
        if (!name) return;
        seen.add(name.toLowerCase());
        const hunt = liveHunt(m.hunt, ctx.now);
        if (!hunt || hunt.tier !== tier) return;
        out.push({ id: `p:${lower(m.user_id)}`, kind: "party", zone: hunt.zone, name: cap(name), skin: typeof m.skin === "string" ? m.skin : null,
          href: `#/player/${encodeURIComponent(name)}`, tip: `${cap(name)} · your party` });
      });
      realmOn(ctx, tier).rows.forEach((row) => {
        const name = row && typeof row.username === "string" ? row.username : "";
        if (!name || seen.has(name.toLowerCase()) || !ZONE_IDS.has(row.zone)) return;
        seen.add(name.toLowerCase());
        const kls = getClass(row.discipline);
        const since = serverMs(row.started_at);
        out.push({ id: `r:${name.toLowerCase()}`, kind: "realm", zone: row.zone, name: cap(name), skin: typeof row.skin === "string" ? row.skin : null,
          href: `#/player/${encodeURIComponent(name)}`,
          tip: [cap(name), kls ? kls.name : null, Number.isFinite(since) ? outFor(ctx.now - since) : null].filter(Boolean).join(" · ") });
      });
      return out;
    }

    /* ================= THE QUARRY ================= */

    /* One of the region's four, as it stands in the zone you hunt (or last looked at):
       its numbers at that depth, what a kill of it pays you now, and what it leaves. */
    function plateSig(ctx, tier, zoneId) {
      const state = ctx.state;
      return [tier, zoneId, platePick, Math.round(xpMult(state, "warfare", ctx.now) * 1000), companionBonus(state, "gold"), companionBonus(state, "drops")].join("|");
    }

    function paintPlate(ctx) {
      const state = ctx.state;
      const c = state.tasks.combat;
      const party = partyFight(ctx);
      const tier = currentRegion(state).tier;
      const here = c && c.tier === tier ? c : party && party.tier === tier ? party : null;
      const z = getZone(here ? here.zone : lastZone);
      const list = [...foesOf(tier), sovereignOf(tier)];
      // The commonest in the zone to begin with.
      if (!platePick || !list.some((m) => m.id === platePick)) {
        platePick = foesOf(tier).slice().sort((a, b) => (z.mix[b.archetype] || 0) - (z.mix[a.archetype] || 0))[0].id;
      }
      const sig = plateSig(ctx, tier, z.id);
      if (sig === sigs.plate) return;
      sigs.plate = sig;

      const tabsSig = `${tier}|${platePick}`;
      if (tabsSig !== sigs.tabs) {
        sigs.tabs = tabsSig;
        plateTabs.replaceChildren(...list.map((m) => {
          const sov = m.archetype === "sovereign";
          const picked = m.id === platePick;
          return h("button.quarry-tab", { type: "button", role: "tab", class: { "is-sov": sov }, "aria-selected": picked, tabindex: picked ? "0" : "-1", dataset: { monster: m.id } },
            h("span.quarry-tab-face", { html: monsterArt(m) }),
            h("span.quarry-tab-text", h("b", m.name), h("small", sov ? "Sovereign" : GameData.ARCHETYPES[m.archetype].name)));
        }));
      }

      const m = list.find((x) => x.id === platePick) || list[0];
      const sov = m.archetype === "sovereign";
      const n = foeNumbers(m, false, z.power);
      const base = n.xp * z.xp;
      const xp = base * xpMult(state, "warfare", ctx.now);
      const goldMult = 1 + companionBonus(state, "gold");
      const dropMult = 1 + companionBonus(state, "drops");
      const mix = z.mix[m.archetype] || 0;
      const where = sov
        ? "Sovereign · it walks the Inner and the Core"
        : `${GameData.ARCHETYPES[m.archetype].name} · ${mix >= 0.35 ? `the ${z.name} is thick with them` : mix >= 0.2 ? `common in the ${z.name}` : `seldom seen in the ${z.name}`}`;
      const stat = (l, v, cls) => h("div.quarry-stat", { class: cls }, h("span", l), h("b", v));
      const band = veilBandOfTier(tier);
      const reagent = m.drops.find((d) => d[0] === "@reagent");
      const drops = [];
      if (reagent) {
        const [, qty, chance] = reagent;
        const odds = Math.min(1, chance * dropMult);
        drops.push(h("span.quarry-drop",
          h("span.quarry-reagents", GameData.REAGENTS.map((r) => artEl(itemDef(r.id)))),
          `${qty > 1 ? `${qty} reagents` : "A reagent"} `, h("em", odds >= 1 ? "always" : `${chancePct(odds)} of kills`)));
      }
      m.drops.filter((d) => d[0] !== "@reagent").forEach(([key, qty, chance]) => {
        drops.push(h("button.quarry-drop", { type: "button", dataset: { item: key } }, artEl(itemDef(key)), `${itemName(key)}${qty > 1 ? ` ×${qty}` : ""} `, h("em", chancePct(Math.min(1, chance * dropMult)))));
      });
      const veilKey = sov ? essenceOfTier(tier) : fragmentOfTier(tier);
      if (veilKey) {
        drops.push(h("button.quarry-drop.is-veil", { type: "button", dataset: { item: veilKey } }, artEl(itemDef(veilKey)),
          `${band.name} ${sov ? "Essence" : "Fragment"} `, h("em", sov ? "felled, always" : "Elites, Inner and Core")));
      }
      plateBody.replaceChildren(
        h("button.quarry-art", { type: "button", class: { "is-sov": sov }, "aria-label": `${m.name}: everything about it`, dataset: { monster: m.id }, html: monsterArt(m) }),
        h("div.quarry-info",
          h("span.quarry-eyebrow", { class: { "is-sov": sov } }, where),
          h("h3.quarry-name", m.name),
          h("p.quarry-note", sov ? "It rules this ground. It comes with two Elites at its back and grows angrier the longer the fight runs." : GameData.ARCHETYPES[m.archetype].note),
          h("div.quarry-stats",
            stat("Health", fmt(n.hp)),
            stat("Attack", fmtStat(n.attack)),
            stat("Swings every", `${(m.speed / 1000).toFixed(1)}s`),
            stat("Defence", fmtStat(m.defence)),
            stat("A kill pays", h("span", `${fmtStat(xp)} XP`, h("small", `${fmtGold(Math.round(n.gold[0] * goldMult))} to ${fmtGold(Math.round(n.gold[1] * goldMult))}`))),
            stat("Mastery a kill", `+${fmtStat(base * CONFIG.mastery.perKill)}`, "is-mastery")),
          h("p.quarry-small", z.power === 1 && z.xp === 1
            ? `As it stands in the ${z.name}, the plain ground. Mastery goes to the weapon in your hands.`
            : `As it stands in the ${z.name}: health and attack ×${z.power}, XP ×${z.xp}. Mastery goes to the weapon in your hands.${sov ? ` It enrages: +${Math.round(GameData.SOVEREIGN.enrage * 100)}% attack every ${GameData.SOVEREIGN.enrageMs / 1000}s.` : ""}`),
          h("div.quarry-drops", h("span.quarry-drops-l", "Leaves"), drops)));
    }

    function paintGround(ctx, region, c, down) {
      const tier = region.tier;
      /* A hunt already under way locks every other zone: pull back before picking a new one.
         Both fights hold a tier and a zone, so the map marks either one. */
      const members = ctx.party && Array.isArray(ctx.party.members) ? ctx.party.members : [];
      map.paint({
        tier,
        active: c && c.tier === tier ? c.zone : null,
        locked: !!c,
        hunters: huntersOn(ctx, tier, down),
        counts: realmOn(ctx, tier).counts,
        party: members.length > 1,
        view: groundView,
      });

      // Travel doesn't end a hunt: say where it is when that isn't here.
      const elsewhere = !!(c && c.tier !== tier);
      setAttr(away, "hidden", !elsewhere);
      if (elsewhere) {
        const there = regionOfTier(c.tier);
        setText(awayText, there ? `The hunt is out in ${there.name}` : "The hunt is out elsewhere");
      }

      if (sigs.quarry !== tier) {
        sigs.quarry = tier;
        setText(quarrySub, `What lives in ${region.name}, as it stands in the zone you hunt. Pick one to see it up close.`);
      }
      paintPlate(ctx);
    }

    // In a party, signed in, and a realm that can say whether the party is out.
    const canWatch = (ctx) => !!(ctx.account && ctx.account.mode === "account" && ctx.party && ctx.party.party
      && ctx.net && ctx.net.party && typeof ctx.net.party.huntView === "function");

    function askWatch(ctx) {
      if (watchAsking) return;
      watchAsking = true;
      watchAt = Date.now();
      Promise.resolve()
        .then(() => ctx.net.party.huntView())
        .then((res) => {
          const v = res && !res.error && res.data && typeof res.data === "object" ? res.data : null;
          watch = v && !v.over && Array.isArray(v.hunters) && regionOfTier(v.tier) ? v : null;
          // The realm says the party is not out: whatever this camp fell in is over.
          if (!watch) fell = false;
        })
        .catch(() => {})
        .finally(() => { watchAsking = false; });
    }

    /* The fight this camp is watching rather than on. The answer that settled a fall still
       carries the view (without this camp in it), so that is drawn straight away; after
       that the realm is asked every few seconds. */
    function watchedFight(ctx) {
      const v = ctx.store ? ctx.store.partyHunt : null;
      if (v && !v.over && Array.isArray(v.hunters) && regionOfTier(v.tier)) return v;
      return watch;
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

      // A hunt of your own, or back on the party's: nothing is being watched.
      if (c || party) {
        watch = null;
        fell = false;
      }
      onFight = !!party;
      if (!c && !party && canWatch(ctx)) {
        if (Date.now() - watchAt >= WATCH_MS) askWatch(ctx);
      } else if (!party && !c) {
        watch = null;
        fell = false;
      }
      const watching = !c && !party ? watchedFight(ctx) : null;

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
      const shown = party || watching;
      if (!!shown !== wasParty) {
        wasParty = !!shown;
        sigs.band = null;
        sigs.company = null;
        sigs.coming = null;
        partySeen = null;
        walkFull = 0;
        cards.forEach((card) => card.node.remove());
        cards.clear();
        // Blows queued off the fight that just ended have nothing left to land on.
        fxQueue.length = 0;
      }
      if (party) paintParty(ctx, party);
      else if (watching) paintParty(ctx, watching, { watching: true, fell });
      else paintSolo(ctx, region, c, kls, down);
      // Both fights hold a tier and a zone, so the ground below marks either one.
      paintGround(ctx, region, c || shown, down);
    }

    update(ctx);
    return {
      update,
      unmount() {
        timers.forEach((t) => clearTimeout(t));
        timers.clear();
        offNews();
        ring.destroy();
        map.destroy();
      },
    };
  },
};
