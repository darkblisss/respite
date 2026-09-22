# Sound

Nothing in this folder ships with the repo. Drop your own audio in and the camp
picks it up on the next load; Settings has the switches and the volume.

| File | What it is |
| --- | --- |
| `bgm.mp3` (or `bgm.ogg`) | The music, on a loop |
| `press.mp3` | A press |
| `good.mp3` | Something went well |
| `bad.mp3` | Something did not |
| `coin.mp3` | Gold changing hands |

Two points worth keeping in mind.

**Use a track you hold the rights to.** Music ripped from YouTube or anywhere
else is somebody's copyright, and a public GitHub Pages site is publishing it.
Licensed libraries and Creative Commons tracks with a named attribution are
fine; so is anything you commissioned or made. Whatever you use, keep the
licence note in this file so the next person knows what is in here.

**Keep it small.** The whole file is fetched before it plays, so aim under 3 MB:
a two-minute loop at 96 kbps mono sits around 1.4 MB and is plenty for a game
that runs in the background. `ffmpeg -i in.wav -b:a 96k -ac 1 bgm.mp3` does it.

Paths live in `TRACKS` and `CUES` at the top of `src/client/ui/audio.js`.
