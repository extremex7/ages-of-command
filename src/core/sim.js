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
import { monthlyResearch } from './technology.js';
import { processFleets, detectNavalBattles, resolveNavalBattles, navalTrade } from './naval.js';
import { processWings, strategicBombing } from './air.js';
import { dailySupply, monthlyDepots } from './supply.js';
import { dailyStrategic, monthlyStrategic } from './strategic.js';
import { monthlyPrestige } from './prestige.js';
import { monthlyRecord } from './record.js';
import { monthlyCivilWar } from './civilwar.js';
import { monthlyCommanders } from './commanders.js';
import { dailyPlans } from './plans.js';
import { monthlyEspionage } from './espionage.js';
import { monthlyCouncil } from './council.js';
import { monthlyDeals } from './deals.js';
import { monthlyNations } from './nations.js';
import { dailyCapitulation } from './capitulation.js';
import { dailyColonies, aiColonies } from './colonies.js';
import { monthlyExperience } from './experience.js';
import { monthlyVictory } from './victory.js';

export function tick(game) {
  const { state, map, rules } = game;
  if (state.gameOver) return { monthly: false };
  state.day++;
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  processRecruitment(state, map, rules);
  dailyPlans(state, map, rules);
  processMovement(state, map, rules);
  processFleets(state, map, rules);
  processWings(state, map, rules);
  detectBattles(state, map);
  detectNavalBattles(state, map, rules);
  dailySupply(state, map, rules);
  resolveBattles(state, map, rules);
  resolveNavalBattles(state, map, rules);
  processSieges(state, map, rules);
  dailyCapitulation(state, map, rules);
  dailyRecovery(state, rules);
  dailyStrategic(state, map, rules);
  processConstruction(state, map, rules);
  dailyColonies(state, map, rules);
  dailyEvents(state, map, rules);
  const t1 = typeof performance !== 'undefined' ? performance.now() : 0;
  aiTick(state, map, rules);
  aiDiplomacy(state, map, rules);
  const t2 = typeof performance !== 'undefined' ? performance.now() : 0;
  const monthly = civilFromDays(state.day).d === 1;
  if (monthly) {
    navalTrade(state, map, rules);
    strategicBombing(state, map, rules);
    monthlyEconomy(state, map, rules);
    monthlyStrategic(state, map, rules);
    monthlyDepots(state, map, rules);
    if (state.tech) monthlyResearch(state, map, rules);
    monthlyMilitary(state, map, rules);
    monthlyExperience(state, rules);
    monthlyCommanders(state, map, rules);
    const warScores = currentWarScores(state, map, rules);
    monthlyGovernment(state, map, rules, warScores);
    monthlyCivilWar(state, map, rules, warScores);
    monthlyDiplomacy(state, map, rules);
    monthlyDeals(state, map, rules);
    monthlyEspionage(state, map, rules);
    monthlyCouncil(state, map, rules);
    aiPeace(state, map, rules, warScores);
    aiEconomy(state, map, rules);
    monthlyNations(state, map, rules);
    aiColonies(state, map, rules);
    refreshCountryCache(state, map, rules);
    monthlyPrestige(state, civilFromDays(state.day).m);
    monthlyRecord(state, rules, civilFromDays(state.day).m);
    monthlyVictory(state, map, rules);
  }
  const t3 = typeof performance !== 'undefined' ? performance.now() : 0;
  state.stats.ticks++;
  game.profile = { daily: t1 - t0, ai: t2 - t1, monthly: t3 - t2, total: t3 - t0 };
  return { monthly };
}

export function runDays(game, n) {
  for (let i = 0; i < n; i++) tick(game);
}
