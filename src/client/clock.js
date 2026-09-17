/* ============================================================
   Respite · clock.js · The Hourglass
   ------------------------------------------------------------
   The server's time, as best the browser can tell it. Every
   answer from the game function carries the server's `now`; the
   request's round trip bounds how wrong that reading can be, so
   the offset comes from the quickest recent trip.

   The predicted clock only ever moves forward. When a fresh
   reading says the server is behind what we already showed, time
   holds until the wall clock catches up, rather than stepping
   back. No DOM here: the store and its tests run it in Node.
   ============================================================ */

const KEEP = 8;              // recent readings; a clock drifts, so old ones age out
const WALL_JUMP_MS = 5000;   // a wall clock that runs back this far was set back by hand

export function createClock({ wall = () => Date.now(), keep = KEEP } = {}) {
  let offset = 0;
  let trip = null;
  let synced = false;
  let samples = [];
  let floor = -Infinity;     // the server has certainly passed its last `now`
  let last = -Infinity;      // the latest time handed out
  let prevWall = null;

  function read() {
    const w = wall();
    // Someone set the computer's clock back: carry on from where we were instead of holding for the difference.
    if (prevWall != null && w < prevWall - WALL_JUMP_MS) offset += prevWall - w;
    prevWall = w;
    return w;
  }

  function now() {
    const t = Math.max(read() + offset, floor);
    if (t > last) last = t;
    return last;
  }

  /* serverNow: the answer's `now`. sentAt and receivedAt: wall times either side of
     the request. The server read its clock somewhere in between; the middle is the
     best guess, and half the trip is the most it can be out. */
  function sample(serverNow, sentAt, receivedAt) {
    if (!Number.isFinite(serverNow) || !Number.isFinite(sentAt) || !Number.isFinite(receivedAt) || receivedAt < sentAt) return false;
    const rtt = receivedAt - sentAt;
    samples.push({ offset: serverNow - (sentAt + rtt / 2), rtt });
    if (samples.length > keep) samples = samples.slice(-keep);
    const best = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    offset = best.offset;
    trip = best.rtt;
    synced = true;
    if (serverNow > floor) floor = serverNow;
    return true;
  }

  return {
    now,
    sample,
    get offset() { return offset; },
    get rtt() { return trip; },
    get synced() { return synced; },
  };
}
