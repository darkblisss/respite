## Combat System (as built)

The player prepares, picks where to fight and lets it run. There is no rotation. What matters is how long you survive, how you handle Threat and how much XP an hour you make. Tables live in `data.js` (sections 9 and 14). The engine is in `combat.js`.

### Stats

- **Hunt level L** gives the base stats. A discipline multiplies them, then gear adds on top.
  - Health: `25 + 3(L−1) + 0.13(L−1)²`. That is 25 at Lv1, 63 at Lv10, 340 at Lv40 and 1,568 at Lv99.
  - Attack: `1.85^((L−1)/10)`. That is 1 at Lv1, 11 at Lv40 and 415 at Lv99.
  - Defence: `(7/9)(1.85^((L−1)/10) − 1)`, which is 0 at Lv1.
- A blow deals Attack. Crits multiply it. The result is rounded up or down by chance (2.3 lands as 3 three times in ten), and your own blows always deal at least 1.
- **Defence:** `mitigation = D / (D + K)`, with `K = 7 × 1.85^(tier − 1)` on the ground you fight on, capped at 80%. The same rule covers blows in both directions. On lower-tier ground the same Defence stops more.
- Nobody passes 5,000 health. The most anyone can reach is 4,797: a Lv99 Warrior in a Vital Relic tier-9 robe set.

### Gear lines (tier 1, Common)

| Piece | Stats |
|---|---|
| Sword, Dagger, Grimoire, Amulet | +1 Attack (Dagger also +3% crit) |
| Bow, Staff, Greatsword (two hands) | +2 Attack |
| Shield, Ring | +1 Defence |
| Heavy (Forgemaster) | Helm and Gauntlets and Boots +1 Health +1 Defence, Chest +2 Health +1 Defence |
| Medium (Tanner) | Hood, Boots, Gloves +1 Health +1% crit, Jacket +2 Health +1 Defence |
| Light (Weaver) | Hood +2, Robe +3, Boots +1, Gloves +1 Health |

- Each tier multiplies Attack and Defence by 1.85 and Health by 2.
- Rarity multiplies again: Uncommon 1.1, Rare 1.2, Epic 1.3, Legendary and Relic 1.5.
- Weapons from tier 5 add Veil a blow: 1, 2, 3, 4, 5 by tier, times rarity.

### Disciplines and the Veil

- **Levels 1 to 4: Brute Force.** No discipline and no Veil, a 2.4s swing, 5% crit at 150%. At Hunt 5 you choose a discipline and the Veil (0 to 100) opens.
- **Veil a blow** for Warrior and Rogue scales with level: Lv5 10, Lv20 12, Lv40 16, Lv60 20, Lv80+ 25, plus weapon Veil (up to 33).

| | Health | Attack | Defence | Swing | Crit | Crit dmg | Pen |
|---|---|---|---|---|---|---|---|
| Warrior | ×1.2 | ×1 | ×1.5 | 2.6s | 5% | 150% | 10% |
| Rogue | ×1 | ×0.85 | ×1 | 2.0s | 12% | 175% | 15% |
| Mage | ×0.9 | ×1.3 | ×0.7 | 2.6s | 6% | 160% | 25% |

- **Warrior, Devastating Strike.**
  - Veil builds by a blow's worth on every swing, and by half that on every blow aimed at you.
  - At 100 the next swing lands ×3 and ignores an extra 50% of Defence.
  - The Veil carries from fight to fight.
- **Rogue, Ambush.**
  - Every encounter you walk into sets the Veil to 100, so your first swing is an Ambush: a certain crit ×1.25.
  - After that the Veil rebuilds from your own blows only. At 100 the next swing is another Ambush.
- **Mage, Elemental Absorption.**
  - Every encounter you walk into opens with 3 empowered casts, 450ms apart, each ×2. Then the Veil is empty.
  - It refills at 2 a second and never from blows, taking 50s. At 100 you get one empowered cast at ×3.
  - Empowered casts also hit every other foe for half.
- Encounters you are forced into (a Sovereign) give no opening effect.
- **Relic prefixes still work:**
  - Echoing: 12% chance of a second blow.
  - Sundering: +15% penetration.
  - Furious: up to +25% on a run of blows.
  - Executioner's: ×1.3 against foes under 30%.
  - Wounding: 20% chance to bleed.
  - Stalwart: 10% chance to halve a blow.
  - Vital: +5% health and remedies heal 20% more.
  - Thorned: reflects 15%.
  - Resilient: −20% damage taken under 35% health.
  - Bulwark: +15% Defence.

### Foes

Each tier is built from a tier-1 Stalker: 40 health, 0.026 Attack a blow and 1 XP. Health grows ×1.8 a tier and Attack ×1.75. XP by tier is 1, 4, 8, 14, 21, 30, 41, 54, 68. Gold is 0.5 to 1.5 × the tier's material value.

| Kind | Swing | Health | Attack | Defence | XP | Threat | Drops |
|---|---|---|---|---|---|---|---|
| Skirmisher | 2.0s | ×0.7 | ×0.7 | 0% | ×0.8 | 1 | hides 45% |
| Stalker | 2.4s | ×1 | ×1 | 10% | ×1 | 2 | hides 35%, finds 15% |
| Brute | 3.0s | ×1.6 | ×1.8 | 25% | ×1.5 | 3 | ore 35%, hides 30% |
| Sovereign | 2.8s | ×12 | ×2.5 | 30% | ×15 | none | 3 hides, 3 ore, 2 finds, an Epic piece |

- **Elite** can be any of the three: health ×1.8, Attack ×1.4, XP ×2.5, Threat +2 and double drops.
- A foe's Defence is the share of a blow it stops on its own ground.
- **Names** come per region, in the order Skirmisher, Stalker, Brute, Sovereign:
  - Ashen Verge: Carrion Rat, Ash Stalker, Ash Brute, The Ashen Warden.
  - Gallowmoor: Bog Crawler, Fen Stalker, Bog Brute, The Drowned Bailiff.
  - The rest follow in the same order.

### Zones

| Zone | Foes at start | Window | Elites | XP | Threat | Mix Sk/St/Br | Sovereign at 100 | Escorts |
|---|---|---|---|---|---|---|---|---|
| Outer | 1 (75%) or 2 | 60s | 4% | ×1 | ×1 | 40/40/20 | 40% | 0 |
| Middle | 1 or 2 (50/50) | 50s | 8% | ×1.3 | ×1.25 | 35/40/25 | 60% | 0 |
| Inner | 2 or 3 (50/50) | 40s | 14% | ×1.7 | ×1.5 | 30/40/30 | 80% | 1 |
| Core | 3 | 30s | 22% | ×2.2 | ×2 | 25/40/35 | always | 2 |

### Encounters

- **Timers:** every combatant keeps its own swing timer. Foes start staggered at 45 to 80% of their swing, and you open 0.25 to 0.65s in. You always strike the first foe still standing.
- **Windows:** the window is not the time between spawns.
  - Cleared inside it, the rest of the window is the walk to the next encounter (at least 3s).
  - Still fighting when it runs out, a reinforcement joins, but only if fewer than 3 foes are up. Never a fourth, and nothing queues. The window then starts again.
  - A reinforcement swings within 0.3 to 0.7s, and its first blow lands ×1.5.
- **Threat** is kept per region and zone, 0 to 100, in whole numbers. A kill adds its Threat × the zone multiplier. A peak is settled when the encounter ends:
  - With **Hide when Threat peaks** ticked: you go to ground for 5 minutes with no combat, Threat resets, it goes on the log, and the hunt resumes by itself. Ticking it after a Sovereign has already set out still works.
  - Otherwise the zone's chance decides whether the Sovereign comes. It arrives with its escorts (Elites) after a 3s walk.
  - If it doesn't come, Threat resets and the log says so.
- **Sovereign fights:**
  - No reinforcements join.
  - Its Attack rises 15% every 30s.
  - At 25% health or less you break away and the hunt goes on.
  - Its Threat resets when you fell it, break away or die to it.
- **Remedies:** at 45% health or less the strongest remedy you hold is taken.
- **Death:** 5 minutes' recovery counted in game time, so it also runs offline. Every worn piece loses 25 durability, and the log names the killer and how long the hunt lasted.
- **Hunt ends:** at its kill limit, at twelve hours, or at once when you pull back.
- **At camp:** health comes back over five minutes (full after five minutes at camp). A hunt that sets out sooner leaves with what has come back, and still has to finish the walk the last hunt was on. Moving ground mid-hunt keeps your health and the walk. (Pulling back and setting out again after every fight used to skip the walk and refill health; it no longer gains anything.)
- **The dice:** every fight draws from one stream kept in the save, carried across hunts, pull backs and falls, so no command can pick the next fight's luck. Drops, finds and Sovereign pieces use counters that only grow when the kill happens.
- **XP/hr:** measured every 5 minutes over the last hour, or over the hunt so far if it is under an hour.
- **Loot:** goes straight into storage: Belongings, then the Vault, then the Stockpile. A stack you already hold grows where it is.

### Offline

The engine jumps from event to event. Eight hours played on load, in the background or with the tab open give identical results: the same kills, reinforcements, Sovereigns, remedies, breaks and levels, whatever the step size. Log lines written during catch-up carry the time they happened.

### Balance at a glance

These are from the balance simulator: common gear of the region's tier, no remedies, 12-hour runs. Each cell is XP/hr then how long you last.

| Hunter | Outer | Middle | Inner | Core |
|---|---|---|---|---|
| Lv1, bare hands | 37, 17m | 50, 15m | 66, 13m | 81, 13m |
| Lv1, a sword | 66, 24m | 85, 16m | 121, 14m | 153, 12m |
| Lv5 Warrior, tier 1 | 80, 2.6h | 157, 1.4h | 245, 58m | 327, 49m |
| Lv9 Rogue, tier 2 gear | 85, 9.2h | 184, 4.2h | 517, 1.4h | 782, 52m |
| Lv40 Mage, tier 5 | 1,738, 2.9h | 3,377, 1.7h | 6,661, 31m | 8,038, 25m |
| Lv80 Warrior, tier 9 | 5,719, 2.5h | 11,557, 1.2h | 23,195, 37m | 32,435, 30m |

- **Pace:** bare hands reach Lv5 in about 11 hours, a sword alone in about 6.5.
- **Remedies:** ten remedies of the region's tier carry Outer past twelve hours and Core to about 3 hours.
- **Hide:** it trades about a third of Core XP for roughly double the survival.
