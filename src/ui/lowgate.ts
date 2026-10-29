// V4.0: Lowgate, the camp before a delve. One path of four steps along the top (Job, Party, Outfit, Set out), each
// clickable at any time. Keven's cart and the graves are side pages. The party, packs and entrance are UI state
// (a Loadout) until Delve sends startDelve.

// V5.1 (W0): the screens live in src/ui/camp/ (shared.ts, job.ts, party.ts, outfit.ts, setout.ts, graves.ts).
// V5.1 (W1): this file is the shell; the frame (the 1920x1080 stage, header, footer, tooltips) is src/ui/camp/frame.ts.
// The Lowgate house ribbon and the old footer are retired: the wagon and the gravestone sit beside the purse.

import type { GameState } from '../game/types';
import { h } from './dom';
import { STEPS, type Step, type CampPage, type CampHost, cleanLoadout, ui } from './camp/shared';
import * as jobMod from './camp/job';
import * as partyMod from './camp/party';
import * as outfitMod from './camp/outfit';
import * as setoutMod from './camp/setout';
import * as gravesMod from './camp/graves';
import { campStage, finishFrame, header, footer } from './camp/frame';
import { warmBusts } from './camp/bust';
import './camp/camp.css'; // V5.1 (W0): the camp kit, scoped under .camp

export { STEPS, type Step, type CampPage, type Loadout, type CampHost, type EntranceInfo, entrancesOf, memoryOf, BOARD_ROW_MAX, boardRows, boardOrder, cleanLoadout, freshLoadout, sameAsLast, installTips, villageOf, captiveContract, contractCaptive } from './camp/shared';

/** The module that renders each page (its optional `footNote` fills the footer's middle line). */
const PAGE_MOD: Record<CampPage, unknown> = { job: jobMod, party: partyMod, outfit: outfitMod, setout: setoutMod, cart: outfitMod, graves: gravesMod };

export function campScreen(el: HTMLElement, s: GameState, host: CampHost): void {
  // Keep the focused control across re-renders of the same page.
  const focusKey = document.activeElement instanceof HTMLElement && el.contains(document.activeElement) ? document.activeElement.closest('[data-k]')?.getAttribute('data-k') : null;

  const l = cleanLoadout(s, host.engine, host.draft);
  if ((STEPS as readonly string[]).includes(host.page)) ui.lastStep = host.page as Step;
  if (!ui.packFor || !l.heroIds.includes(ui.packFor)) ui.packFor = l.heroIds[0] ?? null;

  // V5.1.1: fetch the party's and the Flagon's baked busts now, so every step shows them at once.
  const c = s.campaign;
  if (c) warmBusts([...c.roster.map((x) => x.cls), ...c.recruits.map((x) => x.hero.cls)]);

  const f = campStage(el, s);
  const root = f.stage.root;
  root.className = `camp lowgate lg-page-${host.page}`;
  root.dataset.page = host.page;
  const main = h('main', { class: 'lg-main camp-main', id: 'lg-main' });
  switch (host.page) {
    case 'job':
      jobMod.jobStep(main, s, l, host);
      break;
    case 'party':
      partyMod.partyStep(main, s, l, host);
      break;
    case 'outfit':
      outfitMod.outfitStep(main, s, l, host);
      break;
    case 'setout':
      setoutMod.setOutStep(main, s, l, host);
      break;
    case 'cart':
      outfitMod.cartPage(main, s, l, host);
      break;
    case 'graves':
      gravesMod.gravesPage(main, s);
      break;
  }
  root.append(header(f, s, l, host), main, footer(s, l, host, PAGE_MOD[host.page]));
  finishFrame(f);
  if (focusKey) root.querySelector<HTMLElement>(`[data-k="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
}
