/* ============================================================
   Respite · popups/profile.js · A Commander, at a Glance
   ------------------------------------------------------------
   The card that opens on a name in the Party tab: their face with
   the halo they wear round it, who they are and where, the counts
   a stranger wants (kills, sovereigns, falls), and the two pieces
   the Veil goes into. Nothing else is listed, because nothing else
   is worked, and the level is never written on the face: the halo
   is the telling.

   Everything comes off player_profile(), the same row the full
   page reads. A name anywhere opens this rather than walking off
   to a page of its own: reading who somebody is should not cost
   you the party you were looking at. Guests are sent to make an
   account, as the page does.
   ============================================================ */

import { h, setText } from "../dom.js";
import { iconEl } from "../icons.js";
import { openModal, toast } from "../overlay.js";
import { registerPopup, openPopup, portraitImg } from "../widgets.js";
import { fmtWhole, fmtAgo } from "../format.js";
import { getClass, getRegion, getZone } from "../../../shared/registry.js";
import { itemDef, itemName, parseKey, canFortify, wornHalos } from "../../../shared/items.js";
import { CONFIG } from "../../../shared/config.js";
import { avatarHaloNode, paintAvatarHalo, haloTags, plusPlate, paintMini } from "../halo.js";
import { refreshTitles, saintTag, titleFor } from "../../titles.js";

const ASK_MS = 15 * 1000;
const ONLINE_MS = 3 * 60 * 1000;   // as the Party tab and online_count() count it

const display = (name) => {
  const s = String(name == null ? "" : name);
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Someone";
};

const num = (obj, key) => {
  const v = obj && typeof obj === "object" ? obj[key] : null;
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
};

const slotWord = (slot) => (slot === "neck" ? "Amulet" : "Ring");

// The amulet and the ring, worn or not: a row each, and "bare" where there is nothing.
function wornRows(equipment) {
  return CONFIG.enchant.slots.map((slot) => {
    const key = equipment && typeof equipment === "object" ? equipment[slot] : null;
    const d = key && canFortify(key) ? itemDef(key) : null;
    if (!d) {
      return h("div.list-row",
        h("span.art.art-sm", { "data-tone": "neutral", "aria-hidden": "true" }, iconEl(slot === "neck" ? "amulet" : "ring")),
        h("span.lr-main", h("span.lr-title.muted", `No ${slotWord(slot).toLowerCase()}`), h("span.lr-sub", "Nothing worn")),
        h("span.lr-end"));
    }
    const plus = parseKey(key).plus;
    const art = h("span.art.art-sm", { "data-rarity": d.rarity || "common", "aria-hidden": "true" }, iconEl(d.icon));
    paintMini(art, plus, slot);
    return h("div.list-row",
      art,
      h("span.lr-main",
        h("span.lr-title", itemName(key).replace(/ \+\d+$/, "")),
        h("span.lr-sub", `${d.rarity ? `${d.rarity.charAt(0).toUpperCase()}${d.rarity.slice(1)} ` : ""}${slotWord(slot).toLowerCase()} · Tier ${d.tier}`)),
      h("span.lr-end", plusPlate(plus)));
  });
}

registerPopup("profile", (ctx, username) => {
  const who = String(username || "").trim().toLowerCase();
  if (!who) return null;

  if (ctx.account.mode === "guest") {
    toast("Sign in to look anyone up", { kind: "info", icon: "lock", action: { label: "Create account", onClick: () => openPopup("account", ctx, { mode: "create" }) } });
    return null;
  }

  const halo = avatarHaloNode();
  const face = h("div.portrait.portrait-bust.profile-face");
  const lvPip = h("span.profile-lv", { hidden: true });
  const avatar = h("div.profile-avatar", halo, face, lvPip);
  const body = h("div.profile-body");
  let alive = true;

  const me = ctx.account.username && ctx.account.username.toLowerCase() === who;
  /* Nobody is invited into a party they are already standing in. The roster on the shell is
     the same one the Party page draws, so a square opened from there never offers it. */
  const mates = ctx.party && Array.isArray(ctx.party.members) ? ctx.party.members : [];
  const withMe = mates.some((m) => m && String(m.username || "").toLowerCase() === who);
  const canInvite = !me && !withMe && ctx.net && ctx.net.party && typeof ctx.net.party.invite === "function";

  const m = openModal({
    title: display(who),
    sub: "Commander",
    art: avatar,
    artClass: "art-paint profile-art",
    size: "md",
    className: "modal-profile",
    body,
    actions: [
      { label: "Close", kind: "quiet" },
      canInvite ? {
        label: "Invite to party", kind: "gold", soft: true, icon: "party", keep: true,
        onClick: async () => {
          const res = await ctx.net.party.invite(who);
          if (res && res.error) toast(String(res.error), { kind: "warn" });
          else toast(`Invite sent to ${display(who)}`, { kind: "good", icon: "user-plus" });
          return false;
        },
      } : null,
    ],
    onClose: () => { alive = false; },
  });

  function state(text) {
    body.replaceChildren(h("p.copy.muted", text));
  }

  function show(row) {
    const klass = row.discipline ? getClass(row.discipline) : null;
    const region = row.region ? getRegion(row.region) : null;
    const hunting = row.hunting && typeof row.hunting === "object" ? row.hunting : null;
    const seen = row.last_seen ? Date.parse(row.last_seen) : 0;
    const online = seen && Date.now() - seen < ONLINE_MS;
    const eq = row.equipment && typeof row.equipment === "object" ? row.equipment : {};
    const halos = wornHalos(eq);
    const st = row.stats && typeof row.stats === "object" ? row.stats : {};
    const levels = row.levels && typeof row.levels === "object" ? row.levels : {};

    face.replaceChildren(portraitImg(row.skin || null));
    setText(lvPip, fmtWhole(num(levels, "warfare") || 1));
    lvPip.hidden = false;
    paintAvatarHalo(halo, halos);
    /* A title stands in place of the discipline wherever the discipline would be said.
       One commander in the realm holds each line, so next to that "Rogue" is noise. */
    const title = titleFor(row.username || who);
    m.setTitle(display(row.username || who), [
      title || (klass ? klass.name : "Undisciplined"),
      `Total level ${fmtWhole(row.total_level || 0)}`,
      region ? `In ${region.name}` : null,
    ].filter(Boolean).join(" · "));

    body.replaceChildren(
      h("div.chip-row.profile-tags",
        h("span.chip", { class: online ? "chip-good" : null },
          h("span.dot", { class: online ? "dot-online" : "dot-offline", "aria-hidden": "true" }),
          online ? "Online" : seen ? `Last about ${fmtAgo(Date.now() - seen)}` : "Not seen yet"),
        // What they are doing before what they are: the ground moves, the discipline does not.
        hunting ? h("span.chip.chip-ember", iconEl("swords"), `Hunting the ${getZone(hunting.zone).name}`) : null,
        title ? saintTag(row.username || who) : (klass ? h("span.tag.tag-violet", klass.name) : null),
        ...haloTags(halos)),
      h("div.kpis",
        h("div.kpi", h("span.l", "Kills"), h("span.v", fmtWhole(num(st, "kills")))),
        h("div.kpi", h("span.l", "Sovereigns"), h("span.v", fmtWhole(num(st, "bosses")))),
        h("div.kpi", h("span.l", "Falls"), h("span.v", fmtWhole(num(st, "deaths"))))),
      h("div",
        h("div.eyebrow", "Worn"),
        h("div.list.worn-list", wornRows(eq))));
  }

  async function load() {
    if (typeof ctx.net.playerProfile !== "function") {
      state("This realm does not keep commander pages.");
      return;
    }
    state(`Asking the realm about ${display(who)}.`);
    // Asked alongside the page, so a saint's card carries the title the first time it opens.
    const titles = refreshTitles(ctx);
    let res;
    try {
      res = await Promise.race([
        ctx.net.playerProfile(who),
        new Promise((resolve) => setTimeout(() => resolve({ row: null, error: "The realm is slow to answer." }), ASK_MS)),
      ]);
    } catch (err) {
      res = { row: null, error: String(err && err.message) };
    }
    if (!alive || m.closed) return;
    if (res.missing) {
      state("This realm does not keep commander pages.");
      return;
    }
    if (res.error) {
      state(String(res.error));
      return;
    }
    if (!res.row) {
      state(`Nobody in the realm answers to ${display(who)}.`);
      return;
    }
    await titles.catch(() => false);
    if (!alive || m.closed) return;
    show(res.row);
  }

  load();
  return m;
});
