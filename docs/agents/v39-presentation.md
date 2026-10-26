# Brief: V3.9 presentation

Read docs/agents/v39-common.md, then docs/v3-spec.md 24 (24.5 is yours; 24.1–24.4 say what the engine does). Build against the contract and src/view/fixtures.ts until the engine lands (docs/agents/v39-engine-progress.md).

1. Hero facing wedge; Face: key F then click a neighbouring hex or any hex to face toward (sends `face`); the move preview shows the facing the hero will end with; `faced` events turn the figure.
2. Visibility follows the engine (unseen rear hexes dimmed like explored-not-visible, no units). "Back exposed" badge on a hero card when no other active hero's front half covers the hex behind them (compute from the engine's visibility: the hero's rear neighbour hexes not visible) with a tooltip.
3. Remove the sneaking blind-arc wash and the free-swing confirm dialog. Hovering a seen awake enemy shows its rear half faintly. With a Burglar selected, seen unaware enemies get a small dagger marker on their rear-half hexes the Burglar could reach ("Backstab from here"). Keep the enemy facing wedge.
4. Move preview risks come pre-filtered by the engine (seen enemies only); make sure nothing in the view adds markers for unseen enemies.
5. `unseenHit`: hero flash, an arrow from behind, log line; backstab: a distinct strike effect and log line ("Pim backstabs the orc: 8").
6. Tooltips/help: Face, backstab, blindsided, back exposed, Burglar's quiet feet (names.ts, live numbers).
7. Checks: typecheck, scripts/v39-ui-check.mjs on `?fixture=1` and the real engine, the older DOM checks (v34–v371) still passing, stress bot. One screenshot showing facing wedges and a backstab marker.
