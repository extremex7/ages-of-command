// Simulation clock: one tick = one day. Systems run at their own cadence (daily movement and
// combat, staggered AI, monthly economy) and the renderer never drives simulation work.
import { civilFromDays } from './calendar.js';
import { processRecruitment, processMovement, processSieges, dailyRecovery, monthlyMilitary } from './military.js';
import { detectBattles, resolveBattles } from './combat.js';
import { monthlyEconomy } from './economy.js';
import { aiTick, aiPeace } from './ai.js';
import { refreshCountryCache } from './state.js';
import { processConstruction } from './industry.js';
import { aiEconomy } from './ai.js';
import { monthlyGovernment } from './government.js';
import { monthlyDiplomacy } from './diplomacy.js';
import { dailyEvents, currentWarScores } from './events.js';
import { aiDiplomacy } from './ai_diplomacy.js';

export function tick(game) {
  const { state, map, rules } = game;
  if (state.gameOver) return { monthly: false };
  state.day++;
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  processRecruitment(state, map, rules);
  processMovement(state, map, rules);
  detectBattles(state, map);
  resolveBattles(state, map, rules);
  processSieges(state, map, rules);
  dailyRecovery(state, rules);
  processConstruction(state, map, rules);
  dailyEvents(state, map, rules);
  const t1 = typeof performance !== 'undefined' ? performance.now() : 0;
  aiTick(state, map, rules);
  aiDiplomacy(state, map, rules);
  const t2 = typeof performance !== 'undefined' ? performance.now() : 0;
  const monthly = civilFromDays(state.day).d === 1;
  if (monthly) {
    monthlyEconomy(state, map, rules);
    monthlyMilitary(state, map, rules);
    const warScores = currentWarScores(state, map, rules);
    monthlyGovernment(state, map, rules, warScores);
    monthlyDiplomacy(state, map, rules);
    aiPeace(state, map, rules, warScores);
    aiEconomy(state, map, rules);
    refreshCountryCache(state, map, rules);
  }
  const t3 = typeof performance !== 'undefined' ? performance.now() : 0;
  state.stats.ticks++;
  game.profile = { daily: t1 - t0, ai: t2 - t1, monthly: t3 - t2, total: t3 - t0 };
  return { monthly };
}

export function runDays(game, n) {
  for (let i = 0; i < n; i++) tick(game);
}
