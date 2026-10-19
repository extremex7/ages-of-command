// Builds src/ui/icons.js from Lucide (https://lucide.dev, ISC licence): only the icons the game
// uses, as SVG markup, so the game keeps zero runtime dependencies.
// Usage: node tools/build_icons.mjs <path to an unpacked lucide-static package>
//   (npm pack lucide-static && tar -xzf lucide-static-*.tgz   gives ./package)
import fs from 'node:fs';
import path from 'node:path';

// game name -> Lucide icon
export const ICONS = {
  // map modes
  political: 'flag', terrain: 'mountain-snow', population: 'users', development: 'trending-up', economy: 'coins',
  resources: 'gem', industry: 'factory', infrastructure: 'route', military: 'swords', diplomacy: 'handshake',
  technology: 'flask-conical', naval: 'anchor', supply: 'package', government: 'landmark',
  // sidebar tabs (some share the map-mode icons)
  country: 'flag', research: 'flask-conical', strategic: 'radiation', log: 'scroll-text', ai: 'bot',
  // buildings
  farm: 'wheat', lumber_camp: 'trees', coal_mine: 'pickaxe', iron_mine: 'drill', oil_well: 'droplet', uranium_mine: 'atom',
  rare_earth_mine: 'gem', coal_power: 'zap', nuclear_power: 'radiation', refinery: 'fuel', steel_mill: 'anvil',
  factory: 'factory', electronics_plant: 'cpu', machine_works: 'cog', arms_factory: 'crosshair',
  gas_well: 'flame', gas_power: 'flame-kindling', hydro_dam: 'dam', wind_farm: 'wind', solar_farm: 'sun',
  // top bar and menus
  treasury: 'wallet', monthly: 'trending-up', stability: 'scale', manpower: 'hard-hat', era: 'graduation-cap', wars: 'swords',
  play: 'play', pause: 'pause', save: 'save', menu: 'menu', new_game: 'play', load: 'folder-open', settings: 'settings', exit: 'log-out',
  editor: 'pencil-ruler', achievements: 'medal', summary: 'award',
  army: 'shield', fleet: 'ship', wing: 'plane', events: 'bell', close: 'x',
  influence: 'megaphone', research_points: 'flask-conical', tech_tree: 'network', zoom_in: 'zoom-in', zoom_out: 'zoom-out', fit: 'maximize',
  music: 'music', sound: 'volume-2', mute: 'volume-x',
  collapse: 'panel-left-close', expand: 'panel-left-open', leaderboard: 'trophy', star: 'star', rising: 'rocket', console: 'terminal',
  help: 'circle-help', tip: 'lightbulb', next: 'chevron-right', prev: 'chevron-left', up: 'arrow-up', down: 'arrow-down', same: 'minus',
};

// technologies (tech_<id>); a technology missing here uses its field's icon (field_<field>)
export const TECH_ICONS = {
  // fields
  field_agriculture: 'wheat', field_administration: 'landmark', field_economy: 'factory', field_medicine: 'stethoscope',
  field_education: 'book-open', field_transport: 'truck', field_communications: 'radio', field_energy: 'zap', field_army: 'swords',
  field_navy: 'anchor', field_air: 'plane', field_doctrine: 'target', field_space: 'rocket',
  // technologies
  irrigation: 'waves', bronze_working: 'hammer', writing: 'pen-line', masonry: 'pyramid', sailing: 'sailboat', mathematics: 'sigma',
  horseback_riding: 'rabbit', iron_working: 'anvil', philosophy: 'brain', siege_engineering: 'castle', hippocratic_medicine: 'stethoscope',
  roads: 'milestone', aqueducts: 'droplet', bureaucracy: 'building-2', professional_army: 'shield', paper: 'scroll',
  three_field_rotation: 'sprout', magnetic_compass: 'compass', universities: 'graduation-cap', trebuchet: 'axe', banking: 'hand-coins',
  gunpowder: 'flame', blast_furnace: 'flame', cannon: 'bomb', printing_press: 'printer', firearms: 'crosshair', ocean_navigation: 'globe',
  trace_italienne: 'castle', pike_and_shot: 'sword', columbian_exchange: 'apple', anatomy: 'heart-pulse', joint_stock_company: 'receipt',
  scientific_method: 'microscope', ship_of_the_line: 'ship', vauban_siegecraft: 'shovel', parliamentarism: 'vote', flintlock_bayonet: 'crosshair',
  steam_engine: 'cog', crop_rotation: 'tractor', canals: 'waves', compulsory_schooling: 'book-open', mechanised_textiles: 'factory',
  watt_steam_engine: 'cog', federalism: 'network', census: 'users-round', levee_en_masse: 'users-round', vaccination: 'syringe',
  machine_tools: 'ruler', railways: 'train-front', steamships: 'ship', chemical_fertilisers: 'test-tube', income_tax: 'receipt',
  telegraph: 'radio-tower', rifled_firearms: 'crosshair', bessemer_process: 'anvil', general_staff: 'flag-triangle-right',
  public_sanitation: 'droplet', oil_drilling: 'fuel', germ_theory: 'microscope', high_explosives: 'bomb', reinforced_concrete: 'building',
  electricity: 'plug', internal_combustion: 'car', quick_firing_artillery: 'target', radio: 'radio', powered_flight: 'plane',
  dreadnought: 'ship', assembly_line: 'factory', haber_bosch: 'flask-round', tanks: 'shield-half', modern_surgery: 'hospital',
  infiltration_tactics: 'eye-off', mass_politics: 'megaphone', quantum_mechanics: 'atom', modern_artillery: 'target',
  keynesian_economics: 'scale', motorised_infantry: 'truck', radar: 'radar', combined_arms_warfare: 'swords', aircraft_carrier: 'anchor',
  antibiotics: 'pill', nuclear_fission: 'atom', jet_engine: 'fan', electronic_computer: 'calculator', transistor: 'cpu',
  helicopters: 'helicopter', nuclear_power: 'radiation', mass_immunisation: 'syringe', containerisation: 'container', spaceflight: 'rocket',
  integrated_circuit: 'cpu', guided_missiles: 'rocket', satellites: 'satellite', green_revolution: 'sprout', rare_earth_refining: 'gem',
  internet: 'globe', gps: 'map-pin', precision_guided_munitions: 'crosshair', mobile_telephony: 'smartphone', gm_crops: 'dna',
  e_government: 'laptop', drones: 'plane', biotechnology: 'dna', hydraulic_fracturing: 'drill', renewable_energy: 'sun', gas_turbine: 'flame',
  machine_learning: 'brain-circuit', quantum_computing: 'atom', directed_energy_weapons: 'zap', vertical_farming: 'leaf',
  longevity_medicine: 'heart', general_ai: 'bot', fusion_power: 'sun', orbital_industry: 'orbit', powered_exoskeletons: 'dumbbell',
  asteroid_mining: 'pickaxe', arcologies: 'building-2', molecular_nanotechnology: 'sparkles', life_extension: 'infinity',
  artificial_superintelligence: 'sparkles', submarines: 'waves', all_metal_aircraft: 'plane', atomic_bomb: 'bomb',
  thermonuclear_weapons: 'radiation', icbm: 'rocket', missile_defense: 'shield-check', stealth: 'eye-off', cyber_warfare: 'server',
  hypersonic_weapons: 'gauge', autonomous_weapons: 'bot', quantum_encryption: 'lock-keyhole', orbital_defense: 'satellite-dish',
  off_world_settlement: 'earth',
};
for (const [k, v] of Object.entries(TECH_ICONS)) ICONS[k.startsWith('field_') ? k : 'tech_' + k] = v;

const dir = process.argv[2];
if (!dir) { console.error('usage: node tools/build_icons.mjs <lucide-static package dir>'); process.exit(1); }
const version = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
const body = {};
for (const name of new Set(Object.values(ICONS))) {
  const svg = fs.readFileSync(path.join(dir, 'icons', name + '.svg'), 'utf8');
  body[name] = svg.slice(svg.indexOf('>', svg.indexOf('<svg')) + 1, svg.lastIndexOf('</svg>')).replace(/\s*\n\s*/g, '').trim();
}
const out = `// Interface icons from Lucide ${version} (https://lucide.dev), ISC licence (full text: LICENSE-lucide.txt):
//   Copyright (c) Lucide Icons and Contributors. Permission to use, copy, modify, and/or distribute
//   this software for any purpose with or without fee is hereby granted, provided that the above
//   copyright notice and this permission notice appear in all copies.
// Generated by tools/build_icons.mjs; edit the ICONS table there, not this file.
const SVG = ${JSON.stringify(body, null, 0).replace(/","/g, '",\n  "').replace(/^\{/, '{\n  ').replace(/\}$/, ',\n}')};
const NAMES = ${JSON.stringify(ICONS, null, 0).replace(/,"/g, ', "')};

// icon('farm') -> <svg class="icon">; the colour follows the text (currentColor).
export function icon(name, cls = '') {
  const inner = SVG[NAMES[name] || name];
  const span = document.createElement('span');
  span.className = 'icon' + (cls ? ' ' + cls : '');
  span.setAttribute('aria-hidden', 'true');
  if (inner) span.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
  return span;
}
export function hasIcon(name) { return !!SVG[NAMES[name] || name]; }
`;
fs.writeFileSync(new URL('../src/ui/icons.js', import.meta.url), out);
fs.copyFileSync(path.join(dir, 'LICENSE'), new URL('../src/ui/LICENSE-lucide.txt', import.meta.url));
console.log(`wrote src/ui/icons.js: ${Object.keys(body).length} icons, ${out.length} bytes`);
