// V3.8: the older DOM checks (V3.3–V3.7.1) test the turn-based UI. Delves now start exploring
// (spec 22), so this keeps any delve they set up in combat: every state loaded through `vc.load`
// and every state a command leaves behind (from the checks or the HUD) is put back in turns.
// Exploring itself is checked by scripts/v38-ui-check.mjs.
//   import { inTurns } from './v38-ui-turns.mjs';  await inTurns(page);   (after window.vc exists)
export async function inTurns(p) {
  await p.evaluate(() => {
    const vc = window.vc;
    if (!vc || vc.__turns) return;
    vc.__turns = true;
    const force = (s) => {
      if (!s?.delve || s.delve.mode === 'combat') return s;
      const t = structuredClone(s);
      t.delve.mode = 'combat';
      for (const h of t.delve.heroes) delete h.walk;
      return t;
    };
    const load = vc.load;
    vc.load = (s) => load(force(s));
    const after = () => {
      const st = vc.state();
      if (st?.delve && st.delve.mode !== 'combat') load(force(st));
    };
    const send = vc.send;
    vc.send = async (c) => {
      const ok = await send(c);
      after();
      return ok;
    };
    // Screens start delves through the app directly: watch for an exploring delve too.
    setInterval(() => {
      if (!vc.busy()) after();
    }, 30);
    // The HUD sends through its host: wrap that too, so clicks and keys stay in turns.
    const host = vc.hud.host;
    const hs = host.send;
    host.send = async (c) => {
      const ok = await hs(c);
      after();
      return ok;
    };
  });
}
