/* ============================================================
   Respite · version.js · The Seal
   ------------------------------------------------------------
   Which edition of the rules this is. The browser predicts with
   its copy and the server settles with its own, so the two must
   agree: bump this whenever a rules change would make an older
   browser predict differently, and the server turns it away.
   ============================================================ */

/* 4: the Satchel. A fourth pool, the combat loadout, holding remedies and
   nothing else; the hunt drinks from it alone, so a bottle in Belongings does
   nothing in a fight; the Bonesetter sells into Belongings, where a remedy
   costs a slot a bottle instead of stacking; and a save without a Satchel has
   one packed for it on migration. */
export const ENGINE_VERSION = 4;
