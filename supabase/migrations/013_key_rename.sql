-- ============================================================
-- Respite . 013_key_rename.sql . Schema 12: the keys moved
-- ------------------------------------------------------------
-- An item id used to be free to drift from its name: Gloam Ore was stored as
-- "cold", Gnarl Wood as "iron". Schema 12 put them back on the same word, and
-- 386 keys moved with it. 216 of those name an item a player can hold;
-- the rest are bench actions, which never reach these tables.
--
-- A save heals itself, because the client migrates it on load and writes it
-- back. These three never pass through that, so they are rewritten here:
--
--   market_listings   item_key, item_base, item_name
--   market_sales      item_key, item_name
--   mail              item_key
--
-- ONE statement, on purpose. The first cut of this used a temporary table and
-- died in the Supabase SQL editor, which runs each statement in its own
-- transaction: "on commit drop" took the table away before the updates could
-- read it. A CTE has no such problem and is atomic without needing begin/commit.
--
-- item_key carries the gear grammar ("slag_sword|rare|c17.42|+7"), so only the
-- part before the first bar is matched and whatever followed is carried over.
-- A bare key has no bar, and split_part returns the whole string for it.
--
-- item_name is a stored string the market reads back as-is. A gear listing wraps
-- the base in its prefix and plus ("Wounding Gloam Sword +7"), so the old name
-- is replaced inside the string rather than the column being overwritten.
--
-- Safe to run twice: a second pass finds no old keys left and reports zeroes.
-- ============================================================

with key_moves (old_key, new_key, old_name, new_name) as (
  values
    ('bog_delve'::text, 'mire_delve'::text, 'Mire Ore'::text, 'Mire Ore'::text),
    ('grave_harvest', 'noose_harvest', 'Grave Moss', 'Noose Weed'),
    ('river_dredge', 'bog_dredge', 'River Amber', 'Bog Pebble'),
    ('bog_bar', 'mire_bar', 'Mire Bar', 'Mire Bar'),
    ('grave_weave', 'noose_weave', 'Grave Weave', 'Noose Weave'),
    ('river_inlay', 'bog_inlay', 'River Inlay', 'Bog Inlay'),
    ('bog_blade', 'mire_blade', 'Mire Blade', 'Mire Blade'),
    ('grave_string', 'noose_string', 'Grave Bowstring', 'Noose Bowstring'),
    ('bog_head', 'mire_head', 'Mire Staff Head', 'Mire Staff Head'),
    ('bog_gblade', 'mire_gblade', 'Mire Great Blade', 'Mire Great Blade'),
    ('grave_book', 'noose_book', 'Grave Book Tome', 'Noose Book Tome'),
    ('river_clasp', 'bog_clasp', 'River Clasp', 'Bog Clasp'),
    ('cold_delve', 'rime_delve', 'Gloam Ore', 'Rime Ore'),
    ('iron_fell', 'gnarl_fell', 'Iron Bark', 'Gnarl Wood'),
    ('cave_dredge', 'chalk_dredge', 'Cave Agate', 'Chalk Pebble'),
    ('cold_bar', 'rime_bar', 'Gloam Bar', 'Rime Bar'),
    ('iron_plank', 'gnarl_plank', 'Iron Plank', 'Gnarl Plank'),
    ('cave_inlay', 'chalk_inlay', 'Cave Inlay', 'Chalk Inlay'),
    ('cold_blade', 'rime_blade', 'Gloam Blade', 'Rime Blade'),
    ('iron_handle', 'gnarl_handle', 'Iron Handle', 'Gnarl Handle'),
    ('iron_score', 'gnarl_score', 'Iron Shield Core', 'Gnarl Shield Core'),
    ('iron_stave', 'gnarl_stave', 'Iron Bow Stave', 'Gnarl Bow Stave'),
    ('iron_shaft', 'gnarl_shaft', 'Iron Shaft', 'Gnarl Shaft'),
    ('cold_head', 'rime_head', 'Gloam Staff Head', 'Rime Staff Head'),
    ('cold_gblade', 'rime_gblade', 'Gloam Great Blade', 'Rime Great Blade'),
    ('iron_ggrip', 'gnarl_ggrip', 'Iron Great Grip', 'Gnarl Great Grip'),
    ('cave_clasp', 'chalk_clasp', 'Cave Clasp', 'Chalk Clasp'),
    ('cured_flay', 'gaunt_flay', 'Cured Hide', 'Gaunt Hide'),
    ('cured_leather', 'gaunt_leather', 'Cured Leather', 'Gaunt Leather'),
    ('cured_bind', 'gaunt_bind', 'Cured Binding', 'Gaunt Binding'),
    ('cured_grip', 'gaunt_grip', 'Cured Grip', 'Gaunt Grip'),
    ('widows_harvest', 'widow_harvest', 'Widows Bloom', 'Widow Bloom'),
    ('scaled_flay', 'slough_flay', 'Scaled Hide', 'Slough Hide'),
    ('widows_weave', 'widow_weave', 'Widows Weave', 'Widow Weave'),
    ('scaled_leather', 'slough_leather', 'Scaled Leather', 'Slough Leather'),
    ('scaled_bind', 'slough_bind', 'Scaled Binding', 'Slough Binding'),
    ('widows_string', 'widow_string', 'Widows Bowstring', 'Widow Bowstring'),
    ('scaled_grip', 'slough_grip', 'Scaled Grip', 'Slough Grip'),
    ('widows_book', 'widow_book', 'Widows Book Tome', 'Widow Book Tome'),
    ('star_delve', 'starfall_delve', 'Starfall Steel', 'Starfall Steel'),
    ('umber_fell', 'elder_fell', 'Umber Heartwood', 'Elder Timber'),
    ('dragon_harvest', 'lantern_harvest', 'Dragon Bloom', 'Lantern Bloom'),
    ('chitin_flay', 'stag_flay', 'Chitin Hide', 'Stag Hide'),
    ('blood_dredge', 'amber_dredge', 'Blood Ruby', 'Amber Gem'),
    ('star_bar', 'starfall_bar', 'Starfall Bar', 'Starfall Bar'),
    ('umber_plank', 'elder_plank', 'Umber Plank', 'Elder Plank'),
    ('dragon_weave', 'lantern_weave', 'Dragon Weave', 'Lantern Weave'),
    ('chitin_leather', 'stag_leather', 'Chitin Leather', 'Stag Leather'),
    ('blood_inlay', 'amber_inlay', 'Blood Inlay', 'Amber Inlay'),
    ('star_blade', 'starfall_blade', 'Starfall Blade', 'Starfall Blade'),
    ('umber_handle', 'elder_handle', 'Umber Handle', 'Elder Handle'),
    ('umber_score', 'elder_score', 'Umber Shield Core', 'Elder Shield Core'),
    ('chitin_bind', 'stag_bind', 'Chitin Binding', 'Stag Binding'),
    ('umber_stave', 'elder_stave', 'Umber Bow Stave', 'Elder Bow Stave'),
    ('dragon_string', 'lantern_string', 'Dragon Bowstring', 'Lantern Bowstring'),
    ('chitin_grip', 'stag_grip', 'Chitin Grip', 'Stag Grip'),
    ('umber_shaft', 'elder_shaft', 'Umber Shaft', 'Elder Shaft'),
    ('star_head', 'starfall_head', 'Starfall Staff Head', 'Starfall Staff Head'),
    ('star_gblade', 'starfall_gblade', 'Starfall Great Blade', 'Starfall Great Blade'),
    ('umber_ggrip', 'elder_ggrip', 'Umber Great Grip', 'Elder Great Grip'),
    ('dragon_book', 'lantern_book', 'Dragon Book Tome', 'Lantern Book Tome'),
    ('blood_clasp', 'amber_clasp', 'Blood Clasp', 'Amber Clasp'),
    ('wyrm_delve', 'wyrmheart_delve', 'Wyrmheart Core', 'Wyrmheart Core'),
    ('wyrm_fell', 'ember_fell', 'Wyrm Root', 'Ember Heartwood'),
    ('abyssal_dredge', 'hoard_dredge', 'Abyssal Coral', 'Hoard Sigil'),
    ('wyrm_bar', 'wyrmheart_bar', 'Wyrmheart Bar', 'Wyrmheart Bar'),
    ('wyrm_plank', 'ember_plank', 'Wyrm Plank', 'Ember Plank'),
    ('abyssal_inlay', 'hoard_inlay', 'Abyssal Inlay', 'Hoard Inlay'),
    ('wyrm_blade', 'wyrmheart_blade', 'Wyrmheart Blade', 'Wyrmheart Blade'),
    ('wyrm_handle', 'ember_handle', 'Wyrm Handle', 'Ember Handle'),
    ('wyrm_score', 'ember_score', 'Wyrm Shield Core', 'Ember Shield Core'),
    ('wyrm_stave', 'ember_stave', 'Wyrm Bow Stave', 'Ember Bow Stave'),
    ('wyrm_shaft', 'ember_shaft', 'Wyrm Shaft', 'Ember Shaft'),
    ('wyrm_head', 'wyrmheart_head', 'Wyrmheart Staff Head', 'Wyrmheart Staff Head'),
    ('wyrm_gblade', 'wyrmheart_gblade', 'Wyrmheart Great Blade', 'Wyrmheart Great Blade'),
    ('wyrm_ggrip', 'ember_ggrip', 'Wyrm Great Grip', 'Ember Great Grip'),
    ('abyssal_clasp', 'hoard_clasp', 'Abyssal Clasp', 'Hoard Clasp'),
    ('void_delve', 'hollow_delve', 'Hollow Core', 'Hollow Core'),
    ('void_fell', 'wither_fell', 'Void Root', 'Wither Heartwood'),
    ('leviathan_dredge', 'sunken_dredge', 'Leviathan Bone', 'Sunken Sigil'),
    ('void_bar', 'hollow_bar', 'Hollow Bar', 'Hollow Bar'),
    ('void_plank', 'wither_plank', 'Void Plank', 'Wither Plank'),
    ('leviathan_inlay', 'sunken_inlay', 'Leviathan Inlay', 'Sunken Inlay'),
    ('void_blade', 'hollow_blade', 'Hollow Blade', 'Hollow Blade'),
    ('void_handle', 'wither_handle', 'Void Handle', 'Wither Handle'),
    ('void_score', 'wither_score', 'Void Shield Core', 'Wither Shield Core'),
    ('void_stave', 'wither_stave', 'Void Bow Stave', 'Wither Bow Stave'),
    ('void_shaft', 'wither_shaft', 'Void Shaft', 'Wither Shaft'),
    ('void_head', 'hollow_head', 'Hollow Staff Head', 'Hollow Staff Head'),
    ('void_gblade', 'hollow_gblade', 'Hollow Great Blade', 'Hollow Great Blade'),
    ('void_ggrip', 'wither_ggrip', 'Void Great Grip', 'Wither Great Grip'),
    ('leviathan_clasp', 'sunken_clasp', 'Leviathan Clasp', 'Sunken Clasp'),
    ('godsdown_fell', 'marrow_fell', 'Godsdown Knot', 'Marrow Heartwood'),
    ('void_dredge', 'idol_dredge', 'Void Sapphire', 'Idol Sigil'),
    ('godsdown_plank', 'marrow_plank', 'Godsdown Plank', 'Marrow Plank'),
    ('void_inlay', 'idol_inlay', 'Void Inlay', 'Idol Inlay'),
    ('godsdown_handle', 'marrow_handle', 'Godsdown Handle', 'Marrow Handle'),
    ('godsdown_score', 'marrow_score', 'Godsdown Shield Core', 'Marrow Shield Core'),
    ('godsdown_stave', 'marrow_stave', 'Godsdown Bow Stave', 'Marrow Bow Stave'),
    ('godsdown_shaft', 'marrow_shaft', 'Godsdown Shaft', 'Marrow Shaft'),
    ('godsdown_ggrip', 'marrow_ggrip', 'Godsdown Great Grip', 'Marrow Great Grip'),
    ('void_clasp', 'idol_clasp', 'Void Clasp', 'Idol Clasp'),
    ('bog_sword', 'mire_sword', 'Mire Sword', 'Mire Sword'),
    ('bog_dagger', 'mire_dagger', 'Mire Dagger', 'Mire Dagger'),
    ('river_staff', 'bog_staff', 'River Staff', 'Bog Staff'),
    ('bog_greatsword', 'mire_greatsword', 'Mire Greatsword', 'Mire Greatsword'),
    ('river_grimoire', 'bog_grimoire', 'River Grimoire', 'Bog Grimoire'),
    ('river_amulet', 'bog_amulet', 'River Amulet', 'Bog Amulet'),
    ('bog_ring', 'mire_ring', 'Mire Ring', 'Mire Ring'),
    ('bog_helm', 'mire_helm', 'Mire Helm', 'Mire Helm'),
    ('bog_chest', 'mire_chest', 'Mire Chestplate', 'Mire Chestplate'),
    ('bog_hboots', 'mire_hboots', 'Mire Boots', 'Mire Boots'),
    ('bog_hgaunts', 'mire_hgaunts', 'Mire Gauntlets', 'Mire Gauntlets'),
    ('grave_hood', 'noose_hood', 'Grave Hood', 'Noose Hood'),
    ('grave_robe', 'noose_robe', 'Grave Robe', 'Noose Robe'),
    ('grave_lboots', 'noose_lboots', 'Grave Boots', 'Noose Boots'),
    ('grave_lgloves', 'noose_lgloves', 'Grave Gloves', 'Noose Gloves'),
    ('cold_sword', 'rime_sword', 'Gloam Sword', 'Rime Sword'),
    ('cold_dagger', 'rime_dagger', 'Gloam Dagger', 'Rime Dagger'),
    ('iron_shield', 'gnarl_shield', 'Iron Shield', 'Gnarl Shield'),
    ('iron_bow', 'gnarl_bow', 'Iron Bow', 'Gnarl Bow'),
    ('cave_staff', 'chalk_staff', 'Cave Staff', 'Chalk Staff'),
    ('cold_greatsword', 'rime_greatsword', 'Gloam Greatsword', 'Rime Greatsword'),
    ('cave_grimoire', 'chalk_grimoire', 'Cave Grimoire', 'Chalk Grimoire'),
    ('cave_amulet', 'chalk_amulet', 'Cave Amulet', 'Chalk Amulet'),
    ('cold_ring', 'rime_ring', 'Gloam Ring', 'Rime Ring'),
    ('cold_helm', 'rime_helm', 'Gloam Helm', 'Rime Helm'),
    ('cold_chest', 'rime_chest', 'Gloam Chestplate', 'Rime Chestplate'),
    ('cold_hboots', 'rime_hboots', 'Gloam Boots', 'Rime Boots'),
    ('cold_hgaunts', 'rime_hgaunts', 'Gloam Gauntlets', 'Rime Gauntlets'),
    ('cured_hood', 'gaunt_hood', 'Cured Hood', 'Gaunt Hood'),
    ('cured_jacket', 'gaunt_jacket', 'Cured Jacket', 'Gaunt Jacket'),
    ('cured_mboots', 'gaunt_mboots', 'Cured Boots', 'Gaunt Boots'),
    ('cured_mgloves', 'gaunt_mgloves', 'Cured Gloves', 'Gaunt Gloves'),
    ('scaled_hood', 'slough_hood', 'Scaled Hood', 'Slough Hood'),
    ('scaled_jacket', 'slough_jacket', 'Scaled Jacket', 'Slough Jacket'),
    ('scaled_mboots', 'slough_mboots', 'Scaled Boots', 'Slough Boots'),
    ('scaled_mgloves', 'slough_mgloves', 'Scaled Gloves', 'Slough Gloves'),
    ('widows_hood', 'widow_hood', 'Widows Hood', 'Widow Hood'),
    ('widows_robe', 'widow_robe', 'Widows Robe', 'Widow Robe'),
    ('widows_lboots', 'widow_lboots', 'Widows Boots', 'Widow Boots'),
    ('widows_lgloves', 'widow_lgloves', 'Widows Gloves', 'Widow Gloves'),
    ('star_sword', 'starfall_sword', 'Starfall Sword', 'Starfall Sword'),
    ('star_dagger', 'starfall_dagger', 'Starfall Dagger', 'Starfall Dagger'),
    ('umber_shield', 'elder_shield', 'Umber Shield', 'Elder Shield'),
    ('umber_bow', 'elder_bow', 'Umber Bow', 'Elder Bow'),
    ('blood_staff', 'amber_staff', 'Blood Staff', 'Amber Staff'),
    ('star_greatsword', 'starfall_greatsword', 'Starfall Greatsword', 'Starfall Greatsword'),
    ('blood_grimoire', 'amber_grimoire', 'Blood Grimoire', 'Amber Grimoire'),
    ('blood_amulet', 'amber_amulet', 'Blood Amulet', 'Amber Amulet'),
    ('star_ring', 'starfall_ring', 'Starfall Ring', 'Starfall Ring'),
    ('star_helm', 'starfall_helm', 'Starfall Helm', 'Starfall Helm'),
    ('star_chest', 'starfall_chest', 'Starfall Chestplate', 'Starfall Chestplate'),
    ('star_hboots', 'starfall_hboots', 'Starfall Boots', 'Starfall Boots'),
    ('star_hgaunts', 'starfall_hgaunts', 'Starfall Gauntlets', 'Starfall Gauntlets'),
    ('chitin_hood', 'stag_hood', 'Chitin Hood', 'Stag Hood'),
    ('chitin_jacket', 'stag_jacket', 'Chitin Jacket', 'Stag Jacket'),
    ('chitin_mboots', 'stag_mboots', 'Chitin Boots', 'Stag Boots'),
    ('chitin_mgloves', 'stag_mgloves', 'Chitin Gloves', 'Stag Gloves'),
    ('dragon_hood', 'lantern_hood', 'Dragon Hood', 'Lantern Hood'),
    ('dragon_robe', 'lantern_robe', 'Dragon Robe', 'Lantern Robe'),
    ('dragon_lboots', 'lantern_lboots', 'Dragon Boots', 'Lantern Boots'),
    ('dragon_lgloves', 'lantern_lgloves', 'Dragon Gloves', 'Lantern Gloves'),
    ('wyrm_sword', 'wyrmheart_sword', 'Wyrmheart Sword', 'Wyrmheart Sword'),
    ('wyrm_dagger', 'wyrmheart_dagger', 'Wyrmheart Dagger', 'Wyrmheart Dagger'),
    ('wyrm_shield', 'ember_shield', 'Wyrm Shield', 'Ember Shield'),
    ('wyrm_bow', 'ember_bow', 'Wyrm Bow', 'Ember Bow'),
    ('abyssal_staff', 'hoard_staff', 'Abyssal Staff', 'Hoard Staff'),
    ('wyrm_greatsword', 'wyrmheart_greatsword', 'Wyrmheart Greatsword', 'Wyrmheart Greatsword'),
    ('abyssal_grimoire', 'hoard_grimoire', 'Abyssal Grimoire', 'Hoard Grimoire'),
    ('abyssal_amulet', 'hoard_amulet', 'Abyssal Amulet', 'Hoard Amulet'),
    ('wyrm_ring', 'wyrmheart_ring', 'Wyrmheart Ring', 'Wyrmheart Ring'),
    ('wyrm_helm', 'wyrmheart_helm', 'Wyrmheart Helm', 'Wyrmheart Helm'),
    ('wyrm_chest', 'wyrmheart_chest', 'Wyrmheart Chestplate', 'Wyrmheart Chestplate'),
    ('wyrm_hboots', 'wyrmheart_hboots', 'Wyrmheart Boots', 'Wyrmheart Boots'),
    ('wyrm_hgaunts', 'wyrmheart_hgaunts', 'Wyrmheart Gauntlets', 'Wyrmheart Gauntlets'),
    ('void_sword', 'hollow_sword', 'Hollow Sword', 'Hollow Sword'),
    ('void_dagger', 'hollow_dagger', 'Hollow Dagger', 'Hollow Dagger'),
    ('void_shield', 'wither_shield', 'Void Shield', 'Wither Shield'),
    ('void_bow', 'wither_bow', 'Void Bow', 'Wither Bow'),
    ('leviathan_staff', 'sunken_staff', 'Leviathan Staff', 'Sunken Staff'),
    ('void_greatsword', 'hollow_greatsword', 'Hollow Greatsword', 'Hollow Greatsword'),
    ('leviathan_grimoire', 'sunken_grimoire', 'Leviathan Grimoire', 'Sunken Grimoire'),
    ('leviathan_amulet', 'sunken_amulet', 'Leviathan Amulet', 'Sunken Amulet'),
    ('void_ring', 'hollow_ring', 'Hollow Ring', 'Hollow Ring'),
    ('void_helm', 'hollow_helm', 'Hollow Helm', 'Hollow Helm'),
    ('void_chest', 'hollow_chest', 'Hollow Chestplate', 'Hollow Chestplate'),
    ('void_hboots', 'hollow_hboots', 'Hollow Boots', 'Hollow Boots'),
    ('void_hgaunts', 'hollow_hgaunts', 'Hollow Gauntlets', 'Hollow Gauntlets'),
    ('godsdown_shield', 'marrow_shield', 'Godsdown Shield', 'Marrow Shield'),
    ('godsdown_bow', 'marrow_bow', 'Godsdown Bow', 'Marrow Bow'),
    ('void_staff', 'idol_staff', 'Void Staff', 'Idol Staff'),
    ('void_grimoire', 'idol_grimoire', 'Void Grimoire', 'Idol Grimoire'),
    ('void_amulet', 'idol_amulet', 'Void Amulet', 'Idol Amulet'),
    ('bog_pick', 'mire_pick', 'Mire Pickaxe', 'Mire Pickaxe'),
    ('grave_sickle', 'noose_sickle', 'Grave Sickle', 'Noose Sickle'),
    ('river_net', 'bog_net', 'River Net', 'Bog Net'),
    ('cold_pick', 'rime_pick', 'Gloam Pickaxe', 'Rime Pickaxe'),
    ('iron_axe', 'gnarl_axe', 'Iron Axe', 'Gnarl Axe'),
    ('cave_net', 'chalk_net', 'Cave Net', 'Chalk Net'),
    ('cured_knife', 'gaunt_knife', 'Cured Knife', 'Gaunt Knife'),
    ('widows_sickle', 'widow_sickle', 'Widows Sickle', 'Widow Sickle'),
    ('scaled_knife', 'slough_knife', 'Scaled Knife', 'Slough Knife'),
    ('star_pick', 'starfall_pick', 'Starfall Pickaxe', 'Starfall Pickaxe'),
    ('umber_axe', 'elder_axe', 'Umber Axe', 'Elder Axe'),
    ('dragon_sickle', 'lantern_sickle', 'Dragon Sickle', 'Lantern Sickle'),
    ('chitin_knife', 'stag_knife', 'Chitin Knife', 'Stag Knife'),
    ('blood_net', 'amber_net', 'Blood Net', 'Amber Net'),
    ('wyrm_pick', 'wyrmheart_pick', 'Wyrmheart Pickaxe', 'Wyrmheart Pickaxe'),
    ('wyrm_axe', 'ember_axe', 'Wyrm Axe', 'Ember Axe'),
    ('abyssal_net', 'hoard_net', 'Abyssal Net', 'Hoard Net'),
    ('void_pick', 'hollow_pick', 'Hollow Pickaxe', 'Hollow Pickaxe'),
    ('void_axe', 'wither_axe', 'Void Axe', 'Wither Axe'),
    ('leviathan_net', 'sunken_net', 'Leviathan Net', 'Sunken Net'),
    ('godsdown_axe', 'marrow_axe', 'Godsdown Axe', 'Marrow Axe'),
    ('void_net', 'idol_net', 'Void Net', 'Idol Net')
),

-- A listing carries the key, the base it groups under, and the name a buyer reads.
listings as (
  update public.market_listings l
     set item_base = m.new_key,
         item_key  = m.new_key || substr(l.item_key, length(split_part(l.item_key, '|', 1)) + 1),
         item_name = replace(l.item_name, m.old_name, m.new_name)
    from key_moves m
   where m.old_key = split_part(l.item_key, '|', 1)
  returning 1
),

-- A row whose base is stale while its key is not. Rows the update above already
-- took are left out: one statement may not write the same row twice.
listing_bases as (
  update public.market_listings l
     set item_base = m.new_key
    from key_moves m
   where m.old_key = l.item_base
     and not exists (
       select 1 from key_moves m2 where m2.old_key = split_part(l.item_key, '|', 1)
     )
  returning 1
),

sales as (
  update public.market_sales s
     set item_key  = m.new_key || substr(s.item_key, length(split_part(s.item_key, '|', 1)) + 1),
         item_name = replace(coalesce(s.item_name, ''), m.old_name, m.new_name)
    from key_moves m
   where s.item_key is not null
     and m.old_key = split_part(s.item_key, '|', 1)
  returning 1
),

-- Mail is claimed straight into a save, so a stale key here is an item that
-- vanishes on the way in.
mails as (
  update public.mail t
     set item_key = m.new_key || substr(t.item_key, length(split_part(t.item_key, '|', 1)) + 1)
    from key_moves m
   where t.item_key is not null
     and m.old_key = split_part(t.item_key, '|', 1)
  returning 1
)

select (select count(*) from listings)       as listings_moved,
       (select count(*) from listing_bases)  as bases_moved,
       (select count(*) from sales)          as sales_moved,
       (select count(*) from mails)          as mail_moved;
