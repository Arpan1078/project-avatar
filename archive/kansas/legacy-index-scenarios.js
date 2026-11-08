/* ARCHIVED, NOT LOADED. Legacy Kansas "Cottonwood Creek" demo code removed from index.html in Phase 5.
   Kept for reference only; it depends on story.js, mapdata.js, satellite.js and archive/kansas/data/. */

// ===== index.html: Kansas scenario table, menu, helper consts (SCENARIOS, COTTONWOOD_*, REGISTERED_BURN...) =====
// The scenario menu in the top bar (key in SCENARIOS, label shown).
const SCENARIO_MENU = window.RegionalMap && RegionalMap.active ? [['dixie', 'Dixie Fire historical replay']] : [
  ['real',   'Real fire'],
  ['outage', 'Power outage, no fire'],
  ['burn',   'Planned burn']
];

// ---- Shared by the two Cottonwood Creek fire replays ----
const COTTONWOOD_CONDITIONS = [
  { from: 0, badge: 'Red flag warning', badgeClass: 'flag', note: 'Fires spread fast today',
    weather: [['Wind', 'S 35, gusts 55'], ['Humidity', '11%'], ['Temp', '78°F'], ['Rain', 'none in 5 weeks']] }
];
// South wind; counts and geometry follow the northward forecast.
const COTTONWOOD_WIND = [{ from: 0, dir: 'S', towardDeg: 0, mph: 35, text: '35 mph, gusts 55' }];
const WEEKEND_BURNS = [
  { title: 'Section 14 pasture', sub: 'Saturday, called in to dispatch, out by 6 pm' },
  { title: 'Section 31 pasture', sub: 'Sunday, called in to dispatch, out by 5 pm' }
];
// Card over the homes in the likely path (title gets the live count, see compute()).
const COTTONWOOD_HOMES_CARD = { title: n => `${n} ${n === 1 ? 'home' : 'homes'} in the fire path`, sub: 'Rancher has a disc' };
const HEAD_CARD = { tone: 'wildfire', title: 'Head of the fire', sub: 'lineDistance' };

// ---- "Planned burn" registration (used by the planned-burn rules) ----
const REGISTERED_BURN = {
  place: 'Section 22',
  startText: '10:00 am', endText: '2:00 pm',
  endMin: 14 * 60,              // 2:00 pm, minutes after midnight
  escapeMin: 12 * 60 + 47       // when the burn escaped: 12:47 pm (assumed)
};

const SCENARIOS = {

  /* ------------------------------------------------------------------
     1. REAL FIRE: the Cottonwood Creek fire with all data sources (unchanged)
     ------------------------------------------------------------------ */
  real: {
    ampm: 'pm',
    conditions: COTTONWOOD_CONDITIONS,
    wind: COTTONWOOD_WIND,
    compareCols: ['Firewatch', 'Real day'],
    steps: [
      { time: '1:50', acres: 0,   caption: 'A gust drops the power line into dry grass. The co-op’s meters show the line lost power.', real: 'nobody knew.' },
      { time: '1:51', acres: 5,   caption: 'Red flag day and no burn permit nearby, so Firewatch flags a possible fire.', real: 'nobody knew.' },
      { time: '1:52', acres: 15,  caption: 'A weather satellite sees heat over the line. Confidence passes 70%.', real: 'nobody knew. Nobody was within four miles.' },
      { time: '1:53', acres: 22,  caption: 'Alerts go out by text to the chief, dispatch, the rancher downwind, the water truck and {homes}.', real: 'nobody knew. The first 911 call was 28 minutes away.' },
      { time: '1:56', acres: 45,  caption: 'Dispatch pages the volunteers. Three of the five who are free reply.', real: 'nobody knew.' },
      { time: '1:59', acres: 80,  caption: 'A neighbor sends a photo. The rancher starts cutting a firebreak ahead of the fire.', real: 'nobody knew.' },
      { time: '2:04', acres: 160, caption: 'Brush 1 leaves the station. Nearby departments and the state get a heads-up.', real: 'nobody knew. A driver saw smoke at 2:17, with no signal.' },
      { time: '2:22', acres: 600, caption: 'Brush 1 arrives. The firebreak is already ahead of the fire.', real: 'the 911 call had just come in. The truck left at 2:34.' }
    ],
    reasons: [
      { label: 'Power lost on the line', pts: 30, from: 0 },
      { label: 'Red flag day',           pts: 15, from: 1 },
      { label: 'No burn permit nearby',  pts: 10, from: 1 },
      { label: 'Satellite sees heat',    pts: 25, from: 2, sat: true },
      { label: 'Neighbor photo',         pts: 15, from: 5 }
    ],
    alerts: [
      { who: 'Fire chief',          s: [[3, 'Text sent 1:53'], [4, 'Heading in']] },
      { who: 'County 911 dispatch', s: [[3, 'Alert sent 1:53'], [4, 'Paged 1:56']] },
      { who: 'Rancher downwind',    s: [[3, 'Text sent 1:53'], [5, 'Cutting firebreak']] },
      { who: 'Lease water truck',   s: [[3, 'Text sent 1:53'], [5, 'Moving']] },
      { who: '{Homes} in the path', s: [[3, 'Warned 1:53']] },
      { who: 'Nearby departments',  s: [[6, 'Heads-up 2:04']] },
      { who: 'State fire desk',     s: [[6, 'Heads-up 2:04']] }
    ],
    // People: [step, status, counts as responding?]
    people: {
      intro: '5 of 18 volunteers can leave work this afternoon', pagedFrom: 4, notPaged: 'Not paged yet',
      rows: [
        { who: 'Volunteer 1', note: 'farm',        s: [[4, 'Responding', true], [6, 'On Brush 1', true]] },
        { who: 'Volunteer 2', note: 'in town',     s: [[4, 'Responding', true], [6, 'On Brush 1', true]] },
        { who: 'Volunteer 3', note: 'co-op yard',  s: [[4, 'Responding', true], [6, 'Bringing tanker', true]] },
        { who: 'Volunteer 4', note: 'out of town', s: [[4, 'Can’t make it', false]] },
        { who: 'Volunteer 5', note: 'at work',     s: [] }
      ]
    },
    burnsTab: k => ({ items: WEEKEND_BURNS.concat([{ title: 'Today', sub: 'None. No burning on a red flag day.' }]) }),
    data: k => [
      ['Power outages (co-op)', 'Live'],
      ['Satellite heat (GOES)', k >= 2 ? '1 min ago' : 'No heat yet'],
      ['Satellite (VIIRS)', 'Last pass 3 h ago'],
      ['Weather (NWS)', '5 min ago'],
      ['Community reports', k >= 5 ? '1 photo, 1:59' : 'None yet'],
      ['Air quality (AirNow)', 'Sensor too far'],
      ['Burn permits', 'Today’s list']
    ],
    facts: k => [['Likely cause', 'Power line down'], ['Heading', 'N, 2–3 mph'], ['Nearest water', '{Water}'],
      ['Brush 1', k >= 7 ? 'On scene' : k >= 6 ? 'Driving' : k >= 4 ? 'Crew gathering' : 'At station']],
    tiles: (k, v) => [
      timeTile(v),
      confTile(v),
      { label: 'Area burned', value: v.now.acres, unit: 'acres', color: 'var(--fire)', note: k >= 3 ? 'Simulated estimate' : 'From the scenario' },
      homesTile(v),
      { label: 'Volunteers responding', value: v.responding, unit: 'of 5', color: 'var(--text)', note: '18 on the roster' },
      { label: 'Ahead of 911', value: k >= 7 ? '30' : k >= 3 ? '28' : '0', unit: 'min', color: k >= 3 ? 'var(--fire)' : 'var(--text)',
        note: k >= 7 ? 'Truck arrived 30 min sooner' : k >= 3 ? 'Fire known before anyone called' : 'Counts once alerts go out' }
    ],
    // Footer comparison: Firewatch value shows from step `from`; `other` is the right-hand column.
    compare: [
      { label: 'Fire known',    ours: '1:53', from: 3, other: '2:21' },
      { label: 'Truck leaves',  ours: '2:04', from: 6, other: '2:34' },
      { label: 'Truck arrives', ours: '2:22', from: 7, other: '2:52' }
    ],
    popup: {
      at: 3, time: '1:53 pm',
      sms: ['<b>Likely wildfire, 80% confidence</b>', '{fromStation}.', 'Cause: power line down.',
        'Moving N. Wind S 35, gusts 55.', '{Homes} in the path. Nearest water: {water}.', 'Nearest help: {help}.'],
      sentTo: 'Sent to the chief, county dispatch, the rancher downwind, the lease operator and {homes}. Plain text, so it works on one bar of signal.'
    },
    fireType: k => 'wildfire',
    map: (k, v) => ({
      view: 'district',
      fires: { A: { place: 'line', acres: v.now.acres, type: 'wildfire', path: k >= 1, card: HEAD_CARD }, B: null },
      firebreak: k >= 5, reporter: k >= 5, route: k >= 6, lineFault: true, burnArea: false,
      homesCard: COTTONWOOD_HOMES_CARD
    })
  },

  /* ------------------------------------------------------------------
     1b. REAL FIRE with the co-op power data switched OFF.
     Same fire, same growth (acres follow the same curve as the replay
     above; 2:36 is extrapolated). Only detection changes.
     ------------------------------------------------------------------ */
  realNoPower: {
    ampm: 'pm',
    conditions: COTTONWOOD_CONDITIONS,
    wind: COTTONWOOD_WIND,
    compareCols: ['Firewatch', 'Real day'],
    extraLine: 'Slower without power data, but still ahead of the 911 call. Every source is a bonus, not a requirement.',
    steps: [
      { time: '1:50', acres: 0,    caption: 'The line falls into dry grass. Power data is off: the outage isn’t seen.', real: 'nobody knew.' },
      { time: '1:52', acres: 15,   caption: 'Red flag day is known, but there is nothing to tie it to yet. Firewatch sees nothing.', real: 'nobody knew. Nobody was within four miles.' },
      { time: '2:04', acres: 160,  caption: 'At 2:04 (assumed) the fire is big enough for the weather satellite. Possible fire: Firewatch auto-texts enrolled people near the heat.', real: 'nobody knew.' },
      { time: '2:07', acres: 200,  caption: 'At 2:07 (assumed) the rancher {rancher} replies YES with a photo. 75%: alerts go out.', real: 'nobody knew.' },
      { time: '2:10', acres: 250,  caption: 'Dispatch pages the district at 2:10 (assumed).', real: 'nobody knew.' },
      { time: '2:18', acres: 390,  caption: 'Brush 1 leaves the station at 2:18 (assumed, same 8 min to gather a crew).', real: 'nobody knew. A driver saw smoke at 2:17, with no signal.' },
      { time: '2:36', acres: 1500, caption: 'Brush 1 arrives at 2:36 (assumed, same 18 min drive), 16 minutes sooner than the real day.', real: 'the truck left at 2:34 and was still on the road.' }
    ],
    reasons: [
      { label: 'Power lost on the line', off: true },
      { label: 'Satellite sees heat',       pts: 25, from: 2, sat: true },
      { label: 'Red flag day',              pts: 15, from: 2 },
      { label: 'No burn permit nearby',     pts: 10, from: 2 },
      { label: 'Nearby person sees smoke',  pts: 25, from: 3 }
    ],
    status: [['Nothing detected', 'text'], ['Nothing detected', 'text']],   // later steps use the usual thresholds
    alerts: [
      { who: 'Rancher {rancherShort}',  s: [[2, 'Asked 2:04: see smoke?'], [3, 'Replied YES + photo']] },
      { who: 'Fire chief',            s: [[3, 'Text sent 2:07'], [4, 'Heading in']] },
      { who: 'County 911 dispatch',   s: [[3, 'Alert sent 2:07'], [4, 'Paged 2:10']] },
      { who: 'Lease water truck',     s: [[3, 'Text sent 2:07']] },
      { who: '{Homes} in the path',   s: [[3, 'Warned 2:07']] },
      { who: 'Nearby departments',    s: [[5, 'Heads-up 2:18']] },
      { who: 'State fire desk',       s: [[5, 'Heads-up 2:18']] }
    ],
    people: {
      intro: '5 of 18 volunteers can leave work this afternoon', pagedFrom: 4, notPaged: 'Not paged yet',
      rows: [
        { who: 'Volunteer 1', note: 'farm',        s: [[4, 'Responding', true], [5, 'On Brush 1', true]] },
        { who: 'Volunteer 2', note: 'in town',     s: [[4, 'Responding', true], [5, 'On Brush 1', true]] },
        { who: 'Volunteer 3', note: 'co-op yard',  s: [[4, 'Responding', true], [5, 'Bringing tanker', true]] },
        { who: 'Volunteer 4', note: 'out of town', s: [[4, 'Can’t make it', false]] },
        { who: 'Volunteer 5', note: 'at work',     s: [] }
      ]
    },
    burnsTab: k => ({ items: WEEKEND_BURNS.concat([{ title: 'Today', sub: 'None. No burning on a red flag day.' }]) }),
    data: k => [
      ['Power outages (co-op)', 'Off (not available)'],
      ['Satellite heat (GOES)', k >= 2 ? 'Heat seen 2:04' : 'No heat yet'],
      ['Satellite (VIIRS)', 'Last pass 3 h ago'],
      ['Weather (NWS)', '5 min ago'],
      ['Community reports', k >= 3 ? 'YES + photo, 2:07' : k >= 2 ? '1 asked, waiting' : 'None yet'],
      ['Air quality (AirNow)', 'Sensor too far'],
      ['Burn permits', 'Today’s list']
    ],
    facts: k => [['Likely cause', k >= 3 ? 'Near the power line' : 'Not known yet'], ['Heading', k >= 2 ? 'N, 2–3 mph' : '—'],
      ['Nearest water', '{Water}'], ['Brush 1', k >= 6 ? 'On scene' : k >= 5 ? 'Driving' : k >= 4 ? 'Crew gathering' : 'At station']],
    tiles: (k, v) => [
      timeTile(v),
      confTile(v),
      { label: 'Area burned', value: v.now.acres.toLocaleString('en-US'), unit: 'acres', color: 'var(--fire)', note: k >= 3 ? 'Simulated estimate' : 'From the scenario' },
      homesTile(v),
      { label: 'Volunteers responding', value: v.responding, unit: 'of 5', color: 'var(--text)', note: '18 on the roster' },
      { label: 'Ahead of 911', value: k >= 6 ? '16' : k >= 3 ? '14' : '0', unit: 'min', color: k >= 3 ? 'var(--fire)' : 'var(--text)',
        note: k >= 6 ? 'Truck arrived 16 min sooner' : k >= 3 ? 'Fire known before anyone called' : 'Counts once alerts go out' }
    ],
    compare: [
      { label: 'Fire known',    ours: '2:07', from: 3, other: '2:21' },
      { label: 'Truck leaves',  ours: '2:18', from: 5, other: '2:34' },
      { label: 'Truck arrives', ours: '2:36', from: 6, other: '2:52' }
    ],
    popup: {
      at: 3, time: '2:07 pm',
      sms: ['<b>Likely wildfire, 75% confidence</b>', '{fromStation}.', 'Seen by satellite, confirmed by a rancher nearby.',
        'Moving N. Wind S 35, gusts 55.', '{Homes} in the path. Nearest water: {water}.', 'Nearest help: {help}.'],
      sentTo: 'Sent to the chief, county dispatch, the rancher, the lease operator and {homes}. Plain text, so it works on one bar of signal.'
    },
    fireType: k => 'wildfire',
    map: (k, v) => ({
      view: 'district',
      fires: { A: { place: 'line', acres: v.now.acres, type: 'wildfire', path: k >= 2, card: HEAD_CARD }, B: null },
      firebreak: false, reporter: false, route: k >= 5, lineFault: true, burnArea: false,
      homesCard: COTTONWOOD_HOMES_CARD
    })
  },

  /* ------------------------------------------------------------------
     2. POWER OUTAGE, NO FIRE: a windy day trips the line; nobody is paged.
     ------------------------------------------------------------------ */
  outage: {
    ampm: 'am',
    conditions: [
      { from: 0, badge: 'Windy', badgeClass: 'badge-neutral', note: 'Windy Thursday in April',
        weather: [['Wind', 'S 30, gusts 45'], ['Humidity', '30%']] }
    ],
    wind: [{ from: 0, dir: 'S', towardDeg: 20, mph: 30, text: '30 mph, gusts 45' }],
    compareCols: ['Firewatch', 'Without Firewatch'],
    steps: [
      { time: '10:40', caption: 'A gust trips the same power line. The co-op’s meters show the line lost power.' },
      { time: '10:41', caption: 'Windy, but not a red flag day. Firewatch keeps watching the line.' },
      { time: '10:45', caption: 'The weather satellite sees no heat over the line at 10:45 (assumed).' },
      { time: '10:46', caption: 'Under 70%, so no alert. Firewatch texts 2 enrolled people near the line: “Power line down near you. Can you see smoke? Reply YES or NO.”' },
      { time: '10:49', caption: 'At 10:49 (assumed) the rancher replies NO: no smoke.' },
      { time: '10:52', caption: 'At 10:52 (assumed) the co-op reports power back on: the line reclosed, it was not down. Case closed.' }
    ],
    reasons: [
      { label: 'Power lost on the line',      pts: 30,  from: 0 },
      { label: 'Windy, not red flag',         pts: 5,   from: 1 },
      { label: 'No satellite heat',           pts: 0,   from: 2 },
      { label: 'Nearby person sees no smoke', pts: -20, from: 4 },
      { label: 'Power restored',              pts: -10, from: 5 }
    ],
    status: [['Watching the line', 'text'], ['Watching the line', 'text'], ['Watching the line', 'text'],
      ['Asking people nearby', 'text'], ['Watching the line', 'text'], ['No fire, case closed', 'calm']],
    alerts: [
      { who: 'Rancher near the line', s: [[3, 'Confirm request sent'], [4, 'Replied NO, no smoke']] },
      { who: 'Lease operator',        s: [[3, 'Confirm request sent']] },
      { who: 'Fire chief',            s: [[5, 'Not needed']], none: 'Not alerted' },
      { who: 'County 911 dispatch',   s: [[5, 'Not needed']], none: 'Not alerted' },
      { who: 'Volunteers',            s: [[5, 'Not paged']], none: 'Not paged' }
    ],
    alertNote: { from: 3, title: 'Confirm request (text, 10:46)', text: 'Power line down near you. Can you see smoke? Reply YES or NO.' },
    people: {
      intro: 'No one is paged unless an alert goes out', pagedFrom: Infinity, notPaged: 'Not paged',
      rows: ['farm', 'in town', 'co-op yard', 'out of town', 'at work'].map((note, i) => ({ who: 'Volunteer ' + (i + 1), note, s: [] }))
    },
    burnsTab: k => ({ items: WEEKEND_BURNS.concat([{ title: 'Today', sub: 'None registered.' }]) }),
    data: k => [
      ['Power outages (co-op)', k >= 5 ? 'Power back on 10:52' : 'Line out since 10:40'],
      ['Satellite heat (GOES)', k >= 2 ? 'No heat' : 'Checking'],
      ['Satellite (VIIRS)', 'Last pass 2 h ago'],
      ['Weather (NWS)', '5 min ago'],
      ['Community reports', k >= 4 ? '1 reply: no smoke' : k >= 3 ? '2 asked, waiting' : 'None yet'],
      ['Air quality (AirNow)', 'Sensor too far'],
      ['Burn permits', 'None today']
    ],
    facts: k => [['Likely cause', k >= 5 ? 'Line reclosed' : 'Line tripped in wind'], ['Heading', 'No fire'],
      ['Nearest water', '{Water}'], ['Brush 1', 'At station']],
    tiles: (k, v) => [
      timeTile(v),
      confTile(v),
      { label: 'Area burned', value: 0, unit: 'acres', color: 'var(--text)', note: 'No fire' },
      { label: 'Homes in path', value: 0, unit: '', color: 'var(--text)', note: 'No fire' },
      { label: 'Volunteers paged', value: 0, unit: 'of 5', color: 'var(--text)', note: 'No alert, no page' },
      { label: 'False alarms avoided', value: k >= 5 ? 1 : 0, unit: '', color: k >= 5 ? 'var(--calm)' : 'var(--text)',
        note: k >= 5 ? 'District not paged' : 'Counts when the case closes' }
    ],
    compare: [
      { label: 'Outage',                      ours: '10:40', from: 0, other: '10:40' },
      { label: 'District paged',              ours: 'No',    from: 5, other: 'Maybe, if someone calls in' },
      { label: 'Volunteers pulled from work', ours: '0',     from: 5, other: 'Up to 5' }
    ],
    outcome: { at: 5, title: 'No alert sent. 0 volunteers pulled from work.', sub: 'Case closed at 10:52: the line reclosed, no fire.' },
    map: k => ({
      view: 'district',
      fires: { A: null, B: null },
      firebreak: false, reporter: false, route: false, lineFault: true, burnArea: false,
      homesCard: null
    })
  },

  /* ------------------------------------------------------------------
     3. PLANNED BURN: a registered burn is watched, not paged; then it escapes.
     ------------------------------------------------------------------ */
  burn: {
    ampm: 'am/pm',
    layersOnEnter: { burns: true },          // show the registered burn area
    conditions: [
      { from: 0, badge: 'Burn day', badgeClass: 'badge-neutral', note: 'Breezy Wednesday in April',
        weather: [['Wind', 'SW 15'], ['Humidity', '28%']] },
      { from: 3, badge: 'Burn day', badgeClass: 'badge-neutral', note: 'Breezy Wednesday in April',
        weather: [['Wind', 'SW 25, gusts 40'], ['Humidity', '28%']] }
    ],
    wind: [
      // Southwest wind drives the simulated path northeast.
      { from: 0, dir: 'SW', towardDeg: 45, mph: 15, text: '15 mph' },
      { from: 3, dir: 'SW', towardDeg: 45, mph: 25, text: '25 mph, gusts 40' }
    ],
    compareCols: ['Firewatch', 'Without Firewatch'],
    // burnAcres = the planned burn inside Section 22; escapeAcres = new fire outside it.
    // heatOutside = satellite heat outside the registered area (drives the rules).
    steps: [
      { time: '9:00',  ampm: 'am', burnAcres: 0,  escapeAcres: 0, caption: 'The landowner registers a burn by text: Section 22, 10:00 am to 2:00 pm, crew of 3 on site.' },
      { time: '10:05', ampm: 'am', burnAcres: 2,  escapeAcres: 0, caption: 'At 10:05 (assumed) the satellite sees heat at Section 22. It matches the registered burn, so no alert.' },
      { time: '10:20', ampm: 'am', burnAcres: 8,  escapeAcres: 0, caption: 'At 10:20 (assumed) a neighbor texts a smoke photo. Firewatch matches it to the burn and replies automatically. No alert.' },
      { time: '12:30', ampm: 'pm', burnAcres: 40, escapeAcres: 0, caption: 'Wind picks up to SW 25, gusts 40. Firewatch keeps checking the burn’s edges against the registered area.' },
      { time: '12:48', ampm: 'pm', burnAcres: 48, escapeAcres: 3, heatOutside: true, caption: 'At 12:48 (assumed) the satellite sees new heat about half a mile northeast, outside the registered area.' },
      { time: '12:49', ampm: 'pm', burnAcres: 48, escapeAcres: 4, heatOutside: true, caption: 'Alert goes out to the chief, dispatch, the landowner running the burn and the downwind neighbors.' },
      { time: '12:51', ampm: 'pm', burnAcres: 48, escapeAcres: 8, heatOutside: true, caption: 'At 12:51 (assumed) the landowner replies: “Yes, it jumped the road.” Dispatch pages the district. A VIIRS pass at 12:50 (assumed) also sees the escape.' },
      { time: '12:58', ampm: 'pm', burnAcres: 48, escapeAcres: 8, heatOutside: true, caption: 'Simulated drone flight: launch from the nearest town at 12:52 PM, arrival near the escape at 12:58 PM. Six minutes replayed in 2.4 seconds; timing and capabilities assumed.' }
    ],
    reasons: [
      { label: 'Satellite sees heat',          pts: 25,  from: 1, sat: true },
      { label: 'Matches a registered burn',    from: 1, rule: k => burnMatchReason(k) },
      { label: 'Neighbor smoke report',        pts: 15,  from: 2,
        changes: [[4, { label: 'Neighbor report (was the burn)', pts: 0 }]] },   // that smoke was the planned burn
      { label: 'Wind increasing',              pts: 10,  from: 3 },
      { label: 'Heat outside registered area', pts: 45,  from: 4 },
      { label: 'Landowner confirms escape',    pts: 15,  from: 6 }
    ],
    // 'fire' = the current fire type's color: amber while planned, red-magenta once escaped.
    status: [['Burn registered', 'fire'], ['Planned burn, being watched', 'fire'], ['Planned burn, being watched', 'fire'],
      ['Planned burn, watching edges', 'fire'], ['Possible escaped burn', 'fire'], ['Possible escaped burn', 'fire'], ['Escaped burn, confirmed', 'fire'], ['Escaped burn, confirmed', 'fire']],
    confLabel: 'Wildfire confidence',
    alerts: [
      { who: 'County drone (simulated)', s: [[7, 'Launched 12:52 PM; arrived 12:58 PM (assumed)']] },
      { who: 'Landowner (running the burn)', s: [[0, 'Burn registered 9:00'], [5, 'Text sent 12:49'], [6, 'Replied: jumped the road']] },
      { who: 'Neighbor (smoke photo)',       s: [[2, 'Auto-reply sent 10:20']] },
      { who: 'Fire chief',                   s: [[5, 'Text sent 12:49']] },
      { who: 'County 911 dispatch',          s: [[5, 'Alert sent 12:49'], [6, 'Paged district 12:51']] },
      { who: 'Downwind neighbors ({escapeHomesN})', s: [[5, 'Warned 12:49']] }
    ],
    alertNote: { from: 2, title: 'Auto-reply to the neighbor (10:20)', text: 'This is a registered burn in Section 22, scheduled until 2:00 pm. Reply FIRE if you see it spreading.' },
    people: {
      intro: '5 of 18 volunteers can leave work today', pagedFrom: 6, notPaged: 'Not paged',
      rows: ['farm', 'in town', 'co-op yard', 'out of town', 'at work'].map((note, i) => ({ who: 'Volunteer ' + (i + 1), note, s: [[6, 'Paged 12:51', false]] }))
    },
    burnsTab: k => ({
      items: [
        { title: 'Section 22 pasture', sub: 'Today 10:00 am to 2:00 pm. Registered by text at 9:00, crew of 3 on site.',
          badge: k >= 4 ? 'Possible escape' : 'Active today', badgeTone: k >= 4 ? 'fire' : 'calm' }
      ].concat(WEEKEND_BURNS)
    }),
    data: k => [
      ['Power outages (co-op)', 'Live, none'],
      ['Satellite heat (GOES)', k >= 4 ? 'Heat outside burn, 12:48' : k >= 1 ? 'Heat at Section 22' : 'No heat yet'],
      ['Satellite (VIIRS)', 'Last pass 2 h ago'],
      ['Weather (NWS)', '5 min ago'],
      ['Community reports', k >= 6 ? 'Landowner: jumped the road' : k >= 2 ? '1 smoke photo, 10:20' : 'None yet'],
      ['Air quality (AirNow)', 'Sensor too far'],
      ['Burn permits', 'Section 22 active']
    ],
    facts: k => [['Likely cause', k >= 4 ? 'Escaped planned burn' : 'Registered burn'], ['Heading', 'NE, with the wind'],
      ['Burn crew', '3 on site'], ['Brush 1', k >= 6 ? 'Crew gathering' : 'At station']],
    tiles: (k, v) => [
      timeTile(v),
      confTile(v),
      { label: 'Area burned', value: v.now.burnAcres + v.now.escapeAcres, unit: 'acres', color: 'var(--fire)',
        note: k >= 4 ? 'Burn + escape, simulated' : 'Planned burn, simulated' },
      homesTile(v),
      { label: 'Volunteers responding', value: v.responding, unit: 'of 5', color: 'var(--text)', note: k >= 6 ? 'Paged 12:51' : 'Not paged' },
      k >= 4
        ? { label: 'Escape caught', value: escapeCaughtMinutes(), unit: 'min', color: 'var(--fire)', note: 'After the escape (12:47, assumed)' }
        : { label: 'Planned burns not paged', value: 1, unit: '', color: 'var(--calm)', note: 'Smoke there is expected' }
    ],
    compare: [
      { label: 'Smoke reports',                      ours: 'Answered automatically', from: 2, other: 'Each one paged or called back' },
      { label: 'District paged for the planned burn', ours: 'No',                    from: 1, other: 'Possibly' },
      { label: 'Escape noticed',                     ours: '12:48',                  from: 4, other: 'When someone calls' }
    ],
    popup: {
      at: 5, time: '12:49 pm',
      sms: ['<b>Planned burn may have escaped, 80% confidence</b>', 'New fire {escapeFrom} of Section 22 burn, outside the registered area.',
        'Wind SW 25, gusts 40.', 'Homes in the path: {escapeHomes}.', 'Nearest help: {help}.'],
      sentTo: 'Sent to the chief, county dispatch, the landowner running the burn and {escapeHomesN} downwind. Plain text, so it works on one bar of signal.'
    },
    rules: k => (k >= 1 ? burnRules(k) : null),
    // Planned while every burn rule holds; escaped as soon as one breaks.
    fireType: k => (burnRules(k).every(r => r.ok) ? 'planned' : 'escaped'),
    map: (k, v) => {
      const [inside, beforeEnd] = burnRules(k).map(r => r.ok);
      return {
        view: 'burn',
        fires: {
          // New fire outside the registered area.
          A: v.now.escapeAcres ? { place: 'escape', acres: v.now.escapeAcres, type: 'escaped', path: true,
            card: { tone: 'escaped', title: 'Escaped burn', sub: k >= 6 ? 'Confirmed by the landowner' : 'Outside the registered area' } } : null,
          // The burn inside Section 22: planned until its end time passes.
          B: v.now.burnAcres ? { place: 'burn', acres: v.now.burnAcres, type: beforeEnd ? 'planned' : 'escaped',
            card: beforeEnd ? { tone: 'planned', title: 'Planned burn', sub: `Section 22, until ${REGISTERED_BURN.endText}` }
              : { tone: 'escaped', title: 'Burn past its end time', sub: `Registered until ${REGISTERED_BURN.endText}` } } : null
        },
        firebreak: false, reporter: false, route: false, lineFault: false, burnArea: true,
        burnAreaTone: inside && beforeEnd ? 'planned' : 'escaped',
        homesCard: { title: n => `${n} ${n === 1 ? 'home' : 'homes'} downwind`, sub: '{escapeHomesRange} of the escape' }
      };
    }
  }
};



// ===== index.html: planned-burn rules =====
function burnRules(k) {
  const sc = SCENARIOS.burn, s = sc.steps[k];
  const inside = !s.heatOutside;
  const beforeEnd = toMinutes(s.time, stepAmPm(sc, s)) <= REGISTERED_BURN.endMin;
  return [
    { label: 'Inside registered area', ok: inside },
    { label: `Before ${REGISTERED_BURN.endText} end time`, ok: beforeEnd }
  ];
}
function burnMatchReason(k) {
  const [inside, beforeEnd] = burnRules(k).map(r => r.ok);
  if (inside && beforeEnd) return { label: 'Matches a registered burn', pts: -30 };
  if (!inside) return { label: 'No longer matches the burn', pts: 0 };
  return { label: 'Still burning after the end time', pts: 0 };
}
// Minutes from the (assumed) escape to the first heat seen outside the area.
function escapeCaughtMinutes() {
  const sc = SCENARIOS.burn;
  const first = sc.steps.find(s => s.heatOutside);
  return toMinutes(first.time, stepAmPm(sc, first)) - REGISTERED_BURN.escapeMin;
}

// Shared tiles.


// ===== index.html: Kansas help plan =====
const HELP_PLAN = {
  real:        { headsUpFrom: 6, busyNearest: true },   // "Nearby departments: heads-up 2:04"
  realNoPower: { headsUpFrom: 5, busyNearest: true },   // heads-up 2:18
  outage:      null,
  burn:        { headsUpFrom: 6 }                       // district paged 12:51
};
function helpState(sc, k, v) {
  const plan = HELP_PLAN[sc.key];
  const A = v.map.fires.A, B = v.map.fires.B;
  const at = STORY.PLACES[(A || B || { place: 'line' }).place];
  const rows = MapData.helpFrom(at);
  const status = {};
  if (plan && plan.busyNearest && rows[0]) status[rows[0].dept.id] = 'busy';
  const available = rows.filter(r => status[r.dept.id] !== 'busy');
  if (plan && k >= plan.headsUpFrom) available.slice(0, 3).forEach(r => { status[r.dept.id] = 'headsup'; });
  // Dashed lines only while there is a fire that may need help (wildfire or escape).
  const needed = !!A;
  return { at, from: needed ? at : null, rows, status, lineTo: needed ? available.slice(0, 3).map(r => r.dept.id) : [], nearest: available[0] || null };
}

/* ---------- Story text about real places ----------
   Captions and alerts use {tokens}; fill() puts in values from the real data. */


// ===== index.html: Kansas story tokens =====
function storyTokens(v) {
  const t = {};
  const P = STORY.PLACES, fire = P.line, dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const vec = (a, b) => [b[0] - a[0], b[1] - a[1]];
  const ok = MapData.loaded;
  // Nearest water to the fire (or to the burn / escape).
  const w = ok ? MapData.nearestWater(v.help.at) : null;
  t.Water = w ? w.text : '—';
  t.water = w ? `${(w.name || w.type).toLowerCase()} ${w.miles.toFixed(1)} mi ${w.dir}` : 'unknown';
  // Homes in the likely path now.
  t.homes = plural(v.pathHomes.length, 'home', 'homes');
  t.Homes = t.homes;
  // Nearest available help.
  const h = v.help.nearest;
  t.help = h ? `${h.dept.label}, ~${h.minutes} min` : 'none in range';
  // Where the fire is, from the district station.
  if (ok) {
    const road = MapData.nearestNamedRoad(fire), line = MapData.nearestPower(fire);
    t.fromStation = `${Math.round(dist(STORY.STATION, fire))} mi ${MapData.dir16(vec(STORY.STATION, fire))} of station, at the ` +
      `${line ? line.label.replace(/ \(.*\)$/, '') : 'power line'}${road ? ' by ' + road.name : ''}`;
    // The rancher: the nearest home in the fire's path.
    const rh = Map3D.pathHomes({ place: 'line', acres: 200, path: true }, SCENARIOS.real.wind[0].towardDeg)
      .map(i => MapData.buildings[i].p).sort((a, b) => dist(fire, a) - dist(fire, b))[0];
    t.rancher = rh ? `${dist(fire, rh).toFixed(1)} miles ${MapData.dir16(vec(fire, rh))}` : 'downwind';
    t.rancherShort = rh ? `${dist(fire, rh).toFixed(1)} mi ${MapData.dir16(vec(fire, rh))}` : 'downwind';
    // Planned burn: the escape and the homes in its path.
    const C = STORY.SECTION_22.center, E = P.escape;
    t.escapeFrom = `${dist(C, E).toFixed(1)} mi ${MapData.dir16(vec(C, E))}`;
    const burnWind = SCENARIOS.burn.wind[SCENARIOS.burn.wind.length - 1].towardDeg;
    const eh = Map3D.pathHomes({ place: 'escape', acres: 4, path: true }, burnWind).map(i => MapData.buildings[i].p);
    const ds = eh.map(p => dist(E, p)).sort((a, b) => a - b);
    const dir = eh.length ? MapData.dir16(vec(E, eh.reduce((s, p) => [s[0] + p[0] / eh.length, s[1] + p[1] / eh.length], [0, 0]))) : '';
    t.escapeHomesN = plural(eh.length, 'home', 'homes');
    t.escapeHomes = eh.length ? `${eh.length}, about ${ds[0].toFixed(1)} mi ${dir}` : 'none';
    t.escapeHomesRange = eh.length ? `${ds[0].toFixed(1)} to ${ds[ds.length - 1].toFixed(1)} mi ${dir}` : 'Downwind';
  }
  return t;
}


// ===== index.html: Kansas compute() =====
function compute() {
  if (state.scenario === 'dixie') return DixieScenario.compute(RegionalMap.data, state);
  const sc = scenario();
  const k = Math.min(state.step, sc.steps.length - 1);
  const now = sc.steps[k];
  const full = state.mode === 'full';
  const ampm = stepAmPm(sc, now);

  // Satellite detections for this moment (simulated now; same format as the real feeds).
  const iso = Satellite.toIso(sc.key, now.time, ampm);
  const goes = Satellite.getGoesDetections(sc.key, iso);
  const firms = Satellite.getFirmsHotspots(sc.key, iso);
  const goesScan = Satellite.getGoesScanTime(sc.key, iso);
  const firmsPass = Satellite.getFirmsPassInfo(sc.key, iso);
  const strongest = Satellite.strongest(goes);

  // Confidence: sum of the reasons that apply now (negative points allowed), kept in 0..100.
  let sum = 0;
  const reasons = sc.reasons.map(r => {
    if (r.off) return { label: r.label, pts: 'off', color: 'var(--dim)' };
    if (k < r.from) return { label: r.label, pts: '—', color: 'var(--dim)' };
    let label = r.label, pts = r.pts;
    for (const [ck, ch] of r.changes || []) if (k >= ck) { if (ch.label) label = ch.label; if ('pts' in ch) pts = ch.pts; }
    if (r.rule) ({ label, pts } = r.rule(k));
    if (r.sat && strongest) label = `Satellite sees heat (${firms.length ? 'GOES + VIIRS' : 'GOES'}, ${MASK_SHORT[strongest.fire_mask]})`;
    sum += pts;
    return {
      label,
      pts: pts > 0 ? '+' + pts : pts < 0 ? '-' + Math.abs(pts) : '+0',
      color: pts > 0 ? 'var(--text)' : pts < 0 ? 'var(--calm)' : 'var(--dim)'
    };
  });
  const conf = Math.max(0, Math.min(100, sum));

  // Fire type now (FIRE_TYPES): sets the color of the status heading, ring, badge.
  const fireType = sc.fireType ? sc.fireType(k) : null;
  const typeColor = fireType ? FIRE_TYPES[fireType].color : null;
  let statusLabel, statusColor;
  if (sc.status && sc.status[k]) {
    statusLabel = sc.status[k][0];
    statusColor = sc.status[k][1] === 'fire' && typeColor ? typeColor : TONE[sc.status[k][1]];
  } else {
    statusLabel = conf < 50 ? 'Watching the line' : conf < 70 ? 'Possible fire' : conf < 90 ? 'Likely wildfire' : 'Confirmed wildfire';
    statusColor = conf < 70 ? 'var(--text)' : typeColor || 'var(--fire)';
  }

  let responding = 0;
  const peopleRows = sc.people.rows.map(p => {
    let s = null, yes = false;
    for (const [from, text, ok] of p.s) if (k >= from) { s = text; yes = !!ok; }
    if (yes) responding++;
    return {
      who: p.who, note: p.note,
      status: s || (k >= sc.people.pagedFrom ? 'No reply' : sc.people.notPaged),
      color: yes ? 'var(--fire-soft)' : 'var(--dim)',
      dot: yes ? 'var(--fire)' : s ? 'var(--dim)' : '#4A4238'
    };
  });

  const alertRows = sc.alerts.map(a => {
    const s = pickStatus(a.s, k);
    const quiet = !s || /^Not /.test(s);
    return { who: a.who, status: s || a.none || 'Not sent yet', color: quiet ? 'var(--dim)' : 'var(--fire-soft)', dot: quiet ? '#4A4238' : 'var(--fire)' };
  });

  const v = { sc, k, now, ampm, full, conf, reasons, statusLabel, statusColor, peopleRows, alertRows, responding, fireType, typeColor };
  v.ringColor = confidenceColor(conf);
  v.wind = pickFrom(sc.wind, k);
  // Map state for this step. Homes "in the path" come from the map's likely-path
  // zone, so the tile, the card and the orange homes always agree.
  v.map = sc.map(k, v);
  v.drone = droneState(v);
  v.map.drone = v.drone;
  v.pathHomes = Map3D.pathHomes(v.map.fires.A, v.wind.towardDeg);
  // Help nearby (real fire departments) and the {tokens} used in story text.
  v.help = helpState(sc, k, v);
  v.map.help = { from: v.help.from, status: v.help.status, lineTo: v.help.lineTo };
  v.tokens = storyTokens(v);
  const hc = v.map.homesCard;
  v.map.homesCard = hc && v.pathHomes.length ? { title: hc.title(v.pathHomes.length), sub: fill(hc.sub, v) } : null;
  // Planned-burn flags: once a rule breaks, the banner stays to the end of the scenario.
  v.flags = [];
  if (sc.rules) {
    let outside = false, late = false;
    for (let i = 0; i <= k; i++) {
      const r = sc.rules(i);
      if (r) { outside = outside || !r[0].ok; late = late || !r[1].ok; }
    }
    if (outside) v.flags.push('Planned burn outside its registered area');
    if (late) v.flags.push(`Still burning after the ${REGISTERED_BURN.endText} end time`);
  }
  v.tiles = sc.tiles(k, v);
  v.facts = sc.facts(k);
  // Data tab: the satellite rows come live from satellite.js.
  const goesText = goesScan
    ? `last scan ${Satellite.formatTime(goesScan)}, ` + (strongest
      ? `${strongest.fire_mask_label}, ` + (goes.length === 1 ? `${Math.round(goes[0].frp_mw)} MW`
        : `${goes.length} pixels, ${Math.round(goes.reduce((t, d) => t + d.frp_mw, 0))} MW total`)
      : 'no fire seen')
    : 'no scan yet';
  const firmsText = firms.length
    ? `hotspot ${Satellite.firmsTime(firms[0])}, ${firms[0].confidence}, ${firms[0].frp.toFixed(1)} MW`
    : firmsPass.lastPass ? `no pass since ${Satellite.formatTime(firmsPass.lastPass)}` : 'no pass yet';
  const otherRows = sc.data(k).filter(([name]) => !/^Satellite/.test(name));
  v.dataRows = [otherRows[0], ['GOES-East', goesText], ['FIRMS VIIRS', firmsText]].concat(otherRows.slice(1),
    [['Homes in path', 'Real buildings: houses + unlabeled']]);
  v.firmsNote = firmsPass.note;
  v.goes = goes;
  v.firms = firms;
  v.compare = sc.compare.map(c => ({ label: c.label, ours: k >= c.from ? c.ours : '…', other: c.other, color: k >= c.from ? 'var(--fire)' : 'var(--dim)' }));
  v.rules = sc.rules ? sc.rules(k) : null;
  v.conditions = pickFrom(sc.conditions, k);
  return v;
}



// ===== index.html: Kansas droneState =====
function droneState(v) {
  if (window.RegionalMap && RegionalMap.active) return null; // No California deployment authorized in Phase 2.
  if (!['real', 'realNoPower', 'burn'].includes(v.sc.key)) return null;
  const burn = v.sc.key === 'burn', town = MapData.nearestTown(STORY.PLACES[burn ? 'escape' : 'line']);
  if (!town) return null;
  const arrived = burn && toMinutes(v.now.time, v.ampm) >= 778;
  return { id: v.sc.key, from: town.p, town: town.name, toPlace: burn ? 'escape' : 'line',
    progress: arrived ? 1 : 0, active: burn, path: arrived, onScene: arrived,
    label: !burn ? 'County drone: grounded, gusts 55 mph' : arrived ? 'County drone: arrived 12:58 PM (simulated)' : 'County drone: awaiting launch 12:52 PM (assumed)',
    info: !burn ? 'Grounded: gusts 55 mph. No flight.' : 'Simulated launch 12:52 PM; arrival 12:58 PM. Timing and capabilities assumed.' };
}


// ===== index.html: Kansas forecastDrivers =====
  const fire = v.map.fires.A || v.map.fires.B;
  const f = Map3D.forecast(fire || { place: v.sc.key === 'burn' ? 'burn' : 'line', acres: 0 }, v.wind.towardDeg);
  const slope = f && f.slopePct;
  const slopeText = Number.isFinite(slope) ? slope.toFixed(1) + '% over 1 mi downwind (terrain grid) - ' +
    (slope > 0.5 ? 'Uphill, potentially faster' : slope < -0.5 ? 'Downhill, potentially slower' : 'Little net slope effect') : 'Terrain unavailable / loading';
  const humidity = v.conditions.weather.find(row => row[0] === 'Humidity');
  const rows = [
    ['Wind', v.wind.dir + ' ' + v.wind.text + ' - Main factor'],
    ['Fuel', v.sc.key === 'burn' ? 'Grazed pasture - Lower fuel load (assumed)' : 'CRP and tall grass - Faster (assumed)'],
    ['Slope', slopeText],
    ['Humidity', (humidity ? humidity[1] : 'Unavailable') + (v.sc.key.startsWith('real') ? ', very dry - Faster' : ' - Less drying than 11%')],
    ['Barriers', !fire || !fire.path ? 'No projected escape path yet' : f && f.barrier ? f.barrier.name + ', ' + f.barrier.along.toFixed(2) + ' mi ahead - Potential slowing factor' : 'No suitable road crossing; path unchanged']
  ];
  return '<details class="drivers" open><summary>What drives this forecast</summary><dl>' + rows.map(([k,x]) => '<dt>' + k + '</dt><dd>' + escHtml(x) + '</dd>').join('') + '</dl><p>Simplified, uncertain forecast; roads may slow a fire but cannot guarantee a stop.</p><p>Today&#39;s demo uses wind and simple rules. Next step: the Rothermel fire spread model with LANDFIRE fuel maps and USDA crop maps.</p></details>';
}


// ===== index.html: Kansas droneFeed =====
  const d = v.drone;
  const status = !d ? (window.RegionalMap && RegionalMap.active ? 'Camera unavailable: no Dixie drone deployment is defined in Phase 2.' : 'No drone assigned to this scenario.') : !d.active ? d.label : !d.onScene ?
    (v.k >= 6 ? 'Waiting for drone, ETA 6 min' : 'Waiting for simulated launch at 12:52 PM') : 'On scene at 12:58 PM (assumed)';
  return '<div class="dronefeed"><p class="camera-status" role="status">' + escHtml(status) + '</p>' +
    (d && d.onScene ? '<div class="camera-image"><canvas id="thermalFeed" width="640" height="360" aria-label="Animated thermal simulation of the escaped fire"></canvas></div><p>Fire edge outside the registered area, 0.5 mi NE of Section 22</p>' : '<div class="camera-image unavailable">Camera unavailable</div>') +
    '<p class="muted">' + (d && d.active ? 'Flight 12:52-12:58 PM; timing, telemetry, footprint and capability assumed. Generated thermal imagery, not live. ' : 'No flight or camera footage available. ') + 'Real town location: ' + escHtml(d ? d.town : 'unavailable') + '.</p></div>';
}


// ===== index.html: Kansas thermal canvas =====
let thermalFrame = null;
function startThermal(v) {
  if (thermalFrame !== null) cancelAnimationFrame(thermalFrame);
  thermalFrame = null;
  const canvas = document.getElementById('thermalFeed');
  if (!canvas || state.view !== 'dashboard' || !v.drone || !v.drone.onScene) return;
  const g = canvas.getContext('2d');
  if (!g) return;
  const [lon, lat] = STORY.toLonLat(STORY.PLACES.escape);
  const began = performance.now();
  function draw(now) {
    if (!canvas.isConnected) { thermalFrame = null; return; }
    const t = (now - began) / 1000, loop = t % 12;
    g.fillStyle = '#090523'; g.fillRect(0, 0, 640, 360);
    // Moving contours and flickering hot spots, repeated every 12 seconds.
    for (let band = 6; band >= 0; band--) {
      g.fillStyle = ['#fff8be','#ffe35a','#ff982b','#ed392a','#9b1955','#4b1864','#231447'][band];
      g.beginPath(); g.moveTo(0,360);
      for (let x=0;x<=640;x+=8) {
        const y=230 + Math.sin(x/61+loop*Math.PI/6)*20 + Math.sin(x/19-loop*Math.PI/3)*7 - band*14;
        g.lineTo(x,y);
      }
      g.lineTo(640,360); g.closePath(); g.fill();
    }
    g.strokeStyle='#d4ffff'; g.lineWidth=1; g.beginPath();
    g.moveTo(300,180);g.lineTo(340,180);g.moveTo(320,160);g.lineTo(320,200);g.stroke();
    g.fillStyle='rgba(0,0,0,.7)';g.fillRect(0,0,640,55);g.fillRect(0,305,640,55);
    g.font='17px monospace';g.fillStyle='#fff';g.fillText('SIMULATED FEED',14,23);
    g.fillText('ALT 120 m AGL | SPD 0 mph | BAT 86%',14,46);
    g.fillStyle=Math.floor(t*2)%2 ? '#ff5353':'#fff';g.fillText('REC',550,23);
    g.fillStyle='#fff';g.fillText('GPS '+lat.toFixed(5)+', '+lon.toFixed(5),14,328);
    g.fillText('12:58:'+String(Math.floor(loop)).padStart(2,'0')+' PM | ASSUMED TELEMETRY | LOOP',14,350);
    thermalFrame=requestAnimationFrame(draw);
  }
  thermalFrame=requestAnimationFrame(draw);
}



// ===== index.html: Kansas co-op power switch =====
  const powerSwitch = state.scenario === 'real' ? `
      <button type="button" class="pswitch ${state.powerData ? 'on' : ''}" aria-pressed="${state.powerData}" data-act="power">
        <span class="pswitch-track"><span class="pswitch-knob"></span></span>Co-op power data: <b>${state.powerData ? 'On' : 'Off'}</b>
      </button>` : '';

// ===== index.html: Kansas scenario() =====
function scenario() {
  if (state.scenario === 'dixie') return DixieScenario.scenario(RegionalMap.data);
  return state.scenario === 'real' && !state.powerData ? SCENARIOS.realNoPower : SCENARIOS[state.scenario];
}


