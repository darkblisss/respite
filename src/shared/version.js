/* ============================================================
   Respite · version.js · The Seal
   ------------------------------------------------------------
   Which edition of the rules this is. The browser predicts with
   its copy and the server settles with its own, so the two must
   agree: bump this whenever a rules change would make an older
   browser predict differently, and the server turns it away.
   ============================================================ */

/* 5: Bountiful Weekend no longer stacks with the day's favoured/hindered
   weather roll. Saturday and Sunday now grant the flat +20% alone; the roll
   only ever applies Monday through Friday. Changes the XP a trade action
   pays out on a weekend, so an older browser's prediction would disagree. */
/* 6: fortifying, and where things land. Only an amulet or a ring takes the Veil
   now, the odds run off the forge thresholds instead of the linear table, a charm
   rides in a fourth socket, and `convert` carries a level onto a new piece.
   Schema 13 strips the Veil off anything that is not jewellery. Breaking gear
   down is gone. The bench, the ground and the hunt place by the order rather than
   by whatever stack is already held, so gathered stock lands in the Stockpile and
   a run's takings in Belongings; leaving a hunt empties the pack into the Vault;
   and travelling to another region stands the bench down and pulls back. */
export const ENGINE_VERSION = 6;
