// The game's engine, running on the V2 castle. (The 1980 map is still in src/data/maps/classic.ts.)
import { v2Castle } from '../data/maps/v2';
import { createEngine } from './engine';

export const engine = createEngine(v2Castle);
export { createEngine };
