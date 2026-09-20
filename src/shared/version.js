/* ============================================================
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
export const ENGINE_VERSION = 5;
