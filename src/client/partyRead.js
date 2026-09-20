/* ============================================================
   Respite · partyRead.js · What You Have Already Read
   ------------------------------------------------------------
   The high-water mark of the party chat: the newest message this
   camp has actually had in front of it. The Party page sets it
   while the page is open, and the sidebar reads it to decide
   whether the Party row wears a dot.

   Kept in localStorage, one mark a party, so closing the tab does
   not make three days of chat unread again -- and thrown away
   with the party when you leave it. A browser that refuses
   storage still works: the mark lives for the session and the dot
   is simply keener than it needs to be.

   Message ids are bigints from the database, which JSON hands
   over as numbers well inside what a double holds. Anything that
   does not read as a number is ignored rather than guessed at.
   ============================================================ */

const KEY = "respite:partyRead";

// The in-memory copy is the one that is read; storage is where it is kept between visits.
let marks = null;

const idOf = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

function load() {
  if (marks) return marks;
  marks = new Map();
  try {
    const raw = window.localStorage.getItem(KEY);
    const obj = raw ? JSON.parse(raw) : null;
    if (obj && typeof obj === "object") {
      Object.keys(obj).forEach((k) => {
        const at = idOf(obj[k]);
        if (at) marks.set(String(k), at);
      });
    }
  } catch (err) {
    // No storage, or junk in it. The session's own marks still work.
  }
  return marks;
}

function save() {
  try {
    const obj = {};
    load().forEach((at, id) => { obj[id] = at; });
    window.localStorage.setItem(KEY, JSON.stringify(obj));
  } catch (err) {
    // Full, private, or refused. The mark stays in memory either way.
  }
}

// The newest message id in a party_state() payload, or 0 for a party with nothing said in it.
export function newestMessage(party) {
  const msgs = party && Array.isArray(party.messages) ? party.messages : [];
  let top = 0;
  msgs.forEach((m) => {
    const id = idOf(m && m.id);
    if (id > top) top = id;
  });
  return top;
}

/* Everything up to `id` has been seen. Only ever moves forward: a poll that answers
   with an older page of chat must not un-read what was already read. */
export function markRead(partyId, id) {
  const key = String(partyId || "");
  const at = idOf(id);
  if (!key || !at) return;
  const m = load();
  if ((m.get(key) || 0) >= at) return;
  m.set(key, at);
  save();
}

// How many messages are newer than the mark. A party never read at all counts as all read:
// a dot the first time you are handed a party you have never opened would say nothing useful.
export function unreadCount(party) {
  const id = party && party.party && party.party.id ? String(party.party.id) : "";
  if (!id) return 0;
  const m = load();
  const msgs = Array.isArray(party.messages) ? party.messages : [];
  if (!msgs.length) return 0;
  const mark = m.get(id);
  if (mark === undefined) {
    // First sight of this party: take where it stands as read, so the dot means "since you looked".
    markRead(id, newestMessage(party));
    return 0;
  }
  return msgs.filter((msg) => idOf(msg && msg.id) > mark).length;
}

// Leaving a party takes its mark with it; nothing else is touched.
export function forgetParty(partyId) {
  const key = String(partyId || "");
  if (!key) return;
  const m = load();
  if (m.delete(key)) save();
}
