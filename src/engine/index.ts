// The game's engine, running on the classic 1980 castle.
import { classicCastle } from '../data/maps/classic';
import { createEngine } from './engine';

export const engine = createEngine(classicCastle);
export { createEngine };
