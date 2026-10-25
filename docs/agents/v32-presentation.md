# Brief: V3.2 view and interface

Read docs/agents/v3-common.md (own paths only, don't commit, progress note at docs/agents/v32-presentation-progress.md, `bash scripts/snapshot-wip.sh` every 10-15 minutes; the account is near its usage limit, so save often and keep screenshot loops short). Branch `v3.2`. Read docs/agents/v31-presentation-progress.md for the view's layout.

You own src/view/**, src/ui/**, src/audio/**, src/main.ts, src/style.css, index.html. Implement the presentation side of docs/v3-spec.md section 15. The engine agent updates the contract (types.ts/api.ts) in its first 10 minutes and notes it in docs/agents/v32-engine-progress.md; start with the parts that don't depend on it (15.5 enemy camera, 15.6 chest glow), then build the rest against the new contract.

1. **15.5 Camera on enemy actions:** during world-phase playback, pan (and switch level if needed) to each visible enemy action or any attack on a hero, then return to the selected hero; respect the speed setting.
2. **15.6 Unlooted chests:** gold glow and coin marker on opened chests and seen ground loot until taken.
3. **15.2 Dash:** after the first move, show the dash range in a second colour; clicking a dash hex moves again and spends the action.
4. **15.3 Squad building:** a new campaign starts with Hobart alone; the tavern is the first stop (make it obvious, e.g. the camp opens on the tavern and the bounty board says "Hire at least one hero" until you have). Recruit cards show class, a one-line role ("Quiet: picks locks, sneaks fast"), stats, abilities and spells. Distinct figure silhouettes/colours for the new classes (ranger with a bow, sapper with a hammer and pack, three mage schools by colour).
5. **Abilities, spells and items in the action bar** with their targeting (hex targets for throws/fireball/gust/blink, ally targets for veil/ward/mend, enemy targets for sleep/knockback shot), previews, and effects drawn on the map: smoke clouds, glue puddles, caltrops, burning hexes, veiled heroes (translucent), warded heroes (shield glint), overwatch (eye icon + cone), sleeping monsters (z).
6. **Quartermaster:** all twelve items with their one-line effect.
7. Save key `vc.save.v32`.

Check with short headless screenshot runs (scripts/v3-shot.mjs full, a scene or two of your own). Finish with a short report.
