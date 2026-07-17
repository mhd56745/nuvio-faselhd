/**
 * FaselHD - Nuvio Provider
 * Arabic streaming site with movie & TV show support
 * Supports multiple mirror domains and multiple server qualities
 */

var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try { step(generator.next(value)); } catch (e) { reject(e); }
    };
    var rejected = (value) => {
      try { step(generator.throw(value)); } catch (e) { reject(e); }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

var cheerio = require("cheerio-without-node-native");

// ─── Constants ────────────────────────────────────────────────────────
var DEFAULT_BASE_URL = "https://www.fasel-hd.cam";
var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
var TMDB_BASE_URL = "https://api.themoviedb.org/3";

var HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ar-SA,ar;q=0.9,en-US;q=0.8,en;q=0.7",
  "Connection": "keep-alive"
};

// ─── Settings Helper ──────────────────────────────────────────────────
function getBaseUrl() {
  try {
    if (typeof global !== "undefined" && global.SCRAPER_SETTINGS && global.SCRAPER_SETTINGS.baseUrl) {
      var val = String(global.SCRAPER_SETTINGS.baseUrl).trim().replace(/\/+$/, "");
      if (val.startsWith("http")) return val;
    }
    if (typeof window !== "undefined" && window.SCRAPER_SETTINGS && window.SCRAPER_SETTINGS.baseUrl) {
      var val2 = String(window.SCRAPER_SETTINGS.baseUrl).trim().replace(/\/+$/, "");
      if (val2.startsWith("http")) return val2;
    }
  } catch (e) {}
  return DEFAULT_BASE_URL;
}

// ─── TMDB Lookup ─────────────────────────────────────────────────────
function getTMDBDetails(tmdbId, mediaType) {
  return __async(this, null, function* () {
    var _a;
    var endpoint = mediaType === "tv" ? "tv" : "movie";
    var url = TMDB_BASE_URL + "/" + endpoint + "/" + tmdbId + "?api_key=" + TMDB_API_KEY + "&append_to_response=external_ids";
    try {
      var response = yield fetch(url, {
        headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" }
      });
      if (!response.ok) throw new Error("TMDB API error: " + response.status);
      var data = yield response.json();
      var title = mediaType === "tv" ? data.name : data.title;
      var releaseDate = mediaType === "tv" ? data.first_air_date : data.release_date;
      var year = releaseDate ? parseInt(releaseDate.split("-")[0]) : null;
      var imdbId = ((_a = data.external_ids) == null ? void 0 : _a.imdb_id) || null;
      console.log("[FaselHD] TMDB:", title, year ? "(" + year + ")" : "");
      return { title: title, year: year, imdbId: imdbId };
    } catch (e) {
      console.error("[FaselHD] TMDB lookup failed:", e.message);
      return { title: "TMDB " + tmdbId, year: null, imdbId: null };
    }
  });
}

// ─── Title Matching ───────────────────────────────────────────────────
function normalizeTitle(title) {
  if (!title) return "";
  return title.toLowerCase()
    .replace(/\b(the|a|an)\b/g, "")
    .replace(/[:\-_.]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[^\w\s]/g, "")
    .trim();
}

function titleSimilarity(t1, t2) {
  var n1 = normalizeTitle(t1);
  var n2 = normalizeTitle(t2);
  if (n1 === n2) return 1;
  var w1 = n1.split(/\s+/).filter(function(w) { return w.length > 0; });
  var w2 = n2.split(/\s+/).filter(function(w) { return w.length > 0; });
  if (w1.length === 0 || w2.length === 0) return 0;
  var set1 = new Set(w1);
  var set2 = new Set(w2);
  var intersection = w1.filter(function(w) { return set2.has(w); });
  var union = new Set([].concat(w1, w2));
  var jaccard = intersection.length / union.size;
  var extra = w2.filter(function(w) { return !set1.has(w); }).length;
  var score = jaccard - extra * 0.05;
  if (w1.length > 0 && w1.every(function(w) { return set2.has(w); })) score += 0.2;
  return score;
}

function findBestMatch(mediaInfo, results) {
  if (!results || results.length === 0) return null;
  var best = null;
  var bestScore = 0;
  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    var score = titleSimilarity(mediaInfo.title, r.title);
    if (mediaInfo.year && r.year) {
      var diff = Math.abs(mediaInfo.year - r.year);
      if (diff === 0) score += 0.25;
      else if (diff <= 1) score += 0.15;
      else if (diff > 5) score -= 0.3;
    }
    if (score > bestScore && score > 0.3) {
      bestScore = score;
      best = r;
    }
  }
  console.log("[FaselHD] Best match score:", bestScore, "→", best ? best.title : "none");
  return best;
}

// ─── Search ───────────────────────────────────────────────────────────
function searchFaselHD(query, baseUrl) {
  return __async(this, null, function* () {
    var ajaxUrl = baseUrl + "/wp-admin/admin-ajax.php";
    var results = [];
    try {
      console.log("[FaselHD] Searching for:", query);

      // Method 1: AJAX live search
      var formData = "action=dtc_live&trsearch=" + encodeURIComponent(query);
      var response = yield fetch(ajaxUrl, {
        method: "POST",
        headers: Object.assign({}, HEADERS, {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Requested-With": "XMLHttpRequest",
          "Referer": baseUrl + "/"
        }),
        body: formData
      });

      if (response.ok) {
        var html = yield response.text();
        var $ = cheerio.load(html);

        // Parse search results - each result is inside .postDiv > a
        $(".postDiv a").each(function(i, el) {
          var href = $(el).attr("href") || "";
          // Extract title from the img alt or .h1 text
          var title = $(el).find(".h1").text().trim();
          if (!title) {
            title = $(el).find("img").attr("alt") || "";
          }
          if (!title) {
            title = $(el).text().trim().split("\n")[0].trim();
          }
          // Clean Arabic prefixes for matching
          var cleanTitle = title
            .replace(/^(فيلم|مسلسل|أنمي|انمي)\s+/i, "")
            .replace(/\s+(مترجم|مدبلج|اونلاين|كامل).*$/i, "")
            .trim();

          if ((href.includes("/movies/") || href.includes("/episodes/") || href.includes("/series/")) && cleanTitle.length > 1) {
            var yearMatch = title.match(/(\d{4})/);
            var year = yearMatch ? parseInt(yearMatch[1]) : null;
            results.push({
              title: cleanTitle,
              originalTitle: title,
              url: href,
              year: year
            });
          }
        });
      }

      // Method 2: Fallback - WordPress search page
      if (results.length === 0) {
        console.log("[FaselHD] AJAX returned nothing, trying page search...");
        var searchUrl = baseUrl + "/?s=" + encodeURIComponent(query);
        var searchRes = yield fetch(searchUrl, {
          headers: Object.assign({}, HEADERS, { "Referer": baseUrl + "/" })
        });
        if (searchRes.ok) {
          var searchHtml = yield searchRes.text();
          var $s = cheerio.load(searchHtml);
          // Try multiple selectors used by WordPress Arabic themes
          $s("article a, .postDiv a, .result-item a, .entry-title a").each(function(i, el) {
            var href2 = $s(el).attr("href") || "";
            var alt = $s(el).find("img").attr("alt") || $s(el).find(".entry-title, .h1, h2, h3").first().text().trim();
            var cleanAlt = alt.replace(/^(فيلم|مسلسل|أنمي|انمي)\s+/i, "").replace(/\s+(مترجم|مدبلج|اونلاين|كامل).*$/i, "").trim();
            if ((href2.includes("/movies/") || href2.includes("/episodes/") || href2.includes("/series/")) && cleanAlt.length > 1) {
              var yearMatch2 = alt.match(/(\d{4})/);
              results.push({
                title: cleanAlt,
                originalTitle: alt,
                url: href2,
                year: yearMatch2 ? parseInt(yearMatch2[1]) : null
              });
            }
          });
        }
      }

      console.log("[FaselHD] Found", results.length, "search results");
      return results;
    } catch (e) {
      console.error("[FaselHD] Search error:", e.message);
      return results;
    }
  });
}

// ─── Page Parsing ─────────────────────────────────────────────────────
function extractPlayerTokens(html, pageUrl) {
  var tokens = [];
  var match;

  // Pattern 1: onclick="player_iframe.location.href = 'URL'"
  var onclickRegex = /player_iframe\.location\.href\s*=\s*['"]([^'"]+)['"]/g;
  while ((match = onclickRegex.exec(html)) !== null) {
    tokens.push(match[1]);
  }

  // Pattern 2: data-src on iframe with player_token
  var dataSrcRegex = /data-src=["']([^"']*player_token[^"']*)["']/g;
  while ((match = dataSrcRegex.exec(html)) !== null) {
    if (tokens.indexOf(match[1]) === -1) tokens.push(match[1]);
  }

  // Pattern 3: iframe src with video_player
  var iframeSrcRegex = /<iframe[^>]+src=["']([^"']*video_player[^"']*)["']/gi;
  while ((match = iframeSrcRegex.exec(html)) !== null) {
    if (match[1] && tokens.indexOf(match[1]) === -1) tokens.push(match[1]);
  }

  // Normalize relative URLs
  tokens = tokens.map(function(t) {
    if (t.startsWith("http")) return t;
    try { return new URL(t, pageUrl).toString(); }
    catch (e) { return t; }
  });

  return tokens;
}

function extractDownloadLinks(html) {
  var links = [];
  var regex = /<a[^>]+href=["'](https?:\/\/[^"']+?)["'][^>]*>([\s\S]*?)<\/a>/gi;
  var match;
  while ((match = regex.exec(html)) !== null) {
    var url = match[1];
    var label = match[2].replace(/<[^>]*>/g, "").trim();
    if (url.includes("/wp-") || url.includes("facebook") || url.includes("twitter") ||
        url.includes("instagram") || url.includes("faselplus") || url.includes("google.com") ||
        url.includes("javascript:") || url.includes("#")) continue;
    if (url.includes("/file/") || url.includes("/d/") || url.includes("/download/") ||
        url.includes(".mp4") || url.includes(".mkv") || url.includes("t7meel") ||
        url.includes("gofile") || url.includes("mega") || url.includes("drive.google")) {
      links.push({ url: url, label: label });
    }
  }
  return links;
}

// ─── Embed/Stream Extractors ──────────────────────────────────────────
function jsUnpack(code) {
  try {
    var match2 = code.match(/}\s*\(\s*['"](.+?)['"]\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*['"](.+?)['"]\.split\(['"]\|['"]\)/);
    if (!match2) return code;
    var p = match2[1], a = parseInt(match2[2]), c = parseInt(match2[3]), k = match2[4].split("|");
    var alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    function unbase(n, base) {
      if (base <= 36) return parseInt(n, base).toString(36);
      var dict = {};
      for (var i2 = 0; i2 < base; i2++) dict[alphabet[i2]] = i2;
      var res = 0;
      for (var j = 0; j < n.length; j++) res = res * base + (dict[n[j]] || 0);
      return res;
    }
    while (c--) {
      if (k[c]) {
        var word = unbase(c, a);
        p = p.replace(new RegExp("\\b" + word + "\\b", "g"), k[c]);
      }
    }
    return p;
  } catch (e) { return code; }
}

function extractM3U8FromHTML(html, referer) {
  var streams = [];
  var content = html;
  if (content.includes("eval(function(p,a,c,k,e,d)")) {
    content = jsUnpack(content);
  }
  var m, m3u8Regex = /["'](https?:\/\/[^"']*\.m3u8[^"']*)["']/gi;
  while ((m = m3u8Regex.exec(content)) !== null) {
    var u = m[1]; if (u.startsWith("//")) u = "https:" + u;
    streams.push({ quality: "Auto", url: u, headers: Object.assign({}, HEADERS, { Referer: referer }) });
  }
  if (streams.length === 0) {
    var mp4Regex = /["'](https?:\/\/[^"']*\.mp4[^"']*)["']/gi;
    while ((m = mp4Regex.exec(content)) !== null) {
      var u2 = m[1]; if (u2.startsWith("//")) u2 = "https:" + u2;
      streams.push({ quality: "Auto", url: u2, headers: Object.assign({}, HEADERS, { Referer: referer }) });
    }
  }
  if (streams.length === 0) {
    var srcRegex = /(?:source|src|file|url)\s*[:=]\s*["'](https?:\/\/[^"']*(?:m3u8|mp4|mkv)[^"']*)["']/gi;
    while ((m = srcRegex.exec(content)) !== null) {
      var u3 = m[1]; if (u3.startsWith("//")) u3 = "https:" + u3;
      streams.push({ quality: "Auto", url: u3, headers: Object.assign({}, HEADERS, { Referer: referer }) });
    }
  }
  return streams;
}

function doodStreamExtract(url) {
  return __async(this, null, function* () {
    try {
      var res = yield fetch(url, { headers: Object.assign({}, HEADERS, { Referer: url }) });
      var html = yield res.text();
      var md5Match = html.match(/\/pass_md5\/([^'"]+)/);
      if (!md5Match) return [];
      var passRes = yield fetch("https://dood.re/pass_md5/" + md5Match[1], { headers: Object.assign({}, HEADERS, { Referer: url }) });
      var passContent = yield passRes.text();
      return [{ quality: "Auto", url: passContent + "abc?token=" + md5Match[1] + "&expiry=" + Date.now(), headers: Object.assign({}, HEADERS, { Referer: url }) }];
    } catch (e) { return []; }
  });
}

function streamTapeExtract(url) {
  return __async(this, null, function* () {
    try {
      var res = yield fetch(url, { headers: Object.assign({}, HEADERS, { Referer: url }) });
      var html = yield res.text();
      var match2 = html.match(/id="videolink">([^<]+)/);
      if (match2) return [{ quality: "Auto", url: "https:" + match2[1], headers: Object.assign({}, HEADERS, { Referer: url }) }];
      return [];
    } catch (e) { return []; }
  });
}

function resolveEmbedUrl(url) {
  return __async(this, null, function* () {
    try {
      var domain = new URL(url).hostname.toLowerCase();
      if (domain.includes("dood")) return yield doodStreamExtract(url);
      if (domain.includes("streamtape") || domain.includes("streamta")) return yield streamTapeExtract(url);
      // Generic: fetch page and look for stream URLs
      var res = yield fetch(url, { headers: Object.assign({}, HEADERS, { Referer: url }) });
      if (!res.ok) return [];
      var html = yield res.text();
      return extractM3U8FromHTML(html, url);
    } catch (e) {
      console.error("[FaselHD] Embed resolve error:", e.message);
      return [];
    }
  });
}

// ─── Main: getStreams ─────────────────────────────────────────────────
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  if (mediaType === undefined) mediaType = "movie";
  if (seasonNum === undefined) seasonNum = null;
  if (episodeNum === undefined) episodeNum = null;
  return __async(this, null, function* () {
    var baseUrl = getBaseUrl();
    console.log("[FaselHD] === START === Base:", baseUrl, "TMDB:", tmdbId, "Type:", mediaType);

    try {
      // 1. TMDB info
      var mediaInfo = yield getTMDBDetails(tmdbId, mediaType);
      var searchQuery = mediaInfo.title;

      // 2. Search
      var searchResults = yield searchFaselHD(searchQuery, baseUrl);
      if (searchResults.length === 0) {
        console.log("[FaselHD] No results for title, trying IMDB ID...");
        if (mediaInfo.imdbId) {
          searchResults = yield searchFaselHD(mediaInfo.imdbId, baseUrl);
        }
      }
      if (searchResults.length === 0) {
        console.log("[FaselHD] No search results found at all");
        return [];
      }

      // 3. Best match
      var bestMatch = findBestMatch(mediaInfo, searchResults);
      var selected = bestMatch || searchResults[0];
      console.log("[FaselHD] Selected:", selected.title, "→", selected.url);

      // 4. Fetch media page
      var pageRes = yield fetch(selected.url, {
        headers: Object.assign({}, HEADERS, { Referer: baseUrl + "/" })
      });
      if (!pageRes.ok) {
        console.error("[FaselHD] Page fetch failed:", pageRes.status);
        return [];
      }
      var pageHtml = yield pageRes.text();
      console.log("[FaselHD] Page fetched, length:", pageHtml.length);

      // 5. Extract player tokens
      var playerTokens = extractPlayerTokens(pageHtml, selected.url);
      console.log("[FaselHD] Player tokens found:", playerTokens.length);

      // 6. Extract download links
      var downloadLinks = extractDownloadLinks(pageHtml);

      // 7. Build streams
      var streams = [];
      var streamTitle = mediaInfo.title;
      if (mediaInfo.year) streamTitle += " (" + mediaInfo.year + ")";
      if (mediaType === "tv" && seasonNum && episodeNum) {
        streamTitle = mediaInfo.title + " S" + String(seasonNum).padStart(2, "0") + "E" + String(episodeNum).padStart(2, "0");
      }

      // Process each player token
      for (var i = 0; i < playerTokens.length; i++) {
        var tokenUrl = playerTokens[i];
        var serverNum = i + 1;
        try {
          console.log("[FaselHD] Resolving server #" + serverNum);
          var playerRes = yield fetch(tokenUrl, {
            headers: Object.assign({}, HEADERS, {
              "Referer": selected.url,
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
            })
          });
          if (!playerRes.ok) continue;
          var playerHtml = yield playerRes.text();

          // If token invalid, return player URL for iframe playback
          if (playerHtml.includes("Token Not Valid") || playerHtml.length < 200) {
            console.log("[FaselHD] Token #" + serverNum + " session-bound, returning iframe URL");
            streams.push({
              name: "FaselHD Server " + String(serverNum).padStart(2, "0"),
              title: streamTitle,
              url: tokenUrl,
              quality: "Auto",
              size: "Unknown",
              headers: Object.assign({}, HEADERS, { Referer: selected.url }),
              provider: "faselhd",
              subtitles: []
            });
            continue;
          }

          // Try to extract direct stream URLs from player page
          var extracted = extractM3U8FromHTML(playerHtml, tokenUrl);

          // Look for embedded iframes
          if (extracted.length === 0) {
            var iframeRegex2 = /<iframe[^>]+src=["'](https?:\/\/[^"']+)["']/gi;
            var iframeMatch;
            while ((iframeMatch = iframeRegex2.exec(playerHtml)) !== null) {
              var embedUrl = iframeMatch[1];
              if (embedUrl.includes("recaptcha") || embedUrl.includes("google.com")) continue;
              console.log("[FaselHD] Found embed:", embedUrl.substring(0, 60));
              var embedStreams = yield resolveEmbedUrl(embedUrl);
              for (var j = 0; j < embedStreams.length; j++) {
                streams.push({
                  name: "FaselHD Server " + String(serverNum).padStart(2, "0"),
                  title: streamTitle,
                  url: embedStreams[j].url,
                  quality: embedStreams[j].quality,
                  size: "Unknown",
                  headers: embedStreams[j].headers,
                  provider: "faselhd",
                  subtitles: []
                });
              }
            }
          }

          if (extracted.length > 0) {
            for (var k = 0; k < extracted.length; k++) {
              streams.push({
                name: "FaselHD Server " + String(serverNum).padStart(2, "0"),
                title: streamTitle,
                url: extracted[k].url,
                quality: extracted[k].quality,
                size: "Unknown",
                headers: extracted[k].headers,
                provider: "faselhd",
                subtitles: []
              });
            }
          }

          // If nothing extracted, return player URL as fallback
          if (extracted.length === 0) {
            var hasUsefulEmbed = /<iframe[^>]+src=["'](?!https?:\/\/www\.google)[^"']+["']/i.test(playerHtml);
            if (!hasUsefulEmbed) {
              streams.push({
                name: "FaselHD Server " + String(serverNum).padStart(2, "0"),
                title: streamTitle,
                url: tokenUrl,
                quality: "Auto",
                size: "Unknown",
                headers: Object.assign({}, HEADERS, { Referer: selected.url }),
                provider: "faselhd",
                subtitles: []
              });
            }
          }
        } catch (err) {
          console.error("[FaselHD] Error server #" + serverNum + ":", err.message);
          streams.push({
            name: "FaselHD Server " + String(serverNum).padStart(2, "0"),
            title: streamTitle,
            url: tokenUrl,
            quality: "Auto",
            size: "Unknown",
            headers: Object.assign({}, HEADERS, { Referer: selected.url }),
            provider: "faselhd",
            subtitles: []
          });
        }
      }

      // Add download links
      for (var d = 0; d < downloadLinks.length; d++) {
        var dl = downloadLinks[d];
        streams.push({
          name: "FaselHD DL " + (dl.label || "Download"),
          title: streamTitle,
          url: dl.url,
          quality: "Auto",
          size: "Unknown",
          headers: Object.assign({}, HEADERS, { Referer: selected.url }),
          provider: "faselhd",
          subtitles: []
        });
      }

      // Sort by quality
      var qualityOrder = { "4K": 5, "1440p": 4, "1080p": 3, "720p": 2, "480p": 1, "360p": 0, "Auto": -1, "Unknown": -2 };
      streams.sort(function(a, b) {
        return (qualityOrder[b.quality] || -2) - (qualityOrder[a.quality] || -2);
      });

      console.log("[FaselHD] === DONE === Returning", streams.length, "streams");
      return streams;
    } catch (error) {
      console.error("[FaselHD] Fatal error:", error.message);
      return [];
    }
  });
}

// ─── Settings UI ──────────────────────────────────────────────────────
function onSettings() {
  return __async(this, null, function* () {
    return [
      { type: "header", label: "FaselHD Configuration" },
      {
        type: "text",
        key: "baseUrl",
        label: "Base URL",
        placeholder: "https://www.fasel-hd.cam",
        description: "FaselHD mirror domain. Change if default is blocked. Examples: https://web71718x.faselhdx.bid"
      }
    ];
  });
}

module.exports = { getStreams: getStreams, onSettings: onSettings };
