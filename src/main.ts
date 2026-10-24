// Boot: pick the engine, mount the app.
//
// The engine comes from one import. The real engine on the classic 1980
// castle is the default. To test on the engine's two-level mini castle
// instead, swap the import for these two lines:
//
//   import { createEngine } from './engine/engine';
//   import { miniCastle } from './engine/test/miniCastle';
//   const ENGINE: Engine = createEngine(miniCastle());

import './style.css';
import type { Engine } from './engine/api';
import { engine } from './engine/index';
import { App } from './ui/app';

const ENGINE: Engine = engine;

const root = document.querySelector<HTMLElement>('#app')!;
const app = new App(root, ENGINE);

// Scripting hook for screenshots and debugging in the console.
Object.assign(window as unknown as Record<string, unknown>, { vc: app.debug, vcEngine: ENGINE });
