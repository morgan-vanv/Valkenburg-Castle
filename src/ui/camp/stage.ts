// V5.1 (W0): the camp's fixed stage (Handoff: "No scrolling, any size"). Every camp screen is laid out on a
// 1920x1080 stage, scaled to the window by one factor, min(width / 1920, height / 1080), and centred; a window
// that is not 16:9 gets quiet bars, never a scrollbar. The stage element carries the .camp class (the kit's
// tokens and table background) and --stage-scale, which camp.css uses to keep small type at 12px or more on
// screen (1280x720 is scale 0.667). For the camp only; the delve HUD is not staged.

export const STAGE_W = 1920;
export const STAGE_H = 1080;

/** Scale and offset (window px) of the stage in a window. Pure, for tests. */
export function stageFit(w: number, h: number): { scale: number; x: number; y: number } {
  const scale = Math.max(0.01, Math.min(w / STAGE_W, h / STAGE_H));
  return { scale, x: Math.round((w - STAGE_W * scale) / 2), y: Math.round((h - STAGE_H * scale) / 2) };
}

export interface Stage {
  /** The 1920x1080 .camp element; render a screen into it. */
  readonly root: HTMLElement;
  /** The fixed full-window host that letterboxes the stage. */
  readonly host: HTMLElement;
  scale(): number;
  /** Map a window point to stage px (for anything that positions itself inside the stage). */
  toStage(clientX: number, clientY: number): [number, number];
  destroy(): void;
}

/** Mount a stage into `parent` (it is appended; extra classes go on the .camp root). */
export function mountStage(parent: HTMLElement, rootClass = ''): Stage {
  const host = document.createElement('div');
  host.className = 'camp-host';
  const root = document.createElement('div');
  root.className = `camp${rootClass ? ` ${rootClass}` : ''}`;
  host.append(root);
  parent.append(host);
  let fit = stageFit(innerWidth, innerHeight);
  const apply = () => {
    fit = stageFit(host.clientWidth || innerWidth, host.clientHeight || innerHeight);
    root.style.transform = `translate(${fit.x}px, ${fit.y}px) scale(${fit.scale})`;
    root.style.setProperty('--stage-scale', `${fit.scale}`);
  };
  apply();
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(apply) : null;
  ro?.observe(host);
  addEventListener('resize', apply);
  return {
    root,
    host,
    scale: () => fit.scale,
    toStage: (cx, cy) => [(cx - fit.x) / fit.scale, (cy - fit.y) / fit.scale],
    destroy() {
      ro?.disconnect();
      removeEventListener('resize', apply);
      host.remove();
    },
  };
}
