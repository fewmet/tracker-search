/*
  Tracker Search - a standalone app for searching artists' Google Sheet trackers.

  It reads the sheets itself (artists.json says which ones) and serves the app
  in /public. It does not need Tracker Player and shares nothing with it.

    npm install
    npm start          ->  http://localhost:3000

  Optional environment: PORT, GOOGLE_API_KEY (reads hidden hyperlinks through
  the Sheets API; without it the public page view of each sheet is used).
*/
const express = require("express");

const fetch = require("node-fetch");

const { parse } = require("csv-parse/sync");

const crypto = require("crypto");

const fs = require("fs");

const path = require("path");

const os = require("os");

const app = express();

// the page is ~350KB of text and a big tracker's song list runs past a megabyte;
// gzip cuts both to a fraction. Audio is already compressed and is left alone.
try {
  app.use(require("compression")());
} catch (err) {
  console.warn("[startup] 'compression' is not installed - responses go out uncompressed (run npm install)");
}

const PORT = process.env.PORT || 3000;

/*
  Adding a tracker:
    1. Add an entry below with the sheet id and one line per tab.
    2. Each tab's gid is the gid= number in the address bar when that tab is open.
    3. "theme" picks the palette in index.html ("green" for Yeat, "mono" for Carti).
*/
const BUILT_IN_ARTISTS = {
  yeat: {
    key: "yeat",
    name: "Yeat",
    theme: "green",
    sheetId: "1FUzAZyTCgFTVxQ--qbCAS2bUk4dsAw6ASxwjURPHbyI",
    sections: {
      unreleased: { name: "Unreleased", gid: "1241081326" },
      recent: { name: "Recent", gid: "1823522157" },
      bestof: { name: "Best Of", gid: "2101310376" },
      special: { name: "Special", gid: "559352580" },
      grails: { name: "Grails", gid: "993561083" }
    }
  },

  carti: {
    key: "carti",
    name: "Playboi Carti",
    theme: "mono",
    sheetId: "1Irtfvymu26CShYowLMMfD-rM0o9CJqE6-BBSlYsAaF4",
    artGid: "487023460",
    sections: {
      unreleased: { name: "Unreleased", gid: "0" },
      recent: { name: "Recent", gid: "1962169030" },
      bestof: { name: "Best Of", gid: "334149012" },
      special: { name: "Special", gid: "2032692991" },
      grails: { name: "Grails", gid: "2131545997" }
    }
  },

  uzi: {
    key: "uzi",
    name: "Lil Uzi Vert",
    theme: "violet",
    sheetId: "1zqqdIds1iwnx4lh29iF1IlraeuqfGhxH9qLNlWOnryo",
    artGid: "135971633",
    sections: {
      unreleased: { name: "Unreleased", gid: "1160569231" },
      recent: { name: "Recent", gid: "1339726772" },
      bestof: { name: "Best Of", gid: "751366210" },
      special: { name: "Special", gid: "1744365588" },
      grails: { name: "Grails", gid: "1521065182" }
    }
  },

  ken: {
    key: "ken",
    name: "Ken Carson",
    theme: "crimson",
    sheetId: "1OARID98xCqRaBr8gyQCvI3aD4jKQDGgtedyRaiP_pyo",
    artGid: "1908257498",
    sections: {
      unreleased: { name: "Unreleased", gid: "1367980602" },
      recent: { name: "Recent", gid: "907300840" },
      // NOTE: "grails & wanted" was given the same gid as "best of & special",
      // so only one tab is wired up. Send the real grails gid to add it.
      bestof: { name: "Best Of & Special", gid: "210493594" }
    }
  },

  thug: {
    key: "thug",
    name: "Young Thug",
    theme: "amber",
    sheetId: "12zc2reK5y8XP6SQhv1ujQtiG9VpJy7yDWwDuE-S-wpc",
    artGid: "171524654",
    sections: {
      unreleased: { name: "Unreleased", gid: "0" },
      recent: { name: "Recent", gid: "1507357362" },
      highlights: { name: "Highlights", gid: "1816766111" }
    }
  },

  future: {
    key: "future",
    name: "Future",
    theme: "ice",
    sheetId: "1WrsgBEo5pv1eFC8ge6kG-FmSV6eZd_N_9t5HCNir7mk",
    // art lives on samply.app, not a sheet tab, so there is nothing to scrape
    artGid: null,
    sections: {
      unreleased: { name: "Unreleased", gid: "610753461" },
      recent: { name: "Recent", gid: "1932564138" },
      bestof: { name: "Best Of / Special", gid: "1016812416" },
      grails: { name: "Grails / Wanted", gid: "1017030528" }
    }
  },

  kanye: {
    key: "kanye",
    name: "Kanye West",
    theme: "sand",
    sheetId: "12nGHPPh5dVTfLuBLVQYzC3QgPxKfvp-jgCoNccvEasM",
    artGid: "1659647236",
    sections: {
      unreleased: { name: "Unreleased", gid: "199908479" },
      recent: { name: "Recent", gid: "1385926980" },
      bestof: { name: "Best Of", gid: "787540803" },
      special: { name: "Special", gid: "812818104" },
      grails: { name: "Grails / Wanted", gid: "1948929917" }
    }
  },

  juicewrld: {
    key: "juicewrld",
    name: "Juice WRLD",
    theme: "indigo",
    sheetId: "1tD3ytt5wPx4zfcefXi5ATeYhIiDaugWjMS46nZrP568",
    artGid: "973925715",
    sections: {
      unreleased: { name: "Unreleased", gid: "0" },
      recent: { name: "Recent", gid: "1558109614" },
      bestof: { name: "Best Of & Special", gid: "1026508737" },
      grails: { name: "Grails & Wanted", gid: "1176245952" }
    }
  },

  lucki: {
    key: "lucki",
    name: "Lucki",
    theme: "rose",
    sheetId: "1zoRNpy7Lvr-JzPqtQLLWRVVDbgKygpBaDf4cC-Lt6k4",
    artGid: null,
    sections: {
      unreleased: { name: "Unreleased", gid: "306146520" },
      recent: { name: "Recent", gid: "1422898255" },
      bestof: { name: "Best Of", gid: "607457161" },
      special: { name: "Special", gid: "659893300" },
      grails: { name: "Grails", gid: "168366243" }
    }
  },

  summrs: {
    key: "summrs",
    name: "Summrs",
    theme: "aqua",
    sheetId: "13yCSXxHCBhNGzO6kBGr_MMmRDNLu9j4X10vn_CSBuG4",
    artGid: null,
    sections: {
      unreleased: { name: "Unreleased", gid: "306146520" },
      recent: { name: "Recent", gid: "1422898255" },
      bestof: { name: "Best Of", gid: "607457161" },
      special: { name: "Special", gid: "100948374" },
      grails: { name: "Grails / Wanted", gid: "168366243" }
    }
  },

  yachty: {
    key: "yachty",
    name: "Lil Yachty",
    theme: "magenta",
    sheetId: "122UuKwiKLuoP36tr8r4WTjOouy2gDJGRUDXCc4uD9lw",
    artGid: "1815328837",
    sections: {
      unreleased: { name: "Unreleased", gid: "0" },
      recent: { name: "Recent", gid: "1441697998" },
      bestof: { name: "Best Of", gid: "381712014" },
      special: { name: "Special", gid: "1228414875" },
      grails: { name: "Grails / Wanted", gid: "1248999078" }
    }
  },

  lonely: {
    key: "lonely",
    name: "Destroy Lonely",
    theme: "copper",
    sheetId: "1J16EyxHqZD4m0VZ6g6SoY_1GC21TU7P2kk9FeteSKvE",
    artGid: null,
    sections: {
      unreleased: { name: "Unreleased", gid: "2018221909" },
      recent: { name: "Recent", gid: "1413127973" },
      bestof: { name: "Best Of", gid: "739259521" },
      special: { name: "Special", gid: "956556872" },
      grails: { name: "Grails", gid: "1350969358" }
    }
  }
};

const BUILT_IN_DEFAULT_ARTIST = "yeat";

/*
  The order trackers are listed in. Anyone can drag this into their own order in
  the player, which is remembered on their device; this is just the starting
  point. A tracker that is not in this list still shows up - it goes on the end.
*/
const BUILT_IN_ORDER = [
  "yeat", "uzi", "carti", "ken", "lonely", "kanye",
  "thug", "juicewrld", "future", "lucki", "summrs", "yachty"
];

/*
  Trackers live in artists.json when that file is present, so adding one is a
  data change rather than a code change - that is what the tracker editor writes.
  Without the file the built-in list above is used, so nothing breaks if it is
  missing or unreadable.

  The file looks like:
    {
      "defaultArtist": "yeat",
      "order": ["yeat", "uzi", ...],
      "artists": [
        {
          "key": "yeat",
          "name": "Yeat",
          "accent": "#4ce364",          // or "theme": "green" for a built-in one
          "sheetId": "1FUz...",
          "artGid": null,
          "sections": [ { "key": "unreleased", "name": "Unreleased", "gid": "0" } ]
        }
      ]
    }
*/
const ARTISTS_FILE = path.join(__dirname, "artists.json");

let ARTISTS = BUILT_IN_ARTISTS;

let DEFAULT_ARTIST_KEY = BUILT_IN_DEFAULT_ARTIST;

let ARTIST_ORDER = BUILT_IN_ORDER;

let artistsFileMtime = 0;

function normaliseArtistEntry(entry) {
  if (!entry || typeof entry !== "object") return null;

  const key = String(entry.key || "").trim().toLowerCase();
  const name = String(entry.name || "").trim();
  const sheetId = String(entry.sheetId || "").trim();

  if (!key || !name || !sheetId) return null;

  // sections may be an array (what the editor writes) or an object (as in code)
  const sections = {};
  const list = Array.isArray(entry.sections)
    ? entry.sections
    : Object.entries(entry.sections || {}).map(([sectionKey, section]) =>
        Object.assign({ key: sectionKey }, section));

  list.forEach((section, index) => {
    if (!section) return;

    const sectionKey = String(section.key || `section${index + 1}`).trim().toLowerCase();
    const gid = String(section.gid == null ? "" : section.gid).trim();

    if (!sectionKey || gid === "") return;

    sections[sectionKey] = { name: String(section.name || sectionKey).trim(), gid };
  });

  if (!Object.keys(sections).length) return null;

  const artist = { key, name, sheetId, sections };

  /*
    A tracker that runs its own site instead of Google Sheets sets "site". The
    gids stay exactly as they are - the mirror publishes each tab under the same
    number - so only where the rows are fetched from changes.
  */
  if (entry.site) artist.site = String(entry.site).trim().replace(/\/+$/, "");

  /*
    Trackers are kept by hand by people who deserve the credit. A string or a
    list both read as one line of names under the tracker in the picker.
  */
  const credits = Array.isArray(entry.credits) ? entry.credits.join(", ") : entry.credits;
  if (credits) artist.credits = String(credits).replace(/\s+/g, " ").trim();

  artist.artGid = entry.artGid ? String(entry.artGid).trim() : null;
  if (entry.theme) artist.theme = String(entry.theme).trim();
  if (entry.accent) artist.accent = String(entry.accent).trim();
  if (!artist.theme && !artist.accent) artist.theme = "green";

  return artist;
}

function loadArtistsFile() {
  try {
    if (!fs.existsSync(ARTISTS_FILE)) return false;

    const stat = fs.statSync(ARTISTS_FILE);
    if (stat.mtimeMs === artistsFileMtime) return true;   // already loaded

    const data = JSON.parse(fs.readFileSync(ARTISTS_FILE, "utf8"));
    const entries = (Array.isArray(data.artists) ? data.artists : [])
      .map(normaliseArtistEntry)
      .filter(Boolean);

    if (!entries.length) {
      console.warn("[artists] artists.json has no usable trackers - keeping the built-in list");
      return false;
    }

    const map = {};
    entries.forEach(artist => { map[artist.key] = artist; });

    ARTISTS = map;
    ARTIST_ORDER = Array.isArray(data.order) && data.order.length
      ? data.order.map(key => String(key).toLowerCase())
      : entries.map(artist => artist.key);
    DEFAULT_ARTIST_KEY = map[String(data.defaultArtist || "").toLowerCase()]
      ? String(data.defaultArtist).toLowerCase()
      : entries[0].key;

    artistsFileMtime = stat.mtimeMs;
    console.log(`[artists] loaded ${entries.length} trackers from artists.json`);
    return true;
  } catch (err) {
    console.error("[artists] artists.json could not be read, using the built-in list:", err.message || err);
    return false;
  }
}

loadArtistsFile();

function orderedArtists() {
  const listed = ARTIST_ORDER.filter(key => ARTISTS[key]).map(key => ARTISTS[key]);
  const rest = Object.values(ARTISTS).filter(artist => !ARTIST_ORDER.includes(artist.key));

  return listed.concat(rest);
}

function getArtist(artistKey, custom) {
  loadArtistsFile();   // pick up edits to artists.json without a restart

  if (custom) {
    const own = parseCustomArtist(artistKey, custom);
    if (own) return own;
  }

  return ARTISTS[String(artistKey || DEFAULT_ARTIST_KEY).toLowerCase()] || ARTISTS[DEFAULT_ARTIST_KEY];
}

/*
  Custom trackers. Someone can add their own tracker in the player; it lives
  in their browser (and their account), and every request for it carries its
  settings as ?custom=<base64url JSON>. Only a Google Sheets id and tab
  numbers are accepted, so the server never fetches anything but a sheet.
*/
const CUSTOM_KEY = /^c_[a-z0-9]{4,24}$/;

const SHEET_ID = /^[A-Za-z0-9_-]{20,100}$/;

function parseCustomArtist(artistKey, custom) {
  try {
    const key = String(artistKey || "").toLowerCase();
    if (!CUSTOM_KEY.test(key)) return null;

    const raw = String(custom);
    if (raw.length > 4000) return null;

    const data = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    const sheetId = String(data.sheetId || "");
    if (!SHEET_ID.test(sheetId)) return null;

    const sections = (Array.isArray(data.sections) ? data.sections : [])
      .slice(0, 20)
      .filter(section => section && /^\d{1,12}$/.test(String(section.gid)))
      .map((section, index) => ({
        key: String(section.key || `tab${index + 1}`).toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40) || `tab${index + 1}`,
        name: String(section.name || `Tab ${index + 1}`).slice(0, 60),
        gid: String(section.gid)
      }));

    if (!sections.length) sections.push({ key: "tab1", name: "Tab 1", gid: "0" });

    const artist = normaliseArtistEntry({
      key,
      name: String(data.name || "My tracker").slice(0, 60),
      sheetId,
      sections
    });

    if (artist) {
      artist.artGid = null;     // custom trackers have no art tab
      artist.custom = true;
    }
    return artist;
  } catch (err) {
    return null;
  }
}

function getSection(artist, sectionKey) {
  const sections = artist.sections;
  const keys = Object.keys(sections);
  const wanted = String(sectionKey || "").toLowerCase();

  return sections[wanted] || sections[keys[0]];
}

/*
  Use the gviz endpoint rather than /export?format=csv. Several trackers
  (Lil Uzi Vert for one) answer 401 to an anonymous /export request, which is
  what Render makes - gviz serves the same data with no sign-in. headers=0
  stops gviz collapsing the first rows into a header line.
*/
function getSheetCsvUrl(artist, section) {
  return `https://docs.google.com/spreadsheets/d/${artist.sheetId}/gviz/tq?tqx=out:csv&gid=${section.gid}&headers=0`;
}

function getArtCsvUrl(artist) {
  return `https://docs.google.com/spreadsheets/d/${artist.sheetId}/gviz/tq?tqx=out:csv&gid=${artist.artGid}&headers=0`;
}

function getSheetEditUrl(artist, section) {
  if (artist.site) return `${artist.site}/edit?gid=${artist.sheetId}#gid=${section.gid}`;
  return `https://docs.google.com/spreadsheets/d/${artist.sheetId}/edit?gid=${section.gid}`;
}

/*
  Some trackers are not on Google Sheets at all. Tyler, The Creator's lives at
  tylertracker.net, which serves each tab as the HTML Google itself publishes -
  a plain <table>, one <tr> per row. That is better than a CSV export, because
  the anchors survive: a cover art cell that only holds a hyperlink reads
  straight off the page with no API key involved.
*/
function getMirrorSheetUrl(artist, gid) {
  return `${artist.site}/preview/sheet/${gid}.html`;
}

const HTML_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", "#160": " "
};

function decodeHtml(text) {
  return String(text || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code) => {
    const key = code.toLowerCase();
    if (HTML_ENTITIES[key]) return HTML_ENTITIES[key];

    if (key[0] === "#") {
      const number = key[1] === "x" ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
      if (Number.isFinite(number)) return String.fromCodePoint(number);
    }

    return whole;
  });
}

function cellText(html) {
  return decodeHtml(
    String(html || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div)>/gi, "\n")
      .replace(/<[^>]*>/g, "")
  ).replace(/ /g, " ").trim();
}

/*
  Reads the published table into the same shape the Sheets API gives us: the
  cell text in `rows`, and whatever each cell links to in `linkRows`, so
  everything downstream cannot tell the two sources apart. Merged cells carry a
  colspan, and the leading <th> is the row number Google prints down the side.
*/
// Google's own page view wraps every link as google.com/url?q=<the real link>
function unwrapGoogleRedirect(href) {
  const wrapped = /^https?:\/\/(?:www\.)?google\.com\/url\?/i.test(href);
  if (!wrapped) return href;

  try {
    return new URL(href).searchParams.get("q") || href;
  } catch (err) {
    return href;
  }
}

function parseSheetHtml(html) {
  /*
    Google does not always send a tab as one table. A long one arrives as a run
    of "grid-chunk" tables of about two hundred rows each - and not every time,
    which made this look random. Reading only the first table, as this used to,
    cut a 2,200-row tab off after row 200: every era heading below that lost its
    picture. So everything from the first table to the last is read as one.
  */
  const text = String(html || "");
  const start = text.search(/<table\b/i);
  const end = text.toLowerCase().lastIndexOf("</table>");
  if (start < 0 || end < start) return { rows: [], linkRows: [], imageRows: [] };

  const table = [text.slice(start, end + 8)];

  const rows = [];
  const linkRows = [];
  const imageRows = [];
  const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let row;

  while ((row = rowPattern.exec(table[0]))) {
    const cells = [];
    const links = [];
    const cellPattern = /<t([dh])\b([^>]*)>([\s\S]*?)<\/t\1>/gi;
    let cell;

    while ((cell = cellPattern.exec(row[1]))) {
      if (cell[1].toLowerCase() === "h") continue;   // Google's row-number gutter

      const span = cell[2].match(/\bcolspan\s*=\s*["']?(\d+)/i);
      const width = Math.min(span ? Number(span[1]) : 1, 50);
      const text = cellText(cell[3]);

      // a cell can hold several links; keep them all, the way a CSV cell would
      const hrefs = (cell[3].match(/<a\b[^>]*\bhref\s*=\s*["'][^"']+["']/gi) || [])
        .map(tag => unwrapGoogleRedirect(decodeHtml(tag.match(/href\s*=\s*["']([^"']+)["']/i)[1])));

      cells.push(text);
      // matching the Sheets API: the link a cell points at, or its text
      links.push(hrefs.length ? hrefs.join(" ") : text);

      // a merged cell stands in for the columns it swallowed
      for (let i = 1; i < width; i++) { cells.push(""); links.push(""); }
    }

    if (cells.length) {
      rows.push(cells);
      linkRows.push(links);
      // an image sitting IN a cell, which no CSV export can show us
      imageRows.push(pickRowImage(row[1]));
    }
  }

  return { rows, linkRows, imageRows };
}

/*
  A heading row can hold more than one picture. Future's tracker puts the era's
  logo in the name cell (a wide banner, "=w400-h109") and the actual cover a few
  cells over (square, "=w110-h109"). Taking the first image grabbed the logo, so
  the squarest one wins - covers are square, logos and banners are not.
*/
function pickRowImage(rowHtml) {
  const found = [];
  const pattern = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
  let match;

  while ((match = pattern.exec(rowHtml))) found.push(decodeHtml(match[1]));
  if (found.length <= 1) return found[0] || "";

  const squareness = url => {
    const size = String(url).match(/=w(\d+)-h(\d+)/i);
    if (!size) return 1;
    const w = Number(size[1]);
    const h = Number(size[2]);
    return w && h ? Math.min(w, h) / Math.max(w, h) : 0;
  };

  let best = found[0];
  found.forEach(url => { if (squareness(url) > squareness(best) + 0.05) best = url; });
  return best;
}

async function fetchMirrorGrid(artist, gid) {
  const response = await fetch(getMirrorSheetUrl(artist, gid));
  if (!response.ok) throw new Error(`${artist.site} answered ${response.status}`);

  return parseSheetHtml(await response.text());
}

app.get("/artists", (req, res) => {
  loadArtistsFile();   // pick up edits to artists.json without a restart

  res.json({
    defaultArtist: DEFAULT_ARTIST_KEY,
    artists: orderedArtists().map(artist => ({
      key: artist.key,
      name: artist.name,
      theme: artist.theme,
      accent: artist.accent || null,
      credits: artist.credits || "",
      sections: Object.entries(artist.sections).map(([key, section]) => ({ key, name: section.name, gid: section.gid }))
    }))
  });
});

/*
  Artist photos for the tracker picker.

  A hand-made artist-pics.json always wins, so a bad or unwanted photo can be
  replaced. Anything it doesn't cover is looked up once on Deezer's open search
  API, which returns a stable CDN image per artist. If neither turns anything
  up the player falls back to the letter it already showed, so this can only
  ever add to what is there.
*/
const artistPhotoCache = { at: 0, photos: null };

const ARTIST_PHOTO_TTL_MS = 12 * 60 * 60 * 1000;

function flattenName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

async function lookupArtistPhoto(name) {
  const url = `https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=5`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });

  if (!res.ok) throw new Error(`Deezer returned ${res.status}`);

  const data = await res.json();
  const wanted = flattenName(name);

  // only accept a result whose name really is this artist - a loose search can
  // easily hand back a tribute act or a soundalike
  const match = (data.data || []).find(entry => {
    const found = flattenName(entry.name);
    return found === wanted || found === wanted.replace(/^lil/, "") || wanted === found.replace(/^lil/, "");
  });

  if (!match) return null;

  const candidates = [match.picture_xl, match.picture_big, match.picture_medium, match.picture];
  return candidates.find(isUsablePicture) || null;
}

/*
  Deezer hands back a picture URL even for an artist it has no photo of - the
  image id is simply empty, giving ".../images/artist//1000x1000-...jpg", which
  loads as a grey silhouette or not at all. Treat those as no photo so the
  player falls back to the letter instead of showing a blank circle.
*/
function isUsablePicture(url) {
  const value = String(url || "").trim();

  if (!/^https?:\/\//i.test(value)) return false;
  if (/\/images\/[a-z]*\/\//i.test(value)) return false;   // empty image id

  return true;
}

function readArtistPicsFile() {
  try {
    const file = path.join(__dirname, "artist-pics.json");
    if (!fs.existsSync(file)) return {};

    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return data.photos || data.covers || data || {};
  } catch (err) {
    console.warn("[artist-pics] could not read artist-pics.json:", err.message || err);
    return {};
  }
}

app.get("/artist-pics", async (req, res) => {
  if (artistPhotoCache.photos && Date.now() - artistPhotoCache.at < ARTIST_PHOTO_TTL_MS) {
    return res.json({ photos: artistPhotoCache.photos, cached: true });
  }

  const manual = readArtistPicsFile();
  const photos = {};
  const artists = Object.values(ARTISTS);

  await mapWithLimit(artists, 4, async artist => {
    const chosen = String(manual[artist.key] || "").trim();

    if (chosen) {
      photos[artist.key] = chosen;
      return;
    }

    try {
      const found = await lookupArtistPhoto(artist.name);
      if (found) photos[artist.key] = found;
    } catch (err) {
      console.warn(`[artist-pics] lookup failed for ${artist.name}:`, err.message || err);
    }
  });

  artistPhotoCache.at = Date.now();
  artistPhotoCache.photos = photos;

  const missing = artists.filter(artist => !photos[artist.key]).map(artist => artist.key);

  console.log(
    `[artist-pics] ${Object.keys(photos).length}/${artists.length} artists have a photo` +
    (missing.length ? ` — no photo for: ${missing.join(", ")} (add them to artist-pics.json)` : "")
  );

  res.json({ photos, missing });
});

function getPillowsId(link) {
  if (!link) return null;

  const match = link.match(/[a-f0-9]{32}/i);
  return match ? match[0] : null;
}

function getImgurId(link) {
  if (!link) return null;

  // page link: https://imgur.gg/f/PKnLvOM   direct: https://i.imgur.gg/PKnLvOM-Cake.mp3
  const page = link.match(/imgur\.gg\/f\/([A-Za-z0-9]+)/i);
  if (page) return page[1];

  const direct = link.match(/i\.imgur\.gg\/([A-Za-z0-9]+)-/i);
  return direct ? direct[1] : null;
}

function getExoshareId(link) {
  if (!link) return null;
  const m = link.match(/exoshare\.org\/(?:share|s)\/([A-Za-z0-9_-]+)/i);
  return m ? m[1] : null;
}

// a cell can also hold the "copy link" API url, which points at one exact file
function getExoshareFile(link) {
  if (!link) return null;
  const m = String(link).match(/exoshare\.org\/api\/shares\/([A-Za-z0-9_-]+)\/files\/([A-Za-z0-9-]+)/i);
  return m ? { shareId: m[1], fileId: m[2] } : null;
}

function getPixeldrainId(link) {
  if (!link) return null;
  const m = link.match(/pixeldrain\.com\/(?:u|api\/file)\/([A-Za-z0-9]+)/i);
  return m ? m[1] : null;
}

/*
  Google Drive.

  A tracker cell holds the ordinary share link - drive.google.com/file/d/<id>/view
  - which is a web page, not audio. Only the file id matters: everything else in
  a "download link" copied out of the browser (confirm, uuid, at, authuser) is a
  short-lived token tied to that session, so those are deliberately ignored and
  the id is rebuilt into a stable address instead.
*/
function getDriveId(link) {
  if (!link) return null;

  const text = String(link);
  if (!/(?:drive\.google\.com|drive\.usercontent\.google\.com)/i.test(text)) return null;

  // a folder is not a file, and a Sheet/Doc/Slide is not audio
  if (/\/drive\/folders\//i.test(text)) return null;
  if (/\/(spreadsheets|document|presentation|forms)\//i.test(text)) return null;

  const patterns = [
    /\/file\/d\/([A-Za-z0-9_-]{10,})/i,        // /file/d/<id>/view
    /\/d\/([A-Za-z0-9_-]{10,})/i,              // /d/<id>
    /[?&]id=([A-Za-z0-9_-]{10,})/i             // ?id=<id>  (uc, open, usercontent)
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) return match[1];
  }

  return null;
}

function getPlayableLink(link) {
  const pillowsId = getPillowsId(link);
  if (pillowsId) return `/stream/${pillowsId}`;

  const driveId = getDriveId(link);
  if (driveId) return `/drive/${driveId}`;

  const exoshareFile = getExoshareFile(link);
  if (exoshareFile) return `/exoshare/${exoshareFile.shareId}/${exoshareFile.fileId}`;

  const exoshareId = getExoshareId(link);
  if (exoshareId) return `/exoshare/${exoshareId}`;

  const pixeldrainId = getPixeldrainId(link);
  if (pixeldrainId) return `/pixeldrain/${pixeldrainId}`;

  const imgurId = getImgurId(link);

  if (imgurId) {
    // if the cell already holds the direct file, remember it so the file page
    // never has to be fetched for this one
    if (/i\.imgur\.gg\//i.test(link) && !imgurMediaCache.has(imgurId)) {
      const direct = findImgurMediaUrl(link, imgurId);
      if (direct) imgurMediaCache.set(imgurId, direct);
    }

    return `/imgur/${imgurId}`;
  }

  // a plain file on a host we trust, in a format that needs converting, is
  // routed through the server so ffmpeg can get at it
  const direct = directFileLink(link);
  if (CONVERT_EXT.test(direct) && isDirectFileHost(direct)) {
    return `/convert?u=${encodeURIComponent(direct)}`;
  }

  return direct;
}

const MEDIA_EXT = /\.(mp3|m4a|m4b|aac|alac|wav|flac|ogg|oga|opus|aiff?|wma|mp4|mov|webm|caf)(\?|#|$)/i;

const CONVERT_EXT = /\.(m4a|m4b|aac|alac|aiff?|wma|mp4|mov|caf)(\?|#|$)/i;

/*
  Hosts that hand over the file itself at the address in the tracker. Only these
  may be fetched through /convert - it takes an address from the query string,
  and a server that fetches any address it is given is a hole. Add more with
  DIRECT_FILE_HOSTS=host1,host2 in the environment.
*/
const DIRECT_FILE_HOSTS = [
  "archive.org", "catbox.moe", "bleed.bot", "fileditchfiles.me",
  "cdn.discordapp.com", "media.discordapp.net", "i.imgur.gg",
  ...String(process.env.DIRECT_FILE_HOSTS || "").split(",").map(h => h.trim().toLowerCase()).filter(Boolean)
];

function isDirectFileHost(link) {
  try {
    const url = new URL(link);
    if (!/^https?:$/.test(url.protocol)) return false;

    const host = url.hostname.toLowerCase();
    return DIRECT_FILE_HOSTS.some(allowed => host === allowed || host.endsWith("." + allowed));
  } catch (err) {
    return false;
  }
}

// archive.org's /details/<item>/<file> is a web page about the file;
// /download/<item>/<file> is the file
function directFileLink(link) {
  // the page address writes a space in the file name as "+"; the file address
  // wants it as %20 and answers 404 otherwise
  return String(link || "").replace(
    /^(https?:\/\/(?:www\.)?archive\.org)\/details\/([^/?#]+\/[^?#]+)/i,
    (whole, site, rest) => `${site}/download/${rest.replace(/\+/g, "%20")}`);
}

/*
  Whether a link is something that can be played at all. Trackers put all sorts
  in the link column - news articles, tweets, mega.nz folders, image pages - and
  every one of those used to be offered as a song, fail three times, and skip.
  A link counts if it is on a host the player knows how to stream, on a host
  that serves plain files, or simply ends in an audio file's extension.
*/
function looksPlayable(link) {
  if (getPlayableLink(link) !== link) return true;
  if (MEDIA_EXT.test(link)) return true;

  // archive.org is mostly item pages and Wayback snapshots; only its actual
  // files (caught by the extension above) are worth offering
  return isDirectFileHost(link) && !/archive\.org/i.test(link);
}

/*
  Hosts the player can't stream from - either they have shut down, or they only
  hand out a download page rather than a playable file. Links to them count as
  missing, so the tracker's alternate-link column is used instead and a song
  with no other link drops out of the list entirely.
*/
const DEAD_HOSTS = [
  /music\.froste\.lol/i,
  /krakenfiles\.com/i
];

function isValidSongLink(link) {
  const cleanLink = (link || "").toLowerCase().trim();

  if (DEAD_HOSTS.some(host => host.test(cleanLink))) return false;

  return (
    cleanLink &&
    cleanLink !== "n/a" &&
    cleanLink !== "link needed" &&
    cleanLink !== "none" &&
    cleanLink !== "-" &&
    cleanLink.startsWith("http")
  );
}

/*
  A link cell often holds more than one address - especially on Released tabs,
  where a song might list Spotify, Apple Music and a direct file side by side.
  Those services stream through their own players and hand a proxy a web page,
  not audio, so they are never chosen. A song whose only links are streaming
  services is marked instead of guessed at.
*/
const STREAMING_HOSTS = [
  /(^|\.)spotify\.com/i,
  /(^|\.)soundcloud\.com/i,
  /(^|\.)snd\.sc/i,
  /music\.apple\.com/i,
  /itunes\.apple\.com/i,
  /(^|\.)youtube\.com/i,
  /(^|\.)youtu\.be/i,
  /(^|\.)tidal\.com/i,
  /(^|\.)deezer\.com/i,
  /(^|\.)audiomack\.com/i,
  /(^|\.)bandcamp\.com/i,
  /music\.amazon\./i,
  /(^|\.)pandora\.com/i,
  /(^|\.)napster\.com/i,
  /(^|\.)iheart\.com/i,
  /(^|\.)audius\.co/i,
  /(^|\.)datpiff\.com/i,
  /(^|\.)genius\.com/i,
  /(^|\.)last\.fm/i,
  // not streaming services, but just as unplayable: social posts, smart links
  // and articles that trackers cite as a source for a song
  /(^|\.)lnk\.to$/i,
  /(^|\.)linktr\.ee$/i,
  /(^|\.)twitter\.com$/i,
  /(^|\.)x\.com$/i,
  /(^|\.)tiktok\.com$/i,
  /(^|\.)instagram\.com$/i,
  /(^|\.)facebook\.com$/i,
  /(^|\.)twitch\.tv$/i,
  /(^|\.)vimeo\.com$/i,
  // pictures
  /^i\.ibb\.co$/i,
  /(^|\.)redd\.it$/i,
  /^pbs\.twimg\.com$/i,
  /^i\.imgur\.com$/i
];

const IMAGE_LINK = /\.(jpe?g|png|webp|gif|avif|bmp)(\?|#|$)/i;

/*
  These patterns describe a host name, so they are tested against the host name.
  They used to be run over the whole address, where "(^|\.)soundcloud\.com" can
  never match "https://soundcloud.com/..." - the name follows "//", not a dot or
  the start. Hundreds of SoundCloud, YouTube and Tidal pages were getting into
  the song list that way, and each one cost three failed loads before skipping.
*/
function isStreamingLink(link) {
  const text = String(link || "").trim();
  let host = text;

  try {
    host = new URL(text).hostname;
  } catch (err) {
    // not a full address - test the text as it is
  }

  return STREAMING_HOSTS.some(pattern => pattern.test(host)) || IMAGE_LINK.test(text);
}

// a cell can hold several addresses separated by spaces, newlines or commas
function extractLinks(cell) {
  const matches = String(cell || "").match(/https?:\/\/[^\s,;|]+/gi) || [];

  return matches
    .map(link => link.replace(/[)\]}.,;]+$/, ""))   // trailing punctuation
    .filter(Boolean);
}

/*
  Pick what the player should actually try to play, preferring in order:
  a host we know how to stream, then any other direct link, and only then
  admitting that all we have is a streaming-service page.
*/
function pickSongLink(cells) {
  const candidates = [];

  cells.forEach(cell => {
    extractLinks(cell).forEach(link => {
      if (!candidates.includes(link)) candidates.push(link);
    });
  });

  const usable = candidates.filter(link =>
    isValidSongLink(link) && !isStreamingLink(link) && looksPlayable(link));
  const known = usable.find(link => getPlayableLink(link) !== link);

  if (known) return { link: known, streamingOnly: false };
  if (usable.length) return { link: usable[0], streamingOnly: false };

  // nothing playable - keep a link so the row still points somewhere
  const streaming = candidates.find(isStreamingLink) ||
    candidates.find(link => isValidSongLink(link) && !looksPlayable(link));
  if (streaming) return { link: streaming, streamingOnly: true };

  return { link: candidates[0] || "", streamingOnly: false };
}

function columnNumberToLetter(columnNumber) {
  let letter = "";

  while (columnNumber > 0) {
    const remainder = (columnNumber - 1) % 26;
    letter = String.fromCharCode(65 + remainder) + letter;
    columnNumber = Math.floor((columnNumber - 1) / 26);
  }

  return letter;
}

function getHeaderIndex(headers, headerName) {
  return headers.findIndex(header => String(header || "").trim() === headerName);
}

/*
  Every tracker names its columns slightly differently, and some put a banner
  row above the headers. Match on normalised aliases instead of exact text.
*/
function normaliseHeader(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const COLUMN_ALIASES = {
  // Released tabs label it "Rel. Era" - the era a song was released in
  era: ["era", "rel. era", "rel era", "release era", "released era"],
  name: ["name", "song", "song name", "title", "track"],
  notes: ["notes"],
  length: ["track length", "length", "song length"],
  type: ["type"],
  quality: ["quality"],
  // trackers are hand-made, so the misspellings of "availability" are as real
  // as the correct one - Destroy Lonely's tab says "Availablitity"
  availableLength: [
    "available length", "available type", "availability", "portion", "available",
    "availablitity", "availabilty", "availablity", "availibility"
  ],
  // "source" is last on purpose: a sheet with both Links and Source uses Links
  link: ["link(s)", "links", "link", "main link", "song link", "download", "source"],
  altLink: ["alternate links", "alternate link", "alt links", "alt link", "alternate", "backup link", "backup links"],
  cover: ["cover", "cover art"],
  // Released tabs say where a song can be streamed; "Lost" means it is
  // gone from streaming and nobody has a file either
  streaming: ["streaming", "streaming?", "on streaming", "streaming service", "streaming services"],
  // art tabs put the artwork under all sorts of headings - Lil Yachty's calls
  // it "Image" while others use "Link(s)"
  artImage: ["image", "images", "art", "artwork", "cover", "cover art", "picture", "img"]
};

/*
  The song title column. "track" is one of its aliases, and a loose prefix match
  on it lands on "Track Length" - which is how Playboi Carti's songs ended up
  titled "0:25". Carti's title column also has no heading at all, so when nothing
  is named for it, the blank-headed column right after the era column is used.
*/
function findNameColumn(headers) {
  const flat = headers.map(normaliseHeader);
  const aliases = COLUMN_ALIASES.name;
  const lengthAliases = COLUMN_ALIASES.length;

  for (const alias of aliases) {
    const exact = flat.indexOf(alias);
    if (exact >= 0) return exact;
  }

  for (const alias of aliases) {
    const prefixed = flat.findIndex(header =>
      header.startsWith(alias) && !lengthAliases.some(len => header.startsWith(len)));
    if (prefixed >= 0) return prefixed;
  }

  const era = findColumn(headers, "era");
  if (era >= 0 && flat[era + 1] === "" && flat.slice(era + 2).some(Boolean)) return era + 1;

  return -1;
}

function findColumn(headers, key) {
  if (key === "name") return findNameColumn(headers);

  const aliases = COLUMN_ALIASES[key] || [];
  const flat = headers.map(normaliseHeader);

  for (const alias of aliases) {
    const exact = flat.indexOf(alias);
    if (exact >= 0) return exact;
  }

  for (const alias of aliases) {
    // "Main Link\n(exoshare.org)" -> starts with "main link"
    const prefixed = flat.findIndex(header => header.startsWith(alias));
    if (prefixed >= 0) return prefixed;
  }

  return -1;
}

// the header row is not always row 0 - some sheets open with a banner
const HEADER_HINTS = ["name", "link", "quality", "type", "availableLength", "length", "notes"];

function findHeaderRow(rows) {
  const limit = Math.min(rows.length, 12);

  // best case: a row that names its era column and several others
  for (let i = 0; i < limit; i++) {
    const flat = (rows[i] || []).map(normaliseHeader);
    if (!flat.includes("era")) continue;

    if (HEADER_HINTS.filter(key => findColumn(rows[i], key) >= 0).length >= 2) return i;
  }

  /*
    Not every tracker labels that column "Era" - Gunna's is headed "." - so fall
    back to a row that clearly names several other columns even though the era
    column has no usable name.
  */
  for (let i = 0; i < limit; i++) {
    if (HEADER_HINTS.filter(key => findColumn(rows[i], key) >= 0).length >= 3) return i;
  }

  return 0;
}

/*
  Which column holds the era. Every one of these trackers keeps it first, so when
  the header does not name it, the first column is used - unless something else
  has already claimed it.
*/
function findEraColumn(headers, claimed) {
  const named = findColumn(headers, "era");
  if (named >= 0) return named;

  return claimed.includes(0) ? -1 : 0;
}

/*
  Some trackers (Ken Carson, Juice WRLD) store song links as Google Sheets
  hyperlinks - the cell shows "Download" and the URL lives in the link. No
  public export exposes those, so a CSV read sees only the word "Download".

  With a GOOGLE_API_KEY set in the environment, the Sheets API returns the
  hyperlink per cell and those trackers work. Without one, this returns null
  and the CSV path is used as before.
*/
const sheetTitleCache = new Map();

async function getSheetTitle(sheetId, gid, apiKey) {
  const cacheKey = `${sheetId}:${gid}`;
  if (sheetTitleCache.has(cacheKey)) return sheetTitleCache.get(cacheKey);

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties(sheetId,title)&key=${apiKey}`;
  const res = await fetch(url);

  if (!res.ok) throw new Error(`Sheets API metadata ${res.status}`);

  const data = await res.json();
  const match = (data.sheets || []).find(sheet => String(sheet.properties.sheetId) === String(gid));
  const title = match ? match.properties.title : null;

  sheetTitleCache.set(cacheKey, title);
  return title;
}

async function fetchGridWithLinks(sheetId, gid) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) return null;

  const title = await getSheetTitle(sheetId, gid, apiKey);
  if (!title) return null;

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}` +
    `?includeGridData=true&ranges=${encodeURIComponent(`'${title.replace(/'/g, "''")}'`)}` +
    `&fields=sheets(data(rowData(values(formattedValue,hyperlink))))&key=${apiKey}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sheets API grid ${res.status}`);

  const data = await res.json();
  const rowData = ((((data.sheets || [])[0] || {}).data || [])[0] || {}).rowData || [];

  const rows = [];
  const linkRows = [];

  rowData.forEach(row => {
    const values = row.values || [];
    rows.push(values.map(cell => (cell && cell.formattedValue) || ""));
    linkRows.push(values.map(cell => (cell && (cell.hyperlink || cell.formattedValue)) || ""));
  });

  return { rows, linkRows };
}

/*
  Trackers write dates the way people write them - "Apr 23, 2023", "September
  20, 2018", the occasional "2023-04-23". We keep the text as typed to show next
  to the song, and pull the year out of it for ordering eras.
*/
const MONTH_NUMBERS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
};

const TEXT_DATE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i;

const ISO_DATE = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/;

const SLASH_DATE = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/;

const YEAR_ONLY = /^\s*(19\d{2}|20[0-4]\d)\s*$/;

function parseDateCell(value) {
  const text = String(value || "").trim();
  if (!text || text.length > 40) return null;

  let match = text.match(TEXT_DATE);
  if (match) {
    const year = Number(match[3]);
    const month = MONTH_NUMBERS[match[1].toLowerCase().slice(0, 3)];
    return { text, year, time: Date.UTC(year, month, Number(match[2])) };
  }

  match = text.match(ISO_DATE);
  if (match) {
    const year = Number(match[1]);
    return { text, year, time: Date.UTC(year, Number(match[2]) - 1, Number(match[3])) };
  }

  match = text.match(SLASH_DATE);
  if (match) {
    const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
    return { text, year, time: Date.UTC(year, Number(match[1]) - 1, Number(match[2])) };
  }

  match = text.match(YEAR_ONLY);
  if (match) {
    const year = Number(match[1]);
    return { text, year, time: Date.UTC(year, 0, 1) };
  }

  return null;
}

// in priority order, not column order: a sheet with both "Leak Date" and
// "File Date" should show the file's own date
const DATE_HEADERS = [
  "file date", "date", "dates", "leak date", "leaked", "leak", "first preview",
  "preview date", "preview", "release date", "released on", "surfaced", "first available"
];

/*
  Yeat's sheet writes the date under a heading of its own: "First Preview" holds
  the word ("Leaked") and the unlabelled cell beside it holds "Apr 23, 2023". So
  a heading match is only a starting point - we take the first column near it
  that genuinely reads as dates, and failing that the column that looks most
  like dates on its own.
*/
/*
  A recording date is when the song was made, not when the file turned up, and
  reading it as the file's date throws era ordering out: Edward Skeletrix's
  Unreleased tab has both, and the recording column holds bare years that sort
  every era to the 1st of January.
*/
const DATE_HEADER_SKIP = /recording|recorded|written|session/i;

function findDateColumn(headers, rows, exclude = []) {
  const width = rows.reduce((most, row) => Math.max(most, row.length), headers.length);
  const flat = headers.map(normaliseHeader);
  const blocked = new Set(exclude.filter(index => index >= 0));

  const hits = index => {
    if (blocked.has(index)) return 0;
    return rows.reduce((count, row) => count + (parseDateCell(row[index]) ? 1 : 0), 0);
  };

  for (const heading of DATE_HEADERS) {
    for (let i = 0; i < flat.length; i++) {
      if (DATE_HEADER_SKIP.test(flat[i])) continue;
      if (flat[i] !== heading && !flat[i].startsWith(heading)) continue;

      for (const at of [i, i + 1, i + 2]) {
        if (at < width && hits(at) >= 3) return at;
      }
    }
  }

  let best = -1;
  let bestHits = Math.max(5, Math.round(rows.length * 0.15));

  for (let i = 0; i < width; i++) {
    const count = hits(i);
    if (count > bestHits) { best = i; bestHits = count; }
  }

  return best;
}

/*
  Every era opens with a block header - the era's name in the Name column and
  the year beside it as "℗ 2018 YEAT". There is no song on that row, so it is
  the one place an era's year is actually written down.
*/
function collectEraYears(dataRows, nameIndex, linkIndex) {
  const years = new Map();
  if (nameIndex < 0) return years;

  dataRows.forEach(row => {
    // a row with a file behind it is a song, not the header that opens an era
    if (linkIndex >= 0 && String(row[linkIndex] || "").trim()) return;

    const cell = String(row[nameIndex] || "").trim();
    if (!cell) return;

    const era = cell.split("\n")[0].trim();
    if (!era || years.has(era)) return;

    const stamped = cell.match(/[℗©]\s*(\d{4})/);
    if (stamped) { years.set(era, Number(stamped[1])); return; }

    // Tyler's tracker opens an era with its span instead - "(2004 - 2012)".
    // A range is specific enough to trust; a lone date in the notes is not,
    // since those are usually about the artist rather than the era.
    const spanned = row.join(" ").match(/\((19\d{2}|20\d{2})\s*[-–—]\s*(?:19\d{2}|20\d{2}|present)\)/i);
    if (spanned) years.set(era, Number(spanned[1]));
  });

  return years;
}

/*
  Some tabs are just songs, with no row saying which column is which. Every
  tracker lays its columns out the same way - era, name, notes, then the details
  - and the details are recognisable by what is in them: a link column is full
  of addresses, a length column of "3:12"s, and so on. This builds the heading
  row such a tab is missing, or returns null if it cannot even find the links.
*/
function inferHeaderRow(rows, linkRows) {
  const width = rows.reduce((most, row) => Math.max(most, row.length), 0);
  if (width < 3 || rows.length < 2) return null;

  const share = (grid, index, pattern) => {
    let filled = 0;
    let hits = 0;

    grid.forEach(row => {
      const cell = String(row[index] || "").trim();
      if (!cell) return;
      filled++;
      if (pattern.test(cell)) hits++;
    });

    return filled >= 3 ? hits / filled : 0;
  };

  const best = (grid, pattern, taken, least = 0.5) => {
    let at = -1;
    let top = least;

    for (let i = 0; i < width; i++) {
      if (taken.has(i)) continue;
      const score = share(grid, i, pattern);
      if (score > top) { at = i; top = score; }
    }

    return at;
  };

  const taken = new Set([0, 1]);
  const link = best(linkRows, /^https?:\/\//i, taken, 0.3);
  if (link < 0) return null;
  taken.add(link);

  const header = new Array(width).fill("");
  header[0] = "Era";
  header[1] = "Name";
  header[link] = "Link(s)";

  const place = (label, pattern) => {
    const at = best(rows, pattern, taken);
    if (at >= 0) { header[at] = label; taken.add(at); }
  };

  place("Quality", /^(cd quality|high quality|low quality|lossless|recording|not available)$/i);
  place("Available Length", /^(full|snippet|partial|og file|tagged|beat only|confirmed|rumored|stem bounce|unavailable)$/i);
  place("Track Length", /^\d{1,2}:\d{2}(:\d{2})?$/);

  if (!taken.has(2)) header[2] = "Notes";

  return header;
}

async function loadSongs(artist, section) {
  {
    let allRows;
    let linkRows;

    try {
      // a mirror site publishes the table itself, links and all
      const grid = artist.site
        ? await fetchMirrorGrid(artist, section.gid)
        : await fetchGridWithLinks(artist.sheetId, section.gid);

      if (grid && grid.rows.length) {
        allRows = grid.rows;
        linkRows = grid.linkRows;
      }
    } catch (err) {
      console.warn(`[songs] grid failed for ${artist.key}/${section.name}:`, err.message || err);
    }

    if (!allRows && artist.site) {
      throw new Error(`${artist.name}: could not read ${getMirrorSheetUrl(artist, section.gid)}`);
    }

    /*
      Without an API key the tab used to be read as a CSV, and that export is
      lossy in two ways. It drops hyperlinks, so trackers whose link cells just
      say "Download" came back empty. Worse, it guesses a type for every column:
      Yeat's eras include "530", "1500" and "2093", so it decided the Era column
      was numeric and blanked every era that is a word - 1,967 of 2,222 rows -
      leaving nearly the whole tracker with no era and so no cover art.

      Google's own page view of the sheet has neither problem, and it is the
      same page the era artwork is read from, so the songs and the covers are
      now guaranteed to agree on what each era is called. The CSV is only the
      fallback if that page cannot be read.
    */
    const hasHeader = rows => {
      const header = rows[findHeaderRow(rows)] || [];
      return findColumn(header, "name") >= 0 && findColumn(header, "link") >= 0;
    };

    let pageGrid = null;

    if (!allRows) {
      try {
        pageGrid = await readSheetTab(artist, section.gid);

        if (hasHeader(pageGrid.rows)) {
          allRows = pageGrid.rows;
          linkRows = pageGrid.linkRows;
        }
      } catch (err) {
        console.warn(`[songs] ${artist.key}/${section.name}: page view failed, using the CSV:`, err.message || err);
      }
    }

    if (!allRows) {
      const response = await fetch(getSheetCsvUrl(artist, section));

      // a private or missing sheet answers with an error page; parsing that as
      // CSV used to produce a silently empty tracker
      if (!response.ok) {
        throw new Error(`${artist.name}: Google answered ${response.status} for the ${section.name} tab`);
      }

      allRows = parse(await response.text(), {
        skip_empty_lines: true,
        relax_column_count: true
      });
      linkRows = allRows;

      /*
        Some tabs (Best Of, Special, Grails on several trackers) keep their
        column headings in frozen rows that the page view leaves out, so it
        arrives as songs with nothing saying which column is which. The CSV does
        have the headings. When the two line up column for column, the CSV's
        heading row is put on top of the page view's rows - which keeps the
        hidden links and the properly-read eras.
      */
      if (pageGrid && pageGrid.rows.length > 1 && hasHeader(allRows)) {
        const csvHeaderRow = findHeaderRow(allRows);
        const header = allRows[csvHeaderRow];
        const nameAt = findColumn(header, "name");
        const firstLine = value => String(value || "").split("\n")[0].replace(/\s+/g, " ").trim().toLowerCase();

        const inPage = new Set(pageGrid.rows.map(row => firstLine(row[nameAt])).filter(Boolean));
        const sample = allRows.slice(csvHeaderRow + 1).map(row => firstLine(row[nameAt])).filter(Boolean).slice(0, 60);
        const matched = sample.filter(name => inPage.has(name)).length;

        if (sample.length && matched / sample.length >= 0.7) {
          allRows = [header, ...pageGrid.rows];
          linkRows = [header, ...pageGrid.linkRows];
        }
      }
    }

    // a tab with no heading row at all (Lil Yachty's Special and Grails, a few
    // of XXXTENTACION's and Radiohead's) gets one worked out from its contents
    if (!hasHeader(allRows)) {
      const inferred = inferHeaderRow(allRows, linkRows);

      if (inferred) {
        allRows = [inferred, ...allRows];
        linkRows = [inferred, ...linkRows];
        console.log(`[songs] ${artist.key}/${section.name}: no heading row, columns worked out from the contents`);
      }
    }

    const headerRow = findHeaderRow(allRows);
    const headers = allRows[headerRow] || [];
    const dataRows = allRows.slice(headerRow + 1);

    const nameIndex = findColumn(headers, "name");
    const notesIndex = findColumn(headers, "notes");
    const lengthIndex = findColumn(headers, "length");
    const typeIndex = findColumn(headers, "type");
    const qualityIndex = findColumn(headers, "quality");
    const availableLengthIndex = findColumn(headers, "availableLength");
    const linkIndex = findColumn(headers, "link");
    const altLinkIndex = findColumn(headers, "altLink");
    const coverIndex = findColumn(headers, "cover");
    const streamingIndex = findColumn(headers, "streaming");

    // worked out last, so it can fall back to the first column only if nothing
    // else is using it
    const eraIndex = findEraColumn(headers, [
      nameIndex, notesIndex, lengthIndex, typeIndex,
      qualityIndex, availableLengthIndex, linkIndex, altLinkIndex, coverIndex,
      streamingIndex
    ]);

    if (eraIndex < 0) {
      console.warn(`[songs] ${artist.key}/${section.name}: no era column found in`, headers.map(normaliseHeader));
    }

    if (linkIndex < 0) {
      console.warn(`[songs] ${artist.key}/${section.name}: no link column found in`, headers.map(normaliseHeader));
    }

    // Notes is full of dates that belong to the story, not to the file
    const dateIndex = findDateColumn(headers, dataRows, [
      eraIndex, nameIndex, notesIndex, lengthIndex, linkIndex, altLinkIndex, coverIndex
    ]);

    const eraYears = collectEraYears(dataRows, nameIndex, linkIndex);

    /*
      Radiohead's tracker writes an indicator in the Era column - "Transitional
      Period" - for songs that sit under the HIATUS heading above them. The
      heading is the era; the column is just a note. So where a song's era is a
      word no heading uses, the heading it sits under is taken instead.

      Only headings that open a block are trusted for this: they carry the era's
      running tally ("2 Full, 0 Tagged...") in the era column. Trackers with no
      such headings, or whose era column is already right, are left alone.
    */
    const ERA_TALLY = /\d+\s*(og file|full|tagged|partial|snippet|unavailable|stem)/i;

    const eraHeaders = [];
    const headerNames = new Set();

    if (nameIndex >= 0) {
      dataRows.forEach((row, index) => {
        if (linkIndex >= 0 && String(row[linkIndex] || "").trim()) return;
        if (!String(row[nameIndex] || "").trim()) return;
        if (!ERA_TALLY.test(eraIndex >= 0 ? String(row[eraIndex] || "") : "")) return;

        const names = eraNamesInCell(row[nameIndex]);
        if (!names.length) return;

        eraHeaders.push({ index, era: names[0] });
        names.forEach(name => headerNames.add(looseEraKey(name)));
      });
    }

    function eraHeadingAbove(index) {
      let found = "";
      for (const heading of eraHeaders) {
        if (heading.index > index) break;
        found = heading.era;
      }
      return found;
    }

    if (eraHeaders.length) {
      console.log(`[songs] ${artist.key}/${section.name}: ${eraHeaders.length} era headings found`);
    }

    const linkColumnLetter = columnNumberToLetter(linkIndex + 1);

    const mapped = dataRows
      .map((row, index) => {
        const rowNumber = index + headerRow + 2;

        const linkRow = linkRows[index + headerRow + 1] || row;
        const mainLink = linkIndex >= 0 ? linkRow[linkIndex] || "" : "";
        const altLink = altLinkIndex >= 0 ? linkRow[altLinkIndex] || "" : "";

        // either cell can hold several links; take the best playable one and
        // ignore Spotify / Apple Music / SoundCloud and the like
        const picked = pickSongLink([mainLink, altLink]);
        const originalLink = picked.link;

        const id = getPillowsId(originalLink);
        const imgurId = getImgurId(originalLink);
        const dated = dateIndex >= 0 ? parseDateCell(row[dateIndex]) : null;

        let era = eraIndex >= 0 ? row[eraIndex] || "" : "";
        if (eraHeaders.length && era && !headerNames.has(looseEraKey(era))) {
          era = eraHeadingAbove(index) || era;
        }

        // every address the row holds, kept off the song itself (not enumerable)
        // so /songs stays the size it was; Tracker Search reads it
        const rowLinks = [];
        [mainLink, altLink].forEach(cell => extractLinks(cell).forEach(link => {
          if (!rowLinks.includes(link)) rowLinks.push(link);
        }));

        return Object.defineProperties({
          // when the file surfaced, exactly as the tracker wrote it
          date: dated ? dated.text : "",
          dateYear: dated ? dated.year : null,
          dateTime: dated ? dated.time : null,
		  cover: coverIndex >= 0 ? row[coverIndex] || "" : "",
          era,
          name: nameIndex >= 0 ? row[nameIndex] || "" : "",
          notes: notesIndex >= 0 ? row[notesIndex] || "" : "",
          length: lengthIndex >= 0 ? row[lengthIndex] || "" : "",
          type: typeIndex >= 0 ? row[typeIndex] || "" : "",
          quality: qualityIndex >= 0 ? row[qualityIndex] || "" : "",
          availableLength: availableLengthIndex >= 0 ? row[availableLengthIndex] || "" : "",
          originalLink,
          trackerCellLink: `${getSheetEditUrl(artist, section)}&range=${linkColumnLetter}${rowNumber}`,
          section: section.name,
          artist: artist.key,
          artistName: artist.name,
          pillowsId: id,
          imgurId,
          exoshareId: getExoshareId(originalLink),
          pixeldrainId: getPixeldrainId(originalLink),
          // m4a/aac used to be flagged here and hidden; the server now converts
          // them on the fly (see convertedAudio), so nothing is unsupported
          unsupportedFormat: null,
          // every link this song has is a streaming service, so there is no
          // file to play - the client hides it like any other unplayable song
          streamingOnly: picked.streamingOnly,
          // Released tabs record where a song can be streamed; "Lost" means it
          // is off streaming with no file anywhere, so it is dropped entirely
          streamingStatus: streamingIndex >= 0 ? String(row[streamingIndex] || "").trim() : "",
          link: getPlayableLink(originalLink)
        }, {
          rowLinks: { value: rowLinks },
          rowNumber: { value: rowNumber },
          rowIndex: { value: index }
        });
      });

    const isPlayableSong = song =>
        song.name &&
        isValidSongLink(song.originalLink) &&
        song.streamingStatus.toLowerCase() !== "lost" &&
        // every link it has is Spotify, YouTube and the like: nothing to play
        !song.streamingOnly;

    const songs = mapped.filter(isPlayableSong);

    /*
      Tracker Search wants the whole tab, not just what can be played: a song
      nobody has a file for is still something people look up. Era headings and
      banner rows are left out - they name no type, quality, length or link.
    */
    const headingRows = new Set(eraHeaders.map(heading => heading.index));
    const first = value => String(value || "").trim();

    const everything = mapped
      .filter(song =>
        first(song.name) &&
        !headingRows.has(song.rowIndex) &&
        (song.rowLinks.length || first(song.type) || first(song.quality) ||
          first(song.availableLength) || first(song.length)))
      .map(song => ({
        era: first(song.era),
        name: first(song.name),
        notes: first(song.notes),
        length: first(song.length),
        type: first(song.type),
        quality: first(song.quality),
        available: first(song.availableLength),
        date: song.date,
        links: song.rowLinks,
        row: song.rowNumber,
        play: isPlayableSong(song)
      }));

    Object.defineProperty(songs, "everything", { value: everything });

    /*
      An era's year comes from its block header where one is written. Where it
      is not, the earliest song we have for that era is the next best thing, and
      an era simply named after a year speaks for itself.
    */
    const earliest = new Map();
    const earliestTime = new Map();

    songs.forEach(song => {
      if (!song.era) return;

      if (song.dateYear) {
        const held = earliest.get(song.era);
        if (!held || song.dateYear < held) earliest.set(song.era, song.dateYear);
      }

      if (song.dateTime) {
        const held = earliestTime.get(song.era);
        if (!held || song.dateTime < held) earliestTime.set(song.era, song.dateTime);
      }
    });

    songs.forEach(song => {
      const named = String(song.era || "").match(YEAR_ONLY);
      song.eraYear = eraYears.get(song.era) || earliest.get(song.era) ||
        (named ? Number(named[1]) : null);
      // two eras from the same year still have an order between them, and the
      // first file either one has is what settles it
      song.eraTime = earliestTime.get(song.era) || null;
    });

    return songs;
  }
}

/*
  The tabs "All" covers: everything a tracker has that is actually music, which
  means Unreleased plus Released. Best Of, Special and Grails are selections of
  those same songs, so folding them in would just repeat things.
*/
const ALL_SECTION_KEYS = ["unreleased", "released"];

/*
  Some trackers keep music in a tab of their own that is neither of those -
  Edward Skeletrix has "Skeletrix Island Radio 66.7". Those are songs like any
  other, so All takes them too; Best Of, Special and Grails stay out because
  they only re-list songs the other tabs already have.
*/
const ALL_SECTION_SKIP = /^(recent|bestof|special|grails|wanted|highlights|notable|worstof|skeptical|fakes|key)/i;

function isAllSectionKey(key) {
  if (ALL_SECTION_KEYS.includes(key)) return true;
  return !ALL_SECTION_SKIP.test(String(key || "").replace(/[^a-z]/gi, ""));
}

function allSectionsFor(artist) {
  const keys = Object.keys(artist.sections).filter(isAllSectionKey);

  // Unreleased first: it is the tab whose era order everything else lines up to
  const rank = key => (ALL_SECTION_KEYS.indexOf(key) + 1) || 99;
  keys.sort((a, b) => rank(a) - rank(b));

  return keys.map(key => Object.assign({ key }, artist.sections[key]));
}

/*
  Released tabs name their eras differently from Unreleased. The same album is
  "LYFESTYLE" over there and "LYFESTYLE [V2]" here, and part-tapes turn up as
  "2093 (P2)" long after plain "2093". Left alone they all pile up at the bottom
  of the All tab as their own cards, so before returning we rename a Released era
  onto the Unreleased era it is a version of, then slot whatever genuinely is a
  separate release in beside the album it belongs to.
*/

/*
  Reading a tracker means downloading a whole Google Sheet tab, which takes
  anywhere from one to ten seconds - and it used to happen on every single load.
  A tab is now kept for a few minutes. After that it is still handed back
  straight away while a fresh copy is fetched behind it, so only the very first
  load of a tracker after the server starts ever waits on Google.
  /songs?fresh=1 skips the cache.
*/
const SONGS_FRESH_MS = 5 * 60 * 1000;

const SONGS_KEEP_MS = 6 * 60 * 60 * 1000;

const songsCache = new Map();     // key -> { at, songs }

const songsLoading = new Map();   // key -> promise, so two requests share one fetch

function songsCacheKey(artist, section) {
  return [artist.key, artist.sheetId || artist.site || "", section.gid, section.name].join("|");
}

function refreshSongsCache(key, artist, section) {
  if (songsLoading.has(key)) return songsLoading.get(key);

  const loading = loadSongs(artist, section)
    .then(songs => {
      // an empty result is usually Google hiccuping, not an empty tracker
      if (songs.length) songsCache.set(key, { at: Date.now(), songs });

      if (songsCache.size > 400) {
        const cutoff = Date.now() - SONGS_KEEP_MS;
        songsCache.forEach((entry, k) => { if (entry.at < cutoff) songsCache.delete(k); });
      }

      return songs;
    })
    .finally(() => songsLoading.delete(key));

  songsLoading.set(key, loading);
  return loading;
}

async function loadSongsCached(artist, section, fresh = false) {
  const key = songsCacheKey(artist, section);
  const cached = fresh ? null : songsCache.get(key);
  const age = cached ? Date.now() - cached.at : Infinity;

  if (cached && age < SONGS_FRESH_MS) return cached.songs;

  if (cached && age < SONGS_KEEP_MS) {
    refreshSongsCache(key, artist, section).catch(err =>
      console.warn(`[songs] background refresh failed for ${artist.key}/${section.name}:`, err.message || err));
    return cached.songs;
  }

  return refreshSongsCache(key, artist, section);
}

/*
  Tracker Search (search.html): every row of one tab, playable or not, in a
  small shape. It rides on the same cache as /songs, so it costs Google nothing
  extra when the player has already loaded that tab.
*/
/*
  Every tab a tracker has, not just the handful named in artists.json. Google's
  page view of a sheet (and a mirror site's front page) lists each tab with its
  name and number, so that list is read straight off it.
*/
const tabListCache = new Map();   // sheet -> { at, value } or { reading }
const TAB_LIST_TTL_MS = 30 * 60 * 1000;

function unescapeJsString(text) {
  return String(text || "")
    .replace(/\\x([0-9a-f]{2})/gi, (whole, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\u([0-9a-f]{4})/gi, (whole, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\(.)/g, "$1");
}

function listTabs(artist) {
  const url = artist.site
    ? artist.site + "/"
    : "https://docs.google.com/spreadsheets/d/" + artist.sheetId + "/htmlview";
  const held = tabListCache.get(url);

  if (held && held.reading) return held.reading;
  if (held && Date.now() - held.at < TAB_LIST_TTL_MS) return Promise.resolve(held.value);

  const reading = (async () => {
    const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!response.ok) throw new Error("sheet answered " + response.status);

    const html = await response.text();
    const tabs = [];
    const pattern = /items\.push\(\{name: "((?:[^"\\]|\\.)*)"[^}]*?gid: "(\d+)"/g;
    let found;

    while ((found = pattern.exec(html))) {
      const name = unescapeJsString(found[1]).replace(/\s+/g, " ").trim();
      if (!tabs.some(tab => tab.gid === found[2])) tabs.push({ gid: found[2], name: name || "Tab " + (tabs.length + 1) });
    }

    if (!tabs.length) throw new Error("no tabs listed");

    const title = decodeHtml((html.match(/<title>([^<]*)<\/title>/i) || [])[1] || "")
      .replace(/\s*-\s*Google (Sheets|Drive|Docs)\s*$/i, "").trim();

    return { tabs, title };
  })().then(
    value => {
      tabListCache.set(url, { at: Date.now(), value });
      if (tabListCache.size > 300) tabListCache.delete(tabListCache.keys().next().value);
      return value;
    },
    err => { tabListCache.delete(url); throw err; });

  tabListCache.set(url, { reading });
  return reading;
}

app.get("/tabs", async (req, res) => {
  const artist = getArtist(req.query.artist, req.query.custom);

  try {
    const listed = await listTabs(artist);
    res.set("Cache-Control", "public, max-age=300");
    res.json({ artist: artist.key, title: listed.title, tabs: listed.tabs });
  } catch (err) {
    console.warn("[tabs] " + artist.key + ":", err.message || err);
    if (artist.custom) return res.status(502).json({ error: "Could not read that sheet." });

    // the tabs named in artists.json are better than nothing
    res.json({
      artist: artist.key, title: "",
      tabs: Object.values(artist.sections).map(section => ({ gid: section.gid, name: section.name }))
    });
  }
});

/*
  A tab that is not a list of songs - Art, Tattoos, Interviews, Fundraisers and
  so on. Nothing is assumed about its columns: the first row that reads like
  headings names them, a row holding a single cell is a heading for the rows
  under it, and every other row comes back as a title plus its labelled cells.
*/
function genericRows(grid, given) {
  const rows = grid.rows || [];
  const linkRows = grid.linkRows || [];
  const images = grid.imageRows || [];
  const clean = row => (row || []).map(cell => String(cell || "").trim());
  const label = cell => String(cell || "").split("\n")[0].replace(/\s+/g, " ").trim();

  let headers = (given || []).map(label);
  let headerAt = -1;

  // no headings handed in: take the first row that reads like some
  if (!headers.filter(Boolean).length) {
    headers = [];

    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const cells = clean(rows[i]).filter(Boolean);
      const wordy = cells.every(cell => cell.length <= 40 && !/\d/.test(cell));
      if (cells.length >= 2 && wordy && new Set(cells).size === cells.length) { headerAt = i; headers = clean(rows[i]).map(label); break; }
    }
  }

  const width = headers.filter(Boolean).length;
  const headingLine = headers.join("|").toLowerCase();
  const eraColumn = headers.findIndex(text => /^(rel\.? ?)?era$/i.test(text));
  const titleColumn = headers.findIndex(text => /^(name|title|song|track|item|file|video|main content|description)/i.test(text));
  const out = [];
  let group = "";

  for (let i = headerAt + 1; i < rows.length && out.length < 6000; i++) {
    const cells = clean(rows[i]);
    const filled = cells.map((cell, at) => (cell ? at : -1)).filter(at => at >= 0);
    if (!filled.length) continue;

    // the heading row itself, where the page view does show it
    if (width && cells.map(label).join("|").toLowerCase() === headingLine) continue;

    const links = [];
    (linkRows[i] || []).forEach(cell => extractLinks(cell).forEach(link => {
      if (!links.includes(link)) links.push(link);
    }));

    if (filled.length === 1 && width >= 3 && !links.length && !images[i] && cells[filled[0]].length <= 120) {
      group = label(cells[filled[0]]).slice(0, 80);
      continue;
    }

    const afterEra = filled.find(at => at !== eraColumn);
    const titleAt = titleColumn >= 0 && cells[titleColumn] ? titleColumn : afterEra != null ? afterEra : filled[0];

    out.push({
      era: eraColumn >= 0 && cells[eraColumn] && titleAt !== eraColumn ? label(cells[eraColumn]).slice(0, 80) : group,
      name: cells[titleAt].slice(0, 400), notes: "", length: "", type: "", quality: "",
      available: "", date: "", links: links.slice(0, 12), row: 0, play: false, g: 1,
      fields: filled.filter(at => at !== titleAt && at !== eraColumn)
        .map(at => [headers[at] || "", cells[at].slice(0, 3000)])
        .filter(field => !/^https?:\/\/\S+$/.test(field[1])),
      img: images[i] ? i : undefined
    });
  }

  return out;
}

/*
  The page view of a tab leaves out frozen rows, and the column headings are
  nearly always frozen - so the headings come from the CSV export, which has
  them. The CSV is also all there is for a tab the page view cannot draw.
*/
async function readTabCsv(artist, section) {
  if (artist.site) return null;

  try {
    const response = await fetch(getSheetCsvUrl(artist, section), { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!response.ok) return null;

    const rows = parse(await response.text(), { skip_empty_lines: true, relax_column_count: true });
    const headerAt = rows.slice(0, 5).findIndex(row => row.filter(cell => String(cell || "").trim()).length >= 2);

    return { rows, headers: headerAt >= 0 ? rows[headerAt] : [] };
  } catch (err) {
    return null;
  }
}

// the tabs artists.json names are song lists for certain; any other tab is one
// only if its headings say so
async function loadTabRows(artist, section, configured, fresh) {
  let grid = null;

  try {
    grid = await readSheetTab(artist, section.gid);
  } catch (err) {
    // some tabs have no table in the page view; the CSV below may still have them
  }

  let songLike = configured;

  if (!songLike && grid) {
    const header = grid.rows[findHeaderRow(grid.rows)] || [];
    songLike = findColumn(header, "name") >= 0 && findColumn(header, "link") >= 0;
  }

  if (songLike) {
    try {
      const songs = await loadSongsCached(artist, section, fresh);
      if (songs.everything && songs.everything.length) return songs.everything;
    } catch (err) {
      if (!grid) throw err;
    }
  }

  const csv = await readTabCsv(artist, section);
  if (grid) return genericRows(grid, csv ? csv.headers : null);
  if (csv && csv.rows.length) return genericRows({ rows: csv.rows, linkRows: csv.rows, imageRows: [] }, csv.headers);

  throw new Error("could not read the " + section.name + " tab");
}

/*
  The Key tab explains the words a tracker uses - "Snippet", "OG File", "ref."
  and so on. It is not a list of anything, so the app shows it as a glossary
  rather than as a section. The tab is laid out as lists side by side: a word,
  its meaning in the next cell, then the next list's word and meaning. A word
  with nothing beside it is the heading of the list below it.
*/
const KEY_TAB = /(^|[^a-z])key([^a-z]|$)/i;

function keyGroups(rows) {
  const text = cell => String(cell || "").replace(/[ 	]+/g, " ").trim();
  const grid = (rows || []).slice(0, 400).map(row => (row || []).map(text)).filter(row => row.some(Boolean));
  if (!grid.length) return [];

  // the first row is the headings, which says which columns hold the words
  const termColumns = grid[0].map((cell, at) => (cell ? at : -1)).filter(at => at >= 0);
  const isTerm = at => termColumns.includes(at);
  const open = new Map();   // column -> the list currently being filled there
  const groups = [];
  let last = null;

  const start = (column, title) => {
    last = { title, items: [] };
    open.set(column, last);
    groups.push(last);
    return last;
  };

  grid.forEach(cells => {
    const filled = cells.map((cell, at) => (cell ? at : -1)).filter(at => at >= 0);

    // every list's column has a short word and nothing is explained: new headings
    const headings = filled.every(isTerm) && termColumns.every(at => cells[at] && cells[at].length <= 60);
    if (headings) { termColumns.forEach(at => start(at, cells[at])); return; }

    for (let i = 0; i < cells.length; i++) {
      if (!cells[i]) continue;

      if (isTerm(i)) {
        const meaning = !isTerm(i + 1) && cells[i + 1] ? cells[i + 1] : "";
        (open.get(i) || start(i, "")).items.push({ term: cells[i].slice(0, 120), text: meaning.slice(0, 2000) });
        if (meaning) i++;
      } else {
        // a line off on its own is a note about the list it sits under
        const owner = open.get(termColumns.filter(at => at < i).pop()) || last || start(i, "");
        owner.items.push({ term: "", text: cells[i].slice(0, 2000) });
      }
    }
  });

  return groups.filter(group => group.items.length);
}

app.get("/key", async (req, res) => {
  try {
    const artist = getArtist(req.query.artist, req.query.custom);
    let gid = String(req.query.gid || "");

    if (!/^d{1,12}$/.test(gid)) {
      const tab = (await listTabs(artist)).tabs.find(item => KEY_TAB.test(item.name));
      if (!tab) return res.json({ artist: artist.key, groups: [] });
      gid = tab.gid;
    }

    const section = { name: "Key", gid };

    // the CSV has the frozen heading row the page view leaves out
    const csv = await readTabCsv(artist, section);
    let groups = csv ? keyGroups(csv.rows) : [];
    if (!groups.length) groups = keyGroups((await readSheetTab(artist, gid)).rows);

    res.set("Cache-Control", "public, max-age=600");
    res.json({ artist: artist.key, sheet: getSheetEditUrl(artist, section), groups });
  } catch (err) {
    console.warn("[key]", err.message || err);
    res.status(502).json({ error: "Could not read the key." });
  }
});

/*
  Every row of one tab, in a small shape. ?gid= reads any tab of the sheet;
  ?section= still reads one of the tabs named in artists.json.
*/
app.get("/tracker-rows", async (req, res) => {
  try {
    const artist = getArtist(req.query.artist, req.query.custom);
    const gid = String(req.query.gid || "");
    const fresh = Boolean(req.query.fresh);
    let section, rows;

    if (/^\d{1,12}$/.test(gid)) {
      const known = artist.custom ? null : Object.values(artist.sections).find(item => item.gid === gid);
      section = known || { name: String(req.query.name || "Tab").slice(0, 80), gid };
      rows = await loadTabRows(artist, section, Boolean(known), fresh);
    } else {
      section = getSection(artist, req.query.section);
      rows = (await loadSongsCached(artist, section, fresh)).everything || [];
    }

    res.set("Cache-Control", "public, max-age=120");
    res.json({ artist: artist.key, section: section.name, sheet: getSheetEditUrl(artist, section), rows });
  } catch (err) {
    console.error("[tracker-rows]", err.message || err);
    res.status(500).json({ error: "Failed to load tracker." });
  }
});

// the picture sitting in one row of a tab (art, jewelry, tattoos...). Google
// will not let another site load these addresses, so they come through here
app.get("/row-image", async (req, res) => {
  try {
    const artist = getArtist(req.query.artist, req.query.custom);
    const gid = String(req.query.gid || "");
    const index = Number(req.query.i);
    if (!/^\d{1,12}$/.test(gid) || !Number.isInteger(index) || index < 0) return res.status(400).send("Bad request.");

    const grid = await readSheetTab(artist, gid);
    const url = atCoverSize((grid.imageRows || [])[index], artist.site);
    if (!/^https?:\/\//i.test(url)) return res.status(404).send("No picture in that row.");

    const image = await downloadSheetImage(url);
    if (!image) return res.status(404).send("No picture in that row.");

    res.set("Content-Type", image.type);
    res.set("Cache-Control", "public, max-age=86400");
    res.send(image.body);
  } catch (err) {
    res.status(502).send("Could not fetch that picture.");
  }
});

/*
  Each tracker has an "Art" tab listing Era + a link to that era's artwork.
  It is deliberately NOT one of the playable sections - it only feeds cover art.
  Only links a browser can actually render are kept; imgur single-image pages
  are rewritten to their direct form.
*/
const DIRECT_IMAGE_HOST = new RegExp(
  "^https?://(" + [
    "i\\.imgur\\.com",
    "i\\d?\\.sndcdn\\.com",
    "\\d+\\.media\\.tumblr\\.com",
    "static\\.tumblr\\.com",
    "t\\d?\\.genius\\.com",
    "images\\.genius\\.com",
    "is\\d?-ssl\\.mzstatic\\.com",
    "a\\d?\\.mzstatic\\.com",
    "leaked\\.cx",
    "i\\.scdn\\.co",
    "i\\.ibb\\.co",
    "i\\.postimg\\.cc",
    "i\\.redd\\.it",
    "preview\\.redd\\.it",
    "pbs\\.twimg\\.com",
    "upload\\.wikimedia\\.org",
    "m\\.media-amazon\\.com",
    "i\\.discogs\\.com",
    "lastfm\\.freetls\\.fastly\\.net",
    "[\\w.-]*\\.dzcdn\\.net",
    "media\\d?\\.giphy\\.com",
    "lh\\d\\.googleusercontent\\.com",
    "[\\w.-]*\\.archive\\.org"
  ].join("|") + ")/", "i");

// Google's own in-cell image URLs - what "copy link" gives for an image
// pasted into a sheet. These render directly and carry no file extension.
const SHEETS_IMAGE = /^https?:\/\/docs\.google\.com\/sheets-images-rt\//i;

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif)(\?|$)/i;

const IMGUR_SINGLE = /^https?:\/\/imgur\.com\/([A-Za-z0-9]{5,9})(?:[?#].*)?$/i;

function toDirectImage(link) {
  const url = String(link || "").trim();
  if (!/^https?:\/\//.test(url)) return null;

  const single = url.match(IMGUR_SINGLE);
  if (single) return `https://i.imgur.com/${single[1]}.jpeg`;

  if (SHEETS_IMAGE.test(url)) return url;
  if (DIRECT_IMAGE_HOST.test(url) || IMAGE_EXT.test(url)) return url;

  return null;
}

const coverCache = new Map();

const COVER_TTL_MS = 30 * 60 * 1000;

// how long one /covers request may spend resolving image pages, and how long a
// run that ran out of time is cached before it is retried
const PAGE_RESOLVE_BUDGET_MS = 5000;

const PARTIAL_COVER_TTL_MS = 20 * 1000;

/*
  Some art tabs link the image's *page* rather than the file itself - Kanye's
  tab is almost entirely ibb.co page links. Those pages carry the direct file
  in their og:image tag, so the page is fetched once and the real image URL
  cached. Anything that can't be resolved just falls back to no cover, and the
  player draws its own placeholder for that era.
*/
const IMAGE_PAGE_HOSTS = [
  /^https?:\/\/(?:www\.)?ibb\.co\/(?!album\/)[A-Za-z0-9._-]+\/?(?:\?.*)?$/i,
  /^https?:\/\/(?:www\.)?postimg\.cc\/(?!gallery\/)[A-Za-z0-9._-]+\/?(?:\?.*)?$/i
];

const imagePageCache = new Map();

function resolvableImagePage(link) {
  const url = String(link || "").trim();
  return IMAGE_PAGE_HOSTS.some(host => host.test(url)) ? url : null;
}

// pull the direct file URL out of an image host's page markup
function extractImageFromPage(html) {
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i,
    /https?:\/\/i\.ibb\.co\/[A-Za-z0-9._-]+\/[^"'\s\\]+/i,
    /https?:\/\/i\.postimg\.cc\/[A-Za-z0-9._-]+\/[^"'\s\\]+/i
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(html || "");
    if (!match) continue;

    const found = decodeHtmlEntities(match[1] || match[0]);
    if (IMAGE_EXT.test(found) || DIRECT_IMAGE_HOST.test(found)) return found;
  }

  return null;
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#47;/g, "/")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function resolveImagePage(pageUrl) {
  if (imagePageCache.has(pageUrl)) return imagePageCache.get(pageUrl);

  let image = null;

  try {
    const response = await fetch(pageUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      redirect: "follow"
    });

    if (response.ok) image = extractImageFromPage(await response.text());
  } catch (err) {
    // a page that won't load just means no cover for that era
  }

  imagePageCache.set(pageUrl, image);
  return image;
}

// resolve a batch of pages a few at a time - an art tab can hold hundreds
async function mapWithLimit(items, limit, worker) {
  const queue = items.slice();

  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      while (queue.length) {
        const item = queue.shift();
        await worker(item);
      }
    })
  );
}

function scoreCoverRow(eraName, name, type, used) {
  const flat = v => String(v || "").toLowerCase().replace(/\$/g, "s")
    .replace(/\[.*?\]|\(.*?\)/g, " ").replace(/^thc:?/, "").replace(/[^a-z0-9]+/g, "");

  const era = flat(eraName);
  const title = flat(name);

  let score = 0;
  if (title && title === era) score += 40;
  else if (title && (title.includes(era) || era.includes(title))) score += 20;

  if (/album cover/i.test(type)) score += 12;
  if (/^yes$/i.test(used)) score += 4;
  if (/logo|poster|merch|tour|tee|banner/i.test(`${type} ${name}`)) score -= 14;

  return score;
}

async function buildCovers(artist) {
  if (!artist.artGid) return { covers: {}, truncated: false };

  /*
    Art tabs have the same problem the song tabs do: on some trackers the cell
    reads "Cover" and the real URL is a Google Sheets hyperlink, invisible to
    any CSV export. Use the Sheets API when a key is configured, exactly as
    /songs does, and fall back to CSV otherwise.
  */
  let rows;
  let linkRows;

  try {
    const grid = artist.site
      ? await fetchMirrorGrid(artist, artist.artGid)
      : await fetchGridWithLinks(artist.sheetId, artist.artGid);

    if (grid && grid.rows.length) {
      rows = grid.rows;
      linkRows = grid.linkRows;
    }
  } catch (err) {
    console.warn(`[covers] grid failed for ${artist.key}:`, err.message || err);
  }

  if (!rows && artist.site) {
    throw new Error(`Art tab unreadable at ${getMirrorSheetUrl(artist, artist.artGid)}`);
  }

  if (!rows) {
    const response = await fetch(getArtCsvUrl(artist));

    if (!response.ok) throw new Error(`Art tab returned ${response.status}`);

    rows = parse(await response.text(), { skip_empty_lines: true, relax_column_count: true });
    linkRows = rows;
  }

  const headerRow = findHeaderRow(rows);
  const headers = rows[headerRow] || [];

  const eraIndex = Math.max(findColumn(headers, "era"), 0);
  const nameIndex = findColumn(headers, "name");
  const typeIndex = findColumn(headers, "type");
  const usedIndex = getHeaderIndex(headers, "Used?");
  /*
    The artwork can sit in more than one column - an "Image" column, a "Link(s)"
    column, or just the last one - and which is filled in varies row by row. So
    every candidate column is checked and the first usable link in a row wins.
  */
  const linkColumns = [];

  [findColumn(headers, "artImage"), findColumn(headers, "link"), headers.length - 1]
    .forEach(index => {
      if (index >= 0 && !linkColumns.includes(index)) linkColumns.push(index);
    });

  const best = {};

  rows.slice(headerRow + 1).forEach((row, index) => {
    const era = String(row[eraIndex] || "").trim();
    if (!era) return;

    // the link comes from the hyperlink grid when there is one, so a cell whose
    // text is just "Cover" still yields its URL
    const linkRow = linkRows[index + headerRow + 1] || row;

    let image = null;
    let pageUrl = null;

    for (const column of linkColumns) {
      const rawLink = linkRow[column] || row[column] || "";
      if (!rawLink) continue;

      image = toDirectImage(rawLink);
      // a link to an image's page still counts - it gets resolved below
      pageUrl = image ? null : resolvableImagePage(rawLink);

      if (image || pageUrl) break;
    }

    if (!image && !pageUrl) return;

    const score = scoreCoverRow(
      era,
      nameIndex >= 0 ? row[nameIndex] : "",
      typeIndex >= 0 ? row[typeIndex] : "",
      usedIndex >= 0 ? row[usedIndex] : ""
    );

    // a direct image always beats a page link of the same quality
    const rank = score + (image ? 1 : 0);
    if (!best[era] || rank > best[era].rank) best[era] = { rank, image, pageUrl };
  });

  const pending = Object.keys(best).filter(era => !best[era].image && best[era].pageUrl);
  let truncated = false;

  if (pending.length) {
    /*
      An art tab can hold hundreds of page links and the player waits on this
      before it shows anything, so the work is capped by a time budget rather
      than run to completion. Whatever resolves is cached for good, and a
      truncated run is cached only briefly so the next load picks up where this
      one stopped instead of waiting the full TTL.
    */
    const deadline = Date.now() + PAGE_RESOLVE_BUDGET_MS;

    await mapWithLimit(pending, 8, async era => {
      if (Date.now() > deadline) { truncated = true; return; }
      best[era].image = await resolveImagePage(best[era].pageUrl);
    });

    const won = pending.filter(era => best[era].image).length;
    console.log(
      `[covers] ${artist.key}: resolved ${won}/${pending.length} image pages` +
      (truncated ? " (hit the time budget, will continue next load)" : "")
    );
  }

  const covers = {};
  Object.keys(best).forEach(era => {
    if (best[era].image) covers[era] = best[era].image;
  });

  return { covers, truncated };
}

/*
  Google Sheets lets people drop an image INTO a cell, and every tracker uses
  that for era art - the cover sits in the era's own header row, right beside
  its name. No CSV or gviz export shows those; only the sheet's HTML view does,
  at htmlview/sheet, where each one appears as a docs.google.com/sheets-images-rt
  URL. That is one cover per era, exact, with no API key and nothing to paste by
  hand.

  Those URLs are not hotlinkable though: fetched from Google they return the
  image, but pointing a browser at one from another site does not, so the player
  cannot use them as cover links directly. /sheet-image below fetches them
  server-side and serves the bytes on, and re-reads the sheet when a URL stops
  working, which is what keeps them from going stale.
*/
function getSheetHtmlUrl(artist, gid) {
  if (artist.site) return getMirrorSheetUrl(artist, gid);
  return `https://docs.google.com/spreadsheets/d/${artist.sheetId}/htmlview/sheet?headers=true&gid=${gid}`;
}

// the size is part of the URL: "=w105-h104" is the thumbnail as the cell shows
// it, and a plain width asks for the real thing at a sane size for a cover
const IMAGE_SIZE_TAIL = /=[swh]\d+(-[hw]\d+)?(-[a-z0-9]+)*$/i;

function atCoverSize(url, site) {
  const text = String(url || "").trim();

  // a mirror site (Tyler's) keeps the pictures on its own server and writes
  // their addresses without the site in front; those are already full size
  if (text.startsWith("/") && !text.startsWith("//")) return site ? site + text : text;

  // only Google's own image addresses understand a size on the end
  if (!/^https?:\/\/[^/]*google(usercontent)?\.com\//i.test(text)) return text;

  return text.replace(IMAGE_SIZE_TAIL, "") + "=w600";
}

/*
  An era header names the era and then the other names it goes by, the way Young
  Thug's does:

      HiTunes [V1]
      (HyTunes, Hy!£5UN35)

  Songs are filed under any one of those, so the cover is registered under all of
  them. Whitespace is flattened too, because an era written across two lines in
  its header is written on one in the Era column.
*/
function looseEraKey(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function eraNamesInCell(cell) {
  const lines = String(cell || "").split("\n").map(line => line.trim()).filter(Boolean);
  if (!lines.length) return [];

  // both spellings count: "So Much Fun (Deluxe)" is a real era name, and
  // "HiTunes [V1] (HyTunes)" is really just HiTunes [V1]
  const names = [lines[0]];
  const trimmed = lines[0].replace(/\s*\(.*$/, "").trim();
  if (trimmed && trimmed !== lines[0]) names.push(trimmed);

  lines.forEach(line => {
    const inside = line.match(/^\((.+)\)$/);
    if (!inside) return;

    inside[1].split(",").forEach(alias => {
      const name = alias.trim();
      // notes and credits live in these brackets too, so only short names count
      if (name && name.length <= 60 && !/^(prod|feat|with|collaboration)\b/i.test(name)) names.push(name);
    });
  });

  const out = [];
  names.forEach(name => {
    [name, name.replace(/\s+/g, " ")].forEach(form => {
      if (form && !out.includes(form)) out.push(form);
    });
  });

  return out;
}

const sheetImageCache = new Map();

const SHEET_IMAGE_TTL_MS = 6 * 60 * 60 * 1000;

// an era with no art would otherwise re-read the whole sheet on every request
const SHEET_IMAGE_REREAD_MS = 5 * 60 * 1000;

/*
  One tab's page view, parsed. The songs and the cover art both read the same
  tabs, so the result is shared between them for a few minutes rather than
  downloading several megabytes twice.

  Google now and then answers a burst of these with an error or a page that has
  no table in it. That used to be taken at face value - a tab that "had no rows"
  was skipped without a word, and the tracker's art was then cached for six
  hours with half its eras missing. So a read that comes back empty is tried
  again, and if it stays empty it is an error, not an empty tab.
*/
const SHEET_TAB_TTL_MS = 5 * 60 * 1000;

const sheetTabCache = new Map();   // url -> { at, grid } or { reading }

async function fetchSheetTab(url) {
  let lastError;

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise(resolve => setTimeout(resolve, 900 * attempt));

    try {
      const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (!response.ok) throw new Error(`sheet view ${response.status}`);

      const grid = parseSheetHtml(await response.text());
      if (grid.rows.length > 1) return grid;

      lastError = new Error("sheet view came back with no table");
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError;
}

function readSheetTab(artist, gid) {
  const url = getSheetHtmlUrl(artist, gid);
  const held = sheetTabCache.get(url);

  if (held && held.reading) return held.reading;
  if (held && Date.now() - held.at < SHEET_TAB_TTL_MS) return Promise.resolve(held.grid);

  const reading = fetchSheetTab(url).then(
    grid => {
      sheetTabCache.set(url, { at: Date.now(), grid });

      // these are big; drop the ones nobody has asked about lately
      if (sheetTabCache.size > 30) {
        const cutoff = Date.now() - SHEET_TAB_TTL_MS;
        sheetTabCache.forEach((entry, key) => { if (entry.at && entry.at < cutoff) sheetTabCache.delete(key); });
      }

      return grid;
    },
    err => {
      sheetTabCache.delete(url);
      throw err;
    });

  sheetTabCache.set(url, { reading });
  return reading;
}

/*
  An Art tab is laid out the other way round from a song tab: one row per piece
  of art, the era named in its own column, and the image sitting in the row. The
  first image an era gets is its front cover - the alternates, backs and inserts
  come after - so the first one wins.
*/
function collectArtTabImages(grid, byEra, site) {
  const headerRow = findHeaderRow(grid.rows);
  const headers = grid.rows[headerRow] || [];
  const nameIndex = findColumn(headers, "name");
  const eraIndex = findEraColumn(headers, [nameIndex, findColumn(headers, "notes"), findColumn(headers, "link")]);

  let added = 0;

  grid.rows.forEach((row, index) => {
    const image = grid.imageRows[index];
    if (!image || index <= headerRow) return;

    const named = [];
    if (eraIndex >= 0) named.push(...eraNamesInCell(row[eraIndex]));
    if (nameIndex >= 0) named.push(...eraNamesInCell(row[nameIndex]));

    const at = atCoverSize(image, site);
    // the Art tab is one row per song, so its first picture for an era is
    // often a song's art - it only fills eras the song tabs had nothing for
    named.forEach(era => {
      if (era && !hasLooseEra(byEra, era)) { byEra[era] = at; added++; }
    });
  });

  return added;
}

// era names that differ only in punctuation or case ("CD Mixtape" and
// "CD MIxtape", "nettmink" and "nettmink*") are the same era
function hasLooseEra(byEra, era) {
  const key = looseEraKey(era);
  if (!key) return Boolean(byEra[era]);
  return Object.keys(byEra).some(name => looseEraKey(name) === key);
}

const ERA_TALLY_CELL = /\d+\s*(og file|full|tagged|partial|snippet|unavailable|stem)/i;

async function readSheetImages(artist) {
  const site = artist.site;
  const byEra = {};
  // names only known from the songs under a heading, applied after every
  // heading's own name so they never take a name another heading owns
  const underHeading = {};
  let failed = false;

  // song tabs first: art in an era's own header row is the era's own cover
  for (const section of allSectionsFor(artist)) {
    try {
      const grid = await readSheetTab(artist, section.gid);

      const headerRow = findHeaderRow(grid.rows);
      const headers = grid.rows[headerRow] || [];
      const nameIndex = findColumn(headers, "name");

      // a song tab with no Name column was not read properly - say so, so the
      // result is only held briefly instead of standing for six hours
      if (nameIndex < 0) throw new Error("no Name column found in the page view");
      const eraIndex = findEraColumn(headers, [nameIndex, findColumn(headers, "notes"), findColumn(headers, "link")]);

      grid.rows.forEach((row, index) => {
        const image = grid.imageRows[index];
        if (!image || index <= headerRow) return;

        const at = atCoverSize(image, site);
        eraNamesInCell(row[nameIndex]).forEach(era => {
          if (!byEra[era]) byEra[era] = at;
        });

        /*
          The songs under a heading often file themselves under a different
          name than the heading shows: Lil Peep's "In The Bedroom, I Confess"
          heading sits over songs marked "ITBIC", and Future's headings show the
          era as a logo picture with no text at all. So the era the first songs
          below the heading use gets this cover too.
        */
        if (eraIndex < 0) return;
        for (let next = index + 1; next < grid.rows.length && next <= index + 8; next++) {
          if (grid.imageRows[next]) break;
          const cell = String(grid.rows[next][eraIndex] || "").trim();
          if (!cell || ERA_TALLY_CELL.test(cell) || /^#[A-Z]+[!?]/.test(cell)) continue;

          eraNamesInCell(cell).forEach(era => {
            if (!underHeading[era]) underHeading[era] = at;
          });
          break;
        }
      });
    } catch (err) {
      failed = true;
      console.warn(`[sheet-images] ${artist.key}/${section.name}:`, err.message || err);
    }
  }

  Object.keys(underHeading).forEach(era => {
    if (!hasLooseEra(byEra, era)) byEra[era] = underHeading[era];
  });

  const fromSongTabs = Object.keys(byEra).length;

  // then the Art tab, for the eras the song tabs had no picture for
  if (artist.artGid) {
    try {
      const grid = await readSheetTab(artist, artist.artGid);
      if (grid.rows.length) collectArtTabImages(grid, byEra, artist.site);
    } catch (err) {
      failed = true;
      console.warn(`[sheet-images] ${artist.key}/art tab:`, err.message || err);
    }
  }

  const total = Object.keys(byEra).length;
  console.log(
    `[sheet-images] ${artist.key}: ${total} era names have art in the sheet ` +
    `(${fromSongTabs} off the song tabs, ${total - fromSongTabs} off the Art tab)` +
    (failed ? " - some tabs failed, will read again soon" : "")
  );

  // a tab Google refused this time should not leave its eras bare for hours
  Object.defineProperty(byEra, "__failed", { value: failed, enumerable: false });
  return byEra;
}

async function getSheetImages(artist, { fresh = false } = {}) {
  const held = sheetImageCache.get(artist.key);

  const age = held ? Date.now() - held.at : Infinity;

  if (!fresh && age < SHEET_IMAGE_TTL_MS) return held.byEra;
  // a forced re-read is for a URL that stopped working, not for every miss
  if (fresh && age < SHEET_IMAGE_REREAD_MS) return held.byEra;

  // one read at a time per tracker: these pages run to several megabytes
  if (held && held.reading) return held.reading;

  const reading = readSheetImages(artist)
    .then(byEra => {
      const at = byEra.__failed ? Date.now() - SHEET_IMAGE_TTL_MS + 2 * 60 * 1000 : Date.now();

      // a read Google only partly answered must not lose the art already known
      const kept = byEra.__failed && held ? Object.assign({}, held.byEra, byEra) : byEra;

      sheetImageCache.set(artist.key, { at, byEra: kept });

      warmSheetImages(artist, kept).catch(err =>
        console.warn(`[sheet-images] ${artist.key}: saving covers failed:`, err.message || err));

      return kept;
    })
    .catch(err => {
      console.warn(`[sheet-images] ${artist.key} failed:`, err.message || err);
      return (held && held.byEra) || {};
    });

  sheetImageCache.set(artist.key, Object.assign({ at: 0, byEra: {} }, held, { reading }));
  return reading;
}

/*
  The same map, but never waited on. Reading a tracker's tabs means pulling
  several megabytes of HTML, which on a cold cache takes longer than the player
  is willing to wait for its cover art - so the first request starts the read and
  says so, and the answer is ready by the time the player asks again.
*/
function peekSheetImages(artist) {
  const held = sheetImageCache.get(artist.key);
  if (held && held.at && Date.now() - held.at < SHEET_IMAGE_TTL_MS) return held.byEra;

  getSheetImages(artist).catch(() => {});   // starts it; the cache keeps the result
  return null;
}

/*
  The pictures themselves, kept on disk.

  The address Google gives for an image in a cell is only good for a while, and
  a page that draws thirty covers at once asks Google for thirty images at once,
  some of which it refuses. Either way an era ended up with no cover even though
  the sheet has one. So each picture is saved the first time it is fetched and
  served from disk after that: a cover that has loaded once keeps loading, and
  it does so without going back to Google at all.

  Right after a tracker's sheet is read - while the addresses are certainly
  still good - all of its covers are fetched in the background, a few at a time.
*/
const COVER_DIR = path.join(os.tmpdir(), "tracker-search-covers");

const COVER_FILE_TTL_MS = 3 * 24 * 60 * 60 * 1000;

const COVER_CACHE_MAX_BYTES = (Number(process.env.COVER_CACHE_MB) || 500) * 1024 * 1024;

const COVER_EXT = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" };

const coverDownloads = new Map();   // file key -> promise

function coverFileKey(artist, url) {
  // aliases of one era share a picture, so the picture is what names the file
  return crypto.createHash("sha1").update(`${artist.key}|${url}`).digest("hex");
}

function eraFileKey(artist, era) {
  return crypto.createHash("sha1").update(`${artist.key}|era|${era}`).digest("hex");
}

function readCoverFile(key, maxAge = COVER_FILE_TTL_MS) {
  for (const type of Object.keys(COVER_EXT)) {
    const file = path.join(COVER_DIR, key + COVER_EXT[type]);

    try {
      const stat = fs.statSync(file);
      if (stat.size > 0 && Date.now() - stat.mtimeMs < maxAge) return { type, body: fs.readFileSync(file) };
    } catch (err) {
      // not there
    }
  }

  return null;
}

function writeCoverFile(key, image) {
  const ext = COVER_EXT[String(image.type).split(";")[0].trim().toLowerCase()];
  if (!ext) return;

  try {
    fs.mkdirSync(COVER_DIR, { recursive: true });

    // an era's picture may have changed format since it was last saved
    Object.values(COVER_EXT).forEach(other => {
      if (other !== ext) { try { fs.unlinkSync(path.join(COVER_DIR, key + other)); } catch (err) {} }
    });

    fs.writeFileSync(path.join(COVER_DIR, key + ext), image.body);
  } catch (err) {
    console.warn("[sheet-image] could not save a cover:", err.message || err);
  }
}

function pruneCoverFiles() {
  try {
    const files = fs.readdirSync(COVER_DIR).map(name => {
      const file = path.join(COVER_DIR, name);
      const stat = fs.statSync(file);
      return { file, size: stat.size, at: stat.mtimeMs };
    }).sort((a, b) => a.at - b.at);

    let total = files.reduce((sum, item) => sum + item.size, 0);

    for (const item of files) {
      if (total <= COVER_CACHE_MAX_BYTES) break;
      try { fs.unlinkSync(item.file); total -= item.size; } catch (err) {}
    }
  } catch (err) {
    // nothing saved yet
  }
}

async function downloadSheetImage(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    // Google refuses the odd request out of a burst; waiting a moment fixes it
    if (attempt) await new Promise(resolve => setTimeout(resolve, 500 * attempt));

    const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } }).catch(() => null);
    if (!response) continue;

    const type = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();

    if (response.ok && /^image\//.test(type)) {
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length) return { type, body };
    } else if (response.body && response.body.destroy) {
      response.body.destroy();
    }

    // gone for good - trying again will not bring it back
    if (response.status === 404 || response.status === 410) break;
  }

  return null;
}

// the picture behind one address, from disk if it is there
function sheetImageFor(artist, era, url) {
  const key = coverFileKey(artist, url);
  const saved = readCoverFile(key);
  if (saved) return Promise.resolve(saved);

  if (!coverDownloads.has(key)) {
    coverDownloads.set(key, downloadSheetImage(url)
      .then(image => {
        if (image) {
          writeCoverFile(key, image);
          // and under the era's own name, which still works after the sheet
          // is re-read and hands out a different address for the same picture
          writeCoverFile(eraFileKey(artist, era), image);
        }
        return image;
      })
      .finally(() => coverDownloads.delete(key)));
  }

  return coverDownloads.get(key);
}

async function fetchSheetImage(artist, era, { fresh = false } = {}) {
  const byEra = await getSheetImages(artist, { fresh });
  const url = byEra[era];

  if (url) {
    const image = await sheetImageFor(artist, era, url);
    if (image) return image;
  }

  // Google would not hand it over this time (or the sheet could not be read):
  // the last copy that did load is far better than a blank square
  if (fresh || !url) return readCoverFile(eraFileKey(artist, era), 30 * 24 * 60 * 60 * 1000);

  return null;
}

// fetch a tracker's covers ahead of anyone asking, while the addresses are new
async function warmSheetImages(artist, byEra) {
  const seen = new Set();
  const jobs = [];

  Object.keys(byEra).forEach(era => {
    const url = byEra[era];
    if (!url || seen.has(url)) return;

    seen.add(url);
    jobs.push({ era, url });
  });

  let failed = 0;

  await mapWithLimit(jobs, 3, async job => {
    const image = await sheetImageFor(artist, job.era, job.url).catch(() => null);
    if (!image) failed++;
  });

  // every other name the same picture goes by gets its own fallback copy too
  Object.keys(byEra).forEach(era => {
    const eraKey = eraFileKey(artist, era);
    if (readCoverFile(eraKey)) return;

    const image = readCoverFile(coverFileKey(artist, byEra[era]));
    if (image) writeCoverFile(eraKey, image);
  });

  pruneCoverFiles();

  console.log(
    `[sheet-images] ${artist.key}: ${jobs.length - failed}/${jobs.length} covers saved` +
    (failed ? ` (${failed} could not be fetched)` : "")
  );
}

/* ------------------------------------------------------------------ *
 *  Downloading a tagged copy
 * ------------------------------------------------------------------ */

app.get("/sheet-image", async (req, res) => {
  const artist = getArtist(req.query.artist, req.query.custom);
  // custom trackers have no art tab, and their covers are not cached
  if (artist.custom) return res.status(404).send("No covers for custom trackers.");
  const era = String(req.query.era || "").trim();

  if (!era) return res.status(400).send("No era given.");

  try {
    // a URL that has stopped working means the sheet moved on, so read it again
    const image = await fetchSheetImage(artist, era) || await fetchSheetImage(artist, era, { fresh: true });

    if (!image) return res.status(404).send("No art in the sheet for that era.");

    res.set("Content-Type", image.type);
    res.set("Cache-Control", "public, max-age=86400");
    res.send(image.body);
  } catch (err) {
    console.error(`[sheet-image] ${artist.key}/${era}:`, err.message || err);
    res.status(502).send("Could not fetch that cover.");
  }
});

/*
  The player lets a cover be chosen by hand: cover-links.json (Yeat) and
  cover-links-<artist>.json, one direct image link per era. Those beat anything
  read off the sheet, even when the sheet spells the era a little differently
  ("Trendi" and "Trëndi"). The same files sit in ./cover-links here, so both
  apps show the same cover for the same era.
*/
const HAND_COVER_DIR = path.join(__dirname, "cover-links");
const handCoverFiles = new Map();   // file -> { mtime, covers }

function readHandCovers(artist) {
  const name = artist.key === "yeat" ? "cover-links.json" : `cover-links-${artist.key}.json`;
  const file = path.join(HAND_COVER_DIR, name);

  try {
    const mtime = fs.statSync(file).mtimeMs;
    const held = handCoverFiles.get(file);
    if (held && held.mtime === mtime) return held.covers;

    const text = fs.readFileSync(file, "utf8");
    let data;
    // a stray comma before a closing brace is the usual slip in a hand-edited file
    try { data = JSON.parse(text); } catch (err) { data = JSON.parse(text.replace(/,(\s*[}\]])/g, "$1")); }

    const listed = (data && (data.covers || data)) || {};
    const covers = {};
    Object.keys(listed).forEach(era => {
      const url = typeof listed[era] === "string" ? listed[era].trim() : "";
      if (/^https?:\/\//i.test(url)) covers[era] = url;
    });

    handCoverFiles.set(file, { mtime, covers });
    return covers;
  } catch (err) {
    if (err.code !== "ENOENT") console.warn(`[covers] ${name} could not be read:`, err.message || err);
    return {};
  }
}

function withHandCovers(artist, covers) {
  const hand = readHandCovers(artist);
  const names = Object.keys(hand);
  if (!names.length) return covers;

  const chosen = new Set(names.map(looseEraKey).filter(Boolean));
  const merged = {};
  Object.keys(covers).forEach(era => { if (!chosen.has(looseEraKey(era))) merged[era] = covers[era]; });
  return Object.assign(merged, hand);
}

app.get("/covers", async (req, res) => {
  const artist = getArtist(req.query.artist, req.query.custom);
  // custom trackers have no art tab, and their covers are not cached
  if (artist.custom) return res.json({ artist: artist.key, covers: {}, pending: false });

  try {
    const cached = coverCache.get(artist.key);
    if (cached && Date.now() - cached.at < COVER_TTL_MS) {
      return res.json({
        artist: artist.key, covers: withHandCovers(artist, cached.covers), cached: true,
        pending: Boolean(cached.pending)
      });
    }

    /*
      The picture in an era's own row is the cover. Until those have been read
      out of the sheet nothing is sent at all: the Art tab's guesses used to be
      shown in the meantime, which meant a wrong cover flashing up and then
      being swapped. The player asks again every few seconds while this says
      "pending", and that answer is not cached, so the art appears as soon as
      the sheet has been read.
    */
    if (!peekSheetImages(artist)) {
      return res.json({ artist: artist.key, covers: withHandCovers(artist, {}), pending: true });
    }

    // the Art tab is only a fallback now, for eras with no picture of their own
    const { covers, truncated } = await buildCovers(artist).catch(err => {
      console.warn(`[covers] ${artist.key}: Art tab skipped:`, err.message || err);
      return { covers: {}, truncated: false };
    });

    /*
      A cover sitting in the era's own row is the era's cover - no guessing
      involved - so it wins over anything matched off the Art tab, which has to
      score rows by name and gets it wrong often enough to notice. The Art tab
      still covers every era the sheet has no image for, and a hand-edited cover
      file still overrides both. These are served through /sheet-image because
      Google will not let another site load those URLs directly.
    */
    const inSheet = peekSheetImages(artist);
    const pending = !inSheet;

    Object.keys(inSheet || {}).forEach(era => {
      covers[era] = `/sheet-image?artist=${encodeURIComponent(artist.key)}&era=${encodeURIComponent(era)}`;
    });

    // a truncated run is only held briefly, so the next load resolves more.
    // art still being read out of the sheet is held briefly for the same reason
    const holdBriefly = truncated || pending;

    coverCache.set(artist.key, {
      at: holdBriefly ? Date.now() - (COVER_TTL_MS - PARTIAL_COVER_TTL_MS) : Date.now(),
      covers,
      pending
    });

    console.log(
      `[covers] ${artist.key}: ${Object.keys(covers).length} eras with art` +
      (pending ? " (still reading the sheet's own art)" : "")
    );

    res.json({ artist: artist.key, covers: withHandCovers(artist, covers), pending });
  } catch (err) {
    console.error(`Cover art lookup failed for ${artist.key}:`, err.message || err);
    res.json({ artist: artist.key, covers: withHandCovers(artist, {}), error: String(err.message || err) });
  }
});

/*
  imgur.gg does not expose the file name in the tracker link, so the real media
  URL has to be read off the file page once:
    page   https://imgur.gg/f/PKnLvOM
    media  https://i.imgur.gg/PKnLvOM-Cake.mp3
  Resolved URLs are cached for the life of the process.
*/
const imgurMediaCache = new Map();

const IMGUR_AUDIO_EXT = "mp3|m4a|wav|flac|ogg|opus|aac|mp4|webm|aiff|alac";

function findImgurMediaUrl(html, id) {
  // the URL can appear escaped inside inline JSON, so normalise slashes first
  const flat = html.replace(/\\u002[fF]/g, "/").replace(/\\\//g, "/");

  // anchor on the file extension: names legitimately contain "(", ")" and %20
  const byId = new RegExp(`https?://i\\.imgur\\.gg/${id}-[^"'\\\\\\s<>]*?\\.(?:${IMGUR_AUDIO_EXT})`, "i");
  const any = new RegExp(`https?://i\\.imgur\\.gg/[^"'\\\\\\s<>]*?\\.(?:${IMGUR_AUDIO_EXT})`, "i");

  const match = flat.match(byId) || flat.match(any);
  return match ? match[0] : null;
}

app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`Tracker Search running at http://localhost:${PORT}`);
});
