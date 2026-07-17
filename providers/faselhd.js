/**
 * FaselHD - Nuvio Provider
 * Arabic streaming site (fasel-hd.cam) with movie & TV show support
 * Supports multiple mirror domains and multiple server qualities
 */

const cheerio = require("cheerio-without-node-native");

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
  return best;
}

// ─── Search ───────────────────────────────────────────────────────────
function searchFaselHD(query, baseUrl) {
  return __async(this, null, function* () {
    var ajaxUrl = baseUrl + "/wp-admin/admin-ajax.php";
    var results = [];
    try {
      console.log("[FaselHD] Searching for:", query);
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
      if (!response.ok) {
        console.error("[FaselHD] Search AJAX failed:", response.status);
        return results;
      }
      var html = yield response.text();
      var $ = cheerio.load(html);

      // Parse search results - look for links with /movies/ or /episodes/
      $("a").each(function(i, el) {
        var href = $(el).attr("href") || "";
        var title = $(el).text().trim();
        // Remove Arabic prefix words for cleaner matching
        var cleanTitle = title.replace(/^(فيلم|مسلسل|أنمي|انمي)\s+/i, "").replace(/\s+(مترجم|مدبلج|اونلاين|كامل).*$/i, "").trim();
        if ((href.includes("/movies/") || href.includes("/episodes/") || href.includes("/series/")) && title.length > 2) {
          var yearMatch = title.match(/(\d{4})/);
          var year = yearMatch ? parseInt(yearMatch[1]) : null;
          results.push({
            title: cleanTitle || title,
            originalTitle: title,
            url: href,
            year: year
          });
        }
      });

      // Also try extracting from the main site search page if AJAX returns HTML with result items
      if (results.length === 0) {
        // Fallback: try the WordPress search endpoint
        var searchUrl = baseUrl + "/?s=" + encodeURIComponent(query) + "&post_type=post";
        var searchRes = yield fetch(searchUrl, {
          headers: Object.assign({}, HEADERS, { "Referer": baseUrl + "/" })
        });
        if (searchRes.ok) {
          var searchHtml = yield searchRes.text();
          var $s = cheerio.load(searchHtml);
          $s("article a, .post-item a, .result-item a").each(function(i, el) {
            var href2 = $s(el).attr("href") || "";
            var img = $s(el).find("img").first();
            var alt = img.attr("alt") || $s(el).text().trim();
            var cleanAlt = alt.replace(/^(فيلم|مسلسل|أنمي|انمي)\s+/i, "").replace(/\s+(مترجم|مدبلج|اونلاين|كامل).*$/i, "").trim();
            if ((href2.includes("/movies/") || href2.includes("/episodes/") || href2.includes("/series/")) && alt.length > 2) {
              var yearMatch2 = alt.match(/(\d{4})/);
              results.push({
                title: cleanAlt || alt,
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
  // Extract player_token URLs from server tabs: onclick="player_iframe.location.href = 'URL'"
  var onclickRegex = /player_iframe\.location\.href\s*=\s*['"]([^'"]+)['"]/g;
  var match;
  while ((match = onclickRegex.exec(html)) !== null) {
    tokens.push(match[1]);
  }
  // Also extract from data-src on iframe
  var dataSrcRegex = /data-src=["']([^"']*player_token[^"']*)["']/g;
  while ((match = dataSrcRegex.exec(html)) !== null) {
    if (tokens.indexOf(match[1]) === -1) {
      tokens.push(match[1]);
    }
  }
  // Also extract from any iframe src with video_player
  var iframeSrcRegex = /<iframe[^>]+src=["']([^"']*video_player[^"']*)["']/g;
  while ((match = iframeSrcRegex.exec(html)) !== null) {
    if (match[1] && tokens.indexOf(match[1]) === -1) {
      tokens.push(match[1]);
    }
  }

  // Normalize URLs (make absolute if relative)
  tokens = tokens.map(function(t) {
    if (t.startsWith("http")) return t;
    try {
      return new URL(t, pageUrl).toString();
    } catch (e) {
      return t;
    }
  });

  return tokens;
}

function extractDownloadLinks(html) {
  var links = [];
  var regex = /<a[^>]+href=["'](https?:\/\/[^"']+?)["'][^>]*>([^<]*?)<\/a>/gi;
  var match;
  while ((match = regex.exec(html)) !== null) {
    var url = match[1];
    var label = match[2].trim();
    // Skip navigation, social links, etc.
    if (url.includes("/wp-") || url.includes("facebook") || url.includes("twitter") ||
        url.includes("instagram") || url.includes("faselplus") || url.includes("google.com") ||
        url.includes("javascript:") || url.includes("#")) {
      continue;
    }
    // Keep download-like links (external file hosts)
    if (url.includes("/file/") || url.includes("/d/") || url.includes("/download/") ||
        url.includes(".mp4") || url.includes(".mkv") || url.includes("t7meel") ||
        url.includes("gofile") || url.includes("mega") || url.includes("drive.google")) {
      links.push({ url: url, label: label });
    }
  }
  return links;
}

// ─── Generic Stream Extractors ────────────────────────────────────────
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
  } catch (e) {
    return code;
  }
}

function extractM3U8FromHTML(html, referer) {
  var streams = [];
  // Try unpacking obfuscated JS first
  var content = html;
  if (content.includes("eval(function(p,a,c,k,e,d)")) {
    content = jsUnpack(content);
  }
  // Look for M3U8 URLs
  var m3u8Regex = /["'](https?:\/\/[^"']*\.m3u8[^"']*)["']/gi;
  var m;
  while ((m = m3u8Regex.exec(content)) !== null) {
    var m3u8Url = m[1];
    if (m3u8Url.startsWith("//")) m3u8Url = "https:" + m3u8Url;
    streams.push({
      quality: "Auto",
      url: m3u8Url,
      headers: Object.assign({}, HEADERS, { Referer: referer })
    });
  }
  // Look for MP4 URLs
  if (streams.length === 0) {
    var mp4Regex = /["'](https?:\/\/[^"']*\.mp4[^"']*)["']/gi;
    while ((m = mp4Regex.exec(content)) !== null) {
      var mp4Url = m[1];
      if (mp4Url.startsWith("//")) mp4Url = "https:" + mp4Url;
      streams.push({
        quality: "Auto",
        url: mp4Url,
        headers: Object.assign({}, HEADERS, { Referer: referer })
      });
    }
  }
  // Look for source/src in video-like JSON objects
  if (streams.length === 0) {
    var srcRegex = /(?:source|src|file|url)\s*[:=]\s*["'](https?:\/\/[^"']*(?:m3u8|mp4|mkv)[^"']*)["']/gi;
    while ((m = srcRegex.exec(content)) !== null) {
      var srcUrl = m[1];
      if (srcUrl.startsWith("//")) srcUrl = "https:" + srcUrl;
      streams.push({
        quality: "Auto",
        url: srcUrl,
        headers: Object.assign({}, HEADERS, { Referer: referer })
      });
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
      var md5 = md5Match[1];
      var passRes = yield fetch("https://dood.re/pass_md5/" + md5, {
        headers: Object.assign({}, HEADERS, { Referer: url })
      });
      var passContent = yield passRes.text();
      var finalUrl = passContent + "abc?token=" + md5 + "&expiry=" + Date.now();
      return [{ quality: "Auto", url: finalUrl, headers: Object.assign({}, HEADERS, { Referer: url }) }];
    } catch (e) {
      return [];
    }
  });
}

function streamTapeExtract(url) {
  return __async(this, null, function* () {
    try {
      var res = yield fetch(url, { headers: Object.assign({}, HEADERS, { Referer: url }) });
      var html = yield res.text();
      var match2 = html.match(/id="videolink">([^<]+)/);
      if (match2) {
        var videoUrl = "https:" + match2[1];
        return [{ quality: "Auto", url: videoUrl, headers: Object.assign({}, HEADERS, { Referer: url }) }];
      }
      return [];
    } catch (e) {
      return [];
    }
  });
}

function vidStackExtract(url) {
  return __async(this, null, function* () {
    try {
      var hash = url.includes("#") ? url.split("#").pop() : url.split("/").filter(Boolean).pop();
      if (!hash) return [];
      var urlObj = new URL(url);
      var baseurl = urlObj.protocol + "//" + urlObj.hostname;
      var apiUrl = baseurl + "/api/v1/video?id=" + hash;
      var response = yield fetch(apiUrl, { headers: Object.assign({}, HEADERS, { Referer: url }) });
      if (!response.ok) {
        var altUrl = baseurl + "/api/video?id=" + hash;
        var altRes = yield fetch(altUrl, { headers: Object.assign({}, HEADERS, { Referer: url }) });
        if (!altRes.ok) return [];
        var encoded = (yield altRes.text()).trim();
        // Try to find m3u8 in response
        var m3u8M = encoded.match(/["'](https?:\/\/[^"']*m3u8[^"']*)["']/i);
        if (m3u8M) return [{ quality: "Auto", url: m3u8M[1], headers: Object.assign({}, HEADERS, { Referer: url }) }];
        return [];
      }
      var text = yield response.text();
      var m3u8M2 = text.match(/["'](https?:\/\/[^"']*m3u8[^"']*)["']/i);
      if (m3u8M2) return [{ quality: "Auto", url: m3u8M2[1], headers: Object.assign({}, HEADERS, { Referer: url }) }];
      return [];
    } catch (e) {
      return [];
    }
  });
}

function resolveEmbedUrl(url) {
  return __async(this, null, function* () {
    try {
      var domain = new URL(url).hostname.toLowerCase();
      console.log("[FaselHD] Resolving embed from:", domain);

      // DoodStream
      if (domain.includes("dood")) {
        return yield doodStreamExtract(url);
      }
      // StreamTape
      if (domain.includes("streamtape") || domain.includes("streamta")) {
        return yield streamTapeExtract(url);
      }
      // VidStack / hubstream
      if (domain.includes("vidstack") || domain.includes("hubstream") || domain.includes("bigwarp")) {
        return yield vidStackExtract(url);
      }
      // Generic: fetch and extract
      var res = yield fetch(url, {
        headers: Object.assign({}, HEADERS, { Referer: url })
      });
      if (!res.ok) return [];
      var html = yield res.text();
      return extractM3U8FromHTML(html, url);
    } catch (e) {
      console.error("[FaselHD] Embed resolve error:", e.message);
      return [];
    }
  });
}

// ─── TV Series: Episode Page Discovery ───────────────────────────────
function findEpisodePage(html, baseUrl, season, episode) {
  var $ = cheerio.load(html);
  var episodeUrl = null;

  // Look for season/episode navigation links
  // Pattern 1: Links containing season and episode numbers
  $("a").each(function(i, el) {
    var href = $(el).attr("href") || "";
    var text = $(el).text().trim();
    // Match patterns like "الموسم 1 الحلقة 5" or "S01E05" or "s1e5"
    var seasonMatch = text.match(/(?:الموسم|موسم|season|s)\s*(\d+)/i);
    var epMatch = text.match(/(?:الحلقة|حلقة|episode|ep|e)\s*(\d+)/i);
    if (seasonMatch && epMatch) {
      var sNum = parseInt(seasonMatch[1]);
      var eNum = parseInt(epMatch[1]);
      if (sNum === season && eNum === episode && href) {
        episodeUrl = href.startsWith("http") ? href : baseUrl + href;
      }
    }
  });

  // Pattern 2: Look for episode listing with season tabs
  if (!episodeUrl) {
    // Try AJAX-based season/episode loading (common in WordPress Arabic themes)
    var postIdMatch = html.match(/post_id\s*[:=]\s*['"](\d+)['"]/);
    if (postIdMatch) {
      var postId = postIdMatch[1];
      // Look for season links with data attributes
      var seasonId = null;
      $("[data-season]").each(function(i, el) {
        var sText = $(el).text().trim();
        var sNumMatch = sText.match(/(\d+)/);
        var sNum = sNumMatch ? parseInt(sNumMatch[0]) : (i + 1);
        if (sNum === season) {
          seasonId = $(el).attr("data-season");
        }
      });
      if (seasonId) {
        // We'd need to make an AJAX call - return info for later processing
        return { ajaxSeason: seasonId, postId: postId };
      }
    }
  }

  // Pattern 3: Direct episode links on the page
  if (!episodeUrl) {
    $("a[href*='episode'], a[href*='episodes'], a[href*='حلقة']").each(function(i, el) {
      var href = $(el).attr("href") || "";
      var text = $(el).text().trim();
      var epNumMatch = text.match(/(\d+)/);
      if (epNumMatch && parseInt(epNumMatch[1]) === episode && href) {
        episodeUrl = href.startsWith("http") ? href : baseUrl + href;
      }
    });
  }

  return episodeUrl;
}

// ─── Main: getStreams ─────────────────────────────────────────────────
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  if (mediaType === undefined) mediaType = "movie";
  if (seasonNum === undefined) seasonNum = null;
  if (episodeNum === undefined) episodeNum = null;
  return __async(this, null, function* () {
    var baseUrl = getBaseUrl();
    console.log("[FaselHD] Base URL:", baseUrl);
    console.log("[FaselHD] Fetching streams for TMDB ID:", tmdbId, "Type:", mediaType);

    try {
      // 1. Get TMDB info
      var mediaInfo = yield getTMDBDetails(tmdbId, mediaType);
      var searchTitle = mediaInfo.title;
      if (mediaInfo.imdbId) {
        // Try IMDB ID as search query for better results
        searchTitle = mediaInfo.imdbId;
      }
      console.log("[FaselHD] Media info:", mediaInfo.title, mediaInfo.year ? "(" + mediaInfo.year + ")" : "");

      // 2. Search FaselHD
      var searchResults = yield searchFaselHD(searchTitle, baseUrl);
      if (searchResults.length === 0 && mediaInfo.imdbId) {
        // Fallback: search by title if IMDB search returned nothing
        searchResults = yield searchFaselHD(mediaInfo.title, baseUrl);
      }
      if (searchResults.length === 0) {
        console.log("[FaselHD] No search results found");
        return [];
      }

      // 3. Find best match
      var bestMatch = findBestMatch(mediaInfo, searchResults);
      var selectedMedia = bestMatch || searchResults[0];
      console.log("[FaselHD] Selected:", selectedMedia.title, selectedMedia.url);

      // 4. Fetch the media page
      var pageUrl = selectedMedia.url;
      var pageResponse = yield fetch(pageUrl, {
        headers: Object.assign({}, HEADERS, { Referer: baseUrl + "/" })
      });
      if (!pageResponse.ok) {
        console.error("[FaselHD] Failed to fetch page:", pageResponse.status);
        return [];
      }
      var pageHtml = yield pageResponse.text();

      // 5. For TV shows, try to find the specific episode page
      var finalPageUrl = pageUrl;
      var finalHtml = pageHtml;
      if (mediaType === "tv" && seasonNum && episodeNum) {
        var epResult = findEpisodePage(pageHtml, baseUrl, seasonNum, episodeNum);
        if (epResult && typeof epResult === "string") {
          // Direct episode URL found
          finalPageUrl = epResult;
          var epResponse = yield fetch(finalPageUrl, {
            headers: Object.assign({}, HEADERS, { Referer: pageUrl })
          });
          if (epResponse.ok) {
            finalHtml = yield epResponse.text();
          }
        }
      }

      // 6. Extract player tokens from the page
      var playerTokens = extractPlayerTokens(finalHtml, finalPageUrl);
      console.log("[FaselHD] Found", playerTokens.length, "player tokens");

      // 7. Extract download links
      var downloadLinks = extractDownloadLinks(finalHtml);
      console.log("[FaselHD] Found", downloadLinks.length, "download links");

      // 8. Build stream objects
      var streams = [];
      var streamTitle = mediaInfo.title;
      if (mediaInfo.year) streamTitle += " (" + mediaInfo.year + ")";
      if (mediaType === "tv" && seasonNum && episodeNum) {
        streamTitle = mediaInfo.title + " S" + String(seasonNum).padStart(2, "0") + "E" + String(episodeNum).padStart(2, "0");
      }

      // Process player token URLs
      for (var i = 0; i < playerTokens.length; i++) {
        var tokenUrl = playerTokens[i];
        var serverNum = i + 1;
        try {
          console.log("[FaselHD] Resolving player token #" + serverNum);
          // Fetch the video_player page (must use same session context)
          var playerRes = yield fetch(tokenUrl, {
            headers: Object.assign({}, HEADERS, {
              "Referer": finalPageUrl,
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
            })
          });
          if (!playerRes.ok) continue;
          var playerHtml = yield playerRes.text();

          // Check if token is invalid
          if (playerHtml.includes("Token Not Valid")) {
            console.log("[FaselHD] Token #" + serverNum + " is not valid (session-bound)");
            // Return the player URL as-is for iframe playback
            streams.push({
              name: "FaselHD Server " + String(serverNum).padStart(2, "0"),
              title: streamTitle,
              url: tokenUrl,
              quality: "Auto",
              size: "Unknown",
              headers: Object.assign({}, HEADERS, { Referer: finalPageUrl }),
              provider: "faselhd",
              subtitles: []
            });
            continue;
          }

          // Try to extract streaming URL from player page
          var extracted = extractM3U8FromHTML(playerHtml, tokenUrl);

          // Look for iframe embeds in the player page
          if (extracted.length === 0) {
            var iframeRegex2 = /<iframe[^>]+src=["'](https?:\/\/[^"']+)["']/gi;
            var iframeMatch;
            while ((iframeMatch = iframeRegex2.exec(playerHtml)) !== null) {
              var embedUrl = iframeMatch[1];
              if (embedUrl.includes("recaptcha") || embedUrl.includes("google.com")) continue;
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

          // If nothing extracted, return the player URL for iframe playback
          if (extracted.length === 0) {
            // Check if playerHtml has any embed URL
            var hasEmbed = /<iframe[^>]+src=["'](?!https?:\/\/www\.google)[^"']+["']/i.test(playerHtml);
            if (!hasEmbed) {
              streams.push({
                name: "FaselHD Server " + String(serverNum).padStart(2, "0"),
                title: streamTitle,
                url: tokenUrl,
                quality: "Auto",
                size: "Unknown",
                headers: Object.assign({}, HEADERS, { Referer: finalPageUrl }),
                provider: "faselhd",
                subtitles: []
              });
            }
          }
        } catch (err) {
          console.error("[FaselHD] Error resolving token #" + serverNum + ":", err.message);
          // Add fallback with player URL
          streams.push({
            name: "FaselHD Server " + String(serverNum).padStart(2, "0"),
            title: streamTitle,
            url: tokenUrl,
            quality: "Auto",
            size: "Unknown",
            headers: Object.assign({}, HEADERS, { Referer: finalPageUrl }),
            provider: "faselhd",
            subtitles: []
          });
        }
      }

      // Process download links as direct streams
      for (var d = 0; d < downloadLinks.length; d++) {
        var dl = downloadLinks[d];
        var dlQuality = "Auto";
        var qMatch = dl.label.match(/(\d{3,4}p|4K|HD|SD|BluRay|WEB-DL|WEBRip|BDRip|HDRip)/i);
        if (qMatch) {
          var q = qMatch[1].toUpperCase();
          if (q === "4K") dlQuality = "4K";
          else if (q.includes("1080") || q === "FHD" || q === "BLURAY") dlQuality = "1080p";
          else if (q.includes("720") || q === "HD" || q === "WEB-DL" || q === "WEBRIP") dlQuality = "720p";
          else if (q.includes("480") || q === "SD" || q === "BDRIP" || q === "HDRIP") dlQuality = "480p";
        }
        streams.push({
          name: "FaselHD DL " + (dl.label || "Download"),
          title: streamTitle,
          url: dl.url,
          quality: dlQuality,
          size: "Unknown",
          headers: Object.assign({}, HEADERS, { Referer: finalPageUrl }),
          provider: "faselhd",
          subtitles: []
        });
      }

      // Sort by quality
      var qualityOrder = { "4K": 5, "1440p": 4, "1080p": 3, "720p": 2, "480p": 1, "360p": 0, "Auto": -1, "Unknown": -2 };
      streams.sort(function(a, b) {
        return (qualityOrder[b.quality] || -2) - (qualityOrder[a.quality] || -2);
      });

      console.log("[FaselHD] Returning", streams.length, "streams");
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
        description: "FaselHD mirror domain. Change if the default is blocked. Examples: https://web71718x.faselhdx.bid, https://www.fasel-hd.cam"
      }
    ];
  });
}

module.exports = { getStreams: getStreams, onSettings: onSettings };
