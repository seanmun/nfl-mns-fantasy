import type { NflTeam } from './schema.js'

// The 32 NFL teams. Seeded once by scripts/seed-teams.ts; nothing syncs
// them. Pulled from ESPN's teams endpoint on 2026-08-13 and paired with
// the division map by hand, since that endpoint does not carry groups.
//
// `id` is ESPN's abbreviation deliberately, so schedule matching is a
// direct lookup and schedule_feed_abbr stays null for every row. It only
// earns its keep if the schedule feed is ever swapped for one that
// abbreviates differently. Note ESPN writes Washington as WSH, not WAS.
//
// oddsApiName is ESPN's displayName, which is the same string The Odds
// API uses. That equality is an ASSUMPTION until the first lines pull
// confirms it — sync-lines must fail loudly on an unmatched team rather
// than skip the game, because a game with no line cannot be graded ATS.
export const NFL_TEAMS: Array<
  Pick<
    NflTeam,
    'id' | 'name' | 'location' | 'nickname' | 'conference' | 'division' | 'oddsApiName' | 'primaryColor' | 'logoUrl'
  >
> = [
  { id: 'BUF',  name: 'Buffalo Bills',             location: 'Buffalo',           nickname: 'Bills',         conference: 'AFC',  division: 'East',    oddsApiName: 'Buffalo Bills',             primaryColor: '#00338d', logoUrl: 'https://a.espncdn.com/i/teamlogos/nfl/500/buf.png', },
  { id: 'MIA',  name: 'Miami Dolphins',            location: 'Miami',             nickname: 'Dolphins',      conference: 'AFC',  division: 'East',    oddsApiName: 'Miami Dolphins',            primaryColor: '#008e97', logoUrl: 'https://a.espncdn.com/i/teamlogos/nfl/500/mia.png', },
  { id: 'NE',   name: 'New England Patriots',      location: 'New England',       nickname: 'Patriots',      conference: 'AFC',  division: 'East',    oddsApiName: 'New England Patriots',      primaryColor: '#002a5c', logoUrl: 'https://a.espncdn.com/i/teamlogos/nfl/500/ne.png', },
  { id: 'NYJ',  name: 'New York Jets',             location: 'New York',          nickname: 'Jets',          conference: 'AFC',  division: 'East',    oddsApiName: 'New York Jets',             primaryColor: '#115740', logoUrl: 'https://a.espncdn.com/i/teamlogos/nfl/500/nyj.png', },
  { id: 'BAL',  name: 'Baltimore Ravens',          location: 'Baltimore',         nickname: 'Ravens',        conference: 'AFC',  division: 'North',   oddsApiName: 'Baltimore Ravens',          primaryColor: '#29126f', logoUrl: 'https://a.espncdn.com/i/teamlogos/nfl/500/bal.png', },
  { id: 'CIN',  name: 'Cincinnati Bengals',        location: 'Cincinnati',        nickname: 'Bengals',       conference: 'AFC',  division: 'North',   oddsApiName: 'Cincinnati Bengals',        primaryColor: '#fb4f14', logoUrl: 'https://a.espncdn.com/i/teamlogos/nfl/500/cin.png', },
  { id: 'CLE',  name: 'Cleveland Browns',          location: 'Cleveland',         nickname: 'Browns',        conference: 'AFC',  division: 'North',   oddsApiName: 'Cleveland Browns',          primaryColor: '#472a08', logoUrl: 'https://a.espncdn.com/i/teamlogos/nfl/500/cle.png', },
  { id: 'PIT',  name: 'Pittsburgh Steelers',       location: 'Pittsburgh',        nickname: 'Steelers',      conference: 'AFC',  division: 'North',   oddsApiName: 'Pittsburgh Steelers',       primaryColor: '#000000', logoUrl: 'https://a.espncdn.com/i/teamlogos/nfl/500/pit.png', },
  { id: 'HOU',  name: 'Houston Texans',            location: 'Houston',           nickname: 'Texans',        conference: 'AFC',  division: 'South',   oddsApiName: 'Houston Texans',            primaryColor: '#021018', logoUrl: 'https://a.espncdn.com/i/teamlogos/nfl/500/hou.png', },
  { id: 'IND',  name: 'Indianapolis Colts',        location: 'Indianapolis',      nickname: 'Colts',         conference: 'AFC',  division: 'South',   oddsApiName: 'Indianapolis Colts',        primaryColor: '#003b75', logoUrl: 'https://a.espncdn.com/i/teamlogos/nfl/500/ind.png', },
  { id: 'JAX',  name: 'Jacksonville Jaguars',      location: 'Jacksonville',      nickname: 'Jaguars',       conference: 'AFC',  division: 'South',   oddsApiName: 'Jacksonville Jaguars',      primaryColor: '#007487', logoUrl: 'https://a.espncdn.com/i/teamlogos/nfl/500/jax.png', },
  { id: 'TEN',  name: 'Tennessee Titans',          location: 'Tennessee',         nickname: 'Titans',        conference: 'AFC',  division: 'South',   oddsApiName: 'Tennessee Titans',          primaryColor: '#4495d2', logoUrl: 'https://a.espncdn.com/i/teamlogos/nfl/500/ten.png', },
  { id: 'DEN',  name: 'Denver Broncos',            location: 'Denver',            nickname: 'Broncos',       conference: 'AFC',  division: 'West',    oddsApiName: 'Denver Broncos',            primaryColor: '#0a2343', logoUrl: 'https://a.espncdn.com/i/teamlogos/nfl/500/den.png', },
  { id: 'KC',   name: 'Kansas City Chiefs',        location: 'Kansas City',       nickname: 'Chiefs',        conference: 'AFC',  division: 'West',    oddsApiName: 'Kansas City Chiefs',        primaryColor: '#e31837', logoUrl: 'https://a.espncdn.com/i/teamlogos/nfl/500/kc.png', },
  { id: 'LAC',  name: 'Los Angeles Chargers',      location: 'Los Angeles',       nickname: 'Chargers',      conference: 'AFC',  division: 'West',    oddsApiName: 'Los Angeles Chargers',      primaryColor: '#0080c6', logoUrl: 'https://a.espncdn.com/i/teamlogos/nfl/500/lac.png', },
  { id: 'LV',   name: 'Las Vegas Raiders',         location: 'Las Vegas',         nickname: 'Raiders',       conference: 'AFC',  division: 'West',    oddsApiName: 'Las Vegas Raiders',         primaryColor: '#000000', logoUrl: 'https://a.espncdn.com/i/teamlogos/nfl/500/lv.png', },
  { id: 'DAL',  name: 'Dallas Cowboys',            location: 'Dallas',            nickname: 'Cowboys',       conference: 'NFC',  division: 'East',    oddsApiName: 'Dallas Cowboys',            primaryColor: '#002a5c', logoUrl: 'https://a.espncdn.com/i/teamlogos/nfl/500/dal.png', },
  { id: 'NYG',  name: 'New York Giants',           location: 'New York',          nickname: 'Giants',        conference: 'NFC',  division: 'East',    oddsApiName: 'New York Giants',           primaryColor: '#003c7f', logoUrl: 'https://a.espncdn.com/i/teamlogos/nfl/500/nyg.png', },
  { id: 'PHI',  name: 'Philadelphia Eagles',       location: 'Philadelphia',      nickname: 'Eagles',        conference: 'NFC',  division: 'East',    oddsApiName: 'Philadelphia Eagles',       primaryColor: '#06424d', logoUrl: 'https://a.espncdn.com/i/teamlogos/nfl/500/phi.png', },
  { id: 'WSH',  name: 'Washington Commanders',     location: 'Washington',        nickname: 'Commanders',    conference: 'NFC',  division: 'East',    oddsApiName: 'Washington Commanders',     primaryColor: '#5a1414', logoUrl: 'https://a.espncdn.com/i/teamlogos/nfl/500/wsh.png', },
  { id: 'CHI',  name: 'Chicago Bears',             location: 'Chicago',           nickname: 'Bears',         conference: 'NFC',  division: 'North',   oddsApiName: 'Chicago Bears',             primaryColor: '#0b1c3a', logoUrl: 'https://a.espncdn.com/i/teamlogos/nfl/500/chi.png', },
  { id: 'DET',  name: 'Detroit Lions',             location: 'Detroit',           nickname: 'Lions',         conference: 'NFC',  division: 'North',   oddsApiName: 'Detroit Lions',             primaryColor: '#0076b6', logoUrl: 'https://a.espncdn.com/i/teamlogos/nfl/500/det.png', },
  { id: 'GB',   name: 'Green Bay Packers',         location: 'Green Bay',         nickname: 'Packers',       conference: 'NFC',  division: 'North',   oddsApiName: 'Green Bay Packers',         primaryColor: '#204e32', logoUrl: 'https://a.espncdn.com/i/teamlogos/nfl/500/gb.png', },
  { id: 'MIN',  name: 'Minnesota Vikings',         location: 'Minnesota',         nickname: 'Vikings',       conference: 'NFC',  division: 'North',   oddsApiName: 'Minnesota Vikings',         primaryColor: '#4f2683', logoUrl: 'https://a.espncdn.com/i/teamlogos/nfl/500/min.png', },
  { id: 'ATL',  name: 'Atlanta Falcons',           location: 'Atlanta',           nickname: 'Falcons',       conference: 'NFC',  division: 'South',   oddsApiName: 'Atlanta Falcons',           primaryColor: '#a71930', logoUrl: 'https://a.espncdn.com/i/teamlogos/nfl/500/atl.png', },
  { id: 'CAR',  name: 'Carolina Panthers',         location: 'Carolina',          nickname: 'Panthers',      conference: 'NFC',  division: 'South',   oddsApiName: 'Carolina Panthers',         primaryColor: '#0085ca', logoUrl: 'https://a.espncdn.com/i/teamlogos/nfl/500/car.png', },
  { id: 'NO',   name: 'New Orleans Saints',        location: 'New Orleans',       nickname: 'Saints',        conference: 'NFC',  division: 'South',   oddsApiName: 'New Orleans Saints',        primaryColor: '#d3bc8d', logoUrl: 'https://a.espncdn.com/i/teamlogos/nfl/500/no.png', },
  { id: 'TB',   name: 'Tampa Bay Buccaneers',      location: 'Tampa Bay',         nickname: 'Buccaneers',    conference: 'NFC',  division: 'South',   oddsApiName: 'Tampa Bay Buccaneers',      primaryColor: '#bd1c36', logoUrl: 'https://a.espncdn.com/i/teamlogos/nfl/500/tb.png', },
  { id: 'ARI',  name: 'Arizona Cardinals',         location: 'Arizona',           nickname: 'Cardinals',     conference: 'NFC',  division: 'West',    oddsApiName: 'Arizona Cardinals',         primaryColor: '#a40227', logoUrl: 'https://a.espncdn.com/i/teamlogos/nfl/500/ari.png', },
  { id: 'LAR',  name: 'Los Angeles Rams',          location: 'Los Angeles',       nickname: 'Rams',          conference: 'NFC',  division: 'West',    oddsApiName: 'Los Angeles Rams',          primaryColor: '#003594', logoUrl: 'https://a.espncdn.com/i/teamlogos/nfl/500/lar.png', },
  { id: 'SEA',  name: 'Seattle Seahawks',          location: 'Seattle',           nickname: 'Seahawks',      conference: 'NFC',  division: 'West',    oddsApiName: 'Seattle Seahawks',          primaryColor: '#002a5c', logoUrl: 'https://a.espncdn.com/i/teamlogos/nfl/500/sea.png', },
  { id: 'SF',   name: 'San Francisco 49ers',       location: 'San Francisco',     nickname: '49ers',         conference: 'NFC',  division: 'West',    oddsApiName: 'San Francisco 49ers',       primaryColor: '#aa0000', logoUrl: 'https://a.espncdn.com/i/teamlogos/nfl/500/sf.png', },
]
