# Content schema

Five JSON files, no cross-file references — each one stands alone so any of them
can be edited or regenerated without touching the others.

Two players, fixed:

| | native | learning | prompts are shown in | answers are given in |
|---|---|---|---|---|
| **Noa** | French | Hebrew | French (English as a hint) | Hebrew |
| **Yariv** | Hebrew | French | Hebrew (English as a hint) | French |

So every item needs all three languages, plus a Latin transliteration of the
Hebrew (`t`) — Noa is still learning the alphabet and cannot read a bare
`מסעדה` at speed.

Rules that apply everywhere:

- `id` is unique within its file and never reused.
- `t` is the Hebrew transliteration: plain Latin letters, `ch` for ח/כ, `'`
  for a glottal stop (`ra'ev`), no diacritics, lowercase.
- `he` is written **without nikud**.
- French nouns carry their article in `fr` where the article is the point
  (`la mer`, `le chien`); the grader strips articles before comparing, so this
  costs nothing and teaches gender.
- `level` is 1 (survival), 2 (everyday), 3 (real conversation).
- `theme` is a lowercase single word from a small, reused set.

## data/words.json

```json
{ "words": [
  { "id": "w001", "he": "שלום", "t": "shalom", "fr": "bonjour", "en": "hello",
    "theme": "greetings", "level": 1, "g": "m" }
] }
```

`g` is the French gender, `"m"` or `"f"`, only on nouns. Omit elsewhere.
Alternative accepted answers go in `alt`: `{"alt": {"fr": ["salut"], "he": ["היי"]}}`.

## data/sentences.json

```json
{ "sentences": [
  { "id": "s001", "he": "אני רעב", "t": "ani ra'ev", "fr": "j'ai faim",
    "en": "I'm hungry", "theme": "food", "level": 1 }
] }
```

Sentences are what a couple actually says to each other, not textbook lines.
Short enough to be said in one breath: 3–9 words.

## data/scenes.json

For the picture game. The scene is drawn from emoji, so it needs no images.

```json
{ "scenes": [
  { "id": "sc01", "title": "At the beach", "emoji": ["🏖️", "☀️", "🌊", "🩴", "🍉"],
    "level": 1,
    "targets": {
      "he": [ { "w": "ים", "t": "yam", "en": "sea" } ],
      "fr": [ { "w": "la mer", "en": "sea" } ]
    } } ] }
```

`targets.he` and `targets.fr` are the words we listen for while the player
describes the picture out loud. 5–8 per language, and the two lists should
cover the same concepts so both players get the same picture at the same
difficulty.

## data/tabou.json

```json
{ "tabou": [
  { "id": "tb01", "he": "חתול", "t": "chatul", "fr": "le chat", "en": "cat",
    "banned": {
      "he": ["כלב", "חיה", "מיאו", "בית"],
      "fr": ["chien", "animal", "miaou", "souris"]
    } } ] }
```

`banned` is what the describer may **not** say, four per language: the obvious
translation, the obvious category, the obvious sound, the obvious companion
word. Banned words are shown in the describer's speaking language.

## data/chat.json

For the texting game. A thread is a short exchange between the two of them,
played back one bubble at a time.

```json
{ "threads": [
  { "id": "c01", "title": "On the way home", "emoji": "🚗", "level": 1,
    "lines": [
      { "he": "אני בדרך הביתה", "t": "ani baderech habaita",
        "fr": "je rentre à la maison", "en": "I'm on my way home" }
    ] } ] }
```

Each thread is 5 to 8 lines and reads as one continuous conversation, so the
lines must follow each other: a question then its answer, not a pile of
unrelated sentences. Every line is short enough to fire back in a couple of
seconds, 3 to 8 words.

The game shows a line in the reader's native language and asks for the same
line in their target language, so a line has to work in both directions and
must not depend on knowing who sent it.

## data/headsup.json

For the forehead game. One word, one emoji, one deck.

```json
{ "headsup": [
  { "id": "hu01", "deck": "animals", "he": "פיל", "t": "pil",
    "fr": "l'éléphant", "en": "elephant", "emoji": "🐘" } ] }
```

Decks: `animals`, `food`, `home`, `city`, `actions`, `israel`, `france`.
Every entry must be guessable by a partner shouting clues across a room, so:
concrete nouns and physical actions, nothing abstract.
