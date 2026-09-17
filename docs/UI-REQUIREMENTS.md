# Respite v5 UI requirements

The owner's words (verbatim where it matters) and the decisions taken from them. Every UI file must satisfy these.

## What the owner asked for

1. "how can I optimise the UI? Lots of things that make it cluttered. especially the task bar." The topbar (task bar) is the worst offender.
2. "have taskbar pinned to top on mobile can't click it really". On phones the topbar is sticky at the top, compact, with big tap targets.
3. "have items in gathering and artisan, rather than being in a row of 4 pills, just 1 big pill, lots of ui space being wasted and crammed." On gathering and artisan pages every node or recipe is one full-width big pill (a row), carrying its information inline, instead of small pills in a 3 or 4 column grid.
4. "give apothecary a different name". The Apothecary is now **the Bonesetter**.
5. "make UI just better like damn it looks poor atm". A real visual upgrade, not a reskin.
6. "remedies stay in belongings not provisions. as only used by player". Remedies are bought into Belongings and stored there first.
7. "better name for provisions." Provisions is now **the Stockpile**.
8. "make atlas page better and dynamic." Region list plus a detail panel that updates as you pick a region, with what lives there, what it yields, its toll and your standing in it.
9. "add a pop up and confirmation before spending gold in shop and atlas." Every gold spend (Bonesetter, Smuggler, Atlas tolls, companions, agent hire) goes through a confirmation dialog that shows the cost, your gold and what is left.
10. "make stuff 3 rows not 4". Card grids show at most 3 per row. Exception kept from an earlier decision: the storage item grid stays 5 per row on desktop.
11. "Requisition only shown when you enter t2+ map". The Requisitions page and its nav entry are hidden until a tier 2 or higher region is unlocked.
12. "Things that don't open till, like doesn't show discipline at all or veil at all". Features that are not open yet are not shown at all: no Discipline or Veil anywhere before Hunt level 5 and a picked class, no "Dungeons Soon" entry, no locked teaser rows for far-off bench tiers (show the tiers you have plus the next one only).
13. "similar to mastery, add a hoverable thing so you can see an items stat before you craft". Recipe pills and the recipe popup have an info trigger with a tooltip showing the crafted item's stats (per rarity range for gear: Common to Relic values), same interaction as the Mastery tooltip. Hover on desktop, tap on touch.
14. "Get rid of that fucking infinity symbol". No U+221E anywhere. Unlimited batches read "No limit"; counts read "12", never "12 / (infinity)".
15. Online features: player market, parties (up to 4, party chat, live status of each other's hunts, +10% Hunt XP per member hunting the same zone at the same time, capped at +30%), online count, hiscores.

## Names

- Pools: Belongings (`inv`), Stockpile (`bank`), Vault (`vault`).
- Shop page: the Bonesetter (remedies) and the Smuggler.
- No em dashes or en dashes anywhere, on screen or in source.

## Information architecture

Sidebar groups (desktop) / drawer (phones and tablets):
- **The Vanguard**: Character, Hunt, Armaments (Belongings + paperdoll), Companions.
- **The Realm** (online): Atlas, Market, Party (badge for invites), Hiscores.
- **The Camp**: Stockpile, Bounties, Requisitions (hidden before tier 2), Shop (Bonesetter + Smuggler).
- **Trades**: Delving, Felling, Flaying, Harvesting, Dredging.
- **Artisans**: Forgemaster, Woodwright, Tanner, Weaver, Artificer.
- Owner's rule: every list of skills keeps each artisan in the same position as the trade it works from (Delving and Forgemaster first, then Felling and Woodwright, Flaying and Tanner, Harvesting and Weaver, Dredging and Artificer). The order lives in registry.js as `TRADE_ORDER`, `ARTISAN_ORDER` and `SKILL_ORDER`; use them for the nav, the Character grid, the Hiscores boards, the tool rack and anything else that lists skills.
- **Sky** (the weather forecast) is a popup, opened from the Atlas (a chip with today's weather in its header) and from the weather card at the foot of the sidebar. There is no Sky page or nav row.
- Nav rows show the level (skills) or a count (storage), a small dot on the skill that is working, and badges only when something needs attention.

Topbar:
- Desktop: brand (logo + wordmark), breadcrumb, two activity chips (the bench/crews and the hunt: icon, name, thin progress bar, one short meta line, stop button), gold, health with a mini bar, a connection indicator (online count, syncing, offline, guest), settings.
- Phones: sticky, one row, no taller than about 56px plus a 3px health line along its bottom edge. Menu button, compact activity chips (icon + short name + bar; tapping one opens its page), gold, settings. No breadcrumb, no clock. Every tap target at least 44px.
- The world clock moves out of the topbar onto the Bounties and Shop pages, where timers matter.

## Page notes

- Character: hero (portrait, name, discipline tag only once picked, total level), the two activity cards, standing stats, skills grid of 3 per row in three groups (Trades, Artisans, The Field) so artisans line up under their trades.
- Skill pages: hero with level and XP bar, XP modifier chips, Mastery tooltip (gathering). Work card of full-width item pills. Bench: Components / Wares tabs and a tier row (tiers you can use plus the next).
- Hunt: arena (you and up to 3 foes), status line, kills, XP/hr, Threat, time left, the hide toggle, zones (4 cards), quarry (3 foes + Sovereign). Party bonus chip when it applies.
- Storage pages: filter, sort, capacity, 5-per-row slot grid, item popup with actions (Equip, Move, Sell, Salvage, List on the market).
- Atlas: list of regions (tier, name, state: here, open, toll) with a detail panel: description, foes, materials, toll with a confirm, Travel button.
- Shop: Bonesetter rows (remedy, heal, price, quantity, Buy with confirm), Smuggler rows (3 offers, timer, Buy with confirm).
- Market: browse (search, kind and tier filters, sort by price), listing rows (item, qty left, price each, seller, Buy with a quantity and confirm), my listings (cancel), sell flow from the item popup (quantity, price each, 5% fee preview), recent sales.
- Party: create (name), invite by username, members (online dot, total level, what they are doing, hunt ground, whether they count toward your bonus), pending invites in and out, leave/kick, chat (240 chars, newest at the bottom).
- Hiscores: tabs or a select for Total and each skill, top 50 table, your own row highlighted.
- Settings: account (sign in, create, sign out), guest notice, Start over (server command `resetCamp`, behind a danger confirmation that makes you type RESET).
- Guests: a clear banner that nothing is kept; Market, Party and Hiscores ask them to sign in.
