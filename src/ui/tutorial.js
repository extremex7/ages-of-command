// The tutorial: a guided tour of every part of the game, step by step, pointing at the part of
// the screen it explains. Offered when a new game starts (Settings → Gameplay → Tutorial: ask,
// always or off) and available any time from Menu → Tutorial. Numbers shown come from the
// game's rules so they stay true when the rules change.
import { h, mount } from './dom.js';
import { icon } from './icons.js';
import { saveSettings } from './storage.js';
import { openDialog } from './dialogs.js';
import { STARS } from '../core/prestige.js';

const P = (...t) => h('p', ...t);
const UL = (...items) => h('ul', items.map((i) => h('li', i)));
const B = (t) => h('b', t);

const stat = (label) => () => [...document.querySelectorAll('.topbar .stat')].find((e) => e.querySelector(':scope > span')?.textContent === label);
const sel = (q) => () => document.querySelector(q);
const tabBtn = (name) => () => [...document.querySelectorAll('.tabs button')].find((b) => b.textContent === name);

// What each building is for, in a sentence (production numbers come from the rules).
const WHY = {
  farm: 'Food keeps the population growing and stable: a food shortage is the fastest way to lose stability.',
  lumber_camp: 'Timber is needed for farms, consumer factories and much construction.',
  coal_mine: 'Coal fuels thermal power plants and steel mills.',
  gas_well: 'Natural gas fuels gas power plants; found in a few dozen countries, often beside oil.',
  iron_mine: 'Iron ore is the base of steel, and so of almost all industry.',
  oil_well: 'Oil becomes fuel at refineries; armoured units and a modern economy run on fuel.',
  uranium_mine: 'Uranium fuels nuclear plants (and nuclear weapon programmes).',
  rare_earth_mine: 'Rare earths are needed for electronics.',
  coal_power: 'Energy: almost every building needs it, and an energy shortage cuts GDP and raises unemployment.',
  nuclear_power: 'Twice the energy of a thermal plant from a little uranium; expensive and needs development 55.',
  hydro_dam: 'Energy with no fuel at all, on rivers in hills and mountains (a hydro deposit); slow and costly to build, then free to run.',
  gas_power: 'Energy from natural gas: cheaper and quicker to build than a coal plant, if you have gas or can import it.',
  wind_farm: 'Energy with no fuel, best on coasts, plains and in the far north; small but quick to build (needs Renewable Energy).',
  solar_farm: 'Energy with no fuel, best in deserts and the tropics; small but quick to build (needs Renewable Energy).',
  refinery: 'Turns oil into fuel for armour, transport and GDP.',
  steel_mill: 'Steel goes into factories, machinery, arms and new buildings: the backbone of industry.',
  factory: 'Consumer goods are what the population buys: shortages cut stability and GDP, surpluses sell abroad.',
  electronics_plant: 'Electronics are demanded more and more as countries get richer; valuable exports.',
  machine_works: 'Machinery is consumed by almost every new building you construct.',
  arms_factory: 'Munitions: every unit uses them monthly and more in battle; short armies fight worse.',
};

function buildingTable(cl) {
  const R = cl.game.rules, X = R.econ, gname = (i) => X.goods[i].name.toLowerCase();
  const list = (pairs) => pairs.map(([g, q]) => `${q} ${gname(g)}`).join(', ');
  return h('table.t.small.tut-table', h('tr', h('th', 'Building'), h('th', 'Makes (per level, monthly)'), h('th', 'Needs'), h('th', 'Why it helps')),
    X.buildings.map((b) => h('tr',
      h('td', icon(b.id), ' ', h('b', b.name), b.dep >= 0 ? h('div.muted', `needs ${/^[aeiou]/.test(X.resources[b.dep]) ? 'an' : 'a'} ${X.resources[b.dep].replace('_', ' ')} deposit`) : b.minDev ? h('div.muted', `development ${b.minDev}+`) : null),
      h('td', list(b.out)), h('td', b.inp.length ? list(b.inp) : 'nothing') , h('td', WHY[b.id] || ''))));
}

// The steps. `target` (optional) returns the element to point at; `before` (optional) sets the
// screen up (a tab, a map mode, a province).
function steps(cl) {
  const R = cl.game.rules, s = cl.state, me = s.player >= 0 ? s.countries[s.player] : null;
  const E = R.balance.economy, D = R.balance.diplomacy, I = R.balance.industry;
  const capital = () => { if (me && me.capital >= 0) cl.focusProvince(me.capital); };
  const tab = (id) => () => cl.setTab(id);
  return [
    { chapter: 'Welcome', title: 'Welcome to Ages of Command', body: [
      P('You lead a country' + (me ? `, ${me.name},` : '') + ' through history: its economy, government, research, armed forces and diplomacy. Every other country is run by the AI, under the same rules.'),
      P('There is no single way to win. Your aim is to make your country as strong, rich and stable as you can: the leaderboard ranks every country by ', B('prestige'), ' so you can see how you are doing.'),
      P('This tutorial walks through every part of the screen and explains how the game works. Use ', B('Next'), ' and ', B('Back'), ', jump to a chapter with the list at the top, or ', B('Skip'), ' at any time. Menu → Tutorial brings it back.'),
    ] },
    { chapter: 'Welcome', title: 'Prestige and the leaderboard', target: sel('.rank-btn'), body: [
      P('Your world rank. Prestige (0–100) combines economy 30%, military strength 20%, technology 15%, population, prosperity (GDP per person) and stability 10% each, and territory 5%, each compared with the best country in the world.'),
      P(STARS.map((t, i) => `${t.name}: ranks ${i ? STARS[i - 1].upTo + 1 : 1}–${t.upTo}`).join('. ') + '. A country that climbs fast (at least 5 places and 30% of its old rank in about five years) is marked as a ', B('rising star'), '.'),
      P('Click it, or the trophy button on the right of the top bar, to open the leaderboard.'),
    ] },
    { chapter: 'The top bar', title: 'Time', target: sel('.topbar .play'), body: [
      P('The game starts paused. ', B('Space'), ' or this button starts and pauses time; the ', B('› buttons'), ' or keys ', B('1–5'), ' set the speed (5 is as fast as your computer allows).'),
      P('Everything runs day by day: armies march, battles last days, buildings take months. The economy, research and politics are settled on the first of each month.'),
      P('Events that need your decision pause the game; once you have decided, it carries on (Settings → Gameplay can keep it paused instead).'),
    ] },
    { chapter: 'The top bar', title: 'Treasury and monthly balance', target: stat('Treasury'), body: [
      P(B('Treasury'), ' is your money (B = billion). ', B('Monthly'), ' is what it changes by each month: taxes and tariffs in, civil spending, military upkeep and debt interest out. Hover it for the breakdown.'),
      P('You can go into debt, but debt costs interest and lowers stability. A healthy country runs a small surplus and spends it on construction.'),
    ] },
    { chapter: 'The top bar', title: 'Stability', target: stat('Stability'), body: [
      P('Stability (0–100) is how calm and governable your country is. It raises tax efficiency; when it falls low, coups and revolutions become possible.'),
      P('It drops with food and consumer-goods shortages, unemployment, inflation, high taxes, low civil spending, debt, war and occupation, and with unhappy factions. The Economy tab lists this month\'s stability drivers.'),
    ] },
    { chapter: 'The top bar', title: 'Manpower and population', target: stat('Manpower'), body: [
      P(B('Manpower'), ' is how many people you can put into uniform: recruiting and reinforcing use it, and it refills monthly up to a cap set by your population, era and conscription policy.'),
      P(B('Population'), ' grows with food supply. More people mean more GDP and more manpower.'),
    ] },
    { chapter: 'The top bar', title: 'Influence', target: stat('Influence'), body: [
      P('Influence is your diplomatic currency. You gain it monthly (more for larger economies, up to ' + D.influenceCap + ') and spend it in the Diplomacy tab, for example ' + D.improveCost + ' to improve relations with a country. Better relations make treaties and alliances possible.'),
    ] },
    { chapter: 'The top bar', title: 'Research points', target: stat('Research'), body: [
      P('Research points per month go into your current research project. They come from research spending (set in the Research tab), education (average development) and technologies. When the number turns amber, no project is running and points are being banked.'),
    ] },
    { chapter: 'The top bar', title: 'Wars and the other buttons', target: stat('Wars'), body: [
      P(B('Wars'), ' counts the wars you are in. On the right: search for any country or province, the leaderboard, Save (', B('Ctrl+S'), ' quick-saves) and the Menu (settings, controls, this tutorial, saving and loading).'),
    ] },
    { chapter: 'The map', title: 'The map', target: sel('.game > canvas'), body: [
      P('Drag to move the map, use the mouse wheel to zoom (pinch on a touch screen). ', B('C'), ' centres on your capital, ', B('H'), ' shows the whole world.'),
      P('Click a province to see it and its country (in the Nation tab). Numbers on the map are armies; ship and plane markers are fleets and air wings.'),
    ] },
    { chapter: 'The map', title: 'Map modes', target: sel('.modes'), body: [
      P('Map modes colour the map by one thing: political borders, terrain, population, development, economy, resources, industry, infrastructure, military, diplomacy (your relations), technology, naval control, supply and government. Hover a button for its name and shortcut key.'),
      P('Resources shows where deposits are (mines can only be built on them); Infrastructure and Development show where buildings will work best.'),
    ] },
    { chapter: 'The map', title: 'Hide the side panel', target: sel('.side-toggle'), body: [
      P('This button (or ', B('Tab'), ') hides the side panel so you can see more of the map. Click a tab or the button again to bring it back.'),
    ] },
    { chapter: 'The map', title: 'A province', target: sel('.prov-panel'), before: capital, body: [
      P('This is your capital. A province panel shows its terrain, population, ', B('development'), ' (how advanced it is: higher development means more GDP per person and more efficient buildings), GDP, ', B('infrastructure'), ', fortification, deposits and buildings.'),
      P(B('Build here'), ' lists what you can construct, with the cost. ', B('Recruit here'), ' trains units in the province. Hover anything for the full calculation.'),
    ] },
    { chapter: 'Your country', title: 'Nation tab', target: sel('.sidebar'), before: tab('country'), body: [
      P('The overview of your country, or of whichever country you click on the map: its government, capital, population, GDP, development, era, treasury, taxes, stability, army and memberships.'),
      P('When you look at another country, this tab also shows your relations with it and the buttons to embargo it or declare war.'),
    ] },
    { chapter: 'Your country', title: 'Government', target: sel('.sidebar'), before: tab('government'), body: [
      P('Your government type (republic, monarchy, one-party state and so on) sets elections, stability, tax efficiency, manpower and the risk of coups.'),
      P('Seven ', B('factions'), ' (liberals, conservatives, socialists, nationalists, business, military, clergy) each have support and an approval of you. They care about different things: taxes, civil and military spending, prosperity, peace, victories, liberty, order, faith. Hover a faction to see why it feels the way it does. Unhappy factions lower stability; in democracies they can vote the ruling faction out.'),
      P(B('Policies'), ' (conscription, press, economy, administration, religion) trade one thing for another, for example mass conscription gives manpower but angers liberals. Changing one costs a little legitimacy and stability. A ', B('reform'), ' changes the government type (in peace, at stability 40 or more).'),
    ] },
    { chapter: 'Economy', title: 'Economy tab: the budget', target: sel('.sidebar'), before: tab('economy'), body: [
      P(B('Tax rate'), ` (${Math.round(E.minTax * 100)}–${Math.round(E.maxTax * 100)}%): more revenue now, but high taxes lower stability and anger the business faction.`),
      P(B('Civil spending'), ' (share of tax revenue): health, education and services. More spending raises development growth, stability and approval; less frees money for the army and construction.'),
      P(B('Import tariff'), ': revenue and protection for your producers, but higher consumer prices and fewer imports.'),
      P('Below are indicators (GDP, growth, unemployment, inflation, living standard), the stability drivers and history charts.'),
    ] },
    { chapter: 'Economy', title: 'How the economy works', body: [
      P('Your GDP has two parts: ', B('services'), ', which grow with population and development, and ', B('industry'), ', the value your buildings add.'),
      UL(
        [B('Goods. '), 'There are 15: raw (food, timber, coal, oil, natural gas, iron ore, uranium, rare earths), industrial (steel, energy, fuel) and final (consumer goods, electronics, machinery, munitions).'],
        [B('Production chains. '), 'Mines and farms make raw goods; mills, plants and refineries turn them into steel, energy and fuel; factories make final goods. A building short of an input slows down.'],
        [B('The world market. '), 'Each month you sell what you have beyond your needs and buy what you lack, at world prices. Wars and embargoes close trade routes.'],
        [B('Shortages hurt. '), 'Missing food or consumer goods lowers stability; missing energy cuts GDP and raises unemployment; missing munitions and fuel weaken armies.'],
        [B('Development '), 'grows slowly with living standards and civil spending. It makes people more productive and buildings more efficient.'],
      ),
      P('So the recipe is: produce (or afford to import) what your people and industry need, keep shortages away, and invest surpluses into new buildings and infrastructure.'),
    ] },
    { chapter: 'Economy', title: 'Industry tab', target: sel('.sidebar'), before: tab('industry'), body: [
      P('Every good with your production, needs, stockpile, imports and exports, and the world price. Red rows are shortages: those are what to build next.'),
      P(B('Construction'), ` lists your projects. A few run at once (more as your GDP grows), the rest wait in the queue (up to ${I.maxQueue ?? 30}). Cancelling refunds half the cost.`),
      P(B('Trade partners'), ' shows who you buy from and sell to.'),
    ] },
    { chapter: 'Economy', title: 'Buildings: what each one does', wide: true, body: () => [
      P('Buildings are built in provinces from the province panel (', B('Build here'), '). Each level adds the output below at full efficiency. Efficiency depends on the province\'s workers, development and infrastructure (farms also on farmland). Each new level costs a little more than the last.'),
      buildingTable(cl),
    ] },
    { chapter: 'Economy', title: 'Infrastructure', body: [
      P(B('Infrastructure'), ` (level 0–10 per province) is roads, rail and utilities. Each level adds ${Math.round(I.infraEffPerLevel * 100)}% to the efficiency of every building in the province and ${Math.round(I.infraSpeedPerLevel * 100)}% to the speed of armies moving into it, and improves army supply in your own land.`),
      P('Build it where your industry is concentrated: a level of infrastructure in a province with many factories pays for itself fastest. It costs more in large provinces and at higher levels.'),
    ] },
    { chapter: 'Research', title: 'Research tab and the technology tree', target: sel('.sidebar'), before: tab('research'), body: [
      P('Set ', B('research spending'), ' with the slider, then pick a project from ', B('Available'), ' (', B('+'), ' adds it to the queue). Technologies are cheaper when your neighbours and the world already know them.'),
      P('Technologies raise farm, mine and industrial output, research, population growth, combat, army speed, tax efficiency and more, and unlock new units, buildings and goods. Knowing at least half of an era\'s technologies moves you into that ', B('era'), ', which changes how much of your population can be mobilised.'),
      P(B('Technology tree'), ' shows everything: lines lead from each technology to what it unlocks. Drag and zoom it, and click a technology to see it and research or queue it.'),
    ] },
    { chapter: 'Military', title: 'Armies', target: sel('.sidebar'), before: tab('military'), body: [
      P(B('Recruit: '), 'choose Army, Navy or Air, select one of your provinces as the training site, and recruit units. Each costs money and manpower, takes time to train and costs upkeep every month.'),
      P(B('Move: '), 'click an army on the map (Shift adds more), then right-click where it should go. ', B('Merge'), ', ', B('Split'), ' and ', B('Modernise'), ' (upgrade old units) are in this tab.'),
      P(B('Battles'), ' start when enemy armies meet; numbers, strength, organisation, terrain, forts, technology, supply and munitions all count. Every battle report explains why it was won or lost. Armies ', B('besiege'), ' enemy provinces to occupy them; occupation builds war score.'),
      P(B('Supply: '), 'armies are supplied at home and less so abroad. Out of supply they fight worse and lose strength. Build ', B('supply depots'), ' (province panel) to supply a front, and keep the number of troops in one province within its supply capacity.'),
    ] },
    { chapter: 'Military', title: 'Navies and air forces', target: sel('.sidebar'), before: tab('military'), body: [
      P(B('Fleets'), ' are built in coastal provinces and sail between sea zones. They fight for sea control, blockade enemy ports, raid trade, protect armies crossing the sea and support battles on the coast.'),
      P(B('Air wings'), ' are based in your provinces and given a mission: air superiority, close air support for battles nearby, or strategic bombing of enemy industry.'),
    ] },
    { chapter: 'Military', title: 'Strategic tab', target: sel('.sidebar'), before: tab('strategic'), body: [
      P('Once you have the technology: ', B('nuclear weapons'), ' (programmes, warheads, missiles and bombers; a strike devastates a province and the world reacts strongly), ', B('cyber operations'), ' (espionage, sabotage, disruption, disinformation), and ', B('satellites'), ' (reconnaissance, communications, navigation, early warning). The future scenarios add space stations and settlements.'),
    ] },
    { chapter: 'Diplomacy', title: 'Diplomacy tab', target: sel('.sidebar'), before: tab('diplomacy'), body: [
      P(B('Opinion'), ' (−100 to 100) is what each country thinks of you, from government type, treaties, shared borders, rivals, threats, past wars and more; hover it to see every term. ', B('Trust'), ' falls when you break treaties.'),
      P(B('Treaties: '), 'alliance, defensive pact, non-aggression pact, trade agreement (no tariffs), military access and guarantees. Each proposal button shows whether it will be accepted and why. ', B('Organisations'), ' such as NATO or the EU can be joined by vote.'),
      P(B('Improve relations'), ` costs ${D.improveCost} influence and raises their opinion of you for a while.`),
      P(B('War and peace: '), 'declare war from the Nation tab of the target (the dialog shows who will join them). In a war, ', B('Negotiate peace…'), ' lets you demand provinces, reparations or a subject, paid for with war score from battles and occupation.'),
    ] },
    { chapter: 'Diplomacy', title: 'Events and decisions', target: tabBtn('Events'), body: [
      P('The ', B('Events'), ' tab is your news feed. Important news also appears as a message in the corner.'),
      P('Some events need a decision: strikes, scandals, disasters, booms, elections and historical moments. Each option shows its effects. You have ' + R.balance.government.eventChoiceDays + ' days; if you do not choose, your advisers do.'),
      P('The ', B('AI'), ' tab shows what the computer-run countries decided and why.'),
    ] },
    { chapter: 'Playing well', title: 'How to make your country the best', body: [
      UL(
        [B('Feed your people. '), 'Food shortages are the quickest way to lose stability and population. Keep food in surplus.'],
        [B('Fix shortages first. '), 'Check the Industry tab monthly: build what is red, starting with energy, steel and consumer goods.'],
        [B('Build where it works best. '), 'High development and infrastructure make every building more efficient; put industry where the workers are.'],
        [B('Balance the budget. '), 'Moderate taxes, enough civil spending to keep development and factions happy, and a small surplus to invest. Avoid long debts.'],
        [B('Research steadily. '), 'Keep a project running at all times; economic technologies pay back fastest.'],
        [B('Keep stability up. '), 'Watch the stability drivers and the factions; pick policies your strongest factions like.'],
        [B('Make friends before enemies. '), 'Trade agreements and alliances with neighbours keep you safe and markets open. Pick fights you can win, with allies, and make peace while you are ahead.'],
        [B('Keep an army you can afford. '), 'Upkeep is paid every month; a large idle army slows your economy. Modernise rather than mass-recruit.'],
        [B('Watch the leaderboard. '), 'Prestige rewards a strong economy most of all. Climbing fast earns the rising-star mark.'],
      ),
    ] },
    { chapter: 'Playing well', title: 'Saving, settings and help', body: [
      P(B('Save'), ' or ', B('Ctrl+S'), ' to save; the game also autosaves (Settings). ', B('Menu'), ' has settings (window, interface scale, graphics, music and sound, tutorial, cheats), the list of controls, and this tutorial.'),
      P('Almost everything has a tooltip: hover a number to see how it is calculated.'),
      P('You are ready. Good luck' + (me ? `, leader of ${me.name}` : '') + '!'),
    ] },
  ];
}

export function startTutorial(cl, from = 0) {
  document.querySelector('.tutorial')?.remove();
  document.querySelector('.tut-spot')?.remove();
  const list = steps(cl);
  let i = Math.max(0, Math.min(list.length - 1, from));
  if (cl.speed) cl.togglePause();
  const spot = h('div.tut-spot');
  const card = h('div.tutorial');
  const chapters = [...new Set(list.map((x) => x.chapter))];
  const close = () => { card.remove(); spot.remove(); clearInterval(timer); window.removeEventListener('resize', place); };
  const place = () => {
    const st = list[i], el = st.target?.();
    const r = el && el.getBoundingClientRect(), root = cl.el.getBoundingClientRect();
    card.classList.toggle('wide', !!st.wide);
    if (!r || !r.width) { spot.style.display = 'none'; card.classList.add('center'); card.style.left = card.style.top = ''; return; }
    card.classList.remove('center');
    spot.style.display = '';
    const pad = 4;
    Object.assign(spot.style, { left: r.left - root.left - pad + 'px', top: r.top - root.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
    // the card goes beside the target where there is room: right, left, below, above
    const cw = card.offsetWidth, ch = card.offsetHeight, W = root.width, H = root.height, gap = 14;
    let x, y;
    if (r.right - root.left + gap + cw < W) { x = r.right - root.left + gap; y = r.top - root.top; }
    else if (r.left - root.left - gap - cw > 0) { x = r.left - root.left - gap - cw; y = r.top - root.top; }
    else if (r.bottom - root.top + gap + ch < H) { x = r.left - root.left; y = r.bottom - root.top + gap; }
    else { x = r.left - root.left; y = r.top - root.top - gap - ch; }
    card.style.left = Math.max(8, Math.min(W - cw - 8, x)) + 'px';
    card.style.top = Math.max(8, Math.min(H - ch - 8, y)) + 'px';
  };
  const show = () => {
    const st = list[i];
    st.before?.();
    const body = typeof st.body === 'function' ? st.body() : st.body;
    const pick = h('select', { on: { change: (e) => { i = list.findIndex((x) => x.chapter === e.target.value); show(); } } },
      chapters.map((c) => h('option', { value: c, selected: c === st.chapter }, c)));
    mount(card,
      h('div.row.spread.tut-head', h('span.muted', icon('help'), ` Tutorial · ${i + 1} of ${list.length}`), pick),
      h('h3', st.title), h('div.tut-body', body),
      h('div.row.spread.tut-foot',
        h('button', { on: { click: () => { close(); } } }, i === list.length - 1 ? 'Close' : 'Skip tutorial'),
        h('div.row',
          i > 0 && h('button', { on: { click: () => { i--; show(); } } }, icon('prev'), 'Back'),
          i < list.length - 1 ? h('button.primary', { on: { click: () => { i++; show(); } } }, 'Next', icon('next'))
            : h('button.primary', { on: { click: close } }, 'Finish'))));
    cl.uiDirty = true; cl.requestFrame();
    requestAnimationFrame(() => requestAnimationFrame(place));
  };
  cl.el.append(spot, card);
  // the interface redraws as the game runs: keep pointing at the right place
  const timer = setInterval(() => { if (!card.isConnected) clearInterval(timer); else place(); }, 400);
  window.addEventListener('resize', place);
  show();
  return { close, step: () => i, count: list.length };
}

// Asked when a new game starts (Settings → Gameplay → Tutorial).
export function offerTutorial(cl) {
  const st = cl.data.settings;
  if (st.tutorial === 'off') return;
  if (st.tutorial === 'on') { startTutorial(cl); return; }
  const w = openDialog(cl, h('h2', icon('help'), ' Would you like a tutorial?'),
    h('p', 'A short guided tour of the screen and of how the economy, government, research, military and diplomacy work, with tips on how to make your country the best. You can skip it at any time, and open it later from Menu → Tutorial.'),
    h('div.row', { style: { marginTop: '1em', gap: '0.5em', flexWrap: 'wrap' } },
      h('button.primary', { on: { click: () => { w.remove(); startTutorial(cl); } } }, 'Start the tutorial'),
      h('button', { on: { click: () => w.remove() } }, 'Not now'),
      h('button', { on: { click: () => { st.tutorial = 'off'; saveSettings(st); w.remove(); cl.toast('The tutorial will not be offered again. Turn it back on in Settings → Gameplay, or open it from Menu → Tutorial.'); } } }, "Don't ask again")));
  return w;
}
