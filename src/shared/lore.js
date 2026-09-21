/* ============================================================
   Respite · lore.js · Item Lore
   ------------------------------------------------------------
   What the item popup says about a thing. Written by hand for
   anything you gather, dig up, buy or brew; written per type for
   everything crafted.
   ============================================================ */

import { deepFreeze } from "./config.js";
import { GameData } from "./registry.js";

export const ITEM_LORE = deepFreeze({
  // Reagents
  coal: "A vital fuel dug from the same seams as ore. Every forge in camp burns through it, and no bar is smelted without it.",
  resin: "Sap bled from wounded trees and boiled down thick. It seals planks and hafts so they never split in the damp.",
  pulp: "Stems and leaves beaten into a grey mash. It sets woven fibre and binds the pages of every tome.",
  tallow: "Rendered fat, pale and rank. Worked into hides, it keeps leather supple long after the beast is gone.",
  veil_shard: "Splinters of something that was never quite stone. They hold a charge, and every inlay and staff needs one.",

  // Ore
  slag_delve: "Dull, pitted ore raked from the spoil heaps at the camp's edge. Poor stuff, but it melts.",
  mire_delve: "Rust-red lumps pulled from the peat of Gallowmoor. It smells of standing water long after it dries.",
  rime_delve: "Ore from the Warrens that never warms in the hand. Frost forms on it even beside the fire.",
  cairn_delve: "Old steel prised from the cairns on Graveshelf. Nobody asks who laid it there.",
  crucible_delve: "Steel that pools in the Sallow Fen, as if something smelted it long ago and left in a hurry.",
  starfall_delve: "Fallen iron from Umberdeep, still faintly warm. The trees grew around it rather than through it.",
  wyrmheart_delve: "A dense, heat-soaked core from Wyrmreach. It hums when struck, like something answering.",
  hollow_delve: "A core of dark metal from The Fade. It weighs more than it should and casts no shadow.",
  titan_delve: "Metal from the roots of Godsdown, heavy as a debt. Only the best forges can bear its heat.",

  // Timber
  bitter_fell: "Tough, thorned brush that grows where nothing else will. It burns bitter and splits badly.",
  blood_fell: "Ash wood from Gallowmoor with sap the colour of a fresh wound. It stains every hand that cuts it.",
  gnarl_fell: "Bark so hard it blunts axes. The trees of the Warrens grow slow and stubborn in the cold.",
  barrow_fell: "Pine from the barrow slopes of Graveshelf. Its roots go down into the old graves.",
  sallow_fell: "Pale, waterlogged timber hauled out of the Sallow Fen. It dries hard and never loses the smell.",
  elder_fell: "Timber cut from the oldest growth in Umberdeep, the rings so tight they look like writing.",
  ember_fell: "Heartwood from under Wyrmreach, warm to the hand and faintly lit along the grain. It remembers the shape you bend it to.",
  wither_fell: "Heartwood from a Fade tree that grew away from the light. Cut it quickly and do not look at it for long.",
  marrow_fell: "Heartwood from the roots at Godsdown, pale as bone and heavier than it has any business being. No saw in camp was made for it.",

  // Fibre
  stink_harvest: "Rank, stringy weed that thrives on ash. The fibres are coarse, but they hold.",
  noose_harvest: "Pale weed that grows thickest under the gibbets of Gallowmoor. Soft, damp and strangely warm.",
  pale_harvest: "Colourless rushes from the underground streams of the Warrens. They grow without ever seeing sun.",
  corpse_harvest: "A fleshy flower that opens over fresh cairns on Graveshelf. Its fibres are strong and its scent is worse.",
  widow_harvest: "A black-petalled bloom from the Sallow Fen. The old wives say it only flowers after a drowning.",
  lantern_harvest: "A bloom that hangs lit in the dark of Umberdeep, dim as a shuttered lamp. Crews follow them, and should not.",
  moon_harvest: "Silver fronds from Wyrmreach that curl shut by day. Cloth woven from them glows faintly at night.",
  fade_harvest: "Fronds from The Fade, thin as breath. Hold one too long and your fingers go numb.",
  godsbane_harvest: "Fronds from the roots of Godsdown that wilt anything planted beside them. The finest fibre there is.",

  // Hides
  mangy_flay: "A patchy pelt from the scavengers of the Verge. Thin, flea-bitten and better than nothing.",
  bristle_flay: "A coarse, bristled hide from the bog beasts of Gallowmoor. It sheds water and little else.",
  dire_flay: "A heavy pelt from the things that den in the Warrens. The fur is thick enough to stop a knife.",
  gaunt_flay: "Hide from Graveshelf that comes off the body already stiff. The cold there does half the tanner's work.",
  slough_flay: "Skin sloughed by whatever moves under the Sallow Fen and left behind whole. It turns a blade and slips a grip.",
  stag_flay: "Hide off the great stags of Umberdeep, thick across the shoulder. They do not run from lamplight.",
  drake_flay: "A carapace shed by the wyrmkin of Wyrmreach, still warm at the seams.",
  leviathan_flay: "Shell plate from something vast that died in The Fade. Each piece is the size of a door.",
  demon_flay: "Carapace from the spawn of Godsdown. It never rots, and it never stops smelling of smoke.",

  // Finds
  mud_dredge: "Smooth pebbles sifted from the muck of the Verge. Most are worthless. Some are not.",
  bog_dredge: "Smooth stones raked from the drowned channels of Gallowmoor. They come up warm, and nobody will say why.",
  chalk_dredge: "Pale stones from the black pools of the Warrens. The banding shifts if you watch it long enough.",
  mourning_dredge: "Cloudy quartz dredged from the tarns under Graveshelf. It weeps water in a warm hand.",
  ghost_dredge: "Opal from the Sallow Fen that shows faces in its fire. The crews try not to look.",
  amber_dredge: "Resin from the oldest trees in Umberdeep, set hard and lit from within. Some pieces hold insects. Some hold worse.",
  hoard_dredge: "A worked seal from the hoards under Wyrmreach, still warm. Someone made it, and something kept it.",
  sunken_dredge: "A sigil dredged out of The Fade, polished by currents that should not exist. It rings like a bell.",
  idol_dredge: "A small graven thing from the waters of Godsdown, so dark it swallows the lamp. It is facing you.",

  // Remedies
  provision_t1: "A grey paste of ash and bitter herbs smeared into a wound. It stings, then it holds.",
  provision_t3: "Warm moss packed against a wound and bound tight. It draws out the rot before it sets in.",
  provision_t4: "A thick draught boiled from marrow. Nobody asks whose, and nobody refuses it.",
  provision_t6: "A metallic tonic that burns going down and knits flesh while you fight.",
  provision_t7: "Dark blood bottled from something vast. One swallow and wounds close like shutters.",
  provision_t9: "An elixir brewed from the roots at Godsdown. It drags you back from the edge and leaves you shaking.",

  // Supplies
  vault_chest: "A heavy chest bound in black iron. It holds far more than it looks like it should.",
});

// Crafted things share a line per type. `t` is the item's row in TIERS.
export const TYPE_LORE = deepFreeze({
  // refined
  bar: (t) => `${t.delve} smelted with coal and poured into a bar the Forgemaster can work.`,
  plank: (t) => `${t.fell} sawn, dried and sealed with resin into planks that keep their shape.`,
  weave: (t) => `${t.harvest} spun and set with pulp into a tough, coarse cloth.`,
  leather: (t) => `${t.flay} scraped, tallowed and cured into supple leather.`,
  inlay: (t) => `${t.dredge} cut down and set with veil shards so it holds a charge.`,

  // parts
  blade: () => "A forged blade, sharp but bare. It needs a handle before it is a weapon.",
  handle: () => "A hilt of plank wrapped in leather, shaped for a sword or a dagger.",
  score: () => "Planks banded with metal, the heavy heart of a shield.",
  bind: () => "Strips of cured leather used to lash parts together and keep them there.",
  stave: () => "A long, seasoned stave that bends without breaking.",
  string: () => "Twisted weave, waxed and stretched to take a bow's full draw.",
  grip: () => "Leather wound tight around the middle of a bow for a steady hand.",
  shaft: () => "A straight, sealed shaft cut to carry a staff head.",
  head: () => "A metal head set with an inlay. The part of a staff that does the work.",
  gblade: () => "A blade too long for one hand, waiting on its grip.",
  ggrip: () => "A long grip of plank and leather, made for two hands.",
  book: () => "Blank pages of bound weave, waiting to become a grimoire.",
  clasp: () => "A small inlaid clasp that keeps a grimoire shut.",

  // weapons
  sword: () => "A plain one-handed sword. Honest work for dishonest times.",
  dagger: () => "Short and quick, made for work up close.",
  shield: () => "A banded shield that takes the blows meant for you.",
  bow: () => "A two-handed bow for keeping the dead at a distance.",
  staff: () => "A two-handed staff that draws the Veil through its head.",
  greatsword: () => "A two-handed blade that ends fights and arguments alike.",
  grimoire: () => "An offhand tome, heavy with things better left unread.",

  // jewellery
  amulet: () => "An inlaid amulet worn against the skin. It steadies the arm that swings.",
  ring: () => "A plain band set with an inlay. The blows that reach you arrive a little softer.",

  // heavy armour
  helm: () => "A heavy plate helm. It narrows the world to a slit and keeps your skull whole.",
  chest: () => "Heavy plate that holds a line when nothing else will.",
  hboots: () => "Heavy plated boots. Loud, slow and hard to knock down.",
  hgaunts: () => "Plated gauntlets that turn a fist into a hammer.",

  // medium armour
  hood_medium: () => "A leather hood that keeps off the rain and the worst of a glancing blow.",
  jacket: () => "A cured leather jacket, light enough to move in and tough enough to matter.",
  mboots: () => "Leather boots made for long marches over bad ground.",
  mgloves: () => "Leather gloves that keep a grip steady and hands whole.",

  // light armour
  hood_light: () => "A woven hood. Little protection, but it carries the life in it.",
  robe: () => "A woven robe. Almost no defence, and more life in it than plate will ever hold.",
  lboots: () => "Light woven boots, quiet on stone.",
  lgloves: () => "Woven gloves, thin enough to feel the Veil through.",

  // tools
  pick: () => "A pickaxe for the seams. While it is in hand, every Delving action goes quicker.",
  axe: () => "A felling axe. While it is in hand, every Felling action goes quicker.",
  sickle: () => "A curved sickle. While it is in hand, every Harvesting action goes quicker.",
  knife: () => "A flaying knife. While it is in hand, every Flaying action goes quicker.",
  net: () => "A weighted dredging net. While it is in hand, every Dredging action goes quicker.",
});

// `def` is an item def: it needs `base`, and `prof` and `tier` for crafted things.
export function itemLore(def) {
  if (!def) return "";
  if (ITEM_LORE[def.base]) return ITEM_LORE[def.base];
  const type = def.base.slice(def.base.indexOf("_") + 1);
  const key = type === "hood" ? (def.prof === "weaver" ? "hood_light" : "hood_medium") : type;
  const line = TYPE_LORE[key];
  return line ? line(GameData.TIERS[(def.tier || 1) - 1]) : "";
}
