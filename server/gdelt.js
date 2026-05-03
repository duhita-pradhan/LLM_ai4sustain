const fetch = require('node-fetch');

const THEME_KEYWORDS = {
  renewable:    'solar OR wind OR "renewable energy" OR geothermal OR hydrogen',
  emissions:    '"carbon emissions" OR methane OR "fossil fuel" OR "net zero"',
  biodiversity: 'biodiversity OR deforestation OR wildlife OR "species extinction"',
  water:        'flood OR drought OR groundwater OR glacier OR "sea level"',
  policy:       '"climate policy" OR COP OR "carbon tax" OR "Paris Agreement"',
};

const REGION_MAP = {
  global: '', europe: 'Europe', asia: 'Asia',
  americas: 'Americas', africa: 'Africa',
};

const TIMESPAN_MAP = {
  '7d': '7d', '30d': '30d', '90d': '90d', '1y': '365d',
};

const NON_ENGLISH_DOMAINS = ['xinhua', 'chinadaily', 'tass', 'rt.com', 'sputnik', 'globaltimes'];

const BLOCKLIST = ['insurance', 'recipe', 'patio', 'fashion', 'olympic', 'celebrity', 'movie', 'restaurant', 'hotel', 'shopping', 'discount', 'sale', 'deal', 'arrested', 'nfl', 'nba', 'soccer', 'football', 'baseball', 'drug takeback', 'prescription drug'];

const FALLBACKS = {
  renewable: [
    { title: 'Global solar capacity hits record 1.5 terawatts in 2024', source: 'Reuters', url: '#', date: null, snippet: 'Solar installations surged globally as costs fell to historic lows across Asia and Europe.' },
    { title: 'Offshore wind investment doubles driven by European targets', source: 'BBC', url: '#', date: null, snippet: 'European and Asian nations led offshore wind expansion with record auction results.' },
    { title: 'Green hydrogen emerges as key decarbonization tool for industry', source: 'Guardian', url: '#', date: null, snippet: 'Governments invest in hydrogen infrastructure for hard-to-abate industrial sectors.' },
    { title: 'Battery storage costs fall 40% year-over-year, enabling grid scale deployment', source: 'Financial Times', url: '#', date: null, snippet: 'Falling battery prices accelerate EV adoption and utility-scale storage projects.' },
    { title: 'Geothermal energy expansion planned across East Africa', source: 'AP News', url: '#', date: null, snippet: 'Kenya and Ethiopia lead geothermal development on the continent with new capacity additions.' },
  ],
  emissions: [
    { title: 'Global CO2 emissions reach record high despite clean energy growth', source: 'Nature', url: '#', date: null, snippet: 'IEA data shows emissions hit new peak driven by fossil fuel demand in developing nations.' },
    { title: 'Methane reduction pledges face serious implementation challenges', source: 'Reuters', url: '#', date: null, snippet: 'Countries struggle to monitor and meet methane reduction targets from agriculture and gas.' },
    { title: 'EU carbon markets hit record prices as stricter caps take effect', source: 'Financial Times', url: '#', date: null, snippet: 'EU ETS carbon prices rise as tighter emissions caps come into force across heavy industry.' },
    { title: 'Net zero commitments reviewed by major economies ahead of COP30', source: 'BBC', url: '#', date: null, snippet: 'G20 nations update nationally determined contributions with enhanced ambition targets.' },
    { title: 'IMF: fossil fuel subsidies hit $7 trillion globally in 2023', source: 'Guardian', url: '#', date: null, snippet: 'Report highlights ongoing fossil fuel support undermining climate pledges worldwide.' },
  ],
  biodiversity: [
    { title: 'Amazon deforestation fell 50% in 2024, Brazil reports', source: 'Guardian', url: '#', date: null, snippet: 'Enforcement and satellite monitoring contributed significantly to the decline in tree loss.' },
    { title: 'Coral bleaching affects 80% of Great Barrier Reef in mass event', source: 'Reuters', url: '#', date: null, snippet: 'Record ocean temperatures trigger largest mass bleaching ever recorded on the reef.' },
    { title: 'Global wildlife populations declined 69% since 1970, WWF warns', source: 'BBC', url: '#', date: null, snippet: 'Living Planet Index documents dramatic biodiversity loss across mammals, birds, and fish.' },
    { title: 'Historic ocean treaty creates largest marine protected area in Pacific', source: 'AP News', url: '#', date: null, snippet: 'UN agreement establishes new protections covering 30% of the high seas by 2030.' },
    { title: 'Species extinction rate now 1000 times higher than natural baseline', source: 'Nature', url: '#', date: null, snippet: 'Scientists warn sixth mass extinction is accelerating due to habitat loss and climate change.' },
  ],
  water: [
    { title: 'Sea level rise accelerating faster than IPCC projections', source: 'Nature', url: '#', date: null, snippet: 'Ice sheet instability and thermal expansion drive faster-than-expected sea level increases.' },
    { title: 'Megadroughts hit Western US for third consecutive year', source: 'Reuters', url: '#', date: null, snippet: 'Colorado River Basin faces unprecedented water shortages affecting 40 million people.' },
    { title: 'Glaciers retreating at record pace worldwide, UNESCO study finds', source: 'BBC', url: '#', date: null, snippet: 'UNESCO study finds glaciers losing over 1% of their mass annually on average.' },
    { title: 'Extreme monsoon flooding displaces 50 million in South Asia', source: 'AP News', url: '#', date: null, snippet: 'Climate-intensified monsoon rains cause catastrophic flooding across Pakistan and Bangladesh.' },
    { title: 'Groundwater depletion threatens global food supply in key regions', source: 'Guardian', url: '#', date: null, snippet: 'Aquifer exhaustion threatens irrigated agriculture in India, US, and North Africa.' },
  ],
  policy: [
    { title: 'COP30 host Brazil unveils ambitious national climate pledge', source: 'Reuters', url: '#', date: null, snippet: 'Brazil commits to net zero by 2050 and ending illegal deforestation by 2030.' },
    { title: 'EU carbon border adjustment mechanism takes effect in 2026', source: 'Financial Times', url: '#', date: null, snippet: 'CBAM applies carbon pricing to imports of steel, cement, aluminum and fertilizer.' },
    { title: 'G7 agrees to phase out unabated coal power by 2035', source: 'Guardian', url: '#', date: null, snippet: 'Historic commitment requires G7 nations to close coal plants within a decade.' },
    { title: 'Paris Agreement 10-year review shows mixed progress on targets', source: 'BBC', url: '#', date: null, snippet: 'Emissions reductions lagging on temperature targets despite significant policy advances.' },
    { title: 'Carbon pricing now covers 25% of global greenhouse gas emissions', source: 'AP News', url: '#', date: null, snippet: 'World Bank report shows growing carbon pricing coverage across 70 jurisdictions.' },
  ],
};

function isEnglish(article) {
  const lang = (article.language || '').toLowerCase();
  if (lang && lang !== 'english') return false;
  if (/[^\u0000-\u024F]/.test(article.title || '')) return false;
  const domain = (article.url || '').toLowerCase();
  if (NON_ENGLISH_DOMAINS.some(d => domain.includes(d))) return false;
  return true;
}

function parseDate(s) {
  if (!s) return null;
  return s.replace(/[T\-:Z ]/g, '').substring(0, 8);
}

async function fetchGdelt(query, timespan) {
  const url =
    `https://api.gdeltproject.org/api/v2/doc/doc` +
    `?query=${encodeURIComponent(query)}` +
    `&mode=artlist&maxrecords=25&format=json` +
    `&timespan=${timespan}&sourcelang=english&sort=DateDesc`;
  console.log(`[GDELT] ${url.substring(0, 130)}…`);
  try {
    const res  = await fetch(url, { timeout: 12000 });
    const text = await res.text();
    if (!text || !text.trim()) { console.warn('[GDELT] empty response'); return []; }
    const data = JSON.parse(text);
    const raw = data.articles || [];
    const filtered = raw
      .map(a => ({
        title:    a.title    || '',
        source:   a.domain   || 'GDELT',
        url:      a.url      || '#',
        date:     parseDate(a.seendate),
        snippet:  '',
        from:     'gdelt',
        language: a.language || '',
      }))
      .filter(a => a.title && !BLOCKLIST.some(w => a.title.toLowerCase().includes(w)) && isEnglish(a));
    console.log(`[GDELT] ${filtered.length}/${raw.length} English articles`);
    return filtered;
  } catch (e) {
    console.warn('[GDELT] fetch error:', e.message);
    return [];
  }
}

async function getArticles(theme, region, timeWindow) {
  const keywords = THEME_KEYWORDS[theme] || '"climate change"';
  const regionStr = REGION_MAP[region] || '';
  const timespan  = TIMESPAN_MAP[timeWindow] || '30d';

  const query = regionStr
    ? `(${keywords}) AND "${regionStr}"`
    : `(${keywords})`;

  let articles = await fetchGdelt(query, timespan);

  // Retry 1: drop region
  if (articles.length === 0 && regionStr) {
    console.log('[GDELT] retry without region');
    await new Promise(r => setTimeout(r, 2000));
    articles = await fetchGdelt(`(${keywords})`, timespan);
  }

  // Retry 2: first keyword only, wider window
  if (articles.length === 0) {
    const firstWord = keywords.replace(/["()]/g, '').split(/\s+/)[0];
    console.log(`[GDELT] retry with "${firstWord}" 90d`);
    await new Promise(r => setTimeout(r, 2000));
    articles = await fetchGdelt(firstWord, '90d');
  }

  // Fallback
  if (articles.length === 0) {
    console.log('[GDELT] using hardcoded fallback articles');
    articles = (FALLBACKS[theme] || FALLBACKS.renewable).map(a => ({ ...a, from: 'fallback' }));
  }

  console.log(`[GDELT] returning ${articles.length} articles for theme="${theme}"`);
  return articles;
}

module.exports = { getArticles };
