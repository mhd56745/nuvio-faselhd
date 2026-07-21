var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => { try { step(generator.next(value)); } catch (e) { reject(e); } };
    var rejected = (value) => { try { step(generator.throw(value)); } catch (e) { reject(e); } };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};
var cheerio = require("cheerio-without-node-native");
var BASE = "https://www2.pelisforte.se";
var H = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "X-Requested-With": "XMLHttpRequest",
  "Referer": BASE + "/"
};

function getBaseUrl() {
  try {
    var s = (global.SCRAPER_SETTINGS || window.SCRAPER_SETTINGS || {}).baseUrl;
    if (s && String(s).trim().startsWith("http")) return String(s).trim().replace(/\/+$/, "");
  } catch (e) {}
  return BASE;
}

function getNonce(baseUrl) {
  return __async(this, null, function* () {
    try {
      var r = yield fetch(baseUrl, { headers: H });
      var html = yield r.text();
      var m = html.match(/torofilm_Public\s*=\s*\{[^}]*"nonce"\s*:\s*"([^"]+)"/);
      return m ? m[1] : "";
    } catch (e) { return ""; }
  });
}

function search(query, baseUrl, nonce) {
  return __async(this, null, function* () {
    var results = [];
    try {
      var r = yield fetch(baseUrl + "/wp-admin/admin-ajax.php", {
        method: "POST",
        headers: Object.assign({}, H, { "Content-Type": "application/x-www-form-urlencoded", "Referer": baseUrl + "/" }),
        body: "action=action_tr_search_suggest&nonce=" + nonce + "&term=" + encodeURIComponent(query)
      });
      var html = yield r.text();
      var links = html.match(/href="([^"]+)"/g);
      if (!links) return results;
      for (var i = 0; i < links.length; i++) {
        var href = links[i].replace('href="', "").replace('"', "");
        var label = "";
        var labelMatch = html.match(/<a[^>]+href="' + href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"[^>]*>([^<]+)/);
        if (labelMatch) label = labelMatch[1].trim();
        var slug = href.split("/").filter(Boolean).pop() || "";
        var yearMatch = slug.match(/(\d{4})/);
        var postIdMatch = slug.match(/(\d+)$/);
        results.push({
          title: label || slug,
          url: href,
          year: yearMatch ? parseInt(yearMatch[1]) : null,
          postId: postIdMatch ? postIdMatch[1] : null
        });
      }
    } catch (e) { console.error("[PelisForte] search fail:", e.message); }
    return results;
  });
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  return __async(this, null, function* () {
    mediaType = mediaType || "movie";
    var base = getBaseUrl();
    console.log("[PelisForte] base=" + base + " tmdb=" + tmdbId + " type=" + mediaType);
    // 1. TMDB
    var info = { title: "", year: null };
    try {
      var ep = mediaType === "tv" ? "tv" : "movie";
      var r = yield fetch("https://api.themoviedb.org/3/" + ep + "/" + tmdbId + "?api_key=439c478a771f35c05022f9feabcca01c", { headers: { "Accept": "application/json" } });
      var d = yield r.json();
      info.title = mediaType === "tv" ? d.name : d.title;
      var rd = mediaType === "tv" ? d.first_air_date : d.release_date;
      info.year = rd ? parseInt(rd.split("-")[0]) : null;
    } catch (e) { console.error("[PelisForte] TMDB fail:", e.message); }
    // 2. Nonce + Search
    var nonce = yield getNonce(base);
    console.log("[PelisForte] nonce=" + (nonce ? "ok" : "empty"));
    var results = yield search(info.title, base, nonce);
    if (results.length === 0) { console.log("[PelisForte] no results"); return []; }
    // 3. Pick best by year
    var pick = results[0];
    if (info.year) {
      for (var i = 0; i < results.length; i++) {
        if (results[i].year === info.year) { pick = results[i]; break; }
      }
    }
    console.log("[PelisForte] picked:", pick.title, pick.url);
    // 4. Fetch page
    var streams = [];
    try {
      var pr = yield fetch(pick.url, { headers: Object.assign({}, H, { "Referer": base + "/" }) });
      var ph = yield pr.text();
      var $ = cheerio.load(ph);
      // 5. Extract tab labels (server name + language)
      var tabLabels = [];
      $("ul.aa-tbs-video li a.btn").each(function(i, el) {
        var text = $(el).text().replace(/\s+/g, " ").trim();
        var serverMatch = text.match(/OPCI[ÓO]N\s*(\d+)/i);
        var num = serverMatch ? serverMatch[1] : String(i + 1);
        var lang = "";
        var langMatch = text.match(/(Latino|Castellano|Subtitulado|Español[^-]*)/i);
        if (langMatch) lang = langMatch[1].trim();
        tabLabels.push({ num: num, lang: lang, full: text });
      });
      // 6. Extract iframe URLs from options-N divs
      var stitle = info.title + (info.year ? " (" + info.year + ")" : "");
      $("div[id^='options-']").each(function(i, el) {
        var iframe = $(el).find("iframe");
        var src = iframe.attr("src") || iframe.attr("data-src") || "";
        if (!src) return;
        var label = tabLabels[i] || { num: String(i + 1), lang: "", full: "Server " + (i + 1) };
        var langTag = label.lang ? " [" + label.lang + "]" : "";
        var serverTag = label.full.replace(/OPCI[ÓO]N\s*\d+\s*/i, "").trim();
        if (serverTag.length > 40) serverTag = serverTag.substring(0, 40);
        streams.push({
          name: "PelisForte " + serverTag + langTag,
          title: stitle,
          url: src,
          quality: "Auto",
          size: "Unknown",
          headers: Object.assign({}, H, { "Referer": pick.url }),
          provider: "pelisforte",
          subtitles: []
        });
      });
    } catch (e) { console.error("[PelisForte] page fail:", e.message); }
    console.log("[PelisForte] returning", streams.length, "streams");
    return streams;
  });
}

function onSettings() {
  return __async(this, null, function* () {
    return [
      { type: "header", label: "PelisForte" },
      { type: "text", key: "baseUrl", label: "Base URL", placeholder: "https://www2.pelisforte.se", description: "Mirror domain if default blocked" }
    ];
  });
}

module.exports = { getStreams: getStreams, onSettings: onSettings };