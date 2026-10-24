// The engine the app uses. Runs on the real castle (src/data/castle).

import { castle } from '../data/castle';
import { createEngine } from './engine';

export const engine = createEngine(castle);
export { createEngine };
