// The office as data. A catalog says, for each kind of furniture, which voxel model draws it, the rectangle it
// blocks on the floor and where people sit or stand on it; a layout places the pieces, the outer walls (with windows
// and doors), the glass walls, the floor zones, the boards on the walls and where the desk pods go. Everything is in
// metres, x to the right and z toward the viewer, the floor centred on the origin; a rotation turns a piece about its
// centre the way three.js turns an object (rot 0 keeps the model as drawn). Plain data with no imports, so a custom
// office can come from a JSON file and the plan can be checked without a browser.

const PI = Math.PI;

/** type -> {model: name in office-voxel.js, args: item fields passed to it, y: height it stands at,
 *  foot: [width, depth] blocked, off: [x, z] of that rectangle, seats, spots, fx: points of interest} */
export const CATALOG = {
  bossDesk: {model: 'bossDesk', foot: [2.3, 0.95]},
  bossChair: {model: 'bossChair', foot: [0.8, 0.8], seats: [{x: 0, z: -0.07, y: 0.2, rot: PI, tag: 'boss'}]},
  laptop: {model: 'laptop', y: 0.8},
  shelf: {model: 'shelf', args: ['seed'], foot: [1.6, 0.5], off: [0, 0.05]},
  smallDesk: {model: 'smallDesk', foot: [1.2, 0.7]},
  chair: {model: 'chair', args: ['color', 'accent'], foot: [0.5, 0.5], seats: [{x: 0, z: 0, y: 0.1, rot: PI}]},
  confTable: {model: 'confTable', foot: [2.8, 1.2]},
  meetChair: {model: 'meetChair', foot: [0.45, 0.45], seats: [{x: 0, z: 0, y: 0.1, rot: PI, tag: 'meet'}]},
  kitchen: {model: 'kitchen', args: ['len'], foot: [2.8, 0.7], off: [0, 0.05],
            fx: {machine: [0.25, 1.55, 0], led: [0.2, 1.05, 0.22], brew: {x: 0.25, z: 0.9, rot: PI}}},
  upperCabinets: {model: 'upperCabinets', args: ['len'], y: 1.55},
  fridge: {model: 'fridge', foot: [0.8, 0.8]},
  waterCooler: {model: 'waterCooler', foot: [0.45, 0.45]},
  barTable: {model: 'barTable', foot: [1.0, 1.0]},
  barStool: {model: 'barStool', foot: [0.36, 0.36], seats: [{x: 0, z: 0, y: 0.4, rot: 0, tag: 'coffee'}]},
  sofa: {model: 'sofa', args: ['color'], foot: [1.8, 0.7],
         seats: [{x: -0.5, z: 0.2, y: 0.05, rot: 0, pose: 'sofa', tag: 'coffee'}, {x: 0.5, z: 0.2, y: 0.05, rot: 0, pose: 'sofa', tag: 'coffee'}]},
  armchair: {model: 'armchair', args: ['color'], foot: [0.8, 0.8], seats: [{x: 0, z: 0.1, y: 0.05, rot: 0, pose: 'sofa', tag: 'coffee'}]},
  coffeeTable: {model: 'coffeeTable', foot: [1.0, 0.6]},
  rack: {model: 'rack', foot: [0.7, 0.8],
         fx: {leds: Array.from({length: 27}, (_, i) => [-0.25 + (i % 3) * 0.18, 0.28 + Math.floor(i / 3) * 0.2, 0.36])}},
  printer: {model: 'printer', foot: [1.0, 0.8], fx: {paper: [0, 1.1, 0.2]}},
  planter: {model: 'planter', args: ['seed'], foot: [0.5, 0.5]},
  floorLamp: {model: 'floorLamp', foot: [0.35, 0.35], fx: {light: [0, 1.85, 0]}},
  foosball: {model: 'foosball', foot: [1.4, 0.8], game: true,
             spots: [{x: 0, z: -0.75, rot: 0, tag: 'play'}, {x: 0, z: 0.75, rot: PI, tag: 'play'}]},
};

// ------------------------------------------------------------------ pieces from the office pack and the 5 cm kit
// Pack models (vendor/office-pack.json, MariaIsMe, CC BY 4.0) block a rectangle taken from their own voxel bounds;
// an item may pick another pack model (`pack`), recolour it (`tint`, see recolor in office-voxel.js) or rescale it.
const pk = (pack, extra = {}) => ({pack, ...extra});
const SOFA2 = tag => [{x: -0.45, z: 0.08, y: -0.12, rot: 0, pose: 'sofa', tag}, {x: 0.45, z: 0.08, y: -0.12, rot: 0, pose: 'sofa', tag}];
Object.assign(CATALOG, {
  deskChair: pk('Chairs/Office_Chair_White_02', {foot: [0.5, 0.5], seats: [{x: 0, z: 0.03, y: -0.07, rot: 0}]}),
  execChair: pk('Chairs/Office_Chair_Black_01', {foot: [0.5, 0.5], seats: [{x: 0, z: 0.03, y: -0.07, rot: 0}]}),
  sideChair: pk('Chairs/Office_Chair_White_04', {foot: [0.5, 0.5], seats: [{x: 0, z: 0.03, y: -0.07, rot: 0}]}),
  couch: pk('Chairs/Office_Couch_White_01', {seats: SOFA2('coffee')}),
  lowTable: pk('Tables/Office_Table_Coffee_03_Brown'),
  table: pk('Tables/Office_Table_White_3x1_01'),
  cabinet: pk('Misc/Office_Misc_Cabinet_01'),
  plantTall: {model: 'plantTall', args: ['seed'], foot: [0.52, 0.52]}, plantPot: {model: 'plantBush', args: ['seed'], foot: [0.46, 0.46]},   // leaf by leaf (office-voxel.js)
  trash: pk('Misc/Trashcans/Office_Misc_Trashcan_Big_01'), recycle: pk('Misc/Trashcans/Office_Misc_Traschcan_Recycle_Blue'),
  tvWall: pk('Misc/Electronics/Office_Misc_TV_Wall_02', {block: false}), tvStand: pk('Misc/Electronics/Office_Misc_TV_Stand_03'),
  console: pk('Misc/Electronics/Office_Misc_Console_Woo_01', {block: false, scale: 0.03}),
  espresso: pk('Misc/Coffee/Office_Misc_Coffee_Machine_04', {fx: {steam: [0, 1.0, 0.1]}}),
  coffeeMaker: pk('Misc/Coffee/Office_Misc_Coffee_Machine_01', {block: false, scale: 0.032}),
  corkboard: pk('Misc/Office_Misc_Wall_Corkboard_01', {block: false}), wallGraph: pk('Misc/Office_Misc_Wall_Graph', {block: false}),
  cubicle: {model: 'cubicle', block: false},                       // low fabric screens round each desk (office-voxel.js)
  pack: {},                                                       // any pack model, named by the item's `pack`
  pod: {group: true},                                             // a block of four cubicles: four desks
  workstation: {group: true},                                     // one desk with its chair, no cubicle
  cafeTable: {model: 'cafeTable', args: ['color'], foot: [0.72, 0.72]},
  cafeChair: {model: 'cafeChair', args: ['color'], foot: [0.4, 0.4], seats: [{x: 0, z: 0, y: 0.1, rot: 0, tag: 'coffee'}]},
  barCounter: {model: 'barCounter', args: ['len'], foot: [3.0, 0.65]},
  vending: {model: 'vendingMachine', foot: [0.9, 0.8]},
  lockers: {model: 'lockers', args: ['n', 'color'], foot: [1.6, 0.5]},
  pingPong: {model: 'pingPong', foot: [2.7, 1.5], game: true,
             spots: [{x: -1.6, z: 0, rot: PI / 2, tag: 'play'}, {x: 1.6, z: 0, rot: -PI / 2, tag: 'play'}]},
  poolTable: {model: 'poolTable', foot: [2.4, 1.4], game: true,
              spots: [{x: -0.6, z: 1.0, rot: PI, tag: 'play'}, {x: 0.6, z: 1.0, rot: PI, tag: 'play'}, {x: -1.5, z: 0, rot: -PI / 2, tag: 'play'}]},
  beanBag: {model: 'beanBag', args: ['color'], foot: [0.7, 0.7], seats: [{x: 0, z: 0.05, y: -0.15, rot: 0, pose: 'sofa', tag: 'coffee'}]},
  reception: {model: 'receptionDesk', foot: [2.4, 0.8]},
  binders: {model: 'binderShelf', args: ['seed'], foot: [1.1, 0.5]},
  copier: {model: 'copier', foot: [1.0, 0.7]},
});

// ------------------------------------------------------------------ the default office, 30 x 20 m
// Back right the boss's glass office and, outside its door, the assistant; two phone booths; front right the glass
// meeting room; front middle the common room (the second coffee room, the one friends can share); the entrance with
// the reception; on the left the café (kitchen, bar, tables), the lounge and the games corner. The open space holds
// two blocks of four cubicles, furnished even when nobody sits there; agents take the free ones in order, and when they
// are all taken another block comes at the next pod slot. Behind them, against the north wall, the control room.
const LS = -0.8;                                                 // the assistant's desk faces the open space
const ring4 = (x, z, tag, color) => [[0, -0.72, 0], [0, 0.72, PI], [-0.72, 0, PI / 2], [0.72, 0, -PI / 2]]
  .map(([dx, dz, rot]) => ({type: 'cafeChair', x: x + dx, z: z + dz, rot, color, tag}));
export const DEFAULT_LAYOUT = {
  size: [30, 20],
  floor: {base: 'carpet', zones: [
    {x0: 9, z0: -10, x1: 15, z1: -4.5, kind: 'parquet'}, {x0: 13, z0: -4, x1: 15, z1: 1, kind: 'booth'},
    {x0: 9, z0: 3.5, x1: 15, z1: 10, kind: 'parquetLight'}, {x0: 0, z0: 5, x1: 8, z1: 10, kind: 'common'},
    {x0: -6, z0: 6, x1: 0, z1: 10, kind: 'stone'}, {x0: -15, z0: 1, x1: -6, z1: 10, kind: 'tiles'},
    {x0: -14.5, z0: -4, x1: -9, z1: 0.5, kind: 'rug'}, {x0: -15, z0: -10, x1: -8, z1: -4.5, kind: 'game'},
    {x0: -4, z0: 9.5, x1: -2, z1: 10, kind: 'mat'}, {x0: -2, z0: -10, x1: 3.8, z1: -4.6, kind: 'booth'},
  ]},
  walls: [
    {a: [-15, -10], b: [15, -10], windows: [[-14, -11], [10.5, 14]]},
    {a: [15, -10], b: [15, 10], windows: [[-9, -5.5], [4, 9]]},
    {a: [15, 10], b: [-15, 10], windows: [[9.5, 14], [5, 7], [1, 3.2], [-13.5, -7.5]], doors: [[3.5, 4.7], [-4, -2]]},
    {a: [-15, 10], b: [-15, -10], windows: [[-3.5, 0], [-9, -5.5]]},
  ],
  glass: [
    {a: [9, -10], b: [9, -4.5]}, {a: [9, -4.5], b: [15, -4.5], doors: [[10, 11]]},                  // boss office
    {a: [13, -4], b: [13, 1], doors: [[-3.3, -2.3], [-0.8, 0.2]], swing: 'out'},                  // phone booths: doors open outward
    {a: [13, -4], b: [15, -4]}, {a: [13, -1.5], b: [15, -1.5]}, {a: [13, 1], b: [15, 1]},
    {a: [9, 3.5], b: [9, 10]}, {a: [9, 3.5], b: [15, 3.5], doors: [[10, 11]]},                    // meeting room
    {a: [0, 5], b: [0, 10], doors: [[6.6, 7.6]]}, {a: [0, 5], b: [8, 5], doors: [[3.4, 4.6]]}, {a: [8, 5], b: [8, 10]},  // common room
  ],
  items: [
    // the boss's office
    {type: 'bossDesk', x: 12, z: -7.7, rot: PI}, {type: 'bossChair', x: 12, z: -8.55, rot: PI},
    {type: 'laptop', x: 12.55, z: -7.85, rot: PI - 0.35}, {type: 'binders', x: 14.2, z: -9.6, seed: 23},
    {type: 'cabinet', x: 9.6, z: -9.55}, {type: 'couch', x: 14.4, z: -6.4, rot: -PI / 2, pack: 'Chairs/Office_Couch_Black_01', tag: 'office'},
    {type: 'plantTall', x: 9.5, z: -5.1}, {type: 'floorLamp', x: 14.55, z: -5.0},
    // the assistant
    {type: 'smallDesk', x: 11.6 + Math.sin(LS) * 0.62, z: -3.2 + Math.cos(LS) * 0.62, rot: LS},
    {type: 'chair', x: 11.6, z: -3.2, rot: LS + PI, color: '#2d5b56', tag: 'lead'},
    // a second assistant, for a second session sharing this office
    {type: 'smallDesk', x: 9.8 + Math.sin(LS) * 0.62, z: -3.3 + Math.cos(LS) * 0.62, rot: LS},
    {type: 'chair', x: 9.8, z: -3.3, rot: LS + PI, color: '#5b4a8a', tag: 'lead2'},
    // the open space: two blocks of four cubicles (furniture like the rest: they can be moved or removed); more blocks
    // come by themselves at podSlots when the agents fill them
    ...[[0.9, -0.9], [-4.1, -0.9]].map(([x, z]) => ({type: 'pod', x, z})),
    // the control room: a command table facing the task board and the live TV on the north wall
    {type: 'confTable', x: 1, z: -6.6},
    ...[0, 1, 2].map(x => ({type: 'meetChair', x, z: -5.55, rot: 0})),
    {type: 'meetChair', x: -0.75, z: -6.6, rot: -PI / 2}, {type: 'meetChair', x: 2.75, z: -6.6, rot: PI / 2},
    {type: 'plantTall', x: 4.9, z: -9.45},
    // phone booths
    {type: 'smallDesk', x: 14.5, z: -2.8, rot: PI / 2}, {type: 'barStool', x: 13.95, z: -2.8, rot: PI / 2, tag: 'booth'},
    {type: 'smallDesk', x: 14.5, z: -0.3, rot: PI / 2}, {type: 'barStool', x: 13.95, z: -0.3, rot: PI / 2, tag: 'booth'},
    // meeting room
    {type: 'confTable', x: 12, z: 6.75},
    ...[11, 12, 13].flatMap(x => [{type: 'meetChair', x, z: 5.7, rot: PI}, {type: 'meetChair', x, z: 7.8, rot: 0}]),
    {type: 'meetChair', x: 10.25, z: 6.75, rot: -PI / 2}, {type: 'meetChair', x: 13.75, z: 6.75, rot: PI / 2},
    {type: 'tvWall', x: 14.82, y: 1.0, z: 6.75, rot: -PI / 2}, {type: 'plantTall', x: 14.4, z: 9.4}, {type: 'plantPot', x: 9.5, z: 9.5},
    // common room: the second coffee room
    {type: 'couch', x: 2.6, z: 9.25, rot: PI, pack: 'Chairs/Office_Couch_Brown_01', tag: 'common'},
    {type: 'couch', x: 2.6, z: 6.45, rot: 0, pack: 'Chairs/Office_Couch_Brown_01', tag: 'common'},
    {type: 'lowTable', x: 2.6, z: 7.85},
    {type: 'beanBag', x: 5.4, z: 6.1, rot: -0.6, color: '#ef6c00', tag: 'common'}, {type: 'beanBag', x: 6.4, z: 7.3, rot: -1.4, color: '#1e88e5', tag: 'common'},
    {type: 'beanBag', x: 5.4, z: 8.7, rot: -2.4, color: '#8e24aa', tag: 'common'},
    {type: 'barCounter', x: 7.45, z: 7.6, rot: -PI / 2, len: 40}, {type: 'coffeeMaker', x: 7.5, y: 1.05, z: 8.6, rot: -PI / 2},
    {type: 'plantTall', x: 0.5, z: 9.5}, {type: 'plantPot', x: 7.5, z: 5.5},
    // entrance and reception
    {type: 'reception', x: -3, z: 7.3, rot: PI}, {type: 'deskChair', x: -3, z: 6.5, rot: 0},
    {type: 'armchair', x: -5.3, z: 9.2, rot: PI / 2, color: '#455a64'}, {type: 'armchair', x: -0.7, z: 9.2, rot: -PI / 2, color: '#455a64'},
    {type: 'plantTall', x: -5.5, z: 6.4}, {type: 'plantTall', x: -0.5, z: 6.4},
    // café: kitchen along the wall, bar, tables
    {type: 'kitchen', x: -14.6, z: 4.4, rot: PI / 2}, {type: 'kitchen', x: -14.6, z: 7.2, rot: PI / 2},
    {type: 'upperCabinets', x: -14.72, z: 4.4, rot: PI / 2}, {type: 'upperCabinets', x: -14.72, z: 7.2, rot: PI / 2},
    {type: 'fridge', x: -14.55, z: 2.3, rot: PI / 2}, {type: 'vending', x: -14.45, z: 9.35, rot: PI / 2},
    {type: 'espresso', x: -11.6, z: 9.45, rot: PI}, {type: 'waterCooler', x: -10.2, z: 9.6, rot: PI},
    {type: 'barCounter', x: -11.2, z: 5.2, rot: PI / 2, len: 60},
    ...[3.9, 4.75, 5.6, 6.45].map(z => ({type: 'barStool', x: -10.5, z, rot: -PI / 2})),
    {type: 'cafeTable', x: -7.6, z: 2.6}, ...ring4(-7.6, 2.6, 'coffee', '#c0392b'),
    {type: 'cafeTable', x: -7.6, z: 5.4}, ...ring4(-7.6, 5.4, 'coffee', '#16a085'),
    {type: 'cafeTable', x: -7.6, z: 8.2}, ...ring4(-7.6, 8.2, 'coffee', '#d4a017'),
    {type: 'recycle', x: -6.4, z: 9.6}, {type: 'recycle', x: -6.4, z: 1.4, pack: 'Misc/Trashcans/Office_Misc_Traschcan_Recycle_Green'},
    // lounge
    {type: 'couch', x: -14.4, z: -1.8, rot: PI / 2, pack: 'Chairs/Office_Couch_Brown_01'},
    {type: 'couch', x: -10.0, z: -1.8, rot: -PI / 2, pack: 'Chairs/Office_Couch_Black_02'},
    {type: 'lowTable', x: -12.2, z: -1.8, rot: PI / 2}, {type: 'tvStand', x: -12.2, z: 0.55, rot: PI},
    {type: 'console', x: -12.2, y: 0.45, z: 0.45, rot: PI}, {type: 'armchair', x: -12.2, z: -3.8, rot: 0, color: '#6d5d8a'},
    {type: 'sofa', x: -10.9, z: -3.8, rot: 0}, {type: 'couch', x: -13.5, z: -3.9, rot: 0},
    {type: 'floorLamp', x: -14.5, z: -4.1}, {type: 'plantTall', x: -8.6, z: 0.6},
    // games corner
    {type: 'foosball', x: -13.2, z: -8.4}, {type: 'pingPong', x: -10.4, z: -6.4}, {type: 'poolTable', x: -10.6, z: -8.85},
    {type: 'beanBag', x: -14.2, z: -5.4, rot: 0.6, color: '#43a047'}, {type: 'beanBag', x: -13.0, z: -5.2, rot: 0.2, color: '#e53935'},
    {type: 'tvWall', x: -14.82, y: 1.0, z: -7.4, rot: PI / 2, pack: 'Misc/Electronics/Office_Misc_TV_Wall_03'},
    {type: 'plantTall', x: -8.6, z: -9.4},
    // service corner, back wall
    {type: 'rack', x: -7.5, z: -9.45}, {type: 'copier', x: -6.6, z: -9.35}, {type: 'lockers', x: -5.6, z: 4.5, rot: PI / 2, n: 4, color: '#455a64'},
    {type: 'corkboard', x: -5.2, y: 1.2, z: -9.83}, {type: 'wallGraph', x: 6.6, y: 1.2, z: -9.83},
    {type: 'binders', x: 8.3, z: -9.6, seed: 31}, {type: 'cabinet', x: 7.4, z: -9.55, pack: 'Misc/Office_Misc_Cabinet_02'},
    // the plaza in front of the open space: a team table and plants
    {type: 'table', x: 4.2, z: 3.05}, ...[3.0, 4.2, 5.4].flatMap(x => [{type: 'sideChair', x, z: 2.3, rot: 0, tag: 'team'}, {type: 'sideChair', x, z: 3.8, rot: PI, tag: 'team'}]),
    {type: 'plantTall', x: 8.5, z: 4.4}, {type: 'plantTall', x: -4.8, z: 4.4}, {type: 'plantPot', x: 8.5, z: 0.4},
    {type: 'recycle', x: -1.6, z: 4.6, pack: 'Misc/Trashcans/Office_Misc_Traschcan_Recycle_Yellow'}, {type: 'trash', x: -0.9, z: 4.6},
  ],
  spots: [{x: -13.6, z: 3.5, rot: -PI / 2, tag: 'coffee'}, {x: -13.6, z: 8.1, rot: -PI / 2, tag: 'coffee'},
          {x: -11.6, z: 8.6, rot: 0, tag: 'coffee'}, {x: 1.0, z: 7.85, rot: PI / 2, tag: 'portal'},
          {x: -3, z: 9.2, rot: PI, tag: 'entrance'}, {x: 4.1, z: 9.2, rot: PI, tag: 'bridgeIn'}],
  lights: [[12, 2.6, 6.75], [-10, 2.6, 5.5], [4, 2.6, 7.5], [-12, 2.6, -6.5], [1, 2.6, -6.6]],
  boards: {
    tv: {x: 3.5, y: 1.7, z: -9.85, rot: 0}, whiteboard: {x: -1.5, y: 1.6, z: -9.85, rot: 0},
    clock: {x: 9.75, y: 2.35, z: -9.85, rot: 0}, coffeeSign: {x: -14.85, y: 2.6, z: 5.8, rot: PI / 2},
    nameplate: {x: 12, y: 0.95, z: -7.21, rot: 0}, commonSign: {x: 4, y: 2.65, z: 4.97, rot: PI},
    scoreboard: {x: -9.9, y: 1.75, z: -9.85, rot: 0}, github: {x: 1.1, y: 1.6, z: -9.85, rot: 0},
  },
  // neon signs that name the places (office-signs.js; text in both languages; hang: from the ceiling, readable from both sides) and an easel with a guide at the entrance
  signs: [
    {text: {it: 'SALA REGIA', en: 'CONTROL ROOM'}, x: 0.9, y: 2.72, z: -4.7, rot: 0, w: 1.9, h: 0.42, tone: 'cyan', hang: true},
    {text: 'ARCADE', x: 1.2, y: 2.4, z: 5.12, rot: 0, w: 1.0, h: 0.34, tone: 'magenta', both: true},      // both: the board shows through the glass wall, so the open space sees it too
    {text: 'CINEMA', x: -12.2, y: 2.68, z: 0.8, rot: PI, w: 1.3, h: 0.34, tone: 'amber', hang: true},
    {text: 'OPEN SPACE', x: -1.6, y: 2.72, z: 2.1, rot: 0, w: 2.0, h: 0.42, tone: 'green', hang: true},
    {kind: 'guide', text: 'guide', x: -2.3, y: 0.7, z: 7.9, rot: 0, w: 1.0, h: 0.75, easel: true},
  ],
  // blocks of four cubicles (two open toward +z, two toward -z), all furnished; agents take the free desks in order
  // what the room under the mouse (or around you in first person) is called; the first match wins
  rooms: [
    {x0: 9, z0: -10, x1: 15, z1: -4.5, it: "Ufficio del boss", en: "Boss's office"},
    {x0: 13, z0: -4, x1: 15, z1: 1, it: 'Cabine telefoniche', en: 'Phone booths'},
    {x0: 9, z0: 3.5, x1: 15, z1: 10, it: 'Sala riunioni', en: 'Meeting room'},
    {x0: 0, z0: 5, x1: 8, z1: 10, it: 'Sala comune', en: 'Common room'},
    {x0: 2.9, z0: 10, x1: 5.3, z1: 17, it: 'Ponte verso gli amici', en: 'Bridge to your friends', shared: true},
    {x0: -6, z0: 6, x1: 0, z1: 10, it: 'Ingresso', en: 'Entrance'},
    {x0: -15, z0: 1, x1: -6, z1: 10, it: 'Caffetteria', en: 'Café'},
    {x0: -15, z0: -4.5, x1: -8, z1: 1, it: 'Lounge', en: 'Lounge'},
    {x0: -15, z0: -10, x1: -8, z1: -4.5, it: 'Angolo giochi', en: 'Games corner'},
    {x0: -8, z0: -10, x1: -6, z1: -8, it: 'Angolo servizi', en: 'Service corner'},
    {x0: 9, z0: -4.5, x1: 13, z1: -1, it: "Postazione dell'assistente", en: "Assistant's desk"},
    {x0: -6.5, z0: 1, x1: 9, z1: 5, it: 'Piazza', en: 'Plaza'},
    {x0: -2, z0: -10, x1: 3.8, z1: -4.6, it: 'Sala regia', en: 'Control room'},
    {x0: -15, z0: -10, x1: 15, z1: 10, it: 'Open space', en: 'Open space'},
  ],
  // the common room's door in the front wall; shared with friends, a glass bridge leads to their building
  bridge: {x: 4.1, z: 10, length: 7, width: 2.4},
  pods: {style: 'cubicle'},
  // where a new block of four desks goes when every desk is taken, in this order (one free desk is always kept)
  podSlots: [[5.9, -0.9], [-4.1, -6.6], [5.9, -6.6]],
  camera: {pos: [1.5, 33, 38], target: [0.5, 0.2, 0.3]},
};

// ------------------------------------------------------------------ resolve: from the layout to world positions
const turn = (r, x, z) => [x * Math.cos(r) + z * Math.sin(r), -x * Math.sin(r) + z * Math.cos(r)];

/** a straight wall from a to b: its angle, length, the ranges (in metres from a) of the given cuts */
function span(w) {
  const dx = w.b[0] - w.a[0], dz = w.b[1] - w.a[1], len = Math.hypot(dx, dz), axis = Math.abs(dx) >= Math.abs(dz) ? 0 : 1;
  const cut = list => (list || []).map(([u, v]) => { const s = Math.abs(u - w.a[axis]), t = Math.abs(v - w.a[axis]); return [Math.min(s, t), Math.max(s, t)]; });
  return {dx, dz, len, rot: Math.atan2(-dz, dx), windows: cut(w.windows), doors: cut(w.doors)};
}
/** the solid pieces of a wall between its doors, as boxes */
function wallBoxes(w, s, thick) {
  const out = [], cuts = [...s.doors].sort((p, q) => p[0] - q[0]);
  let from = 0;
  for (const [u, v] of [...cuts, [s.len, s.len]]) {
    if (u > from) {
      const mid = (from + u) / 2;
      out.push({x: w.a[0] + s.dx / s.len * mid, z: w.a[1] + s.dz / s.len * mid, hw: (u - from) / 2, hd: thick / 2, rot: s.rot});
    }
    from = v;
  }
  return out;
}

/** four cubicles round a shared back wall, turned by rot about (cx, z0): each holds a desk against its back */
function cubicleBlock(out, cx, z0, prot, src, tint = null) {
  const n = out.desks.length;
  for (const [side, crot] of [[1, 0], [-1, PI]]) for (const sx of [-1, 1]) {
    const [ox, oz] = turn(prot, sx * 1.04, side * 1.04), x = cx + ox, z = z0 + oz, rot = crot + prot;
    const at = (lx, lz) => { const [dx, dz] = turn(rot, lx, lz); return [x + dx, z + dz]; };
    out.items.push({type: 'cubicle', src, part: true, x, y: 0, z, rot, model: 'cubicle', args: [], tint});
    // low screens: the back one, and the sides only as deep as the desk and a little more (from -1.04 to 0.2)
    const [bx, bz] = at(0, -0.975), [lx, lz] = at(-0.94, -0.42), [rx, rz] = at(0.94, -0.42), [dx, dz] = at(0, -0.5), [hx, hz] = at(0, 0.3);
    out.boxes.push({x: bx, z: bz, hw: 1.04, hd: 0.07, rot}, {x: lx, z: lz, hw: 0.1, hd: 0.62, rot}, {x: rx, z: rz, hw: 0.1, hd: 0.62, rot},
                   {x: dx, z: dz, hw: 0.8, hd: 0.4, rot}, {x: hx, z: hz, hw: 0.25, hd: 0.25, rot});
    out.desks.push({x: dx, z: dz, rot, order: n * 10 + (side > 0 ? 0 : 4) + (sx + 1)});
  }
}
/** a single desk with its chair, facing rot (the person sits on the +z side of the desk, looking at it) */
export function workstation(out, x, z, rot, src) {
  const at = (lx, lz) => { const [dx, dz] = turn(rot, lx, lz); return [x + dx, z + dz]; }, [hx, hz] = at(0, 0.8);
  out.boxes.push({x, z, hw: 0.8, hd: 0.4, rot}, {x: hx, z: hz, hw: 0.25, hd: 0.25, rot});
  out.desks.push({x, z, rot, order: out.desks.length * 10, src});
}

/** every placed thing in world coordinates: what blocks, where to sit or stand, the walls to build, the effects */
export function resolve(layout, {packSize = null} = {}) {
  const out = {boxes: [], seats: [], spots: [], walls: [], glass: [], fx: {}, items: [], desks: [], doors: []};
  const fx = (k, p) => (out.fx[k] = out.fx[k] || []).push(p);
  for (const [src, it] of (layout.items || []).entries()) {
    const c = CATALOG[it.type];
    if (!c) continue;
    if (it.type === 'pod') { cubicleBlock(out, it.x, it.z, it.rot || 0, src, layout.pods?.tint); continue; }
    if (it.type === 'workstation') { workstation(out, it.x, it.z, it.rot || 0, src); continue; }
    const r = it.rot || 0, at = (x, z) => { const [dx, dz] = turn(r, x, z); return [it.x + dx, it.z + dz]; };
    const pack = it.pack || c.pack, scale = it.scale ?? c.scale ?? 0.065;
    out.items.push({...it, src, rot: r, y: it.y ?? c.y ?? 0, model: c.model, args: (c.args || []).map(k => it[k]),
                    pack, scale, sy: it.sy ?? c.sy ?? 1, tint: it.tint || c.tint || null});
    let foot = c.foot;
    if (!foot && pack && c.block !== false && packSize) { const z = packSize(pack, scale); if (z) foot = [z[0] * 0.92, z[2] * 0.92]; }
    if (foot && c.block !== false) { const [x, z] = at(...(c.off || [0, 0])); out.boxes.push({x, z, hw: foot[0] / 2, hd: foot[1] / 2, rot: r}); }
    for (const q of c.seats || []) { const [x, z] = at(q.x, q.z); out.seats.push({x, z, y: q.y, rot: r + q.rot, pose: q.pose || 'sit', tag: it.tag || q.tag || 'seat'}); }
    for (const q of c.spots || []) { const [x, z] = at(q.x, q.z); out.spots.push({x, z, rot: r + q.rot, tag: q.tag}); }
    for (const [k, v] of Object.entries(c.fx || {})) {
      if (k === 'brew') { const [x, z] = at(v.x, v.z); out.spots.push({x, z, rot: r + v.rot, tag: 'brew'}); continue; }
      for (const p of Array.isArray(v[0]) ? v : [v]) { const [x, z] = at(p[0], p[2]); fx(k, [x, p[1], z]); }
    }
  }
  for (const s of layout.spots || []) out.spots.push({...s});
  // cubicle blocks: four cubicles round a shared back wall; each holds a desk against its back, the opening in front
  const P = layout.pods || {};
  if (P.style === 'cubicle') (P.list || []).forEach(([cx, z0]) => cubicleBlock(out, cx, z0, 0, undefined, P.tint));
  out.desks.sort((a, b) => a.order - b.order);
  for (const w of layout.walls || []) {
    const s = span(w), mx = (w.a[0] + w.b[0]) / 2, mz = (w.a[1] + w.b[1]) / 2;
    let nx = s.dz / s.len, nz = -s.dx / s.len;                    // the outward side: away from the middle of the floor
    if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz; }
    out.walls.push({...w, ...s, mid: [mx, mz], out: [nx, nz]});
    out.boxes.push(...wallBoxes(w, s, 0.25));
  }
  for (const w of layout.glass || []) {
    const s = span(w);
    out.glass.push({...w, ...s});
    out.boxes.push(...wallBoxes(w, s, 0.1));
  }
  // door leaves, open at 100 degrees: into the room the door leads to (outer doors swing inward); a door onto the
  // bridge stays the drawing's business (it opens only while the common room is shared). Wider than 1.4 m: two leaves.
  const roomAt = (x, z) => (layout.rooms || []).find(r => !r.shared && r.it !== 'Open space' && x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);
  const B = layout.bridge;
  for (const [kind, list] of [['glass', out.glass], ['wall', out.walls]]) for (const w of list) for (const [u, v] of w.doors) {
    const ux = w.dx / w.len, uz = w.dz / w.len, at = t => [w.a[0] + ux * t, w.a[1] + uz * t];
    const [mx, mz] = at((u + v) / 2);
    if (kind === 'wall' && B && Math.hypot(mx - B.x, mz - B.z) < 1) { out.doors.push({kind: 'bridge', hinge: at(u), len: v - u, rot: w.rot, open: 0}); continue; }
    const side = s => { const [ex, ez] = turn(w.rot + s * 100 * PI / 180, (v - u) / 2, 0); return [mx + ex * 0.6, mz + ez * 0.6]; };
    let sign = 1;
    if (kind === 'wall') sign = (turn(w.rot + 100 * PI / 180, 1, 0)[0] * w.out[0] + turn(w.rot + 100 * PI / 180, 1, 0)[1] * w.out[1]) > 0 ? -1 : 1;
    else if (!roomAt(...side(1)) && roomAt(...side(-1))) sign = -1;
    if (w.swing === 'out') sign = -sign;
    const leaves = v - u > 1.4 ? [[u, (v - u) / 2, 1], [v, (v - u) / 2, -1]] : [[u, v - u, 1]];
    for (const [t, len, dir] of leaves) {
      const open = dir * sign * 100 * PI / 180, rot = w.rot + (dir < 0 ? PI : 0) + open * (dir < 0 ? -1 : 1);
      const [hx, hz] = at(t), [ex, ez] = turn(rot, len / 2, 0);
      out.doors.push({kind, hinge: [hx, hz], len, rot});
      out.boxes.push({x: hx + ex, z: hz + ez, hw: len / 2, hd: 0.04, rot});
    }
  }
  return out;
}

// ------------------------------------------------------------------ walking: what blocks, and the way around it
/** The floor for walking: the layout's boxes plus the desk pods as they get built (setPods). blocked() tests a body
 *  of radius r; route() is A* on a grid of `cell` metres, 8 neighbours without cutting corners, with the corners
 *  pulled straight where the line is clear; it ends at the goal, or at the free cell nearest to it. Points are {x, z}. */
export function floorPlan(layout, placed, {body = 0.2, cell = 0.25} = {}) {
  const [sx, sz] = layout.size, GW = Math.round(sx / cell), GH = Math.round(sz / cell), N = GW * GH, X0 = -sx / 2, Z0 = -sz / 2;
  const cx = k => X0 + (k % GW + 0.5) * cell, cz = k => Z0 + (Math.floor(k / GW) + 0.5) * cell;
  let boxes = placed.boxes, grid = null, open = [], extra = [];

  function blocked(x, z, r = body) {
    const out = x < X0 + r || x > -X0 - r || z < Z0 + r || z > -Z0 - r;
    if (out && !open.some(o => x > o.x0 + r && x < o.x1 - r && z > o.z0 + r && z < o.z1 - r)) return true;
    for (const b of extra.length ? [...boxes, ...extra] : boxes) {
      const dx = x - b.x, dz = z - b.z, reach = b.hw + b.hd + r;
      if (dx * dx + dz * dz > reach * reach) continue;
      const c = Math.cos(b.rot), s = Math.sin(b.rot);
      if (Math.abs(dx * c - dz * s) < b.hw + r && Math.abs(dx * s + dz * c) < b.hd + r) return true;
    }
    return false;
  }
  function free() {
    if (!grid) { grid = new Uint8Array(N); for (let k = 0; k < N; k++) grid[k] = blocked(cx(k), cz(k), body + 0.06) ? 0 : 1; }   // a margin: no squeezing past corners
    return grid;
  }
  /** the free cell nearest to p, searching outwards ring by ring */
  function nearestCell(p) {
    const g = free(), i0 = Math.min(GW - 1, Math.max(0, Math.floor((p.x - X0) / cell))), j0 = Math.min(GH - 1, Math.max(0, Math.floor((p.z - Z0) / cell)));
    for (let rad = 0; rad < Math.max(GW, GH); rad++) {
      let best = -1, bd = Infinity;
      for (let i = i0 - rad; i <= i0 + rad; i++) for (let j = j0 - rad; j <= j0 + rad; j++) {
        if (Math.max(Math.abs(i - i0), Math.abs(j - j0)) !== rad || i < 0 || j < 0 || i >= GW || j >= GH) continue;
        const k = j * GW + i;
        if (!g[k]) continue;
        const d = (cx(k) - p.x) ** 2 + (cz(k) - p.z) ** 2;
        if (d < bd) { bd = d; best = k; }
      }
      if (best >= 0) return best;
    }
    return -1;
  }
  function clear(a, b) {
    const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.1);
    for (let i = 1; i <= n; i++) if (blocked(a.x + (b.x - a.x) * i / n, a.z + (b.z - a.z) * i / n)) return false;
    return true;
  }
  function route(from, to) {
    const g = free(), s = nearestCell(from), goal = nearestCell(to);
    if (s < 0 || goal < 0) return null;
    const cost = new Float32Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), done = new Uint8Array(N);
    const gx = goal % GW, gy = Math.floor(goal / GW), heap = [];
    const push = (f, k) => {
      heap.push([f, k]);
      for (let i = heap.length - 1; i > 0;) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        for (let i = 0; ;) {
          const l = 2 * i + 1, r = l + 1; let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
        }
      }
      return top[1];
    };
    cost[s] = 0; push(0, s);
    while (heap.length) {
      const k = pop();
      if (k === goal) break;
      if (done[k]) continue;
      done[k] = 1;
      const x = k % GW, y = (k - x) / GW;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const nx = x + dx, ny = y + dy, n = ny * GW + nx;
        if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= GW || ny >= GH || !g[n] || done[n]) continue;
        if (dx && dy && (!g[y * GW + nx] || !g[ny * GW + x])) continue;
        const c = cost[k] + (dx && dy ? Math.SQRT2 : 1);
        if (c < cost[n]) { cost[n] = c; prev[n] = k; push(c + Math.hypot(nx - gx, ny - gy), n); }
      }
    }
    if (goal !== s && prev[goal] < 0) return null;
    const pts = [];
    for (let k = goal; k !== s; k = prev[k]) pts.push({x: cx(k), z: cz(k)});
    pts.reverse();
    if (!blocked(to.x, to.z)) pts.push({x: to.x, z: to.z});
    const out = []; let a = from;
    for (let i = 0; i < pts.length; i++) if (i === pts.length - 1 || !clear(a, pts[i + 1])) { out.push(pts[i]); a = pts[i]; }
    return out;
  }
  return {
    blocked, clear, route,
    nearest(p) { const k = nearestCell(p); return k < 0 ? null : {x: cx(k), z: cz(k)}; },
    setPods(pods) { boxes = [...placed.boxes, ...pods.map(p => ({x: p.cx, z: p.z0, hw: 1.7, hd: 0.85, rot: 0}))]; grid = null; },
    /** walkable rectangles beyond the room ({x0, z0, x1, z1}) and extra obstacles (boxes); the grid is rebuilt */
    setExtra(walk = [], obstacles = []) { open = walk; extra = obstacles; grid = null; },
    /** furniture added while running (a workstation for an extra agent) */
    addBoxes(list) { boxes = [...boxes, ...list]; grid = null; },
  };
}
