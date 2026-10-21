// Web Worker for the bot window (bot.html): runs the simulation off the page (see runner.js).
import { createRunner } from './runner.js';

const runner = createRunner((m) => self.postMessage(m));
self.onmessage = (e) => runner.handle(e.data);
