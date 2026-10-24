// Boot: pick the engine, mount the app.
//
// The real engine comes from src/game/index.ts (`engine`). Until that file
// exists, or with `?fixture=1` in the URL, a stand-in engine on the test
// castle is used so the presentation can be built and screenshotted.

import './style.css';
import type { Engine } from './game/api';
import { App } from './ui/app';

const engines = import.meta.glob<{ engine: Engine }>('./game/index.ts');
const castles = import.meta.glob<{ testCastle: import('./game/types').CastleDef }>('./game/test/testCastle.ts');

async function pickEngine(): Promise<Engine> {
  const params = new URLSearchParams(location.search);
  const load = engines['./game/index.ts'];
  if (load && params.get('fixture') !== '1') {
    try {
      return (await load()).engine;
    } catch (e) {
      console.warn('Engine failed to load, using fixtures:', e);
    }
  }
  const { fixtureEngine } = await import('./view/fixtures');
  const tc = castles['./game/test/testCastle.ts'];
  if (!tc) throw new Error('No engine and no test castle.');
  return fixtureEngine((await tc()).testCastle);
}

const root = document.querySelector<HTMLElement>('#app')!;
void pickEngine().then((ENGINE) => {
  const app = new App(root, ENGINE);
  // Scripting hook for screenshots and debugging in the console.
  Object.assign(window as unknown as Record<string, unknown>, { vc: app.debug, vcEngine: ENGINE });
});
