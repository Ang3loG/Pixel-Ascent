// Builds prompts.json from Wikidata (answers) + Wikipedia pageviews (rarity).
//   node scripts/build-db.mjs                       -> writes ./prompts.json
//   node scripts/build-db.mjs --find "musical instrument"   -> look up Wikidata QIDs
// Needs Node 18+ (built-in fetch). No dependencies.
import { writeFile } from "node:fs/promises";

// Wikimedia requires a descriptive User-Agent. Put your own contact here.
const UA = "PixelAscent/1.0 (angeloguerridobusiness@gmail.com)";
const MAX_PER_CATEGORY = 200;   // keep the most-linked N items per category
const CONCURRENCY = 8;

// QIDs marked VERIFY are from memory: confirm with `npm run find -- "<name>"`.
const CATS = [
  { q: "Name a musical instrument",      where: "?item wdt:P31/wdt:P279* wd:Q34379." },
  { q: "Name a programming language",    where: "?item wdt:P31/wdt:P279* wd:Q9143." },
  { q: "Name a country in Africa",       where: "?item wdt:P31 wd:Q3624078; wdt:P30 wd:Q15." },
  // board game Q131436, card game Q142714 (VERIFY)
  { q: "Name a board or card game",      where: "{ ?item wdt:P31/wdt:P279* wd:Q131436 } UNION { ?item wdt:P31/wdt:P279* wd:Q142714 }." },
  // dinosaur genera = genus under Dinosauria (Q430), excluding birds (Aves, Q5113)
  { q: "Name a dinosaur",                where: "?item wdt:P105 wd:Q34740; wdt:P171+ wd:Q430. MINUS { ?item wdt:P171+ wd:Q5113 }." },
  // planet Q634, dwarf planet Q2907 (VERIFY), natural satellite Q2537 (VERIFY)
  { q: "Name a planet, moon or dwarf planet", where: "{ ?item wdt:P31 wd:Q634 } UNION { ?item wdt:P31 wd:Q2199 } UNION { ?item wdt:P31/wdt:P279* wd:Q2537 }." },
  // fruit (Q1364), capital city (Q5119), sport (Q349) (VERIFY with --find)
  { q: "Name a fruit",                  where: "?item wdt:P31/wdt:P279* wd:Q1364." },
  { q: "Name a capital city",           where: "?item wdt:P31/wdt:P279* wd:Q5119." },
  { q: "Name a sport",                  where: "?item wdt:P31/wdt:P279* wd:Q349." },
  // --- added: 26 more categories. QIDs from memory, check with --find if a category says no rows ---
  { q: "Name a video game", where: "?item wdt:P31/wdt:P279* wd:Q7889." },
  { q: "Name a film", where: "?item wdt:P31/wdt:P279* wd:Q11424." },
  { q: "Name a book", where: "?item wdt:P31/wdt:P279* wd:Q571." },
  { q: "Name a TV show", where: "?item wdt:P31/wdt:P279* wd:Q5398426." },
  { q: "Name a band", where: "?item wdt:P31/wdt:P279* wd:Q215380." },
  { q: "Name an album", where: "?item wdt:P31/wdt:P279* wd:Q482994." },
  { q: "Name a song", where: "?item wdt:P31/wdt:P279* wd:Q7366." },
  { q: "Name a painting", where: "?item wdt:P31/wdt:P279* wd:Q3305213." },
  { q: "Name a mountain", where: "?item wdt:P31/wdt:P279* wd:Q8502." },
  { q: "Name a river", where: "?item wdt:P31/wdt:P279* wd:Q4022." },
  { q: "Name a bird", where: "?item wdt:P31/wdt:P279* wd:Q5113." },
  { q: "Name a mammal", where: "?item wdt:P31/wdt:P279* wd:Q7377." },
  { q: "Name a vegetable", where: "?item wdt:P31/wdt:P279* wd:Q11004." },
  { q: "Name a cheese", where: "?item wdt:P31/wdt:P279* wd:Q10943." },
  { q: "Name a car model", where: "?item wdt:P31/wdt:P279* wd:Q1420." },
  { q: "Name an aircraft", where: "?item wdt:P31/wdt:P279* wd:Q11436." },
  { q: "Name a ship", where: "?item wdt:P31/wdt:P279* wd:Q11446." },
  { q: "Name a disease", where: "?item wdt:P31/wdt:P279* wd:Q12136." },
  { q: "Name a chemical element", where: "?item wdt:P31/wdt:P279* wd:Q11344." },
  { q: "Name a museum", where: "?item wdt:P31/wdt:P279* wd:Q33506." },
  { q: "Name a bridge", where: "?item wdt:P31/wdt:P279* wd:Q12280." },
  { q: "Name a city", where: "?item wdt:P31/wdt:P279* wd:Q515." },
  { q: "Name a country in Europe", where: "?item wdt:P31 wd:Q6256; wdt:P30 wd:Q46." },
  { q: "Name a country in Asia", where: "?item wdt:P31 wd:Q6256; wdt:P30 wd:Q48." },
  { q: "Name a country in South America", where: "?item wdt:P31 wd:Q6256; wdt:P30 wd:Q18." },
  { q: "Name a US state", where: "?item wdt:P31/wdt:P279* wd:Q35657." },
  // --- added for categories. QIDs from memory: VERIFY with --find ---
  { q: "Name a computer company",     where: "?item wdt:P31/wdt:P279* wd:Q18388277." },
  { q: "Name a superhero",             where: "?item wdt:P31/wdt:P279* wd:Q188784." },
  { q: "Name a comic book character",  where: "?item wdt:P31/wdt:P279* wd:Q1114461." },
  // --- more category questions (QIDs from memory: check any 'no rows' with --find) ---
  { q: "Name a music genre", where: "?item wdt:P31/wdt:P279* wd:Q188451." },
  { q: "Name a record label", where: "?item wdt:P31/wdt:P279* wd:Q18127." },
  { q: "Name a film franchise", where: "?item wdt:P31/wdt:P279* wd:Q196600." },
  { q: "Name a film genre", where: "?item wdt:P31/wdt:P279* wd:Q201658." },
  { q: "Name a film studio", where: "?item wdt:P31/wdt:P279* wd:Q1762059." },
  { q: "Name an operating system", where: "?item wdt:P31/wdt:P279* wd:Q9135." },
  { q: "Name a web browser", where: "?item wdt:P31/wdt:P279* wd:Q6368." },
  { q: "Name a social media platform", where: "?item wdt:P31/wdt:P279* wd:Q3220391." },
  { q: "Name a video game console", where: "?item wdt:P31/wdt:P279* wd:Q8076." },
  { q: "Name a search engine", where: "?item wdt:P31/wdt:P279* wd:Q4182287." },
  { q: "Name a Pokémon", where: "?item wdt:P31/wdt:P279* wd:Q3966183." },
  { q: "Name an anime", where: "?item wdt:P31/wdt:P279* wd:Q63952888." },
  { q: "Name a toy", where: "?item wdt:P31/wdt:P279* wd:Q11422." },
  // --- 36 more so every category has 15 (direct 'instance of' only to avoid timeouts; QIDs from memory, run --verify) ---
  { q: "Name an opera", where: "?item wdt:P31 wd:Q1344." },
  { q: "Name a stage musical", where: "?item wdt:P31 wd:Q2743." },
  { q: "Name a symphony", where: "?item wdt:P31 wd:Q9734." },
  { q: "Name a music festival", where: "?item wdt:P31 wd:Q868557." },
  { q: "Name a concert hall", where: "?item wdt:P31 wd:Q1060829." },
  { q: "Name a music video", where: "?item wdt:P31 wd:Q193977." },
  { q: "Name a rock band", where: "?item wdt:P31 wd:Q5741069." },
  { q: "Name an orchestra", where: "?item wdt:P31 wd:Q42998." },
  { q: "Name a national anthem", where: "?item wdt:P31 wd:Q23691." },
  { q: "Name an animated film", where: "?item wdt:P31 wd:Q202866." },
  { q: "Name a documentary", where: "?item wdt:P31 wd:Q93204." },
  { q: "Name a sitcom", where: "?item wdt:P31 wd:Q170238." },
  { q: "Name a film festival", where: "?item wdt:P31 wd:Q220505." },
  { q: "Name a movie theater", where: "?item wdt:P31 wd:Q41253." },
  { q: "Name a horror film", where: "?item wdt:P31 wd:Q200092." },
  { q: "Name a sci-fi film", where: "?item wdt:P31 wd:Q471839." },
  { q: "Name a TV channel", where: "?item wdt:P31 wd:Q2001305." },
  { q: "Name a miniseries", where: "?item wdt:P31 wd:Q1259759." },
  { q: "Name a comedy film", where: "?item wdt:P31 wd:Q157443." },
  { q: "Name a smartphone", where: "?item wdt:P31 wd:Q22645." },
  { q: "Name a game engine", where: "?item wdt:P31 wd:Q193564." },
  { q: "Name a Linux distro", where: "?item wdt:P31 wd:Q131669." },
  { q: "Name a file format", where: "?item wdt:P31 wd:Q235557." },
  { q: "Name a robot", where: "?item wdt:P31 wd:Q11012." },
  { q: "Name a spacecraft", where: "?item wdt:P31 wd:Q40218." },
  { q: "Name a website", where: "?item wdt:P31 wd:Q35127." },
  { q: "Name a mobile app", where: "?item wdt:P31 wd:Q620615." },
  { q: "Name a manga", where: "?item wdt:P31 wd:Q21198342." },
  { q: "Name a video game character", where: "?item wdt:P31 wd:Q1569167." },
  { q: "Name a cartoon", where: "?item wdt:P31 wd:Q581714." },
  { q: "Name a theme park", where: "?item wdt:P31 wd:Q2416723." },
  { q: "Name a meme", where: "?item wdt:P31 wd:Q2927074." },
  { q: "Name a video game series", where: "?item wdt:P31 wd:Q7058673." },
  { q: "Name a magazine", where: "?item wdt:P31 wd:Q41298." },
  { q: "Name a fictional universe", where: "?item wdt:P31 wd:Q559618." },
  { q: "Name a roller coaster", where: "?item wdt:P31 wd:Q204832." },
];

const headers = { "User-Agent": UA, Accept: "application/json" };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJSON(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { headers });
    if (res.ok) return res.json();
    if (res.status === 404) return null;
    await sleep(1500 * (i + 1));
  }
  return null;
}

async function find(term) {
  const u = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(term)}&language=en&format=json&limit=8`;
  const j = await getJSON(u);
  for (const r of j?.search ?? []) console.log(r.id, "-", r.label, "-", r.description ?? "");
}

function sparql(where) {
  return `SELECT ?item ?label ?title ?sl (GROUP_CONCAT(DISTINCT ?alt; separator="|") AS ?alts) WHERE {
  ${where}
  ?item wikibase:sitelinks ?sl .
  ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?title .
  ?item rdfs:label ?label . FILTER(LANG(?label) = "en")
  OPTIONAL { ?item skos:altLabel ?alt . FILTER(LANG(?alt) = "en") }
} GROUP BY ?item ?label ?title ?sl ORDER BY DESC(?sl) LIMIT ${MAX_PER_CATEGORY}`;
}

const d = new Date();
const fmtD = x => `${x.getUTCFullYear()}${String(x.getUTCMonth() + 1).padStart(2, "0")}0100`;
const END = fmtD(d), START = fmtD(new Date(Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), 1)));

async function views(title) {
  const t = encodeURIComponent(title.replace(/ /g, "_"));
  const j = await getJSON(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${t}/monthly/${START}/${END}`);
  return (j?.items ?? []).reduce((s, x) => s + x.views, 0);
}

async function pool(items, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

// Rank 0 = most popular. Tier cutoffs shrink for small categories.
function tierOf(rank, n) {
  const cuts = [Math.min(12, n * .15), Math.min(40, n * .4), Math.min(120, n * .7), Math.min(300, n * .9)];
  const i = cuts.findIndex(c => rank < c);
  return i === -1 ? 4 : i;
}

async function build() {
  const prompts = [];
  for (const cat of CATS) {
    console.log("Querying:", cat.q);
    const j = await getJSON("https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(sparql(cat.where)));
    let rows = (j?.results?.bindings ?? []).map(b => ({
      label: b.label.value, title: b.title.value,
      alts: (b.alts?.value || "").split("|").filter(Boolean),
    })).filter(r => !/^Q\d+$/.test(r.label) && r.label.length <= 40);
    if (!rows.length) { console.warn("  no rows (check QIDs / query timeout), skipping"); continue; }
    console.log("  fetching pageviews for", rows.length, "items");
    const v = await pool(rows, r => views(r.title));
    rows.forEach((r, i) => r.v = v[i]);
    rows.sort((a, b) => b.v - a.v);
    const items = rows.map((r, rank) => {
      const al = [...new Set([r.title, ...r.alts])].filter(x => x !== r.label).slice(0, 6);
      return [r.label, tierOf(rank, rows.length), al];
    });
    prompts.push({ q: cat.q, items });
  }
  if (!prompts.length) throw new Error("Nothing built; keeping old prompts.json");
  await writeFile("prompts.json", JSON.stringify(prompts));
  console.log("Wrote prompts.json with", prompts.length, "categories");
}

async function verify() {
  const seen = new Map();
  for (const c of CATS) for (const id of c.where.match(/Q\d+/g) || []) { if (!seen.has(id)) seen.set(id, []); seen.get(id).push(c.q); }
  const ids = [...seen.keys()];
  for (let k = 0; k < ids.length; k += 50) {
    const batch = ids.slice(k, k + 50);
    const j = await getJSON(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${batch.join("|")}&props=labels&languages=en&format=json`);
    for (const id of batch) console.log(id.padEnd(12), String(j?.entities?.[id]?.labels?.en?.value ?? "??? NOT FOUND").padEnd(34), "<-", seen.get(id).join(", "));
  }
}

const i = process.argv.indexOf("--find");
if (process.argv.includes("--verify")) await verify();
else if (i > -1) await find(process.argv.slice(i + 1).join(" "));
else await build();
