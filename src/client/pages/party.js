/* ============================================================
   Respite · pages/party.js · The Muster
   ------------------------------------------------------------
   #/party (UI-KIT 8.15): found or join a party, see what the
   others are about, and talk. The realm owns the party; every
   change is an RPC (ctx.net.party) followed by the store's
   refreshParty(), with realtime pokes and a five-second poll
   while the page is open.

   The bonus is the rules' own: partyMult() over the others'
   hunt presence, read against your hunt right now. Member cards
   are built when the roster changes and repaint in place; chat
   appends what is new and only follows the bottom when you are
   already there. Guests get a sign-in card instead.
   ============================================================ */

import { h, setText, setAttr, toggleClass } from "../ui/dom.js";
import { iconEl } from "../ui/icons.js";
import { confirm, openModal, toast } from "../ui/overlay.js";
import { fmtWhole, fmtTime, fmtAgo } from "../ui/format.js";
import { openPopup } from "../ui/widgets.js";
import { CONFIG } from "../../shared/config.js";
import { findAction, getSkill, getZone, regionOfTier } from "../../shared/registry.js";
import { partyMult } from "../../shared/progression.js";
import { totalLevel } from "../../shared/stats.js";

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
  group: "The Realm",

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
    inFlight = false;
    if (!alive) return;
    paint(true);
    if (again) {
      again = false;
      refresh();
    }
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

  /* ---------- in a party ---------- */

  function partyView() {
    const eyebrow = h("div.eyebrow.page-eyebrow");
    const title = h("h1.page-title");
    const bonusChip = h("span.chip");
    let bonusSig = null;
    const actions = h("div.page-actions");
    let actionsSig = null;

    const grid = h("div.grid-cards.max-2");
    let cards = new Map();
    let rosterSig = null;

    // Lives in the invite dialog now, not on the page. Painted either way.
    const invitesBox = h("div");
    const inviteFormNode = inviteForm();
    let invitesSig = null;

    const onlineChip = h("span.chip.chip-good", iconEl("online"), h("span"));
    const chat = chatPanel();

    // The chat takes the full width the invites card used to share with it.
    page.replaceChildren(
      h("header.page-head",
        h("div", eyebrow, title, h("p.page-sub", RULE), h("div.chip-row.mt-3", bonusChip)),
        actions),
      grid,
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
        h("div.hstack.gap-2", h("div.input-wrap", iconEl("user-plus"), input), btn),
        hint);
    }

    /* Members: one card each, rebuilt when the roster or the leader changes. */
    function paintMembers(st, now, myHunt, bonus) {
      const me = meId();
      const leaderId = st.party.leader_id;
      const members = list(st.members).slice().sort((a, b) => (sameId(a.user_id, me) ? -1 : sameId(b.user_id, me) ? 1 : 0));
      const sig = `${leaderId}|${sameId(leaderId, me)}|${members.map((m) => m.user_id).join(",")}`;
      if (sig !== rosterSig) {
        rosterSig = sig;
        cards = new Map(members.map((m) => [String(m.user_id), memberCard(m, sameId(m.user_id, leaderId), sameId(leaderId, me))]));
        grid.replaceChildren(...Array.from(cards.values()).map((c) => c.node));
      }
      members.forEach((m) => {
        const card = cards.get(String(m.user_id));
        if (card) card.paint(m, now, myHunt, bonus);
      });
    }

    function memberCard(m, isLeader, amLeader) {
      const mine = sameId(m.user_id, meId());
      const dot = h("span.dot");
      const status = h("span.small");
      const level = h("div.member-lv");
      const chipBox = h("span");
      const foot = h("div.member-foot", chipBox);
      const node = h("article.card.member", { class: { "is-me": mine } },
        h("span.avatar", { "aria-hidden": "true" }, initial(m.username), dot),
        h("div",
          h("div.member-name",
            h("span", display(m.username)),
            isLeader ? h("span", { "data-tip": "Party leader", role: "img", "aria-label": "Leader" }, iconEl("crown")) : null,
            mine ? h("span.tag.tag-violet", "You") : null),
          level),
        status,
        foot);
      if (amLeader && !mine) {
        const kick = h("button.btn.btn-quiet.btn-sm", { type: "button", "aria-label": `Remove ${display(m.username)} from the party` }, "Kick");
        kick.addEventListener("click", () => kickMember(m, kick));
        foot.append(kick);
      }
      let lines = [];
      let linesSig = null;
      let chipSig = null;

      return {
        node,
        paint(member, now, myHunt, bonus) {
          const online = mine || (when(member.last_seen) != null && now - when(member.last_seen) < ONLINE_MS);
          toggleClass(node, "is-offline", !online);
          setAttr(dot, "class", `dot ${online ? "dot-online" : "dot-offline"}`);
          setText(status, online ? "Online" : "Away");
          toggleClass(status, "t-good", online);
          toggleClass(status, "muted", !online);
          setText(level, `Total level ${fmtWhole(mine ? totalLevel(ctx.state) : member.total_level || 0)}`);

          // What they are doing: the hunt from presence, the bench from the heartbeat (yours from your own save).
          const hunt = mine ? myHunt : presence(member.hunt, now);
          const want = [];
          if (hunt) want.push({ tone: "ember", icon: "swords", text: `Hunting ${ground(hunt.tier, hunt.zone)} · ${huntFor(now - hunt.start)}` });
          if (online) {
            const task = mine ? ctx.state.tasks.skilling : null;
            const work = mine ? (task ? workOf({ skill: task.skillId, action: task.actionId }) : null) : workOf(member.activity);
            if (work) want.push({ tone: "violet", icon: work.icon, text: work.text });
            else if (!hunt) want.push({ tone: null, icon: "hourglass", text: "Idle at camp" });
          } else {
            const seen = when(member.last_seen);
            want.push({ tone: null, icon: "clock", text: seen == null ? "Not seen yet" : `Last seen ${fmtAgo(now - seen).toLowerCase()}` });
          }
          const sig = want.map((w) => `${w.tone}:${w.icon}`).join("|");
          if (sig !== linesSig) {
            linesSig = sig;
            lines.forEach((l) => l.node.remove());
            lines = want.map((w) => {
              const text = h("span");
              const line = h("div.member-doing", { "data-tone": w.tone }, iconEl(w.icon), text);
              node.insertBefore(line, foot);
              return { node: line, text };
            });
          }
          want.forEach((w, i) => setText(lines[i].text, w.text));

          // Whether they count toward your bonus right now; your own card carries the bonus itself.
          let chip;
          if (mine) {
            chip = bonus.pct > 0
              ? { cls: "chip-good", icon: "party", text: `+${bonus.pct}% to your Hunt XP` }
              : { cls: null, icon: "party", text: "No bonus right now" };
          } else if (hunt && myHunt && hunt.tier === myHunt.tier && hunt.zone === myHunt.zone) {
            chip = { cls: "chip-good", icon: "check", text: "Counts toward your bonus" };
          } else if (hunt) {
            chip = { cls: null, icon: null, text: myHunt ? "Other ground" : "Hunting without you" };
          } else {
            chip = { cls: null, icon: null, text: online ? "Not hunting" : "Offline" };
          }
          const cSig = `${chip.cls}|${chip.icon}|${chip.text}`;
          if (cSig !== chipSig) {
            chipSig = cSig;
            chipBox.replaceChildren(h("span.chip", { class: chip.cls }, chip.icon ? iconEl(chip.icon) : null, chip.text));
          }
        },
      };
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
        const myHunt = c ? { tier: c.tier, zone: c.zone, start: c.startedAt } : null;

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

        paintActions(st, leader);
        paintMembers(st, now, myHunt, bonus);
        paintInvites(st, now, leader);
        chat.paint(list(st.messages), now);
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
