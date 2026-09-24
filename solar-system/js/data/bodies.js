// Physical data for every body shown.
//
// Sources
//   radii        IAU WGCCRE 2015 report (Archinal et al. 2018), equatorial / polar, km
//   masses       NASA GSFC planetary & satellite fact sheets (2024 revision)
//   periods      NASA GSFC fact sheets; Saturn's rotation from ring seismology (Mankovich et al. 2019)
//   obliquities  NASA GSFC fact sheets (angle between spin axis and orbit normal)
//   aKm          moons' mean orbital radius (NASA GSFC); used only to lay out the overview
//
// Orbital motion and spin orientation are NOT stored here: they come from js/astro/ephemeris.js.
// `photometry: 'lunar'` marks dark airless regolith surfaces (lunar–Lambert law, see shaders.js).
// `shape` is [equatorial, equatorial, polar] radii, or the three semi-axes for the irregular moons
// (longest axis pointing at the parent planet).

export const BODIES = [
  {
    name: 'Sun', type: 'Star · G2V', parent: null, color: '#ffd68a',
    shape: [695700, 695700, 695700], massKg: 1.9885e30,
    rotationH: 609.12, rotationNote: 'at the equator; near the poles it takes ~35 days',
    representative: 'sunspots and faculae are not shown',
    desc: 'An ordinary middle-aged star, 4.6 billion years old, holding 99.86% of the Solar System’s mass. Its light takes 8 min 20 s to reach Earth.',
  },
  {
    name: 'Mercury', type: 'Terrestrial planet', parent: 'Sun', color: '#9a8f86', photometry: 'lunar',
    shape: [2440.53, 2440.53, 2438.26], massKg: 3.3011e23,
    periodD: 87.969, rotationH: 1407.6, solarDayH: 4222.6, obliquity: 0.034,
    tex: { map: 'mercury.jpg' },
    desc: 'The smallest planet, and the closest to the Sun. It spins exactly three times for every two orbits, so one solar day there lasts two Mercury years.',
  },
  {
    name: 'Venus', type: 'Terrestrial planet', parent: 'Sun', color: '#d9b98a',
    shape: [6051.8, 6051.8, 6051.8], massKg: 4.8675e24,
    periodD: 224.701, rotationH: -5832.6, solarDayH: -2802.0, obliquity: 177.36,
    tex: { map: 'venus.jpg' }, representative: 'the cloud pattern is a snapshot, but it circles the planet every 4.2 days, as the real cloud tops do',
    // the cloud tops super-rotate: ~100 m/s at the equator, 60× faster than the surface turns
    cloudTopPeriodD: 4.2,
    desc: 'What you see is its permanent cloud deck of sulfuric acid. Beneath it the surface bakes at 464 °C under 92 bar of carbon dioxide. It spins backwards, more slowly than it orbits.',
  },
  {
    name: 'Earth', type: 'Terrestrial planet', parent: 'Sun', color: '#5f8fd0',
    shape: [6378.137, 6378.137, 6356.752], massKg: 5.9722e24,
    periodD: 365.256, rotationH: 23.9345, solarDayH: 24.0, obliquity: 23.44,
    tex: { map: 'earth.jpg', hires: 'earth_4k.jpg', night: 'earth_night.jpg', clouds: 'earth_clouds.jpg', rough: 'earth_rough.jpg' },
    representative: 'the clouds are a snapshot, not the weather on this date',
    atmosphere: { color: [0.32, 0.55, 1.0], heightKm: 80, refractsUmbra: true },
    desc: 'The only world known to host life. Its seasons come from its 23.4° tilt, not from its distance to the Sun: the northern summer falls near aphelion, when Earth is farthest from the Sun.',
  },
  {
    name: 'Moon', type: 'Moon of Earth', parent: 'Earth', color: '#bfbcb6', photometry: 'lunar',
    shape: [1737.4, 1737.4, 1737.4], massKg: 7.346e22,
    periodD: 27.3217, aKm: 384400, synodicD: 29.5306, obliquity: 6.68, synchronous: true,
    tex: { map: 'moon.jpg' },
    desc: 'Tidally locked, it always shows Earth the same face. It probably formed from debris thrown out when a Mars-sized body hit the young Earth, and it drifts 3.8 cm farther away every year.',
  },
  {
    name: 'Mars', type: 'Terrestrial planet', parent: 'Sun', color: '#c1502a',
    shape: [3396.19, 3396.19, 3376.20], massKg: 6.4171e23,
    periodD: 686.980, rotationH: 24.6229, solarDayH: 24.6597, obliquity: 25.19,
    tex: { map: 'mars.jpg' },
    desc: 'A cold desert with the tallest volcano in the Solar System, Olympus Mons (about 22 km high), and Valles Marineris, a canyon system as long as the United States is wide.',
  },
  {
    name: 'Phobos', type: 'Moon of Mars', parent: 'Mars', color: '#a39486', photometry: 'lunar',
    shape: [13.0, 11.4, 9.1], massKg: 1.0659e16, periodD: 0.31891, aKm: 9376, synchronous: true,
    tex: { map: 'phobos.jpg' },
    desc: 'Orbits faster than Mars spins, so from the surface it rises in the west. Tides drag it inward by about 1.8 m per century; in 30–50 million years it should break apart into a ring.',
  },
  {
    name: 'Deimos', type: 'Moon of Mars', parent: 'Mars', color: '#a39486', photometry: 'lunar',
    shape: [7.8, 6.0, 5.1], massKg: 1.4762e15, periodD: 1.26244, aKm: 23463, synchronous: true,
    tex: { tint: '#8f857c' },
    desc: 'A 12 km lump of dark rock. Whether Mars’s two moons are captured asteroids or debris from a giant impact is still debated; JAXA’s MMX mission is going there to find out.',
  },
  {
    name: 'Jupiter', type: 'Gas giant', parent: 'Sun', color: '#d6b48a',
    shape: [71492, 71492, 66854], massKg: 1.89819e27,
    periodD: 4332.589, rotationH: 9.9250, solarDayH: 9.9259, obliquity: 3.13,
    tex: { map: 'jupiter.jpg' }, representative: 'cloud bands drift, so the pattern shown is a snapshot',
    desc: 'More than twice as massive as all the other planets combined. The Great Red Spot, a storm wider than Earth, has been watched continuously since 1831.',
  },
  {
    name: 'Io', type: 'Moon of Jupiter', parent: 'Jupiter', color: '#d8c86a', photometry: 'lunar',
    shape: [1821.6, 1821.6, 1821.6], massKg: 8.9319e22, periodD: 1.769138, aKm: 421800, synchronous: true,
    tex: { map: 'io.jpg' },
    desc: 'The most volcanically active world known. Its 1:2:4 orbital resonance with Europa and Ganymede keeps its orbit slightly eccentric, and the flexing tides heat its interior.',
  },
  {
    name: 'Europa', type: 'Moon of Jupiter', parent: 'Jupiter', color: '#cfc4b0',
    shape: [1560.8, 1560.8, 1560.8], massKg: 4.7998e22, periodD: 3.551181, aKm: 671100, synchronous: true,
    tex: { map: 'europa.jpg', tint: '#f4ece0' },
    desc: 'An ice shell over a salty ocean holding roughly twice the water of all Earth’s oceans. It is one of the most promising places to search for life beyond Earth.',
  },
  {
    name: 'Ganymede', type: 'Moon of Jupiter', parent: 'Jupiter', color: '#a89a86', photometry: 'lunar',
    shape: [2634.1, 2634.1, 2634.1], massKg: 1.4819e23, periodD: 7.154553, aKm: 1070400, synchronous: true,
    tex: { map: 'ganymede.jpg' },
    desc: 'The largest moon in the Solar System, wider than the planet Mercury, and the only moon known to generate its own magnetic field.',
  },
  {
    name: 'Callisto', type: 'Moon of Jupiter', parent: 'Jupiter', color: '#8b7f70', photometry: 'lunar',
    shape: [2410.3, 2410.3, 2410.3], massKg: 1.0759e23, periodD: 16.689017, aKm: 1882700, synchronous: true,
    tex: { map: 'callisto.jpg', tint: '#e2d6c6' },
    desc: 'One of the most heavily cratered surfaces known. It has barely changed in about four billion years, a record of the early Solar System’s bombardment.',
  },
  {
    name: 'Saturn', type: 'Gas giant', parent: 'Sun', color: '#e0c9a0',
    shape: [60268, 60268, 54364], massKg: 5.6834e26,
    periodD: 10759.22, rotationH: 10.561, solarDayH: 10.562, obliquity: 26.73,
    rotationNote: 'deep interior, measured by ring seismology in 2019',
    tex: { map: 'saturn.jpg' },
    rings: {
      tex: 'saturn_rings.png', innerKm: 70426, outerKm: 141127,
      // The map's opacity is artistic; it is rescaled region by region to these mean normal optical
      // depths (Colwell et al. 2009, "The Structure of Saturn's Rings", in Saturn from
      // Cassini–Huygens), keeping its fine structure: [from km, to km, mean τ]
      opticalDepth: [[74490, 91980, 0.1], [91980, 99000, 1.5], [99000, 117580, 3.0], [117580, 122170, 0.12], [122170, 136780, 0.6]],
    },
    desc: 'Its mean density is lower than water’s. The main rings, almost pure water ice, span 280,000 km but are mostly only tens of metres thick.',
  },
  {
    name: 'Titan', type: 'Moon of Saturn', parent: 'Saturn', color: '#d2a35c',
    shape: [2574.7, 2574.7, 2574.7], massKg: 1.3452e23, periodD: 15.945421, aKm: 1221870, synchronous: true,
    tex: { tint: '#d9a85e' },
    desc: 'The only moon with a thick atmosphere, 1.5 bar of nitrogen. In visible light its orange haze hides everything, including rivers, lakes and seas of liquid methane. NASA’s Dragonfly rotorcraft is due to arrive in 2034.',
  },
  {
    name: 'Uranus', type: 'Ice giant', parent: 'Sun', color: '#9fd4dd',
    shape: [25559, 25559, 24973], massKg: 8.6810e25,
    periodD: 30688.5, rotationH: -17.24, solarDayH: -17.24, obliquity: 97.77,
    tex: { map: 'uranus.jpg' },
    rings: { procedural: 'uranus' },
    desc: 'It rolls around the Sun on its side, tilted 98°. Each pole gets about 42 years of continuous daylight and then 42 years of night. A giant impact is the usual explanation, but that is not settled.',
  },
  {
    name: 'Neptune', type: 'Ice giant', parent: 'Sun', color: '#4a6fd0',
    shape: [24764, 24764, 24341], massKg: 1.02413e26,
    periodD: 60182, rotationH: 16.11, solarDayH: 16.11, obliquity: 28.32,
    tex: { map: 'neptune.jpg' },
    desc: 'Its winds are the fastest measured on any planet, over 2,000 km/h. In 1846 it was found by mathematics: its position was predicted from its tiny pull on Uranus before anyone had seen it.',
  },
  {
    name: 'Pluto', type: 'Dwarf planet', parent: 'Sun', color: '#b8a795',
    shape: [1188.3, 1188.3, 1188.3], massKg: 1.303e22,
    periodD: 90560, rotationH: -153.29, solarDayH: -153.28, obliquity: 122.53,
    tex: { map: 'pluto.jpg' }, representative: 'south of ~30°S was in polar night during the 2015 flyby and is unmapped',
    desc: 'A Kuiper Belt dwarf planet with nitrogen-ice glaciers and a heart-shaped plain, revealed by New Horizons in 2015. It orbits the Sun twice for every three orbits of Neptune, which keeps the two from ever colliding.',
  },
];

export const BY_NAME = Object.fromEntries(BODIES.map(b => [b.name, b]));

// Which bodies can cast a shadow on which. The Sun is always the light source.
export const OCCLUDERS = {
  Earth: ['Moon'],
  Moon: ['Earth'],
  Mars: ['Phobos', 'Deimos'],
  Phobos: ['Mars'],
  Deimos: ['Mars'],
  Jupiter: ['Io', 'Europa', 'Ganymede', 'Callisto'],
  Io: ['Jupiter'], Europa: ['Jupiter'], Ganymede: ['Jupiter'], Callisto: ['Jupiter'],
  Saturn: ['Titan'],
  Titan: ['Saturn'],
};

// Uranus's narrow rings (French et al. 1991): radius km, width km, normal optical depth.
// They are very dark (albedo ~0.02), so they are barely visible in reflected sunlight, as in reality.
export const URANUS_RINGS = [
  [41837, 1.6, 0.3], [42234, 1.9, 0.5], [42571, 2.4, 0.3], [44718, 7.2, 0.4], [45661, 8.0, 0.2],
  [47176, 1.6, 0.2], [47627, 2.5, 1.5], [48300, 5.0, 0.5], [50024, 2.0, 0.1], [51149, 58, 1.2],
];

export function meanRadius(b) { return (b.shape[0] + b.shape[1] + b.shape[2]) / 3; }
