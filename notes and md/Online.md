## Online (as built)

Respite runs on the server now. The browser plays the camp forward on its own so everything moves live, but the save that counts lives in the database and only the game function changes it. Tables and functions are in `supabase/`, the function in `src/server/`, and the rules both sides run in `src/shared/`.

### Accounts and saves

- **Sign in** with a username and password, as before. Usernames are 3 to 20 characters: lower-case letters, numbers and underscores.
- **Guests** can play straight away, but a guest camp lives only in that browser tab and is gone when it closes. The Market, Party and Hiscores ask guests to sign in.
- **The server keeps the camp.** Every action the player takes is sent as a command with the moment it happened. The server plays the camp up to that moment, applies it, and plays on to now. Time away is played out the same way, so offline progress is exactly what an open tab would have made.
- **Old saves** are brought over on the first sign-in. Because the old game let the browser write saves directly, a save from before v5 is checked on the way in: each unique item is held once, storage holds no more stacks than it has slots, and gold (5,000,000) and stacks (250,000) are capped. If anything had to be corrected, the camp log says so once.
- **Start over** (Settings) wipes the camp but keeps its dice, so it can't be used to reroll luck.

### The Market

- List materials, gear and tools from Belongings, the Stockpile or the Vault. Worn pieces and anything needing repair can't be listed.
- **Price** is set per item, 1g to 1,000,000,000g.
- **Limits:** 20 open listings at a time, and 60 new listings an hour.
- **Expiry:** listings last 7 days. Unsold items come back by post.
- **Buying:** pay the listed price for as many as you want of what is left. The goods go straight into storage; if there's no room, the buy is refused and nothing is taken.
- **Selling:** the seller is paid by post, less a 5% fee (at least 1g).
- **Cancelling** takes the items back if there's room.
- **The post** is claimed automatically on the next visit.
- Unique pieces get a new id when they change hands, so they never clash with anything the buyer already owns.

### Parties

- A party holds up to 4, pending invites included. The leader invites by username and can remove members. If the leader leaves, the longest-standing member takes over.
- **Party chat** keeps each party's newest 200 messages. A message is up to 240 characters, and a member can post at most once every 1.5 seconds.
- **Hunting together:**
  - While you hunt, each other member hunting the same tier and zone at the same moment adds +10% Hunt XP, up to +30%.
  - A member only counts while they're about: their hunt stops counting three minutes after they were last seen online.
- The Party page shows each member's online state, total level, what they're doing and whether they count toward your bonus right now.

### Hiscores and presence

- **Hiscores:** the top 50 by total level, or by XP in any one skill.
- **Online count:** players seen in the last 3 minutes.
- **Heartbeat:** an open tab checks in once a minute while visible. It also tells the party what you're working on.

### Fairness

- **Luck worth gold:** crafting rarity, drops, finds and Sovereign pieces are rolled from counters that only grow when the thing happens.
- **Fights:** they draw from one stream kept in the save. Knowing the camp's dice gives no way to pick a better outcome.
- **Pull back and set out again:** gains nothing. Health comes back over five minutes at camp, and the walk still has to be finished.
