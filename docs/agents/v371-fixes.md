# Brief: V3.7.1 quick fixes (engine and UI)

Read CLAUDE.md, docs/agents/v3-common.md (testing-cost rules), then docs/v3-spec.md section 21 in full. Repo /root/valkenburg-castle, branch `v3.7.1`. The shell's cwd resets between calls: always `cd /root/valkenburg-castle && ...`. Never pkill by a pattern that matches your own shell; kill servers by PID. Contract (types.ts) already has `ShopOffer.needs: 'innkeeper'` and the `improvised` item kind; don't edit types.ts/api.ts/hex.ts.

You own everything needed for section 21 (engine and UI). Nobody else is editing the tree right now.

1. 21.1 Keven alone: remove the hire gate in src/ui (screens.ts `needsHire` uses, app.ts's opening station) and add the warning line on the prepare screen; make sure nothing else assumes 2+ heroes (lantern bearer, follow, pass lantern).
2. 21.2 START_GOLD 90; fix tests and DOM checks that assume 120 (scripts/v34-camp-check.mjs, v35/v36/v37 checks).
3. 21.3 night-eye needs the innkeeper; peddler shows it locked with the reason; the Flagon lists it with the ales (buy into the stash).
4. 21.4 lockpicks: improvised pick per Burglar per delve (outside the 4 slots, like the Sapper's satchel), consumed on any Pick, 2 slots; proper lockpicks 25 (smith) permanent, Burglar 3 slots / others 2; no pick, no Pick; blocked texts; crew Burglars keep their picks (they carry `lockpicks` in data: fine). Names, glyph and help for `improvised` in names.ts; pack socket shows it.
5. 21.5 NOTICE walking ranges +2 (data.ts NOTICE); update tests; the move preview's notice risk follows automatically.
6. Tests for each, typecheck, vitest, all DOM checks (scripts/v34-camp-check.mjs, v34-hud-check.mjs, v35-ui-check.mjs, v36-ui-check.mjs, v37-ui-check.mjs on the real engine and `?fixture=1` where they support it), stress bot, sim (no refused commands). Changelog entry in docs/v3-changes.md ("V3.7.1") and a decisions line.

Don't commit, push or switch branches. Final report: what changed, files, checks run and results, known issues. Short.
