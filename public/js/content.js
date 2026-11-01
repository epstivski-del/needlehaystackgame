// NIGHT SHIFT: The Last Bell — all written content (narration, scare lines, Incident Logs, pickup labels).
// Everything here is fictional. "Midnight Regional College" and everyone in it are made up.
// Narration comes in two flavours: h = horror, c = comedy. The Comedy vs Horror slider in Settings picks between them.

export const PK_LABEL = {
  crumb: 'Golden Doughnut piece', key: 'Scooter key', toasterkey: 'Toaster key', knife: 'Bread knife', jam: 'Jam jar', butter: 'Butter',
  trophy: 'Trophy fragment', board: 'Bodyboard', battery: 'Battery', snack: 'Snack', coin: 'Cooked Coin', can: 'Tin can', duck: 'Rubber duck',
  stress: 'Stress ball', log: 'Incident Log', s67: 'Suspicious 67', seal: 'Seal of Cooked', bike: 'The Legendary Bike',
};

export const NAR = {
  zone_atrium: { h: 'The doors lock behind you. Above the Reception desk, a sign flickers: ALL VISITORS MUST REPORT TO NO ONE.', c: 'The front doors lock. A sign says all visitors must report to Reception. Reception is empty and somehow judging you.' },
  zone_secret: { h: 'A room that is not on the map. Every clock on the wall reads the same number.', c: 'A secret room. Every clock says 67. Nobody explains this. Nobody ever will.' },
  zone_deck: { h: 'The timber deck creaks under your feet. Something under it creaks back.', c: 'The deck creaks. It is either the wood or a very quiet ghost doing stretches.' },
  zone_quad: { h: 'The quad is empty. The bell should have rung hours ago.', c: 'The quad. Seagulls usually live here. Tonight they are on strike.' },
  zone_wingW: { h: 'West Wing. Every classroom door is open. Every chair is pushed in. Nobody pushed them in.', c: 'West Wing. Immaculate classrooms. Suspiciously immaculate. Someone has been tidying.' },
  zone_wingE: { h: 'East Wing. A locker door clicks shut somewhere ahead of you.', c: 'East Wing. A locker slams. Probably a ghost. Possibly a lost sandwich.' },
  zone_canteen: { h: 'The Doughnut Dungeon. Glaze drips from the ceiling. The sprinkles on the floor remember every step.', c: 'The Doughnut Dungeon. The floor is covered in sprinkles. Do not sprint. Sprinkles are loud and you are not subtle.' },
  zone_scooter: { h: 'The car park is full of scooters. Nobody rode them here.', c: 'Forty-six abandoned scooters. Zero owners. Several are idling. Do not make eye contact.' },
  zone_shed: { h: 'The bike shed. The chain gate is open. That is worse.', c: 'The bike shed. A seal is in here. So is a very strong smell of wet shoes.' },
  zone_bakery: { h: 'Warm air. The smell of baking bread. Far too much baking bread. Something large is breathing.', c: 'The Bakery of Legend. Everything is bread. Please do not eat the walls. They are structural.' },
  zone_abyss: { h: 'The oval is flooded. The water is the wrong colour and the tide is keeping time.', c: 'The oval is underwater. Somewhere below, something wearing a bib is waiting for a rematch.' },
  zone_aud: { h: 'The auditorium. A laugh track plays to an audience that is not laughing for you.', c: 'The auditorium. The laugh track never stops. We checked the plug. There is no plug.' },
  toaster_key: { h: 'The toaster is locked. A key is hidden somewhere in the bakery.', c: 'The toaster needs a key. This is the most bureaucratic bakery in history.' },
  boss_dead: { h: 'The bell rings once more, slowly. Then silence. Then, very softly, a Seal.', c: 'The Last Bell has been roasted into submission. It feels something. Possibly relief.' },
  buddy_leaves: { h: 'Your friend nods at you in the dark and wanders off. They will find you again.', c: 'Buddy has completed their tutorial duties and wandered off. They said "good luck". They did not mean it.' },
};

// Jump-scare / alert lines by enemy kind.
export const SCARE = {
  chase: { h: 'Something has seen you. Run.', c: 'You hear footsteps. They are not yours. They are also very confident.' },
  loaf: { h: 'The floor shakes. The Loaf has your scent.', c: 'The Loaf is coming. It has no eyes. It has opinions.' },
  hand: { h: 'A cold hand closes around yours. The engine starts.', c: 'You shook its hand. Bold. The scooter is a separate consequence.' },
  wraith: { h: 'Something grabs your ankle under the black water.', c: 'LAST has entered the chat. And by chat I mean your ankle.' },
  laugh: { h: 'The crowd turns. Their grins are far too wide.', c: 'The Audience has noticed you move during a punchline. Rude.' },
};

export const LOG_ZONES = ['The Doughnut Dungeon', 'The Scooter Catastrophe', 'The Loaf of Bread Incident', 'The Bodyboard Abyss', 'The Fart Joke Foghorn'];

// 15 Incident Logs, three per level, in pickup order (log index i = level * 3 + k).
export const LOGS = [
  { title: '8:25 AM', text: 'The rumour started at 8:25 on a Friday. By 8:26 it had a group chat, a theme tune and a logo. By 8:30 the entire school was, in the technical sense, cooked.' },
  { title: 'The Doughnut Budget', text: 'Someone spent a whole canteen budget on a single glazed doughnut. The doughnut did not say thank you. It is still down here, and it remembers.' },
  { title: 'Sprinkles', text: 'Do not sprint on the sprinkles. The Glazed Stalker has excellent hearing and terrible manners. Crouch. Or get the mop. The mop is on strike.' },
  { title: 'A Seemingly Innocent Handshake', text: 'It began with a handshake. Nobody expected the scooters. Nobody ever does. The handshake was never again just a handshake.' },
  { title: 'Scooter Inventory', text: 'Forty-six scooters in the lot. Zero owners. Several are idling. Please do not make eye contact with the idling ones. They are shy, and also hungry.' },
  { title: 'Do Not Look Away', text: 'Facts: the Handshake Entity only moves when you are not looking. Counter-fact: you will have to blink at some point. We are sorry. We did not design the eyelid.' },
  { title: 'The Loaf', text: 'One student brought an entire loaf of bread to school as lunch. The loaf has since grown. It is a good loaf. It is not a friendly loaf.' },
  { title: 'Where Is The Butter', text: 'Question one: why a whole loaf? Question two: where is the butter? Question three: why is the loaf looking for the butter. We recommend answering question two first.' },
  { title: 'Toasting Protocol', text: 'Per the staff handbook, the correct response to a sentient loaf is: toast it, then throw jam. The handbook is two lines long and written in biro.' },
  { title: 'Bodyboard Comp', text: 'The competition results are in. Dead last. The trophy was never claimed, so it broke into four pieces and sank into the oval. Nobody has asked for a refund.' },
  { title: 'The Tide', text: 'The oval floods every ninety seconds, give or take a surge. Please do not splash. Splashing is loud and the water is listening.' },
  { title: 'Last Place', text: 'The Last Place Wraith wears a bib that says LAST. It is not bitter. It is somewhat bitter. It would like to discuss the scoring system.' },
  { title: 'Laugh Track', text: 'The laugh track never stops. We checked the plug. There is no plug. We checked the speakers. There are no speakers. The laughter is coming from inside the building.' },
  { title: 'Open Mic', text: 'The comedy microphone has been retired. Several attempts at the fart joke were made. The audience laughed every single time. That is how this started.' },
  { title: 'The Last Bell', text: 'At 8:25 every Friday it rings once. Then, very faintly: ts rizz. It is not a threat. It is a vibe. Possibly also a threat. Be kind to it, and bring a doughnut.' },
];

export const HAT_NAMES = { none: 'No hat', cap: 'Cap', cone: 'Traffic cone', beanie: 'Beanie', crown: 'Crown', bread: 'Loaf hat', duck: 'Duck', halo: 'Halo' };

export const HINTS = {
  plates: 'Stand on both glowing plates to open the front doors. Your Buddy will take one.',
  explore: 'Follow the compass to the five Incidents. Doors on the Quad paths lead to each one.',
};

export const ACHIEVEMENTS = [
  ['cooked', 'Cooked (Technically)', 'Finish a run, win or lose.'],
  ['respect', 'Respect Boundaries', 'Win the Good Ending.'],
  ['sixtyseven', 'The 67/10', 'Earn the secret ending.'],
  ['declined', 'Respectfully Declined', 'Win without being hit once.'],
  ['loaf', 'Loaf Whisperer', 'Hit the Loaf with 3 distractions.'],
  ['last', 'Last Place, First in Our Hearts', 'Collect 2 trophy fragments.'],
  ['samaritan', 'Good Samaritan', 'Revive a teammate.'],
  ['paramedic', 'Paramedic', 'Revive 3 teammates in one run.'],
  ['archivist', 'Archivist', 'Find all 15 Incident Logs as a team.'],
  ['numerologist', 'Numerologist', 'Find all 15 hidden 67s as a team.'],
  ['sweet', 'Sweet Tooth', 'Pick up 40 things in one run.'],
  ['roaster', 'Rhythm Roaster', 'Land 10 perfect beats on The Last Bell.'],
  ['handshake', 'Hand Shaker', 'Shake the Handshake Entity\'s hand.'],
  ['arms', 'Arms Dealer', 'Throw 20 things in a single run.'],
  ['hide', 'Hide and Seek Champion', 'Spend a minute hiding in one run.'],
];
