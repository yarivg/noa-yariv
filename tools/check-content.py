#!/usr/bin/env python3
"""Validate everything under data/ against data/SCHEMA.md.

Run it after editing any content file:

    python3 tools/check-content.py

The games trust this content completely: they read a field and render
it. A missing transliteration is not a crash, it is a blank line on a
card in the middle of a round, which is worse because nobody notices
until they are playing.
"""

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

THEMES = {
    "greetings", "people", "food", "home", "city", "time", "verbs",
    "adjectives", "nature", "numbers", "body", "travel", "feelings",
    "clothes", "work",
}
DECKS = {"animals", "food", "home", "city", "actions", "israel", "france"}

HEBREW = re.compile(r"[֐-׿]")
NIKUD = re.compile(r"[֑-ׇ]")
LATIN_ONLY = re.compile(r"^[a-z0-9 '\-\.,\?!]+$")

problems = []


def fail(where, msg):
    problems.append("%s: %s" % (where, msg))


def load(name, key):
    path = DATA / name
    if not path.exists():
        fail(name, "missing")
        return []
    try:
        blob = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as err:
        fail(name, "invalid JSON: %s" % err)
        return []
    items = blob.get(key)
    if not isinstance(items, list):
        fail(name, "expected a top level %r array" % key)
        return []
    return items


def check_ids(name, items):
    seen = set()
    for i, item in enumerate(items):
        ident = item.get("id")
        if not ident:
            fail("%s[%d]" % (name, i), "no id")
        elif ident in seen:
            fail("%s[%d]" % (name, i), "duplicate id %r" % ident)
        else:
            seen.add(ident)


def check_hebrew(where, he, translit):
    """Hebrew must be unpointed, and must come with a transliteration.

    Noa cannot read a bare Hebrew word at speed, so `t` is not a nicety:
    without it half the site is unplayable for one of its two users.
    """
    if not he or not HEBREW.search(he):
        fail(where, "Hebrew field is empty or has no Hebrew letters")
        return
    if NIKUD.search(he):
        fail(where, "Hebrew carries nikud: %r" % he)
    if not translit:
        fail(where, "no transliteration for %r" % he)
    elif not LATIN_ONLY.match(translit):
        fail(where, "transliteration %r is not plain lowercase Latin" % translit)


def check_words():
    items = load("words.json", "words")
    check_ids("words", items)
    for item in items:
        where = "words/%s" % item.get("id", "?")
        for key in ("he", "t", "fr", "en", "theme", "level"):
            if key not in item:
                fail(where, "missing %r" % key)
        check_hebrew(where, item.get("he", ""), item.get("t", ""))
        if item.get("theme") not in THEMES:
            fail(where, "unknown theme %r" % item.get("theme"))
        if item.get("level") not in (1, 2, 3):
            fail(where, "level must be 1, 2 or 3")
        if "g" in item and item["g"] not in ("m", "f"):
            fail(where, "gender must be 'm' or 'f'")
    return items


def check_sentences():
    items = load("sentences.json", "sentences")
    check_ids("sentences", items)
    for item in items:
        where = "sentences/%s" % item.get("id", "?")
        for key in ("he", "t", "fr", "en", "level"):
            if key not in item:
                fail(where, "missing %r" % key)
        check_hebrew(where, item.get("he", ""), item.get("t", ""))
        # Phrase Race splits on spaces into tiles. One tile is not a puzzle,
        # and twelve tiles do not fit on a phone.
        for lang in ("he", "fr"):
            words = len(str(item.get(lang, "")).split())
            if words < 2:
                fail(where, "%s side is a single word" % lang)
            if words > 11:
                fail(where, "%s side is %d words, too many tiles" % (lang, words))
    return items


def check_scenes():
    items = load("scenes.json", "scenes")
    check_ids("scenes", items)
    for item in items:
        where = "scenes/%s" % item.get("id", "?")
        if not item.get("title"):
            fail(where, "no title")
        emoji = item.get("emoji") or []
        if not 3 <= len(emoji) <= 9:
            fail(where, "%d emoji, want 3 to 9" % len(emoji))
        targets = item.get("targets") or {}
        he, fr = targets.get("he") or [], targets.get("fr") or []
        if not 4 <= len(he) <= 9:
            fail(where, "%d Hebrew targets, want 4 to 9" % len(he))
        if len(he) != len(fr):
            fail(where, "%d Hebrew targets but %d French, they must match"
                 % (len(he), len(fr)))
        for t in he:
            check_hebrew(where + " target", t.get("w", ""), t.get("t", ""))
            if not t.get("en"):
                fail(where, "Hebrew target %r has no English" % t.get("w"))
        for t in fr:
            if not t.get("w") or not t.get("en"):
                fail(where, "French target missing 'w' or 'en'")
    return items


def check_tabou():
    items = load("tabou.json", "tabou")
    check_ids("tabou", items)
    for item in items:
        where = "tabou/%s" % item.get("id", "?")
        for key in ("he", "t", "fr", "en", "banned"):
            if key not in item:
                fail(where, "missing %r" % key)
        check_hebrew(where, item.get("he", ""), item.get("t", ""))
        banned = item.get("banned") or {}
        for lang in ("he", "fr"):
            words = banned.get(lang) or []
            if len(words) != 4:
                fail(where, "%s has %d banned words, want exactly 4" % (lang, len(words)))
            # Banning the answer itself is the game's own job, and listing it
            # here would print the answer on the describer's card.
            if item.get(lang) in words:
                fail(where, "%s banned list contains the answer itself" % lang)
    return items


def check_headsup():
    items = load("headsup.json", "headsup")
    check_ids("headsup", items)
    decks = {}
    for item in items:
        where = "headsup/%s" % item.get("id", "?")
        for key in ("deck", "he", "t", "fr", "en", "emoji"):
            if key not in item:
                fail(where, "missing %r" % key)
        check_hebrew(where, item.get("he", ""), item.get("t", ""))
        deck = item.get("deck")
        if deck not in DECKS:
            fail(where, "unknown deck %r" % deck)
        decks[deck] = decks.get(deck, 0) + 1
        if not item.get("emoji"):
            fail(where, "no emoji, and the card is unreadable across a room without one")
    # A deck of four cards is over in fifteen seconds.
    for deck, n in sorted(decks.items()):
        if n < 8:
            fail("headsup", "deck %r has only %d cards" % (deck, n))
    return items


def main():
    counts = {
        "words": len(check_words()),
        "sentences": len(check_sentences()),
        "scenes": len(check_scenes()),
        "tabou": len(check_tabou()),
        "headsup": len(check_headsup()),
    }
    for name, n in counts.items():
        print("%-10s %4d" % (name, n))
    if problems:
        print("\n%d problem%s:" % (len(problems), "" if len(problems) == 1 else "s"))
        for p in problems:
            print("  " + p)
        return 1
    print("\nall good")
    return 0


if __name__ == "__main__":
    sys.exit(main())
