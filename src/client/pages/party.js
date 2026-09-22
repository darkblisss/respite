/* ============================================================
   Respite · pages/party.js · The Muster
   ------------------------------------------------------------
   #/party (UI-KIT 8.15): found or join a party, see what the
   others are about, and talk. The realm owns the party; every
   change is an RPC (ctx.net.party) followed by the store's
   refreshParty(), with realtime pokes and a five-second poll
   while the page is open.

   The party is a room of four squares. A square holds whoever is
   sitting in it (the face, the host's remove in the top corner
   with the Hunt level under it, and the crown, the name and what
   they are at along the bottom), stands open and says Waiting, or
   carries the host's cross. Anyone may put a ground up, everyone
   marks ready for it, and the host's press sends the whole room
   out at once. Squares are rebuilt when the roster, the seats or
   the marks change and repainted in place every second for what
   each of them is at. Opening and closing a square flips it under
   the press and the realm's answer confirms it.

   The bonus is the rules' own: partyMult() over the others' hunt
   presence, read against your hunt right now. Chat appends what
   is new and only follows the bottom when you are already there.
   Guests get a sign-in card instead.

   Setting out together lives here rather than in the zone sheet:
   that sheet is a lone hunter's projection of their own twelve
   hours, and it is opened by the many players who have no party.
   Founding, joining and leaving are already here, and this is the
   one page that can see whether the party is out at all. The
   fight itself is the server's; this page only names it and the
   Hunt page draws it.
   ============================================================ */

import { h, setText, setAttr, toggleClass } from "../ui/dom.js";
import { iconEl } from "../ui/icons.js";
import { confirm, openModal, toast } from "../ui/overlay.js";
import { fmtWhole, fmtTime, fmtAgo, plural } from "../ui/format.js";
import { openPopup, portraitImg } from "../ui/widgets.js";
import { CONFIG } from "../../shared/config.js";
import { GameData, findAction, getSkill, getZone, regionOfTier } from "../../shared/registry.js";
import { partyMult } from "../../shared/progression.js";
import { recovering, skillLevel } from "../../shared/stats.js";
import { currentRegion } from "../../shared/world.js";
import { markRead, newestMessage } from "../partyRead.js";

const P = CONFIG.party;
const ONLINE_MS = 3 * 60 * 1000;   // last_seen this recent counts as online, as online_count() does
const POLL_MS = 5000;
const ASK_MS = 20 * 1000;
const CHAT_MAX = 240;
const CHAT_NEAR = 200;
const NAME_MAX = 24;
const PER = Math.round(P.huntBonusPerMember * 100);
const CAP = Math.round(P.huntBonusCap * 100);
const RULE = `Hunt the same ground at the same time: +${PER}% Hunt XP for each of you there, up to +${CAP}%.`;

// The artisans' work, as a word; the trades are already named for theirs (Delving, Felling).
const WORKING = { forgemaster: "Forging", woodwright: "Carving", tanner: "Tanning", weaver: "Weaving", artificer: "Crafting" };

const EMPTY_STATE = Object.freeze({ party: null, members: [], invites_in: [], invites_out: [], messages: [] });

/* ================= SMALL PIECES ================= */

const when = (iso) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

const display = (name) => {
  const s = String(name == null ? "" : name);
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Someone";
};

const initial = (name) => display(name).charAt(0);
const list = (v) => (Array.isArray(v) ? v : []);
const sameId = (a, b) => a != null && b != null && String(a).toLowerCase() === String(b).toLowerCase();

// A presence row counts from its start until it ended, or until it would have.
function presence(hunt, now) {
  if (!hunt || typeof hunt !== "object") return null;
  const start = when(hunt.started_at);
  const end = hunt.ended_at ? when(hunt.ended_at) : when(hunt.ends_by);
  if (start == null || end == null || !(start <= now && now < end)) return null;
  return { tier: Number(hunt.tier), zone: String(hunt.zone), start, end };
}

// How long a hunt has run, to the minute: a card that ticks every second is noise.
function huntFor(ms) {
  if (ms < 60 * 1000) return "just begun";
  return ms < 60 * 60 * 1000 ? `${Math.floor(ms / 60000)}m` : fmtTime(Math.floor(ms / 60000) * 60000);
}

// "the Inner of Gallowmoor", "the Outer of the Ashen Verge".
function ground(tier, zone) {
  const region = regionOfTier(tier);
  const where = region ? region.name.replace(/^The /, "the ") : `tier ${tier} ground`;
  return `the ${getZone(zone).name} of ${where}`;
}

// What the heartbeat says someone works at. Only registry names reach the screen, never the payload.
function workOf(activity) {
  if (!activity || typeof activity !== "object" || typeof activity.skill !== "string") return null;
  const skill = getSkill(activity.skill);
  if (!skill || skill.id === "warfare") return null;
  const def = typeof activity.action === "string" ? findAction(skill.id, activity.action) : null;
  const verb = WORKING[skill.id] || skill.name;
  return { icon: skill.icon, text: def ? `${verb} ${def.name}` : verb };
}

function cardHead(title, { sub = null, actions = null } = {}) {
  return h("div.card-head",
    h("div", h("h2.card-title", title), sub ? h("p.card-sub", sub) : null),
    actions ? h("div.card-actions", actions) : null);
}

function emptyState({ icon, title, text, action = null, small = true }) {
  return h("div.empty", { class: small && "empty-sm" },
    h("div.empty-art", iconEl(icon)),
    h("div.empty-title", title),
    text ? h("p.empty-text", text) : null,
    action);
}

function busy(btn, on) {
  if (!btn) return;
  toggleClass(btn, "is-loading", !!on);
  btn.disabled = !!on;
}

// Every RPC answers { data, error }; a thrown fetch, or one that never comes back, becomes an error
// too, so nothing waits forever and nothing throws into the loop.
async function ask(fn) {
  let timer = 0;
  try {
    const res = await Promise.race([
      Promise.resolve().then(fn),
      new Promise((resolve) => { timer = setTimeout(() => resolve({ data: null, error: "The realm is slow to answer. Look again in a moment." }), ASK_MS); }),
    ]);
    return res && typeof res === "object" ? res : { data: null, error: null };
  } catch (err) {
    return { data: null, error: "The road to the realm is closed. Try again in a moment." };
  } finally {
    clearTimeout(timer);
  }
}

function pageHead({ eyebrow, title, sub, extra = null, actions = null }) {
  return h("header.page-head",
    h("div",
      h("div.eyebrow.page-eyebrow", eyebrow),
      h("h1.page-title", title),
      h("p.page-sub", sub),
      extra),
    actions ? h("div.page-actions", actions) : null);
}

function signInCard(ctx) {
  return h("section.card",
    h("div.empty",
      h("div.empty-art", iconEl("lock")),
      h("div.empty-title", "Sign in to march together"),
      h("p.empty-text", `Parties, their chat and the shared hunt bonus are kept by the realm, and the realm needs a name. Up to ${P.maxSize} to a party. Guests march alone.`),
      h("div.btn-row",
        h("button.btn.btn-gold", { type: "button", onClick: () => openPopup("account", ctx, { mode: "create" }) }, "Create account"),
        h("button.btn", { type: "button", onClick: () => openPopup("account", ctx, { mode: "signin" }) }, "Sign in"))));
}

/* ================= THE PAGE ================= */

export default {
  id: "party",
  title: () => "Party",
  group: "The Vanguard",

  mount(view, ctx) {
    const page = h("div.page");
    view.replaceChildren(page);
    let body = null;
    let who = null;

    function render() {
      const acc = ctx.account;
      who = `${acc.mode}:${acc.userId || ""}`;
      if (body) body.destroy();
      body = null;
      if (acc.mode === "guest") {
        page.replaceChildren(pageHead({ eyebrow: "The Realm", title: "Party", sub: RULE }), signInCard(ctx));
      } else {
        body = partyBody(ctx, page);
      }
    }

    render();
    return {
      update() {
        const acc = ctx.account;
        if (`${acc.mode}:${acc.userId || ""}` !== who) render();
        else if (body) body.update();
      },
      unmount() {
        if (body) body.destroy();
        body = null;
      },
    };
  },
};

/* ================= SIGNED IN ================= */

function partyBody(ctx, page) {
  let alive = true;
  let local = null;        // party_state asked for directly, while the store has none
  let remoteFight = null;  // party_hunt_view(), for a fight this camp is not out on
  let failed = null;       // why the first answer never came
  let inFlight = false;
  let again = false;
  let pokeTimer = 0;
  let shape = "";
  let view = null;         // the painter for the current shape
  let painted = null;      // the party_state object last painted
  let lastSecond = -1;
  let subKey;              // what realtime is following (see follow)
  let unsub = null;

  const current = () => ctx.party || local;
  const meId = () => ctx.account.userId;

  /* The party's fight. The store has it whenever this camp is out on one, because the server
     sends it back with every answer; nobody else is ever told that way, so a member who has
     not joined asks the realm for it. Whichever it is, it is the server's word and nothing
     here plays it forward. */
  const liveFight = () => (ctx.store && ctx.store.partyHunt) || remoteFight;
  const outOn = (fight) => {
    const me = meId();
    return !!(fight && Array.isArray(fight.hunters) && fight.hunters.some((u) => u && sameId(u.userId, me)));
  };

  /* ---------- asking the realm ---------- */

  async function refresh() {
    if (inFlight) {
      again = true;
      return;
    }
    inFlight = true;
    const got = await ask(async () => ({ data: await ctx.store.refreshParty(), error: null }));
    const st = got.error ? null : got.data;
    // The store keeps nothing when it has no party to show: ask directly, so an error can be told apart.
    if (alive && !st && !ctx.party) {
      const res = await ask(() => ctx.net.party.state());
      if (res.error) {
        if (!local) failed = String(res.error);
      } else {
        local = res.data && typeof res.data === "object" ? res.data : EMPTY_STATE;
        failed = null;
      }
    } else if (st || ctx.party) {
      local = null;
      failed = null;
    }
    if (alive) await refreshFight();
    inFlight = false;
    if (!alive) return;
    paint(true);
    if (again) {
      again = false;
      refresh();
    }
  }

  /* Only when the store has none of its own: the answer to a game request carries the fight this
     camp is out on, and that costs nothing. A request of its own is worth spending only for the
     one thing an answer can never say, which is that the rest of the party is out without you. */
  async function refreshFight() {
    if (ctx.store && ctx.store.partyHunt) {
      remoteFight = null;
      return;
    }
    const st = current();
    if (!st || !st.party || typeof ctx.net.party.huntView !== "function") {
      remoteFight = null;
      return;
    }
    const res = await ask(() => ctx.net.party.huntView());
    if (!alive) return;
    const view = !res.error && res.data && typeof res.data === "object" ? res.data : null;
    remoteFight = view && !view.over ? view : null;
  }

  // Realtime pokes come in bursts (a message, a member row, an invite): one refresh for the lot.
  function poke() {
    clearTimeout(pokeTimer);
    pokeTimer = setTimeout(() => { if (alive) refresh(); }, 250);
  }

  /* target: a party id, null for no party (realtime then pokes on invites to you), or
     undefined for nothing at all (still loading, failed, or gone). */
  function follow(target) {
    const key = target === undefined ? undefined : target || "";
    if (key === subKey) return;
    if (unsub) {
      try { unsub(); } catch (err) { /* already gone */ }
    }
    unsub = null;
    subKey = key;
    if (key === undefined) return;
    try {
      const off = ctx.net.party.subscribe(target || null, poke);
      unsub = typeof off === "function" ? off : null;
    } catch (err) {
      unsub = null;   // the five-second poll still covers it
    }
  }

  /* ---------- choosing what to show ---------- */

  function paint(force = false) {
    const st = current();
    let next;
    if (st) next = st.party ? `party:${st.party.id}` : "none";
    else next = failed ? "failed" : "loading";

    if (next !== shape) {
      shape = next;
      if (view && view.destroy) view.destroy();
      view = next === "loading" ? loadingView()
        : next === "failed" ? failedView()
          : next === "none" ? aloneView()
            : partyView();
      follow(!st ? undefined : st.party ? st.party.id : null);
      force = true;
    }
    if (!view || !view.paint) return;
    const second = Math.floor(ctx.now / 1000);
    if (force || st !== painted || second !== lastSecond) {
      painted = st;
      lastSecond = second;
      view.paint(st || EMPTY_STATE);
    }
  }

  function loadingView() {
    page.replaceChildren(
      pageHead({ eyebrow: "The Realm", title: "Party", sub: RULE }),
      h("div.grid-cards.max-2.realm-skel", { "aria-hidden": "true" }, [0, 1].map(() => h("section.card",
        h("div.hstack.gap-3", h("span.skel.skel-art"), h("div.grow", h("span.skel.skel-line.skel-w-60"), h("span.skel.skel-line.skel-w-35"))),
        h("span.skel.skel-line.skel-w-80.mt-4")))),
      h("div.loading", h("span.spinner", { role: "status", "aria-label": "Loading" }), "Asking the realm"));
    return null;
  }

  function failedView() {
    page.replaceChildren(
      pageHead({ eyebrow: "The Realm", title: "Party", sub: RULE }),
      h("section.card", emptyState({
        icon: "offline",
        title: "The realm did not answer",
        text: `${failed} Your camp is fine.`,
        action: h("button.btn.btn-sm", { type: "button", onClick: () => { failed = null; paint(); refresh(); } }, iconEl("sync"), "Retry"),
        small: false,
      })));
    return null;
  }

  /* ---------- not in a party ---------- */

  function aloneView() {
    const nameInput = h("input.input.input-sm", { type: "text", placeholder: "Party name", "aria-label": "Party name", maxlength: String(NAME_MAX), autocomplete: "off", enterkeyhint: "go" });
    const foundBtn = h("button.btn.btn-primary.btn-sm", { type: "submit" }, "Found a party");
    const hint = h("span.field-hint.t-bad", { hidden: true, role: "alert" });
    const invitesBox = h("div");
    let invitesSig = null;

    async function found(e) {
      e.preventDefault();
      const name = nameInput.value.trim();
      if (!name || name.length > NAME_MAX) {
        hint.hidden = false;
        setText(hint, `Party names are 1 to ${NAME_MAX} characters.`);
        nameInput.focus();
        return;
      }
      hint.hidden = true;
      busy(foundBtn, true);
      const res = await ask(() => ctx.net.party.create(name));
      if (!alive) return;
      busy(foundBtn, false);
      if (res.error) {
        hint.hidden = false;
        setText(hint, String(res.error));
        return;
      }
      toast(`${name} is founded`, { kind: "good", icon: "party" });
      refresh();
    }

    page.replaceChildren(
      pageHead({ eyebrow: "The Realm", title: "Party", sub: RULE }),
      h("section.card", h("div.empty",
        h("div.empty-art", iconEl("party")),
        h("div.empty-title", "You march alone"),
        h("p.empty-text", `Found a party to hunt together. Up to ${P.maxSize}, and every one of you on the same ground adds ${PER}% Hunt XP.`),
        h("form.btn-row.empty-form", { onSubmit: found }, h("div.input-wrap", nameInput), foundBtn),
        hint)),
      h("section.card",
        cardHead("Invites to you", { sub: "Accepting one turns down the rest." }),
        invitesBox));

    return {
      paint(st) {
        const now = ctx.now;
        const invites = list(st.invites_in);
        const sig = invites.map((i) => i.id).join(",");
        if (sig !== invitesSig) {
          invitesSig = sig;
          invitesBox.replaceChildren(invites.length
            ? h("div.list", invites.map((inv) => inviteInRow(inv, now)))
            : emptyState({ icon: "mail", title: "No invites", text: "When a party leader asks for you by name, it shows here." }));
        }
        invites.forEach((inv) => {
          const node = invitesBox.querySelector(`[data-invite="${CSS.escape(String(inv.id))}"] .lr-sub`);
          setText(node, inviteInSub(inv, now));
        });
      },
    };
  }

  const inviteInSub = (inv, now) => `To ${inv.party_name || "a party"} · ${fmtAgo(now - (when(inv.created_at) || now))}`;

  function inviteInRow(inv, now) {
    const decline = h("button.btn.btn-quiet.btn-sm", { type: "button" }, "Decline");
    const accept = h("button.btn.btn-primary.btn-soft.btn-sm", { type: "button" }, "Accept");
    const answer = async (yes) => {
      busy(yes ? accept : decline, true);
      (yes ? decline : accept).disabled = true;
      const res = await ask(() => ctx.net.party.respond(inv.id, yes));
      if (!alive) return;
      busy(accept, false);
      busy(decline, false);
      if (res.error) toast(String(res.error), { kind: "warn" });
      else toast(yes ? `You join ${inv.party_name || "the party"}` : "Invite turned down", { kind: yes ? "good" : "info", icon: yes ? "party" : null });
      refresh();
    };
    decline.addEventListener("click", () => answer(false));
    accept.addEventListener("click", () => answer(true));
    return h("div.list-row.stack-sm", { dataset: { invite: String(inv.id) } },
      h("span.avatar.avatar-sm", { "data-tone": "ember", "aria-hidden": "true" }, initial(inv.from_name)),
      h("div.lr-main",
        h("div.lr-title", `${display(inv.from_name)} invites you`),
        h("div.lr-sub", inviteInSub(inv, now))),
      h("div.lr-end", decline, accept));
  }

  /* ---------- setting out together ---------- */

  /* One card with the whole of it: where the party is, and the one press that changes that.
     The fight is drawn on the Hunt page, never here: this card only names it. */
  /* ================= THE ROOM ================= */

  /* A party is a room of four squares. Somebody sits in one, one stands open and
     says so, or the leader has crossed it out. Under them the ground anyone can
     put up, a ready mark each, and the leader's press that sends the room out
     together. When the party is already out the same card carries the way in.

     Squares are rebuilt when the roster, the seats or the marks change and
     repainted in place every second for what each of them is doing. */

  const SEAT_OPEN = "open";
  const SEAT_SHUT = "shut";

  function roomCard() {
    const sub = h("p.card-sub");
    const chipBox = h("div.card-actions");
    const squares = h("div.room-grid");
    const groundSel = h("select.select.grow", { "aria-label": "Ground" },
      GameData.ZONES.map((z) => h("option", { value: z.id }, z.name)));
    const putUp = h("button.btn.btn-sm", { type: "button" }, "Propose");
    const readyBtn = h("button.btn.grow", { type: "button" });
    const goBtn = h("button.btn.btn-ember.grow", { type: "button" }, iconEl("swords"), "Start");
    const hint = h("span.field-hint.t-bad", { hidden: true, role: "alert" });
    const bar = h("div.room-bar",
      h("div.hstack.gap-2", groundSel, putUp),
      h("div.btn-row.room-press", readyBtn, goBtn),
      hint);
    const outRow = h("div.btn-row.room-out", { hidden: true });
    const node = h("section.card.room", { "data-tone": "ember" },
      h("div.card-head", h("div", h("h2.card-title", iconEl("party"), "The room"), sub), chipBox),
      squares, bar, outRow);

    let seats = [];          // { node, doing, kind, id }
    let seatSig = null;
    let chipSig = null;
    let outSig = null;
    let sending = false;
    let picked = null;       // the zone in the select, kept across repaints
    let wantSlots = null;    // the seat count a press asked for, until the realm says so too

    groundSel.addEventListener("change", () => { picked = groundSel.value; });

    async function call(fn, btn) {
      sending = true;
      busy(btn, true);
      const res = await ask(fn);
      sending = false;
      if (!alive) return res;
      busy(btn, false);
      if (res.error) toast(String(res.error), { kind: "warn" });
      refresh();
      return res;
    }

    async function send(type, args, btn, said) {
      sending = true;
      busy(btn, true);
      let res;
      try {
        res = await ctx.dispatch(type, args || {});
      } catch (err) {
        res = { ok: false };
        toast("The realm did not answer", { kind: "warn" });
      }
      sending = false;
      if (!alive) return res;
      busy(btn, false);
      // A refusal has already been toasted by dispatch, in the words the server used.
      if (res && res.ok) said(res.data || {});
      refresh();
      return res;
    }

    /* ---------- a square ---------- */

    /* A square: the face filling it, the host's remove in the top corner with
       the Hunt level under it, and the crown, the name and what they are at
       along the bottom. Nothing here is hovered for an explanation: a level is
       a level, and a square you can press says so by being pressable. */
    function memberSeat(m, isLeader, amLeader, isReady) {
      const mine = sameId(m.user_id, meId());
      const doing = h("span.seat-doing");
      const face = h("div.seat-face", { "aria-hidden": "true" });
      face.append(portraitImg(m.skin || null));
      const lv = mine ? skillLevel(ctx.state, "warfare") : Math.max(1, Number(m.levels && m.levels.warfare) || 1);
      const seat = h("div.seat.seat-taken", { class: [mine && "is-me", isReady && "is-ready"] },
        face,
        h("span.seat-lv", { "aria-label": `Hunt level ${fmtWhole(lv)}` }, fmtWhole(lv)),
        h("div.seat-foot",
          h("button.seat-name", { type: "button", onClick: () => openPopup("profile", ctx, String(m.username || "")) },
            isLeader ? iconEl("crown") : null, display(m.username)),
          doing),
        isReady ? h("span.seat-ready", iconEl("check"), "Ready") : null);
      if (amLeader && !mine) {
        const kick = h("button.seat-x", { type: "button", "aria-label": `Remove ${display(m.username)}` }, iconEl("close"));
        kick.addEventListener("click", () => kickMember(m, kick));
        seat.append(kick);
      }
      return { node: seat, doing, id: String(m.user_id) };
    }

    /* An open square says so and nothing else; a shut one carries the cross. The
       leader presses either to turn it into the other. */
    function emptySeat(kind, index, amLeader) {
      const open = kind === SEAT_OPEN;
      const label = amLeader
        ? open ? "Close this square" : "Open this square"
        : open ? "An open square" : "A closed square";
      const inner = open ? h("span.seat-wait", "Waiting") : h("span.seat-shut", { "aria-hidden": "true" }, iconEl("close"));
      if (!amLeader) return { node: h("div.seat", { class: open ? "seat-open" : "seat-shut-box", "aria-label": label }, inner), doing: null, id: null };
      const btn = h("button.seat", { type: "button", class: open ? "seat-open" : "seat-shut-box", "aria-label": label }, inner);
      /* Closing takes the last square away; opening gives one back. The square
         flips under the press and the realm's answer confirms it, so a press
         never looks like it did nothing while the round trip is in the air. */
      btn.addEventListener("click", () => {
        const want = open ? index : index + 1;
        wantSlots = want;
        seatSig = null;
        paint(true);   // partyBody's, which repaints this card with the seat count just asked for
        // `want`, not `wantSlots`: the repaint above can clear the field, and a
        // cleared one reached the realm as nothing and came back "somebody is
        // sitting in that square" about a square nobody was sitting in.
        call(() => ctx.net.party.setSlots(want), btn);
      });
      return { node: btn, doing: null, id: null };
    }

    /* ---------- the bar ---------- */

    function wire(st, tier) {
      putUp.onclick = () => call(() => ctx.net.party.propose(tier, groundSel.value), putUp);
      readyBtn.onclick = () => call(() => ctx.net.party.ready(!myMark(st)), readyBtn);
      goBtn.onclick = () => {
        const up = proposed(st);
        if (!up) return;
        send("partyHuntStart", { tier: up.tier, zone: up.zone }, goBtn, () => {
          toast(`The party sets out for ${ground(up.tier, up.zone)}`, { kind: "good", icon: "swords" });
        });
      };
    }

    const proposed = (st) => {
      const p = st.party && st.party.proposed;
      return p && p.zone ? { tier: Number(p.tier), zone: String(p.zone) } : null;
    };
    const myMark = (st) => list(st.members).some((m) => sameId(m.user_id, meId()) && m.ready);

    return {
      node,
      paint(st, now, myHunt, fight) {
        const me = meId();
        const leaderId = st.party ? st.party.leader_id : null;
        const amLeader = sameId(leaderId, me);
        const members = list(st.members).slice().sort((a, b) => (sameId(a.user_id, me) ? -1 : sameId(b.user_id, me) ? 1 : 0));
        const said = Math.max(members.length, Math.min(P.maxSize, Number(st.party && st.party.slots) || P.maxSize));
        if (wantSlots != null && (wantSlots === said || !amLeader)) wantSlots = null;
        const slots = wantSlots == null ? said : Math.max(members.length, Math.min(P.maxSize, wantSlots));
        const mine = outOn(fight);

        /* ---- the squares ---- */
        const sig = [leaderId, amLeader, slots, members.map((m) => `${m.user_id}:${m.ready ? 1 : 0}`).join(",")].join("|");
        if (sig !== seatSig) {
          seatSig = sig;
          seats = Array.from({ length: P.maxSize }, (_, i) => (i < members.length
            ? memberSeat(members[i], sameId(members[i].user_id, leaderId), amLeader, !!members[i].ready)
            : emptySeat(i < slots ? SEAT_OPEN : SEAT_SHUT, i, amLeader)));
          squares.replaceChildren(...seats.map((s) => s.node));
        }

        // What each of them is at, on the second: the hunt from presence, the bench from the heartbeat.
        members.forEach((m, i) => {
          const seat = seats[i];
          if (!seat || !seat.doing) return;
          const hunt = sameId(m.user_id, me) ? myHunt : presence(m.hunt, now);
          const online = sameId(m.user_id, me) || (when(m.last_seen) != null && now - when(m.last_seen) < ONLINE_MS);
          const task = sameId(m.user_id, me) ? ctx.state.tasks.skilling : null;
          const work = sameId(m.user_id, me)
            ? (task ? workOf({ skill: task.skillId, action: task.actionId }) : null)
            : workOf(m.activity);
          setText(seat.doing, hunt ? ground(hunt.tier, hunt.zone) : work ? work.text : online ? "At camp" : "Away");
          toggleClass(seat.node, "is-offline", !online);
        });

        /* ---- the ground, the marks and the press ---- */
        const tier = currentRegion(ctx.state).tier;
        const up = proposed(st);
        wire(st, tier);
        if (picked === null) picked = up ? up.zone : groundSel.value;
        if (groundSel.value !== picked) groundSel.value = picked;

        const marked = members.filter((m) => m.ready).length;
        const allIn = members.length > 0 && marked === members.length;
        const iAm = myMark(st);
        setText(readyBtn, iAm ? "Stand down" : "Ready");
        toggleClass(readyBtn, "btn-good", iAm);
        readyBtn.disabled = sending || !up || !!fight;
        goBtn.disabled = sending || !amLeader || !up || !allIn || !!fight;
        setText(goBtn.lastChild, amLeader ? "Start" : `${marked} of ${members.length} ready`);
        setAttr(bar, "hidden", !!fight);

        // The server's own two refusals, said before the press instead of after it.
        const no = !up ? null
          : ctx.state.tasks.combat ? "Pull back before you set out with your party."
            : recovering(ctx.state) ? `You're still recovering. Back on your feet in ${fmtTime(ctx.state.player.recoveryLeft)}.` : null;
        setText(hint, no || "");
        setAttr(hint, "hidden", !no);
        if (no) goBtn.disabled = true;

        /* ---- already out ---- */
        const outKind = mine ? "mine" : fight ? "theirs" : "";
        if (outKind !== outSig) {
          outSig = outKind;
          if (!outKind) outRow.replaceChildren();
          else if (mine) {
            const watch = h("a.btn.btn-ember", { href: "#/skill/warfare" }, iconEl("swords"), "Watch the fight");
            const away = h("button.btn.btn-quiet", { type: "button" }, "Break away");
            away.addEventListener("click", () => send("partyHuntLeave", {}, away, (data) => {
              toast(data.kills > 0 ? `You break away: ${plural(data.kills, "kill")}` : "You break away", { kind: "info" });
            }));
            outRow.replaceChildren(watch, away);
          } else {
            const join = h("button.btn.btn-ember", { type: "button" }, iconEl("party"), "Join them");
            join.addEventListener("click", () => send("partyHuntJoin", {}, join, () => {
              toast("You fall in with the party", { kind: "good", icon: "party" });
            }));
            outRow.replaceChildren(join);
          }
        }
        setAttr(outRow, "hidden", !outKind);

        setText(sub, fight
          ? mine ? `Out in ${ground(fight.tier, fight.zone)}` : `Your party is out in ${ground(fight.tier, fight.zone)}`
          : up ? `${ground(up.tier, up.zone)}, when everyone is ready` : "Put a ground up, then everyone marks ready.");

        const hunters = fight && Array.isArray(fight.hunters) ? fight.hunters.length : 0;
        const chip = fight ? `${fmtWhole(hunters)} out · ${fmtTime(fight.elapsed)}` : "";
        if (chip !== chipSig) {
          chipSig = chip;
          chipBox.replaceChildren(...(chip ? [h("span.chip.chip-ember", iconEl("swords"), chip)] : []));
        }
        setAttr(chipBox, "hidden", !chip);
      },
    };
  }

  /* ---------- in a party ---------- */

  function partyView() {
    const eyebrow = h("div.eyebrow.page-eyebrow");
    const title = h("h1.page-title");
    const bonusChip = h("span.chip");
    let bonusSig = null;
    const actions = h("div.page-actions");
    let actionsSig = null;

    // Lives in the invite dialog now, not on the page. Painted either way.
    const invitesBox = h("div");
    const inviteFormNode = inviteForm();
    let invitesSig = null;

    const onlineChip = h("span.chip.chip-good", iconEl("online"), h("span"));
    const chat = chatPanel();
    const room = roomCard();

    // The room, then the chat under it at the full width.
    page.replaceChildren(
      h("header.page-head",
        h("div", eyebrow, title, h("p.page-sub", RULE), h("div.chip-row.mt-3", bonusChip)),
        actions),
      room.node,
      h("section.card.card-flush.chat", cardHead("Party chat", { actions: onlineChip }), chat.log, chat.alert, chat.form));

    /* The page actions: a button that opens the invite dialog, and Leave for everyone.
       The chat is the reason to be on this page, so the invite field and the list of
       who is pending live behind one press instead of taking a third of the page. */
    let inviteBadge = null;

    function openInvites(leader) {
      // invitesBox is painted every frame whether or not it is on screen, so the
      // dialog opens already current and keeps up while it is open.
      const body = leader ? [inviteFormNode, h("div.divider"), invitesBox] : [invitesBox];
      return openModal({
        title: "Invites",
        sub: leader ? `The party holds ${P.maxSize}. Pending invites count toward that.` : "Only the party leader can invite.",
        art: "user-plus",
        body,
        actions: [{ label: "Done", kind: "quiet" }],
      });
    }

    function paintActions(st, leader) {
      const sig = `${leader}`;
      if (sig === actionsSig) return;
      actionsSig = sig;
      const leave = h("button.btn.btn-quiet.btn-sm", { type: "button" }, iconEl("logout"), "Leave");
      leave.addEventListener("click", () => leaveParty(leave));
      inviteBadge = h("span.badge", { hidden: true });
      const open = h("button.btn.btn-primary.btn-sm", { type: "button", "aria-label": "Invites" },
        iconEl("user-plus"), "Invites", inviteBadge);
      open.addEventListener("click", () => openInvites(leader));
      // replaceChildren would write a null out as text, so only real nodes go in.
      actions.replaceChildren(open, leave);
    }

    /* Built once and moved into the invite dialog, so the page is not carrying a
       text field it rarely needs.

       The autocomplete dance matters: a lone text input that looks username-shaped
       inside a form makes Chrome offer its saved-password and passkey picker, which
       reads as a login prompt sitting in the middle of a party page. A name of its
       own plus "one-time-code" is the combination browsers actually honour; plain
       "off" is increasingly ignored on fields like this one. The dialog's form is
       also its own, with no password field anywhere near it. */
    function inviteForm() {
      const input = h("input.input.input-sm", {
        type: "text", placeholder: "Username", "aria-label": "Invite by username", maxlength: "20",
        name: "party-invite-search", autocomplete: "one-time-code",
        autocapitalize: "none", spellcheck: "false", enterkeyhint: "send",
      });
      const btn = h("button.btn.btn-primary.btn-sm", { type: "submit" }, "Invite");
      // A look before the invite: the typed name's card, with the invite on it too.
      const look = h("button.btn.btn-sm", { type: "button", "aria-label": "Look up this commander", onClick: () => {
        const name = input.value.trim().toLowerCase();
        if (!name) {
          say("Whose name?");
          input.focus();
          return;
        }
        say(null);
        openPopup("profile", ctx, name);
      } }, iconEl("search"), "Look up");
      const hint = h("span.field-hint.t-bad", { hidden: true, role: "alert" });
      const say = (text) => {
        hint.hidden = !text;
        setText(hint, text || "");
        toggleClass(input, "is-invalid", !!text);
      };
      input.addEventListener("input", () => say(null));
      const submit = async (e) => {
        e.preventDefault();
        const name = input.value.trim().toLowerCase();
        if (!name) {
          say("Whose name?");
          input.focus();
          return;
        }
        say(null);
        busy(btn, true);
        const res = await ask(() => ctx.net.party.invite(name));
        if (!alive) return;
        busy(btn, false);
        if (res.error) {
          say(String(res.error));
          input.focus();
          return;
        }
        input.value = "";
        toast(`Invite sent to ${display(name)}`, { kind: "good", icon: "user-plus" });
        refresh();
      };
      return h("form.field", { onSubmit: submit, autocomplete: "off" },
        h("div.hstack.gap-2", h("div.input-wrap", iconEl("user-plus"), input), look, btn),
        hint);
    }

    /* Invites out (the leader can cancel) and any still waiting for you. */
    function paintInvites(st, now, leader) {
      const out = list(st.invites_out);
      const incoming = list(st.invites_in);
      const sig = `${leader}|${out.map((i) => i.id).join(",")}|${incoming.map((i) => i.id).join(",")}`;
      if (sig !== invitesSig) {
        invitesSig = sig;
        const parts = [];
        if (out.length) {
          parts.push(h("div.list", out.map((inv) => {
            const cancel = leader ? h("button.btn.btn-quiet.btn-sm", { type: "button", "aria-label": `Cancel the invite to ${display(inv.to_name)}` }, "Cancel") : null;
            if (cancel) cancel.addEventListener("click", () => cancelInvite(inv, cancel));
            return h("div.list-row", { dataset: { invite: String(inv.id) } },
              h("span.avatar.avatar-sm", { "aria-hidden": "true" }, initial(inv.to_name)),
              h("div.lr-main", h("div.lr-title", display(inv.to_name)), h("div.lr-sub")),
              h("div.lr-end", cancel || h("span.tag", "Waiting")));
          })));
        } else {
          parts.push(emptyState({
            icon: "user-plus",
            title: "No invites out",
            text: leader ? "Ask for someone by their username above." : "Only the party leader can invite.",
          }));
        }
        // The button on the page says how many are pending without opening anything.
        if (inviteBadge) {
          const n = out.length + incoming.length;
          setText(inviteBadge, n ? String(n) : "");
          inviteBadge.hidden = !n;
        }
        if (incoming.length) {
          parts.push(h("div.divider"), h("div.eyebrow", "Invites to you"),
            h("p.field-hint.mt-1", "Leave this party first to join another."),
            h("div.list.mt-2", incoming.map((inv) => inviteInRow(inv, now))));
        }
        invitesBox.replaceChildren(...parts);
      }
      out.forEach((inv) => {
        const sub = invitesBox.querySelector(`[data-invite="${CSS.escape(String(inv.id))}"] .lr-sub`);
        setText(sub, `Invited ${fmtAgo(now - (when(inv.created_at) || now)).toLowerCase()}`);
      });
      incoming.forEach((inv) => {
        const sub = invitesBox.querySelector(`[data-invite="${CSS.escape(String(inv.id))}"] .lr-sub`);
        setText(sub, inviteInSub(inv, now));
      });
    }

    return {
      paint(st) {
        const now = ctx.now;
        const me = meId();
        const leader = sameId(st.party.leader_id, me);
        const members = list(st.members);
        const c = ctx.state.tasks.combat;
        const fight = liveFight();
        /* Out with the party is still hunting, and the save knows nothing of it: the session
           says how long it has run, so the start is the only thing worked out here. */
        const myHunt = c ? { tier: c.tier, zone: c.zone, start: c.startedAt }
          : outOn(fight) ? { tier: fight.tier, zone: fight.zone, start: now - fight.elapsed } : null;

        // The rules' own sum, over everyone else's presence.
        const intervals = members
          .filter((m) => !sameId(m.user_id, me) && m.hunt)
          .map((m) => ({ tier: Number(m.hunt.tier), zone: String(m.hunt.zone), start: when(m.hunt.started_at), end: m.hunt.ended_at ? when(m.hunt.ended_at) : when(m.hunt.ends_by) }))
          .filter((iv) => iv.start != null && iv.end != null);
        const pct = myHunt ? Math.round((partyMult({ party: { intervals } }, myHunt.tier, myHunt.zone, now) - 1) * 100) : 0;
        const here = myHunt ? intervals.filter((iv) => iv.tier === myHunt.tier && iv.zone === myHunt.zone && iv.start <= now && now < iv.end).length : 0;
        const bonus = { pct, here };

        setText(eyebrow, `The Realm · ${fmtWhole(members.length)} of ${fmtWhole(P.maxSize)} in the party`);
        setText(title, st.party.name || "The party");
        const bSig = `${pct}|${here}|${!!myHunt}`;
        if (bSig !== bonusSig) {
          bonusSig = bSig;
          bonusChip.replaceChildren(...bonusChipParts(bonus, myHunt));
          setAttr(bonusChip, "class", pct > 0 ? "chip chip-violet" : "chip");
        }

        const online = members.filter((m) => sameId(m.user_id, me) || (when(m.last_seen) != null && now - when(m.last_seen) < ONLINE_MS)).length;
        setText(onlineChip.lastChild, `${fmtWhole(online)} online`);

        room.paint(st, now, myHunt, fight);
        paintActions(st, leader);
        paintInvites(st, now, leader);
        chat.paint(list(st.messages), now);
        // The chat is on screen, so it has been read. The sidebar's dot reads the same mark.
        if (st.party && st.party.id) markRead(st.party.id, newestMessage(st));
      },
      destroy() {
        chat.destroy();
      },
    };
  }

  // Kept short: a chip never wraps, and it has to fit a narrow phone. Where you hunt is on your own card.
  function bonusChipParts(bonus, myHunt) {
    if (!myHunt) return [iconEl("party"), "No party bonus · you are not hunting"];
    if (bonus.pct > 0) return [iconEl("party"), h("b", `+${bonus.pct}% Hunt XP`), ` · ${fmtWhole(bonus.here)} of your party here`];
    return [iconEl("party"), "No party bonus · nobody else here"];
  }

  /* ---------- chat ---------- */

  function chatPanel() {
    const log = h("ol.chat-log", { "aria-live": "polite", "aria-label": "Party chat", tabindex: "0" });
    const input = h("input.input", { type: "text", maxlength: String(CHAT_MAX), placeholder: "Say something to the party", "aria-label": "Message", autocomplete: "off", enterkeyhint: "send" });
    const count = h("span.composer-count", { "aria-hidden": "true" }, `0/${CHAT_MAX}`);
    const send = h("button.btn.btn-primary.btn-icon", { type: "submit", "aria-label": "Send" }, iconEl("send"));
    const alert = h("div.chat-alert", { hidden: true, role: "alert" }, iconEl("alert"), h("span"));
    const rendered = new Map();   // message id -> { node, time, at }
    let empty = null;
    let sending = false;
    let alertTimer = 0;
    let stick = true;             // follow new messages until the reader scrolls up
    let lastTimes = -1;

    const atBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 32;
    log.addEventListener("scroll", () => { stick = atBottom(); });

    function flash(text) {
      clearTimeout(alertTimer);
      alert.hidden = false;
      setText(alert.lastChild, text);
      alertTimer = setTimeout(() => { alert.hidden = true; }, 4000);
    }

    function paintCount() {
      const n = input.value.length;
      setText(count, `${n}/${CHAT_MAX}`);
      toggleClass(count, "is-near", n >= CHAT_NEAR);
    }

    async function submit(e) {
      e.preventDefault();
      if (sending) return;
      const text = input.value.trim();
      if (!text) return;
      if (text.length > CHAT_MAX) {
        flash(`Messages are ${CHAT_MAX} characters at most.`);
        return;
      }
      sending = true;
      input.disabled = true;
      busy(send, true);
      const res = await ask(() => ctx.net.party.say(text));
      if (!alive) return;
      sending = false;
      input.disabled = false;
      busy(send, false);
      if (res.error) {
        flash(String(res.error));
      } else {
        input.value = "";
        paintCount();
        alert.hidden = true;
        stick = true;
        refresh();
      }
      input.focus();
    }

    input.addEventListener("input", paintCount);
    const form = h("form.composer", { onSubmit: submit }, h("div.input-wrap", input), count, send);

    function messageNode(msg, now) {
      const own = sameId(msg.user_id, meId());
      const at = when(msg.created_at) || now;
      const time = h("time", { datetime: msg.created_at || null }, fmtAgo(now - at));
      const node = own
        ? h("li.msg.is-own", h("div", h("div.msg-meta", h("span.sr-only", "You"), time), h("p.msg-text", String(msg.body || ""))))
        : h("li.msg",
          h("span.avatar.avatar-sm", { "aria-hidden": "true" }, initial(msg.username)),
          h("div", h("div.msg-meta", h("b", display(msg.username)), time), h("p.msg-text", String(msg.body || ""))));
      return { node, time, at };
    }

    return {
      log,
      alert,
      form,
      paint(messages, now) {
        const ids = messages.map((msg) => String(msg.id));
        const follow = stick || atBottom();
        let changed = false;

        if (!ids.length) {
          if (!empty) {
            rendered.clear();
            empty = h("li.msg-note", "No words yet. Say something to the party.");
            log.replaceChildren(empty);
          }
        } else {
          if (empty) {
            empty.remove();
            empty = null;
          }
          // Drop what fell off the end of the fifty, then append what is new, if the order still holds.
          const keep = new Set(ids);
          rendered.forEach((r, id) => {
            if (!keep.has(id)) {
              r.node.remove();
              rendered.delete(id);
              changed = true;
            }
          });
          const have = Array.from(rendered.keys());
          const inOrder = have.every((id, i) => ids[i] === id);
          if (!inOrder) {
            rendered.clear();
            log.replaceChildren();
          }
          messages.forEach((msg, i) => {
            if (rendered.has(ids[i])) return;
            const r = messageNode(msg, now);
            rendered.set(ids[i], r);
            log.append(r.node);
            changed = true;
          });
        }
        if (changed && follow) log.scrollTop = log.scrollHeight;

        // "2m ago" moves slowly: a pass every ten seconds is plenty.
        const tick = Math.floor(now / 10000);
        if (tick !== lastTimes) {
          lastTimes = tick;
          rendered.forEach((r) => setText(r.time, fmtAgo(now - r.at)));
        }
      },
      destroy() {
        clearTimeout(alertTimer);
      },
    };
  }

  /* ---------- the actions ---------- */

  async function leaveParty(btn) {
    const st = current();
    if (!st || !st.party) return;
    const members = list(st.members);
    const leader = sameId(st.party.leader_id, meId());
    const others = members.length - 1;
    const ok = await confirm({
      title: `Leave ${st.party.name || "the party"}?`,
      body: others <= 0
        ? "You are the last one here. The party, its chat and its invites end with you."
        : leader
          ? "You lead it now. The longest-serving member takes over when you go."
          : "You can only come back if the leader invites you again.",
      confirmText: "Leave the party",
      danger: others <= 0,
    });
    if (!ok || !alive) return;
    busy(btn, true);
    const res = await ask(() => ctx.net.party.leave());
    if (!alive) return;
    busy(btn, false);
    if (res.error) toast(String(res.error), { kind: "warn" });
    else toast(`You left ${st.party.name || "the party"}`, { kind: "info", icon: "logout" });
    refresh();
  }

  async function kickMember(m, btn) {
    const name = display(m.username);
    const ok = await confirm({
      title: `Remove ${name} from the party?`,
      body: `${name} loses the party chat and stops counting toward the hunt bonus. Only an invite brings them back.`,
      confirmText: `Remove ${name}`,
      danger: true,
    });
    if (!ok || !alive) return;
    busy(btn, true);
    const res = await ask(() => ctx.net.party.kick(m.user_id));
    if (!alive) return;
    busy(btn, false);
    if (res.error) toast(String(res.error), { kind: "warn" });
    else toast(`${name} is out of the party`, { kind: "info" });
    refresh();
  }

  async function cancelInvite(inv, btn) {
    busy(btn, true);
    const res = await ask(() => ctx.net.party.cancelInvite(inv.id));
    if (!alive) return;
    busy(btn, false);
    if (res.error) toast(String(res.error), { kind: "warn" });
    else toast(`Invite to ${display(inv.to_name)} withdrawn`, { kind: "info" });
    refresh();
  }

  /* ---------- the loop ---------- */

  // Realtime can drop quietly; the poll keeps the page honest while it is open and seen.
  const poll = setInterval(() => {
    if (alive && !document.hidden) refresh();
  }, POLL_MS);

  paint(true);
  refresh();

  return {
    update() {
      paint();
    },
    destroy() {
      alive = false;
      clearInterval(poll);
      clearTimeout(pokeTimer);
      if (view && view.destroy) view.destroy();
      follow(undefined);
    },
  };
}
