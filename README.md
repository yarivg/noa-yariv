# Noa &amp; Yariv

Six language games for exactly two people.

Noa is French, lives in Israel, and is learning Hebrew. Yariv is Israeli, native
Hebrew, and is learning French. Both speak good English, so English is the
language the site itself talks in and the hint of last resort. Every game is
built around that one asymmetry: whatever one of them is struggling to say, the
other one says without thinking.

**→ [yarivg.github.io/noa-yariv](https://yarivg.github.io/noa-yariv/)**

No build step, no dependencies, no server, no tracking. Open it on a phone and
play. Scores live in that browser and nowhere else.

## The games

| | | |
|---|---|---|
| ⚡ | **Speed Duel** | Solo. Sixty seconds of cards. A word in the language you already speak, said out loud in the one you are learning. Every right answer buys two more seconds, so a good run lasts longer than a bad one, and three in a row doubles everything after it. |
| 🧩 | **Phrase Race** | Solo. Whole sentences, not single words. Alternates between tapping scrambled word tiles into the right order and saying the sentence into the microphone. Twenty seconds each. |
| 🖼️ | **Describe It** | Solo. A picture built from emoji, and forty-five seconds to talk about it out loud. The words we are listening for sit face down underneath and flip up as you say them. Clear the board before the buzzer for a time bonus. |
| 🏓 | **Ping-Pong** | Together, one phone. Turns alternate behind a handover card, and the pair share three lives and one chain counter. Noa gets a French word and says the Hebrew; Yariv gets a Hebrew word and says the French. The clock shrinks every turn, from ten seconds down to four. Runs until the lives are gone, or until you bank it. |
| 🚫 | **Taboo** | Together, one phone. The describer speaks the language they are *learning* while their partner, who is native in it, guesses. Four forbidden words per card, including the obvious one. Ninety seconds each way, one shared score. |
| 🙈 | **On My Forehead** | Together, one phone. Hold it to your forehead; the word is in the language you are learning and your partner describes it without saying it. Tilt down for a hit, up for a pass, or tap if the phone will not give up its motion sensors. |

Three of them you play alone on the bus. Three of them only work with the other
person in the room.

## Which way round the languages go

The rule under everything: **you are prompted in the language you have, and you
answer in the language you want.**

| | prompted in | answers in | hint |
|---|---|---|---|
| Noa | French | Hebrew | English, and a Latin transliteration of every Hebrew word |
| Yariv | Hebrew | French | English |

The co-op games invert it on purpose. In Taboo the describer speaks their weak
language and the guesser hears their strong one, which is the only arrangement
where both people are doing something useful at the same time. In On My Forehead
the person holding the phone is being trained to *understand*, so the word is in
their target language and the clues come from a native speaker.

Every Hebrew string in the content files carries a transliteration, because Noa
is still learning the alphabet and cannot read a bare `מסעדה` at speed.

## The microphone

Most of the games grade you by listening. That uses the browser's speech
recogniser, which exists in Chrome (desktop and Android) and Safari on iOS, and
does not exist in Firefox at all.

So every microphone feature has a fallback that is a real way to play, not an
apology: the answer is revealed and you mark yourself, or the sentence becomes a
tile puzzle, or you tap the word you just said out loud. The clock keeps running
either way. A game that cannot be played on your partner's phone is not a game
you will play.

Grading is deliberately forgiving. Accents, nikud, punctuation, final letter
forms, articles and a couple of wrong characters are all ignored before the
comparison, and the recogniser's alternative guesses are all checked. Being
marked wrong for saying *ani ra'ev* without the apostrophe teaches nothing
except to stop playing.

## Points, levels, badges

Points are per game and per round. XP is cumulative and shared across
everything, and the level curve is deliberately cheap at the start: the first two
minutes should visibly move the bar. Twelve badges, most handed out
automatically, one of them only available if you are still awake at two in the
morning.

The scoreboard puts the two of them side by side with a crown on whoever is
ahead, because that is the actual engine of the whole thing.

## Content

Five JSON files under `data/`, each standing alone. `data/SCHEMA.md` is the
contract: what every field means, how Hebrew is transliterated, and the rules for
adding more. Adding a word is adding a line.

| file | what |
|---|---|
| `words.json` | single words, themed and levelled, French gender marked |
| `sentences.json` | short sentences a couple actually says to each other |
| `scenes.json` | emoji pictures with the words we listen for in both languages |
| `tabou.json` | cards with four forbidden words per language |
| `headsup.json` | forehead cards, one emoji each, sorted into decks |

## How it is built

Plain HTML, plain CSS, plain JavaScript. No framework, no bundler, no
`node_modules`.

```
index.html          the shell, and the only file with a script tag
assets/app.js       router, home screen, scoreboard, results, countdown
assets/util.js      DOM helpers and the forgiving answer comparison
assets/store.js     the two players, XP, badges, records, localStorage
assets/audio.js     every sound in the site, synthesised, no audio files
assets/speech.js    speaking and listening, and their failure modes
assets/games/*.js   one file per game, with one CSS file each
data/*.json         the content
```

Games register themselves on `window.Games` and never touch the router. A game
gets a root element and a context and hands back a teardown function; the shell
does the rest. The contract is documented at the top of `assets/app.js`, and
`assets/games/duel.js` is the reference implementation.

There are no audio files: a phone on hotel wifi should not wait on a download to
hear that it got a word right. Every sound is a few oscillators through a gain
envelope, which is also why the feedback lands in the same frame as the tap.

## Running it locally

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000`. Opening `index.html` straight off the disk
will not work, because the content is fetched as JSON.
