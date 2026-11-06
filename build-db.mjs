// Builds prompts.json from Wikidata (answers) + Wikipedia pageviews (rarity).
//   node scripts/build-db.mjs                       -> writes ./prompts.json
//   node scripts/build-db.mjs --find "musical instrument"   -> look up Wikidata QIDs
// Needs Node 18+ (built-in fetch). No dependencies.
import { writeFile } from "node:fs/promises";

// Wikimedia requires a descriptive User-Agent. Put your own contact here.
const UA = "PixelAscent/1.0 (angeloguerridobusiness@gmail.com)";
const MAX_PER_CATEGORY = 600;   // keep the most-linked N items per category
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
  { q: "Name a planet, moon or dwarf planet", where: "{ ?item wdt:P31 wd:Q634 } UNION { ?item wdt:P31 wd:Q2907 } UNION { ?item wdt:P31/wdt:P279* wd:Q2537 }." },
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

const i = process.argv.indexOf("--find");
if (i > -1) await find(process.argv.slice(i + 1).join(" "));
else await build();
