# V3.5 presentation progress

## Done
- Story text (18.1): title intro (4 lines), first-camp intro card, camp header "Lowgate", every UI "Hobart" now Keven/the heir (Hobart only as lore: the Reserve ale, the Warhorn), heir class word "Heir" (badge H), game over "The heir has fallen. Valkenburg stays dark."
- Camp stations (18.2): Notice post, Campfire → The Gilded Flagon, Peddler, Forge, Infirmary, Keven's cart, The graves. Locked/partial stations (dashed glyph, lock icon on the cold forge) and lock notes naming who to rescue and where, with "Take the job" when the story contract is pinned. Village panel under the roster (5 rows, home or where).
- Story contracts pinned in their own section with a parchment look, wax seal, "Wins back" line, heavy-copper warning; prepare screen marks them.
- Won-back moment: on `villageUnlocked`, a banner with the village line, the station lit (glow) and opened, chime; dismissable.
- Infirmary before Aldric: "Drink a potion" (+5, `drink`); after: drink + heal for gold.
- Peddler: `shop(state)` locked items greyed with the reason; buy disabled.
- Flagon ale menu (`ales(state)`): pick a hero, pour; locked ales say what brews them; one ale per hero. Ale badge on roster chips and prepare; ale chip on delve hero cards (bad Black Cask pulls in red, Featherfoot "used"); Reserve shows 4 Focus pips.
- Parley card (18.6): crew, temperament, stance, members, aim, purse, each deal with price, `pays`, `risk`, `blocked`; jobs as sub-buttons; sticky footer with Walk away and Fight. Opens from the bar (Parley, key B, offered whenever `deals()` is non-empty even after the action), the rival panel button, or clicking a non-hostile crew member. Toll: rival panel "Pay N or they attack next turn", intent badge with a 1-round fuse, amber pulsing rings.
- Events: `deal` (log line, coin sfx), `betrayed` (banner, horn, log), `rivalsStance` per stance (demanding horn + pulse), `rivalsEnter` crew-aware.
- Models (18.5): rival Sellsword (shield, kettle helm), Sapper (hammer, charge pack), Pyromancer (robe, flame staff), plus ranger/burglar, in crew colours (Ferrymen blue-grey with sash and brass badge; Gallows Choir black and bone with a noose). Model key `rival-<crew>-<cls>`. Crew rings: green hired, red hostile, amber demanding; unit tags "hired · N", "toll!", "truce".
- Intents `toll`, `charge` (blast hexes marked like breath), `firebolt` (orange line) drawn and worded; tooltips.
- Copper and cask book as ground-loot models; objective beacon finds story items.
- Tooltips: stations, lock notes, story cards, village rows, ales, ale chips, stance/temperament tags, deals, rival members (class kit), purse rules.
- Fixture engine: `village`, story contracts (`pinStories`), `shop(state)`, `ales`, `deals`, `drink`, `heal`/`upgrade` refusals, `buyAle`, `deal`, `villageUnlocked` on backToCamp of a story contract, `fixtureCrew(state, stance)` helper.
- scripts/v35-ui-check.mjs: 60 DOM checks, 0 console errors on `?fixture=1`.

- Stress bot (scripts/v3-stress.mjs, 2 delves) on a build of HEAD's engine plus this UI: 0 console errors. That run also covers the UI falling back cleanly while the engine has no `village`, `ales` or `deals` yet. The live dev server can't host the bot right now: the engine's in-progress edits reload the page, and `makeCrew` is not exported yet so the tree doesn't build.

## Next
- Run the check and the stress bot against the real engine once it lands; adjust to its exact texts/ids.

## Contract requests
- none

## Known issues
- At 1280×800 the parley card scrolls (Hire is just below the fold when demanding); Fight and Walk away stay visible in the sticky footer.
- Summary screen doesn't call out story items specially; the engine's `notes` carry it.
