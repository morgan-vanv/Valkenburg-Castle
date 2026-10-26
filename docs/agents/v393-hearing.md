# Brief: V3.9.3 hearing (engine and view)

Read CLAUDE.md, docs/agents/v3-common.md (testing-cost rules), docs/v3-spec.md 24 (24.7 and 24.8 especially). Repo /root/valkenburg-castle, branch `v3.9.3`. The shell's cwd resets between calls: always `cd /root/valkenburg-castle && ...`. Never pkill/pgrep -f a pattern that matches your own shell; kill dev servers by PID from `ps` (port 5187).

The lead has added `Delve.heard`, `Heard` and the `heard` event to src/game/types.ts. Don't edit types.ts/api.ts/hex.ts. Nobody else is editing the tree. Don't commit, push or switch branches.

1. **Engine (24.8):** clear `heard` at world-phase start; record footsteps for each step of an unseen monster or crew member (find where monsters, rivals and crew AI move a figure hex by hex; a shared helper that takes the mover, the hex and the visible set computed once per world phase, refreshed when it changes), with hearing range by kind via the existing noise path field (doors count 2); record loud sounds where unseen enemies make noise (makeNoise calls during the world phase whose source is an enemy: attacks, shouts, smashes, blasts, breath, deaths/hurts out of sight) with `what`. Hearing changes nothing for monsters. Tests under `describe('V3.9.3 hearing')`: footsteps heard through a door within range, not beyond; a seen walker leaves no entry; a loud clash heard in its radius; entries cleared next world phase; monsters' behaviour unchanged (same seed, same monster positions with and without a hero in hearing).
2. **View:** footprint trail and loud markers per 24.8 (src/view/diorama.ts or a new src/view/sounds.ts), over fog, fading by order; tooltips; the summarised log lines by direction (src/ui/app.ts on `heard` events; at most two lines per world phase); help text in names.ts ("Hearing").
3. **Stale shove/drag arrows (24.8 last bullet):** in diorama's intent drawing, skip `markShove` when the victim is not adjacent to `it.to` (keep the tag title).
4. Checks: typecheck, vitest, a DOM check scripts/v393-ui-check.mjs (inject a delve state with `heard` entries: markers present, tooltip, log lines on a `heard` event; a stale shove intent draws no arrow), the older DOM checks (v34-hud, v34-camp, v35, v36, v37, v371, v39 on the real engine), stress bot, sim (no refused commands; print sounds heard per delve). One screenshot of a footstep trail beyond a door, under docs/agents/v393-shots/.
5. Changelog entry (docs/v3-changes.md, "V3.9.3") and a decisions line.

Final reply: what works, files, checks and results, shot path, known issues. Short.
