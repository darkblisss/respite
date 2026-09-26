/* ============================================================
   Respite · ui/recap.js · The Tally
   ------------------------------------------------------------
   What the last encounter came to, for the walk after it: how
   many fell, the XP they paid, what they left and how long it
   took. The hunt keeps running totals (done, xp, drops) and the
   clock of the encounter it last fought, and nothing per
   encounter, so the page holds the totals of the walk it last
   saw and reads the difference once the walk after the fight
   comes round. No kill happens on a walk, so the walk's totals
   are exactly what the next encounter started from.

   Only ever an encounter whose walk in was seen: one that began
   out of sight (another page, a hidden tab caught up in one go)
   has no start to measure from, and saying nothing beats saying
   the wrong thing.

     const track = recapTracker();
     track(c, huntKey)   -> the last encounter's recap while its walk
                            is on screen, else null
     track.felled(key)   -> a Sovereign fell, and left `key` if there was room for it (hunt:felled)
     track.broke()       -> you broke away from one (hunt:retreat)

     recap = { n, kind, slain, xp, drops: { key: qty }, ms, felled, broke }
   ============================================================ */

const copy = (o) => Object.assign({}, o || {});

export function recapTracker() {
  let hunt = null;   // whose hunt the marks below belong to
  let walk = null;   // the totals of the last walk seen: where the next encounter starts
  let mark = null;   // the encounter under way, and what it started from
  let last = null;   // what the last one came to

  function track(c, key) {
    if (!c) {
      hunt = walk = mark = last = null;
      return null;
    }
    if (key !== hunt) {
      hunt = key;
      walk = mark = last = null;
    }
    if (c.phase === "fight") {
      // The encounter straight after the walk last seen: it starts from that walk's totals.
      if (walk && c.encounters === walk.n + 1 && (!mark || mark.n !== c.encounters)) {
        mark = { n: c.encounters, kind: c.kind || "normal", done: walk.done, xp: walk.xp, drops: walk.drops, felled: false, essence: null, broke: false };
      }
      return null;
    }
    if (mark && mark.n === c.encounters && (!last || last.n !== mark.n)) {
      const drops = {};
      Object.keys(c.drops || {}).forEach((k) => {
        const n = (c.drops[k] || 0) - (mark.drops[k] || 0);
        if (n > 0) drops[k] = n;
      });
      // A Sovereign's Essence is paid outside the run's tally, so it is carried in from its event.
      if (mark.essence) drops[mark.essence] = (drops[mark.essence] || 0) + 1;
      last = {
        n: mark.n, kind: mark.kind,
        slain: Math.max(0, c.done - mark.done),
        xp: Math.max(0, c.xp - mark.xp),
        drops,
        ms: Math.max(0, c.clock || 0),   // the walk leaves the encounter's clock where it stopped
        felled: mark.felled, broke: mark.broke,
      };
    }
    walk = { n: c.encounters, done: c.done, xp: c.xp, drops: copy(c.drops) };
    return last && last.n === c.encounters ? last : null;
  }

  track.felled = (key) => {
    if (!mark) return;
    mark.felled = true;
    if (key) mark.essence = key;
  };
  track.broke = () => { if (mark) mark.broke = true; };
  return track;
}
