'use strict';
/*
 * Roster. Each character carries one of the original game's mechanical archetypes:
 *   rig    – hitbox / swing geometry set (see rigs.js)
 *   kind   – 'walk' (keyboard), 'jet' (mouse-steered flyer), 'hover' (bobbing floater)
 *   speed / jump / power – movement, jump and hit multipliers for the human player
 * Looks, names, bios and lines are original to this remake.
 */
const CHARS = {
  pip: {
    name: 'Pip', rig: 'small', kind: 'walk', speed: 1, jump: 1.15, power: 0.97,
    color: '#f39c12', bio: 'Twelve years old and already\nbanned from two rec centres.', pros: 'Pros: Tiny target, big heart.',
    lines: ['Is this the kids table?', 'My mom is watching!', 'I ate three juice boxes.'],
  },
  zara: {
    name: 'Zara Vex', rig: 'std', kind: 'walk', speed: 1.15, jump: 1.1, power: 0.97,
    color: '#e84393', bio: 'Trains on rooftops at dawn.\nNobody knows why.', pros: 'Pros: Quick feet, springy legs.',
    lines: ['Keep up if you can.', 'I warmed up for six hours.', 'Blink and you lose.'],
  },
  jo: {
    name: 'Jetpack Jo', rig: 'jet', kind: 'jet', follow: 1.4, speed: 0.85, jump: 1.25, power: 1,
    color: '#00a8ff', bio: 'Strapped a leaf blower to her\nback and never looked down.', pros: 'Pros: Mouse controls.',
    lines: ['Clear the airspace!', 'Fuel check: questionable.', 'Up, up and a-volley!'],
  },
  boris: {
    name: 'Big Boris', rig: 'std', kind: 'walk', speed: 1.1, jump: 0.9, power: 1.05,
    color: '#c0392b', bio: 'Former furniture mover.\nStill lifts with his back.', pros: 'Pros: Everything but jumping.',
    lines: ['I have moved pianos.', 'You are very small.', 'Boris does not lose.'],
  },
  pogo: {
    name: 'Pogo Pete', rig: 'std', kind: 'walk', speed: 0.89, jump: 1.25, power: 1,
    color: '#27ae60', bio: 'Glued springs to his shoes\nin 2009. Never took them off.', pros: 'Pros: Ridiculous jumping.',
    lines: ['Boing.', 'Gravity is optional.', 'Watch the ceiling, pal.'],
  },
  cubey: {
    name: 'Cubey', rig: 'std1', kind: 'walk', speed: 1, jump: 1, power: 1,
    color: '#8e44ad', bio: 'Born with a square head.\nTakes geometry very personally.', pros: 'Pros: Solid all-rounder.',
    lines: ['...', 'Four sides. No weaknesses.', 'Right angles only.'],
  },
  hank: {
    name: 'Hank Timber', rig: 'std', kind: 'walk', speed: 0.89, jump: 0.9, power: 1.1,
    color: '#2d6a4f', bio: 'Lumberjack on holiday.\nSwings a racket like an axe.', pros: 'Pros: Heavy hitter.',
    lines: ['Timberrr!', 'I chop, you drop.', 'Smells like pine in here.'],
  },
  glim: {
    name: 'Glimmer', rig: 'std1', kind: 'walk', speed: 1, jump: 1, power: 1, glow: true,
    color: '#48dbfb', bio: 'Mostly made of light.\nDoes not cast a shadow.', pros: 'Pros: Hard to look at.',
    lines: ['Can you even see me?', 'Shine on.', 'Bright idea: you lose.'],
  },
  nimbus: {
    name: 'Nimbus', rig: 'hover', kind: 'hover', speed: 1, jump: 1.15, power: 0.97,
    color: '#a4b0be', bio: 'Rides a pet rain cloud.\nThe cloud does most of the work.', pros: 'Pros: Floats, pops serves.',
    lines: ['*poof*', 'Forecast: your defeat.', 'Chance of rain: 100%.'],
  },
  stan: {
    name: 'Stan', rig: 'std1', kind: 'walk', speed: 1, jump: 1, power: 1,
    color: '#2980b9', bio: 'Perfectly ordinary in\nevery measurable way.', pros: 'Pros: Reliable. Very reliable.',
    lines: ['Hello. I am Stan.', 'Nice weather for it.', 'I read the rulebook.'],
  },
  rae: {
    name: 'Rocket Rae', rig: 'jet2', kind: 'jet', follow: 1.3, speed: 0.85, jump: 1.25, power: 1,
    color: '#ff6b35', bio: 'Test pilot. Rocket boots.\nZero chill.', pros: 'Pros: Fast mouse flying.',
    lines: ['Ignition!', 'Mach one, baby.', 'Try to keep up.'],
  },
  turbo: {
    name: 'Turbo', rig: 'std', kind: 'walk', speed: 1.2, jump: 1, power: 1,
    color: '#e74c3c', bio: 'Drinks espresso by the jug.\nHas never once walked.', pros: 'Pros: Blistering speed.',
    lines: ['Vrrrrm!', 'Already there.', 'Too slow, too slow!'],
  },
};

// Tournament select order + unlock tiers (win the tournament to open the next tier)
const SELECT_1P = ['pip', 'zara', 'jo', 'boris', 'pogo', 'cubey', 'hank', 'glim', 'nimbus', 'stan', 'rae', 'turbo'];
const UNLOCK_TIERS = [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9], [10, 11]];
// Two-player roster (no mouse flyers)
const SELECT_2P = ['pip', 'zara', 'boris', 'pogo', 'cubey', 'hank', 'glim', 'nimbus', 'stan', 'turbo'];

// Opponent ladder per player character (rounds 1-5). Rounds 1-4 follow the original; the original
// sent Zara, Nimbus and Boris against their own mirror in the final, here they meet another regular.
const LADDER = {
  jo: ['pip', 'hank', 'glim', 'pogo', 'nimbus'],
  pip: ['zara', 'cubey', 'hank', 'stan', 'glim'],
  pogo: ['boris', 'nimbus', 'stan', 'hank', 'turbo'],
  zara: ['pip', 'glim', 'pogo', 'cubey', 'turbo'],
  nimbus: ['glim', 'cubey', 'hank', 'pogo', 'boris'],
  turbo: ['glim', 'nimbus', 'pogo', 'stan', 'cubey'],
  boris: ['zara', 'glim', 'hank', 'turbo', 'pogo'],
  stan: ['pip', 'boris', 'hank', 'glim', 'cubey'],
  rae: ['nimbus', 'hank', 'pogo', 'cubey', 'glim'],
  hank: ['boris', 'glim', 'cubey', 'stan', 'pogo'],
  cubey: ['nimbus', 'glim', 'hank', 'pogo', 'turbo'],
  glim: ['zara', 'cubey', 'nimbus', 'pogo', 'hank'],
};
const ladderFor = (id) => LADDER[id] || ['stan', 'stan', 'stan', 'stan', 'stan'];

const ROUND_NAMES = ['Round 1', 'Round 2', 'Quarter-Finals', 'Semi-Finals', 'Final Match'];
// Opponent tuning per round: [speed, jump, power, skill]
const ROUND_AI = [
  [1.1, 1, 1, 100],
  [1.1, 1, 1, 95],
  [1.1, 1, 1, 85],
  [1.1, 1, 1, 75],
  [1.15, 1, 1, 65],
];

// Special greeting lines (opponent -> player) shown instead of a random line
function greetingFor(oppId, playerId) {
  if (oppId === 'pip') return playerId === 'zara' ? 'Can I have your autograph?' : 'Are you a pro?';
  if (oppId === 'zara') {
    if (CHARS[playerId].kind === 'jet') return 'Nice wings. Shame about the pilot.';
    if (playerId === 'nimbus') return 'Is that cloud house-trained?';
    return 'Ready to sweat?';
  }
  if (oppId === 'nimbus') return CHARS[playerId].kind === 'jet' ? 'A fellow flyer!' : '*poof*';
  return null;
}

window.CHARS = CHARS;
window.SELECT_1P = SELECT_1P;
window.SELECT_2P = SELECT_2P;
window.UNLOCK_TIERS = UNLOCK_TIERS;
window.LADDER = LADDER;
window.ladderFor = ladderFor;
window.ROUND_NAMES = ROUND_NAMES;
window.ROUND_AI = ROUND_AI;
window.greetingFor = greetingFor;
