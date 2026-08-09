/**
 * Live web context for Jarvis chat.
 * Local models (LM Studio / Ollama) have no network — Cortex fetches
 * search results server-side and injects them into the prompt.
 *
 * Providers (primary → fallbacks):
 *   1. RivalSearchMCP (local, free, multi-engine) — PRIMARY
 *   2. Tavily (if key + quota)
 *   3. Google News RSS / DDG / Wikipedia / headline RSS
 */
import { ensureSecretsLoaded } from "@/lib/env/secrets";
import {
  getRivalSearchLastError,
  rivalSearchBridgeReady,
  searchRivalSearch,
} from "./rivalSearch";

export type LiveSearchHit = {
  title: string;
  url?: string;
  snippet: string;
};

export type LiveContext = {
  searched: boolean;
  query: string;
  provider?: string;
  hits: LiveSearchHit[];
  /** Ready-to-inject prompt block */
  block: string;
  /** Diagnostic notes for logs / UI */
  notes?: string[];
};

export type SearchProviderStatus = {
  id: string;
  ready: boolean;
  detail: string;
};

const TEMPORAL =
  /\b(today|tonight|now|current|currently|latest|recent|recently|this\s+(morning|afternoon|evening|week|month|year|weekend)|right\s+now|as\s+of|breaking|live|headline|headlines|update|updates|202[4-9]|2026)\b/i;

const LIVE_TOPICS =
  /\b(news|weather|forecast|temperature|stock|stocks|market|score|scores|election|poll|traffic|crypto|bitcoin|ethereum|price\s+of|who\s+won|what\s+happened|standings|earnings|ipo|war\s+in|conflict\s+in|president|prime\s+minister|ceo\s+of)\b/i;

const NEWS_SHAPED =
  /\b(news|headline|headlines|breaking|today|latest|what\s+happened|world\s+news|current\s+events)\b/i;

const WEATHER_SHAPED =
  /\b(weather|forecast|temperature|humidity|rain(ing)?|snow(ing)?|windy|hot\s+out|cold\s+out|how\s+hot|how\s+cold|hot\s+is\s+it|cold\s+is\s+it|degrees|°[fc]|uv\s+index|how'?s\s+the\s+weather|what'?s\s+the\s+weather|is\s+it\s+(hot|cold|raining|snowing))\b/i;

/** Whether this user message likely needs live data (not just model weights). */
export function needsLiveData(prompt: string): boolean {
  const q = prompt.trim();
  if (q.length < 3) return false;
  if (TEMPORAL.test(q) || LIVE_TOPICS.test(q) || WEATHER_SHAPED.test(q))
    return true;
  if (
    /\b(what'?s|whats|what\s+is|who\s+is|who\s+won|how\s+much|how\s+many|when\s+is|where\s+is|tell\s+me\s+about|how'?s)\b/i.test(
      q,
    ) &&
    q.length < 200
  ) {
    return true;
  }
  if (/\?$/.test(q) && q.length < 180) return true;
  return false;
}

export function isWeatherQuery(prompt: string): boolean {
  return WEATHER_SHAPED.test(prompt.trim());
}

/** WMO weather codes → short English labels (Open-Meteo). */
function wmoLabel(code: number | undefined): string {
  if (code == null || !Number.isFinite(code)) return "Unknown";
  if (code === 0) return "Clear sky";
  if (code === 1) return "Mainly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code >= 61 && code <= 67) return "Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Rain showers";
  if (code >= 85 && code <= 86) return "Snow showers";
  if (code >= 95 && code <= 99) return "Thunderstorm";
  return `Weather code ${code}`;
}

const US_STATE_ABBR: Record<string, string> = {
  al: "Alabama",
  ak: "Alaska",
  az: "Arizona",
  ar: "Arkansas",
  ca: "California",
  co: "Colorado",
  ct: "Connecticut",
  de: "Delaware",
  fl: "Florida",
  ga: "Georgia",
  hi: "Hawaii",
  id: "Idaho",
  il: "Illinois",
  in: "Indiana",
  ia: "Iowa",
  ks: "Kansas",
  ky: "Kentucky",
  la: "Louisiana",
  me: "Maine",
  md: "Maryland",
  ma: "Massachusetts",
  mi: "Michigan",
  mn: "Minnesota",
  ms: "Mississippi",
  mo: "Missouri",
  mt: "Montana",
  ne: "Nebraska",
  nv: "Nevada",
  nh: "New Hampshire",
  nj: "New Jersey",
  nm: "New Mexico",
  ny: "New York",
  nc: "North Carolina",
  nd: "North Dakota",
  oh: "Ohio",
  ok: "Oklahoma",
  or: "Oregon",
  pa: "Pennsylvania",
  ri: "Rhode Island",
  sc: "South Carolina",
  sd: "South Dakota",
  tn: "Tennessee",
  tx: "Texas",
  ut: "Utah",
  vt: "Vermont",
  va: "Virginia",
  wa: "Washington",
  wv: "West Virginia",
  wi: "Wisconsin",
  wy: "Wyoming",
  dc: "District of Columbia",
};

/** Expand "Las Vegas NV" → "Las Vegas, Nevada" for geocoders that want a comma. */
function normalizePlaceQuery(raw: string): string[] {
  let q = raw.trim();
  // Known short aliases
  if (/^lv$/i.test(q) || /^vegas$/i.test(q)) q = "Las Vegas, Nevada";
  if (/^nyc$/i.test(q)) q = "New York, New York";
  if (/^la$/i.test(q)) q = "Los Angeles, California";
  if (/^sf$/i.test(q)) q = "San Francisco, California";

  // Expand trailing 2-letter US state abbreviation (and ", NV" form)
  q = q.replace(
    /\b([A-Za-z .'-]+?)[,\s]+([A-Za-z]{2})$/i,
    (_m, city: string, st: string) => {
      const full = US_STATE_ABBR[st.toLowerCase()];
      return full
        ? `${city.trim().replace(/,+$/, "")}, ${full}`
        : `${city.trim()} ${st}`;
    },
  );

  // "City StateName" (no comma) → "City, StateName" when last tokens look like a state
  if (!q.includes(",")) {
    const stateNames = Object.values(US_STATE_ABBR);
    for (const st of stateNames) {
      const re = new RegExp(`^(.+?)\\s+${st.replace(/\s+/g, "\\s+")}$`, "i");
      const m = q.match(re);
      if (m) {
        q = `${m[1].trim().replace(/,+$/, "")}, ${st}`;
        break;
      }
    }
  }
  q = q.replace(/,\s*,/g, ", ").replace(/\s+/g, " ").trim();

  const parts = q.replace(/,/g, " ").split(/\s+/).filter(Boolean);
  const candidates: string[] = [];

  // For "Tokyo Japan" / "Paris France" Open-Meteo often wants city-only first
  if (parts.length >= 2) {
    // City alone (first token or first two if multi-word city)
    candidates.push(parts[0]!);
    if (parts.length >= 3) {
      candidates.push(parts.slice(0, 2).join(" "));
    }
    // Full "City Country" form
    candidates.push(q);
    // Comma form "City, Country"
    if (!q.includes(",") && parts.length === 2) {
      candidates.push(`${parts[0]}, ${parts[1]}`);
    }
  } else {
    candidates.push(q);
  }

  // City-only from comma form
  if (q.includes(",")) {
    const cityOnly = q.split(",")[0]!.trim();
    if (cityOnly.length >= 3) candidates.unshift(cityOnly);
    candidates.push(q);
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of candidates) {
    const k = c.toLowerCase().trim();
    if (!k || seen.has(k)) continue;
    // Reject too-short tokens (but allow real city names ≥ 3 chars)
    if (k.length < 3) continue;
    seen.add(k);
    out.push(c.trim());
  }
  return out.length ? out : [q];
}

/** Well-known US places — bypass flaky geocoding for common weather asks. */
const KNOWN_WEATHER_PLACES: Array<{
  match: RegExp;
  name: string;
  admin1: string;
  country: string;
  country_code: string;
  latitude: number;
  longitude: number;
  timezone: string;
}> = [
  {
    match: /\blas\s*vegas\b/i,
    name: "Las Vegas",
    admin1: "Nevada",
    country: "United States",
    country_code: "US",
    latitude: 36.1699,
    longitude: -115.1398,
    timezone: "America/Los_Angeles",
  },
  {
    match: /\b(new\s*york\s*city|\bnyc\b|manhattan)\b/i,
    name: "New York",
    admin1: "New York",
    country: "United States",
    country_code: "US",
    latitude: 40.7128,
    longitude: -74.006,
    timezone: "America/New_York",
  },
  {
    match: /\blos\s*angeles\b|\b\bla\b(?!\w)/i,
    name: "Los Angeles",
    admin1: "California",
    country: "United States",
    country_code: "US",
    latitude: 34.0522,
    longitude: -118.2437,
    timezone: "America/Los_Angeles",
  },
  {
    match: /\bsan\s*francisco\b|\b\bsf\b(?!\w)/i,
    name: "San Francisco",
    admin1: "California",
    country: "United States",
    country_code: "US",
    latitude: 37.7749,
    longitude: -122.4194,
    timezone: "America/Los_Angeles",
  },
  {
    match: /\bchicago\b/i,
    name: "Chicago",
    admin1: "Illinois",
    country: "United States",
    country_code: "US",
    latitude: 41.8781,
    longitude: -87.6298,
    timezone: "America/Chicago",
  },
  {
    match: /\bmiami\b/i,
    name: "Miami",
    admin1: "Florida",
    country: "United States",
    country_code: "US",
    latitude: 25.7617,
    longitude: -80.1918,
    timezone: "America/New_York",
  },
  {
    match: /\bseattle\b/i,
    name: "Seattle",
    admin1: "Washington",
    country: "United States",
    country_code: "US",
    latitude: 47.6062,
    longitude: -122.3321,
    timezone: "America/Los_Angeles",
  },
  // Major non-US cities (Open-Meteo "City Country" often returns empty)
  {
    match: /\btokyo\b/i,
    name: "Tokyo",
    admin1: "Tokyo",
    country: "Japan",
    country_code: "JP",
    latitude: 35.6762,
    longitude: 139.6503,
    timezone: "Asia/Tokyo",
  },
  {
    match: /\blondon\b/i,
    name: "London",
    admin1: "England",
    country: "United Kingdom",
    country_code: "GB",
    latitude: 51.5074,
    longitude: -0.1278,
    timezone: "Europe/London",
  },
  {
    match: /\bparis\b/i,
    name: "Paris",
    admin1: "Île-de-France",
    country: "France",
    country_code: "FR",
    latitude: 48.8566,
    longitude: 2.3522,
    timezone: "Europe/Paris",
  },
  {
    match: /\bsydney\b/i,
    name: "Sydney",
    admin1: "New South Wales",
    country: "Australia",
    country_code: "AU",
    latitude: -33.8688,
    longitude: 151.2093,
    timezone: "Australia/Sydney",
  },
  {
    match: /\bberlin\b/i,
    name: "Berlin",
    admin1: "Berlin",
    country: "Germany",
    country_code: "DE",
    latitude: 52.52,
    longitude: 13.405,
    timezone: "Europe/Berlin",
  },
  {
    match: /\btoronto\b/i,
    name: "Toronto",
    admin1: "Ontario",
    country: "Canada",
    country_code: "CA",
    latitude: 43.6532,
    longitude: -79.3832,
    timezone: "America/Toronto",
  },
];

type GeoHit = {
  name?: string;
  admin1?: string;
  country?: string;
  country_code?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
  population?: number;
};

/**
 * Detect US state from prompt text.
 * Full names always; 2-letter codes only as ", NV" / " NV" at end of a place —
 * never bare "in"/"or"/"me" which appear in normal English ("in London").
 */
function detectUsState(prompt: string): string | null {
  const p = prompt.toLowerCase();
  // Prefer full names first (longer match)
  const byLen = Object.entries(US_STATE_ABBR).sort(
    (a, b) => b[1].length - a[1].length,
  );
  for (const [, full] of byLen) {
    if (p.includes(full.toLowerCase())) return full;
  }

  // Explicit ", XX" or trailing " XX" place form only
  const trailing = prompt.match(
    /(?:,|\s)\s*([A-Za-z]{2})\s*[?!.]*\s*$/,
  );
  if (trailing?.[1]) {
    const full = US_STATE_ABBR[trailing[1].toLowerCase()];
    if (full) return full;
  }
  const commaAbbr = prompt.match(/,\s*([A-Za-z]{2})\b/);
  if (commaAbbr?.[1]) {
    const full = US_STATE_ABBR[commaAbbr[1].toLowerCase()];
    if (full) return full;
  }
  return null;
}

function scoreGeoHit(
  hit: GeoHit,
  prompt: string,
  requiredState: string | null,
): number {
  let score = 0;
  const name = (hit.name || "").toLowerCase();
  const admin = (hit.admin1 || "").toLowerCase();
  const country = (hit.country || "").toLowerCase();
  const cc = (hit.country_code || "").toUpperCase();
  const p = prompt.toLowerCase();

  // Hard preference: when user named a US state, non-US results are almost never right
  if (requiredState) {
    if (admin === requiredState.toLowerCase() && cc === "US") score += 100;
    else if (cc === "US") score += 20;
    else score -= 80; // Zambia / Peru / etc.
  } else if (cc === "US") {
    score += 15;
  }

  // City name overlap
  if (/las\s*vegas/i.test(prompt) && name.includes("las vegas")) score += 60;
  if (p.includes(name) && name.length >= 3) score += 25;

  // Country named in prompt (Tokyo Japan, Paris France, London UK)
  if (country && p.includes(country)) score += 45;
  if (/\bunited\s+kingdom\b|\buk\b|\bengland\b/i.test(prompt)) {
    if (cc === "GB" || /united kingdom|england/i.test(country)) score += 50;
  }
  if (/\bjapan\b/i.test(prompt) && (cc === "JP" || /japan/i.test(country)))
    score += 50;
  if (/\bfrance\b/i.test(prompt) && (cc === "FR" || /france/i.test(country)))
    score += 50;
  if (/\bcanada\b/i.test(prompt) && (cc === "CA" || /canada/i.test(country)))
    score += 50;

  // Admin region mentioned
  if (admin && p.includes(admin)) score += 30;

  // Population as tie-breaker (bigger cities more likely)
  if (typeof hit.population === "number" && hit.population > 0) {
    score += Math.min(30, Math.log10(hit.population + 1) * 5);
  }

  // Penalize obscure foreign hits when query looks American
  if (
    cc &&
    cc !== "US" &&
    /\b(usa|u\.s\.a?|united states|,?\s*(nv|ca|ny|tx|fl|az|wa|or|il|ma)\b)/i.test(
      prompt,
    )
  ) {
    score -= 50;
  }

  // Penalize generic country matches
  if (!name && country) score -= 10;

  return score;
}

/**
 * Extract a place name from a weather-ish prompt.
 * e.g. "weather in Las Vegas Nevada" → "Las Vegas Nevada"
 * e.g. "is it raining in London" → "London"
 */
export function extractWeatherPlace(prompt: string): string {
  let q = prompt.trim();

  // Prefer explicit "in/at/for/near PLACE" capture
  const inMatch = q.match(
    /\b(?:in|at|for|near|around)\s+([A-Za-z0-9 .,'-]+?)(?:\s*[?!.]|$)/i,
  );
  if (inMatch?.[1]) {
    q = inMatch[1].trim();
  } else {
    q = q
      .replace(
        /\b(what\s+is|what'?s|whats|how'?s|how\s+is|how\s+hot|how\s+cold|tell\s+me|give\s+me|check|get|show|can\s+you|could\s+you)\b/gi,
        " ",
      )
      .replace(
        /\b(is\s+it\s+(raining|snowing|hot|cold)|it\s+raining|it\s+snowing)\b/gi,
        " ",
      )
      .replace(
        /\b(the\s+)?(current\s+|live\s+|realtime\s+|real-time\s+)?(weather|forecast|temperature|conditions?|humidity|wind)\b/gi,
        " ",
      )
      .replace(
        /\b(right\s+now|currently|tonight|today|this\s+(morning|afternoon|evening)|please|thanks|thank\s+you)\b/gi,
        " ",
      )
      .replace(/\b(for|in|at|near|around|of)\b/gi, " ");
  }

  q = q
    .replace(/[?!.,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Drop leftover weather verbs if still present
  q = q
    .replace(
      /^(is\s+it\s+)?(raining|snowing|hot|cold)\s+/i,
      "",
    )
    .trim();

  if (q.length < 2) {
    q = prompt
      .replace(/[?!.,]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return q.slice(0, 120);
}

/**
 * Open-Meteo free weather (no API key) — real current conditions + short forecast.
 * RivalSearch only returns *links* to weather sites, not readings.
 */
async function searchOpenMeteoWeather(
  prompt: string,
): Promise<LiveContext | null> {
  try {
    const requiredState = detectUsState(prompt);

    // 1) Hardcoded major cities (US + world) — avoids RivalSearch-style link spam
    // and geocoder ambiguity (London OH, Paris TX, Las Vegas abroad, etc.)
    let pick: GeoHit | null = null;
    for (const known of KNOWN_WEATHER_PLACES) {
      if (!known.match.test(prompt)) continue;

      // US city with a different US state in the prompt → skip this known entry
      if (
        known.country_code === "US" &&
        requiredState &&
        requiredState.toLowerCase() !== known.admin1.toLowerCase()
      ) {
        continue;
      }

      // Non-US known city: use unless user clearly forced a US state (e.g. Paris TX)
      if (known.country_code !== "US" && requiredState) {
        // e.g. "Paris TX" should not hit Paris France
        continue;
      }

      // London: prefer UK unless user said a US state / Ontario
      if (/london/i.test(known.name)) {
        if (/\b(ohio|kentucky|arkansas|ontario|canada)\b/i.test(prompt)) {
          continue;
        }
        if (/\b(uk|u\.k\.|united\s+kingdom|england|britain)\b/i.test(prompt)) {
          pick = { ...known };
          break;
        }
        // bare "London" → UK capital
        pick = { ...known };
        break;
      }

      // Paris: prefer France unless user said a US state
      if (/paris/i.test(known.name)) {
        if (requiredState) continue;
        pick = { ...known };
        break;
      }

      pick = { ...known };
      break;
    }

    // 2) Open-Meteo geocoding with scored multi-candidate resolution
    if (!pick) {
      const placeRaw = extractWeatherPlace(prompt);
      if (placeRaw.length < 2) return null;
      const placeCandidates = normalizePlaceQuery(placeRaw);

      const allMatches: GeoHit[] = [];
      for (const candidate of placeCandidates) {
        const geoUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
        geoUrl.searchParams.set("name", candidate);
        geoUrl.searchParams.set("count", "10");
        geoUrl.searchParams.set("language", "en");
        geoUrl.searchParams.set("format", "json");

        const geoRes = await fetch(geoUrl.toString(), {
          headers: {
            "User-Agent": "Cortex/0.2 (Jarvis weather)",
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(10_000),
          cache: "no-store",
        });
        if (!geoRes.ok) continue;
        const geo = (await geoRes.json()) as { results?: GeoHit[] };
        if (geo.results?.length) allMatches.push(...geo.results);
      }
      if (!allMatches.length) return null;

      // Score every hit; population breaks ties (prefer real metros)
      let best: { hit: GeoHit; score: number } | null = null;
      for (const m of allMatches) {
        const s = scoreGeoHit(m, prompt, requiredState);
        if (
          !best ||
          s > best.score ||
          (s === best.score &&
            (m.population || 0) > (best.hit.population || 0))
        ) {
          best = { hit: m, score: s };
        }
      }
      if (!best || best.score < 0) return null;

      // If user said a US state, force that state + US only
      if (requiredState) {
        const stateHits = allMatches
          .filter(
            (m) =>
              (m.admin1 || "").toLowerCase() === requiredState.toLowerCase() &&
              (m.country_code || "").toUpperCase() === "US",
          )
          .map((m) => ({
            hit: m,
            score: scoreGeoHit(m, prompt, requiredState),
          }))
          .sort(
            (a, b) =>
              b.score - a.score ||
              (b.hit.population || 0) - (a.hit.population || 0),
          );
        if (stateHits[0]) best = stateHits[0];
      }

      // UK / Japan / France country hints when no US state
      if (!requiredState) {
        if (/\b(uk|u\.k\.|united\s+kingdom|england|britain)\b/i.test(prompt)) {
          const uk = allMatches
            .filter(
              (m) =>
                (m.country_code || "").toUpperCase() === "GB" ||
                /united kingdom|england/i.test(m.country || ""),
            )
            .sort((a, b) => (b.population || 0) - (a.population || 0));
          if (uk[0]) best = { hit: uk[0], score: 999 };
        }
        if (/\bjapan\b/i.test(prompt)) {
          const jp = allMatches
            .filter((m) => (m.country_code || "").toUpperCase() === "JP")
            .sort((a, b) => (b.population || 0) - (a.population || 0));
          if (jp[0]) best = { hit: jp[0], score: 999 };
        }
        if (/\bfrance\b/i.test(prompt)) {
          const fr = allMatches
            .filter((m) => (m.country_code || "").toUpperCase() === "FR")
            .sort((a, b) => (b.population || 0) - (a.population || 0));
          if (fr[0]) best = { hit: fr[0], score: 999 };
        }
      }

      pick = best.hit;
    }

    const lat = pick.latitude;
    const lon = pick.longitude;
    if (lat == null || lon == null) return null;

    const placeLabel = [pick.name, pick.admin1, pick.country]
      .filter(Boolean)
      .join(", ");

    const wxUrl = new URL("https://api.open-meteo.com/v1/forecast");
    wxUrl.searchParams.set("latitude", String(lat));
    wxUrl.searchParams.set("longitude", String(lon));
    wxUrl.searchParams.set(
      "current",
      "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation,cloud_cover,uv_index",
    );
    wxUrl.searchParams.set(
      "daily",
      "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum",
    );
    wxUrl.searchParams.set("temperature_unit", "fahrenheit");
    wxUrl.searchParams.set("wind_speed_unit", "mph");
    wxUrl.searchParams.set("precipitation_unit", "inch");
    wxUrl.searchParams.set("forecast_days", "3");
    wxUrl.searchParams.set(
      "timezone",
      pick.timezone || "auto",
    );

    const wxRes = await fetch(wxUrl.toString(), {
      headers: { "User-Agent": "Cortex/0.2 (Jarvis weather)", Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!wxRes.ok) return null;
    const wx = (await wxRes.json()) as {
      timezone?: string;
      current?: Record<string, number | string | null>;
      current_units?: Record<string, string>;
      daily?: {
        time?: string[];
        weather_code?: number[];
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
        precipitation_sum?: number[];
      };
    };

    const c = wx.current || {};
    const u = wx.current_units || {};
    const temp = c.temperature_2m;
    const feels = c.apparent_temperature;
    const humidity = c.relative_humidity_2m;
    const wind = c.wind_speed_10m;
    const precip = c.precipitation;
    const clouds = c.cloud_cover;
    const uv = c.uv_index;
    const code = Number(c.weather_code);
    const asOf = String(c.time || "");
    const cond = wmoLabel(code);

    const unitT = u.temperature_2m || "°F";
    const unitW = u.wind_speed_10m || "mph";

    const currentLine = [
      `Location: ${placeLabel} (${lat.toFixed(2)}°, ${lon.toFixed(2)}°)`,
      `As of: ${asOf} (${wx.timezone || pick.timezone || "local"})`,
      `Conditions: ${cond}`,
      `Temperature: ${temp}${unitT}` +
        (feels != null ? ` (feels like ${feels}${unitT})` : ""),
      humidity != null ? `Humidity: ${humidity}%` : null,
      wind != null ? `Wind: ${wind} ${unitW}` : null,
      precip != null ? `Precipitation: ${precip} ${u.precipitation || "in"}` : null,
      clouds != null ? `Cloud cover: ${clouds}%` : null,
      uv != null ? `UV index: ${uv}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const dailyLines: string[] = [];
    const days = wx.daily?.time || [];
    for (let i = 0; i < Math.min(3, days.length); i++) {
      const dCode = wx.daily?.weather_code?.[i];
      const hi = wx.daily?.temperature_2m_max?.[i];
      const lo = wx.daily?.temperature_2m_min?.[i];
      const p = wx.daily?.precipitation_sum?.[i];
      dailyLines.push(
        `${days[i]}: ${wmoLabel(dCode)} · high ${hi}${unitT} / low ${lo}${unitT}` +
          (p != null ? ` · precip ${p}${u.precipitation || "in"}` : ""),
      );
    }

    const snippet = [
      currentLine,
      dailyLines.length ? `Next days:\n${dailyLines.join("\n")}` : "",
      "Source: Open-Meteo (live weather API, no key). Prefer these numbers over web search links.",
    ]
      .filter(Boolean)
      .join("\n\n");

    const hits: LiveSearchHit[] = [
      {
        title: `Live weather — ${placeLabel}`,
        url: `https://open-meteo.com/`,
        snippet: snippet.slice(0, 1200),
      },
    ];

    // Pack with a richer block (snippet can be longer for weather)
    return {
      searched: true,
      query: prompt,
      provider: "open-meteo",
      hits,
      block:
        `Live weather for "${placeLabel}" (source: open-meteo).\n` +
        `Use these readings as ground truth for current conditions.\n\n` +
        snippet,
    };
  } catch {
    return null;
  }
}

export function formatClockContext(now = new Date()): string {
  const tz =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "local time";
  const local = now.toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
  return (
    `Current date/time: ${local} (${tz}). ` +
    `ISO: ${now.toISOString()}. ` +
    `Your weights may be outdated — treat this clock as authoritative for "today/now". ` +
    `When Live web results are provided, prefer them over training memory for facts that change.`
  );
}

function hitsToBlock(
  query: string,
  provider: string,
  hits: LiveSearchHit[],
): string {
  if (!hits.length) {
    return (
      `Live web search for "${query}" via ${provider} returned no results. ` +
      `Say you could not verify live data rather than inventing current events.`
    );
  }
  const lines = hits.slice(0, 8).map((h, i) => {
    const url = h.url ? ` (${h.url})` : "";
    return `${i + 1}. ${h.title}${url}\n   ${h.snippet}`;
  });
  return (
    `Live web results for "${query}" (source: ${provider}). ` +
    `Use these as ground truth for current facts; cite titles briefly when relevant.\n` +
    lines.join("\n")
  );
}

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseRssItems(xml: string, limit = 6): LiveSearchHit[] {
  const chunks = xml.split(/<item[\s>]/i).slice(1);
  const hits: LiveSearchHit[] = [];
  for (const raw of chunks) {
    if (hits.length >= limit) break;
    const block = raw.split(/<\/item>/i)[0] ?? raw;
    const title = decodeXml(
      (block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim(),
    );
    let link = decodeXml(
      (block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1] || "").trim(),
    );
    if (!link) {
      const href = block.match(/<link[^>]+href=["']([^"']+)["']/i);
      link = href?.[1] ?? "";
    }
    const desc = decodeXml(
      (block.match(/<description[^>]*>([\s\S]*?)<\/description>/i)?.[1] ||
        "").trim(),
    );
    if (!title) continue;
    hits.push({
      title: title.slice(0, 220),
      url: link || undefined,
      snippet: (desc || title).slice(0, 400),
    });
  }
  return hits;
}

function dedupeHits(hits: LiveSearchHit[]): LiveSearchHit[] {
  const seen = new Set<string>();
  const out: LiveSearchHit[] = [];
  for (const h of hits) {
    const key = h.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .slice(0, 90);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  return out;
}

function pack(
  query: string,
  provider: string,
  hits: LiveSearchHit[],
  notes?: string[],
): LiveContext | null {
  const clean = dedupeHits(hits).filter((h) => h.title);
  if (!clean.length) return null;
  return {
    searched: true,
    query,
    provider,
    hits: clean.slice(0, 8),
    block: hitsToBlock(query, provider, clean.slice(0, 8)),
    notes,
  };
}

// ─── Tavily (paid; may be out of quota) ──────────────────────────────────────

let tavilyLastError: string | null = null;

export function getTavilyLastError(): string | null {
  return tavilyLastError;
}

async function searchTavily(query: string): Promise<LiveContext | null> {
  ensureSecretsLoaded();
  const key = process.env.TAVILY_API_KEY?.trim();
  if (!key) {
    tavilyLastError = "no_key";
    return null;
  }
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        query,
        search_depth: "basic",
        max_results: 5,
        include_answer: true,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 432 || /usage limit|quota|plan/i.test(body)) {
        tavilyLastError = "quota_exceeded";
      } else {
        tavilyLastError = `http_${res.status}`;
      }
      return null;
    }
    const data = (await res.json()) as {
      answer?: string;
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };
    const hits: LiveSearchHit[] = (data.results ?? [])
      .map((r) => ({
        title: (r.title || "Result").trim(),
        url: r.url,
        snippet: (r.content || "").trim().slice(0, 400),
      }))
      .filter((h) => h.snippet || h.title);
    if (data.answer?.trim()) {
      hits.unshift({
        title: "Tavily summary",
        snippet: data.answer.trim().slice(0, 600),
      });
    }
    tavilyLastError = null;
    return pack(query, "tavily", hits);
  } catch (e) {
    tavilyLastError = e instanceof Error ? e.message : "network_error";
    return null;
  }
}

// ─── Free: Google News RSS (query-scoped) ────────────────────────────────────

async function searchGoogleNews(query: string): Promise<LiveContext | null> {
  try {
    const url = new URL("https://news.google.com/rss/search");
    url.searchParams.set("q", query);
    url.searchParams.set("hl", "en-US");
    url.searchParams.set("gl", "US");
    url.searchParams.set("ceid", "US:en");
    const res = await fetch(url.toString(), {
      headers: {
        "User-Agent": "Cortex/0.2 (Jarvis live search; +local)",
        Accept: "application/rss+xml, application/xml, text/xml, */*",
      },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const xml = await res.text();
    return pack(query, "google-news", parseRssItems(xml, 7));
  } catch {
    return null;
  }
}

// ─── Free: curated headline RSS (for broad "news today" questions) ───────────

async function searchHeadlineFeeds(query: string): Promise<LiveContext | null> {
  if (!NEWS_SHAPED.test(query) && !/\bnews\b/i.test(query)) return null;
  const feeds = [
    "https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en",
    "https://feeds.bbci.co.uk/news/world/rss.xml",
    "https://feeds.npr.org/1001/rss.xml",
  ];
  try {
    const results = await Promise.all(
      feeds.map(async (feedUrl) => {
        try {
          const res = await fetch(feedUrl, {
            headers: {
              "User-Agent": "Cortex/0.2 (Jarvis live search)",
              Accept: "application/rss+xml, application/xml, text/xml, */*",
            },
            signal: AbortSignal.timeout(9_000),
            cache: "no-store",
          });
          if (!res.ok) return [] as LiveSearchHit[];
          return parseRssItems(await res.text(), 4);
        } catch {
          return [] as LiveSearchHit[];
        }
      }),
    );
    return pack(query, "headline-rss", results.flat());
  } catch {
    return null;
  }
}

// ─── Free: Wikipedia ─────────────────────────────────────────────────────────

async function searchWikipedia(query: string): Promise<LiveContext | null> {
  try {
    const title = query
      .replace(/^(who is|what is|what's|whats|tell me about)\s+/i, "")
      .replace(/[?!.]+$/g, "")
      .trim()
      .slice(0, 120);
    if (title.length < 2) return null;
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Cortex/0.2 (local assistant)",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      title?: string;
      extract?: string;
      description?: string;
      content_urls?: { desktop?: { page?: string } };
      type?: string;
    };
    if (data.type === "disambiguation" || !data.extract?.trim()) return null;
    return pack(query, "wikipedia", [
      {
        title: data.title || title,
        url: data.content_urls?.desktop?.page,
        snippet: [data.description?.trim(), data.extract.trim().slice(0, 600)]
          .filter(Boolean)
          .join(" — "),
      },
    ]);
  } catch {
    return null;
  }
}

// ─── Free: DuckDuckGo Instant Answer ─────────────────────────────────────────

async function searchDuckDuckGo(query: string): Promise<LiveContext | null> {
  try {
    const url = new URL("https://api.duckduckgo.com/");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("no_html", "1");
    url.searchParams.set("skip_disambig", "1");
    const res = await fetch(url, {
      headers: { "User-Agent": "Cortex/0.2 (local assistant)" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      AbstractText?: string;
      AbstractURL?: string;
      AbstractSource?: string;
      Heading?: string;
      Answer?: string;
      Definition?: string;
      RelatedTopics?: Array<
        | { Text?: string; FirstURL?: string }
        | { Topics?: Array<{ Text?: string; FirstURL?: string }> }
      >;
      Results?: Array<{ Text?: string; FirstURL?: string }>;
    };

    const hits: LiveSearchHit[] = [];
    if (data.Answer?.trim()) {
      hits.push({ title: "Direct answer", snippet: data.Answer.trim() });
    }
    if (data.AbstractText?.trim()) {
      hits.push({
        title: data.Heading || data.AbstractSource || "Summary",
        url: data.AbstractURL,
        snippet: data.AbstractText.trim().slice(0, 500),
      });
    }
    if (data.Definition?.trim()) {
      hits.push({ title: "Definition", snippet: data.Definition.trim() });
    }
    const related = data.RelatedTopics ?? [];
    for (const item of related) {
      if (hits.length >= 6) break;
      if ("Text" in item && item.Text) {
        hits.push({
          title: item.Text.slice(0, 80),
          url: item.FirstURL,
          snippet: item.Text.slice(0, 400),
        });
      } else if ("Topics" in item && item.Topics) {
        for (const t of item.Topics) {
          if (hits.length >= 6) break;
          if (t.Text) {
            hits.push({
              title: t.Text.slice(0, 80),
              url: t.FirstURL,
              snippet: t.Text.slice(0, 400),
            });
          }
        }
      }
    }
    for (const r of data.Results ?? []) {
      if (hits.length >= 6) break;
      if (r.Text) {
        hits.push({
          title: r.Text.slice(0, 80),
          url: r.FirstURL,
          snippet: r.Text.slice(0, 400),
        });
      }
    }
    return pack(query, "duckduckgo", hits);
  } catch {
    return null;
  }
}

/**
 * Free DuckDuckGo HTML results page (when Instant Answer is empty).
 * Best-effort scrape of result titles/snippets.
 */
async function searchDuckDuckGoHtml(query: string): Promise<LiveContext | null> {
  try {
    const url = new URL("https://html.duckduckgo.com/html/");
    url.searchParams.set("q", query);
    const res = await fetch(url.toString(), {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const html = await res.text();
    const hits: LiveSearchHit[] = [];
    // result blocks: <a class="result__a" href="...">title</a> ... <a class="result__snippet">
    const re =
      /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|td)>|class="result__snippet">([\s\S]*?)<\/)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && hits.length < 6) {
      const href = decodeXml(m[1] || "");
      const title = decodeXml(m[2] || "");
      const snippet = decodeXml(m[3] || m[4] || "");
      if (!title) continue;
      hits.push({
        title: title.slice(0, 220),
        url: href || undefined,
        snippet: (snippet || title).slice(0, 400),
      });
    }
    // Fallback simpler pattern
    if (!hits.length) {
      const simple =
        /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      while ((m = simple.exec(html)) && hits.length < 6) {
        const title = decodeXml(m[2] || "");
        if (!title) continue;
        hits.push({
          title: title.slice(0, 220),
          url: decodeXml(m[1] || "") || undefined,
          snippet: title.slice(0, 400),
        });
      }
    }
    return pack(query, "duckduckgo-html", hits);
  } catch {
    return null;
  }
}

/**
 * Probe which live providers are usable (for Settings / health UI).
 */
export async function probeLiveSearchProviders(): Promise<SearchProviderStatus[]> {
  ensureSecretsLoaded();
  const out: SearchProviderStatus[] = [];

  // Primary: RivalSearchMCP (existence probe only — full search runs on chat)
  if (!rivalSearchBridgeReady()) {
    out.push({
      id: "rival-search",
      ready: false,
      detail: "RivalSearchMCP not found (clone + cortex_bridge.py)",
    });
  } else {
    out.push({
      id: "rival-search",
      ready: true,
      detail: "Primary · local uv bridge ready",
    });
  }

  const key = process.env.TAVILY_API_KEY?.trim();
  if (!key) {
    out.push({ id: "tavily", ready: false, detail: "No TAVILY_API_KEY (optional)" });
  } else {
    const probe = await searchTavily("current date time news");
    if (probe?.hits.length) {
      out.push({ id: "tavily", ready: true, detail: "OK (secondary)" });
    } else if (tavilyLastError === "quota_exceeded") {
      out.push({
        id: "tavily",
        ready: false,
        detail: "Plan usage limit exceeded (optional secondary)",
      });
    } else {
      out.push({
        id: "tavily",
        ready: false,
        detail: tavilyLastError || "No results",
      });
    }
  }

  const gnews = await searchGoogleNews("world news");
  out.push({
    id: "google-news",
    ready: Boolean(gnews?.hits.length),
    detail: gnews?.hits.length
      ? `${gnews.hits.length} headlines (fallback)`
      : "Unavailable",
  });

  // Weather API probe (Las Vegas — known coords)
  try {
    const wx = await fetch(
      "https://api.open-meteo.com/v1/forecast?latitude=36.17&longitude=-115.14&current=temperature_2m&temperature_unit=fahrenheit",
      {
        headers: { "User-Agent": "Cortex/0.2", Accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
        cache: "no-store",
      },
    );
    out.push({
      id: "open-meteo",
      ready: wx.ok,
      detail: wx.ok
        ? "Weather API OK (used for forecast questions)"
        : `HTTP ${wx.status}`,
    });
  } catch {
    out.push({
      id: "open-meteo",
      ready: false,
      detail: "Weather API unreachable",
    });
  }

  out.push({
    id: "free-fallback",
    ready: true,
    detail: "DuckDuckGo + Wikipedia + RSS last resort",
  });

  return out;
}

/**
 * Fetch live context for a chat turn.
 * Never throws.
 *   Weather → Open-Meteo first (real readings)
 *   General → RivalSearchMCP primary · Tavily · free RSS/DDG
 */
export async function fetchLiveContext(
  prompt: string,
  opts?: { force?: boolean },
): Promise<LiveContext | null> {
  ensureSecretsLoaded();
  const query = prompt.trim().slice(0, 400);
  if (!query) return null;
  if (!opts?.force && !needsLiveData(query)) return null;

  const notes: string[] = [];

  // 0) WEATHER — Open-Meteo only (RivalSearch cannot return live temps for a place)
  if (isWeatherQuery(query)) {
    const weather = await searchOpenMeteoWeather(query);
    if (weather?.hits.length) {
      return {
        ...weather,
        notes: ["Open-Meteo live weather (preferred for temperature/conditions)"],
        block:
          `Primary live source: Open-Meteo weather API.\n\n${weather.block}`,
      };
    }
    // Do NOT fall through to RivalSearch for weather — it only returns site links
    // and confuses the model into saying "no live weather".
    const place = extractWeatherPlace(query);
    return {
      searched: true,
      query,
      provider: "open-meteo",
      hits: [],
      notes: [
        "Open-Meteo could not resolve this location. RivalSearch is not used for weather.",
      ],
      block:
        `Live weather lookup failed for "${place || query}". ` +
        `Could not geocode that place via Open-Meteo. ` +
        `Ask the user to restate the city (and state/country), e.g. "Las Vegas, Nevada" or "Tokyo, Japan". ` +
        `Do not invent temperatures. Do not claim weather for a different country.`,
    };
  }

  // 1) PRIMARY — RivalSearchMCP (local, free, multi-engine) — non-weather only
  const rival = await searchRivalSearch(query, {
    mode: NEWS_SHAPED.test(query) ? "auto" : "auto",
    timeoutMs: 50_000,
  });
  if (rival?.hits.length) {
    const prefix = "Primary live source: RivalSearchMCP.";
    return {
      ...rival,
      notes: [...(rival.notes || []), ...notes],
      block: notes.length
        ? `${notes.join(" · ")}\n\n${prefix}\n\n${rival.block}`
        : `${prefix}\n\n${rival.block}`,
    };
  }
  if (getRivalSearchLastError()) {
    notes.push(`RivalSearch unavailable (${getRivalSearchLastError()})`);
  } else {
    notes.push("RivalSearch returned no hits");
  }

  // 2) Optional paid secondary
  const tavily = await searchTavily(query);
  if (tavily?.hits.length) {
    if (notes.length) {
      tavily.block = `${notes.join(" · ")}\n\n${tavily.block}`;
      tavily.notes = notes;
    }
    return tavily;
  }
  if (tavilyLastError === "quota_exceeded") {
    notes.push("Tavily quota exceeded");
  } else if (tavilyLastError && tavilyLastError !== "no_key") {
    notes.push(`Tavily unavailable (${tavilyLastError})`);
  }

  // 3) Parallel free last-resort sources
  const free = await Promise.all([
    searchGoogleNews(query),
    searchHeadlineFeeds(query),
    searchDuckDuckGo(query),
    searchDuckDuckGoHtml(query),
    searchWikipedia(query),
  ]);

  const mergedHits: LiveSearchHit[] = [];
  const providers: string[] = [];
  for (const r of free) {
    if (r?.hits?.length) {
      providers.push(r.provider || "free");
      mergedHits.push(...r.hits);
    }
  }

  const merged = pack(
    query,
    providers.length ? providers.join("+") : "none",
    mergedHits,
    notes,
  );
  if (merged) {
    if (notes.length) {
      merged.block = `${notes.join(" · ")}\n\n${merged.block}`;
    }
    return merged;
  }

  return {
    searched: true,
    query,
    provider: "none",
    hits: [],
    notes,
    block:
      hitsToBlock(query, "none", []) +
      (notes.length ? `\n(${notes.join("; ")})` : ""),
  };
}
