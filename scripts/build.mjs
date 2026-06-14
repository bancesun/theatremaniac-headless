import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CMS_SITE = (process.env.CMS_URL || "https://cms.theatremaniac.com").replace(/\/$/, "");
const LEGACY_SITE = "https://theatremaniac.com";
const OUT = new URL("../dist/", import.meta.url);
const STYLE = new URL("../src/styles.css", import.meta.url);
const BASE_PATH = (process.env.BASE_PATH || "").replace(/\/$/, "");
const PUBLIC_URL = (process.env.PUBLIC_URL || "").replace(/\/$/, "");

const translationGroups = [
  { slug: "modern-european-theatre-music", zh: 119, en: 120 },
  { slug: "juste-la-fin-du-monde", zh: 123, en: 124 },
  { slug: "in-c-sasha-waltz", zh: 128, en: 129 },
  { slug: "los-anos", zh: 131, en: 130 },
  { slug: "die-rauberinnen", zh: 132, en: 133 },
  { slug: "gier", zh: 150, en: 155 },
  { slug: "zwiegesprach", zh: 162, en: 165 },
  { slug: "applied-drama-berlin-theater-festival", zh: 117, en: 183 },
  { slug: "munich-immersive-theatre", zh: 121, en: 188 },
  { slug: "from-berlin-with-love", zh: 122, en: 193 },
  { slug: "the-three-sisters", zh: 125, en: 198 },
  { slug: "female-stand-up-comedy", zh: 126, en: 201 },
  { slug: "year-end-summary-2020", zh: 127, en: 204 },
  { slug: "count-audland", zh: 134, en: 209 },
  { slug: "it-cant-happen-here", en: 116, zh: 214 },
  { slug: "in-der-sache-j-robert-oppenheimer", en: 118, zh: 218 },
  { slug: "das-vermachtnis", zh: 234, en: 237 },
];

function decodeHtml(value = "") {
  return value
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#039;/g, "'");
}

function stripTags(html = "") {
  return decodeHtml(html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function escapeHtml(value = "") {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function firstImage(html = "") {
  const src = html.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1];
  return src ? decodeHtml(src) : "";
}

function languageOf(post) {
  const title = stripTags(post.title.rendered);
  return /[\u3400-\u9fff]/.test(title + stripTags(post.excerpt.rendered)) ? "zh" : "en";
}

function reviewUrl(review) {
  return `/reviews/${review.slug}/`;
}

function pathTo(path) {
  if (/^https?:\/\//.test(path)) return path;
  return `${BASE_PATH}${path}`;
}

function absoluteUrl(path) {
  return PUBLIC_URL ? `${PUBLIC_URL}${path}` : path;
}

function fmtDate(value) {
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(new Date(value));
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status}`);
  }
  return res.json();
}

function layout({ title, description = "Independent theatre criticism across Europe.", body }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)} - Theatre Maniac</title>
    <meta name="description" content="${escapeHtml(description)}">
    <link rel="stylesheet" href="${pathTo("/assets/styles.css")}">
  </head>
  <body>
    <header class="site-header">
      <div class="header-inner">
        <a class="brand" href="${pathTo("/")}">
          <span class="brand-mark" aria-hidden="true">TM</span>
          <span class="brand-copy">
            <strong>Theatre Maniac</strong>
            <span>Reviews / Essays / Performance</span>
          </span>
        </a>
        <nav class="nav" aria-label="Main navigation">
          <a href="${pathTo("/")}">Home</a>
          <a href="${pathTo("/articles/")}">Articles</a>
          <button type="button" data-global-lang="en" aria-pressed="true">EN</button>
          <button type="button" data-global-lang="zh" aria-pressed="false">中文</button>
          <a href="${CMS_SITE}/wp-admin/">WP Admin</a>
        </nav>
      </div>
    </header>
    ${body}
    <footer class="site-footer">
      <div class="wrap footer-inner">
        <a class="footer-brand" href="${pathTo("/")}">
          <span class="brand-mark" aria-hidden="true">TM</span>
          <span>Theatre Maniac</span>
        </a>
        <nav class="footer-nav" aria-label="Footer navigation">
          <a href="${pathTo("/articles/")}">Articles</a>
          <a href="${CMS_SITE}/wp-admin/">Editor Login</a>
        </nav>
      </div>
    </footer>
    <script>
      (() => {
        const store = localStorage;
        const fromUrl = new URLSearchParams(location.search).get("lang");
        const navLang = navigator.language && navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
        const saved = store.getItem("tm_lang");
        let globalLang = (saved && ["en","zh"].includes(saved)) ? saved : navLang;
        if (fromUrl && ["en","zh"].includes(fromUrl)) globalLang = fromUrl;
        store.setItem("tm_lang", globalLang);
        const applyGlobalLang = (lang) => {
          store.setItem("tm_lang", lang);
          document.documentElement.lang = lang === "zh" ? "zh-Hans" : "en";
          document.querySelectorAll("[data-global-lang]").forEach((btn) => {
            btn.setAttribute("aria-pressed", btn.dataset.globalLang === lang ? "true" : "false");
          });
          document.querySelectorAll("[data-language-root]").forEach((root) => {
            const available = (root.dataset.available || "").split(",");
            if (!available.includes(lang)) return;
            root.querySelectorAll("[data-language-panel]").forEach((panel) => {
              panel.hidden = panel.dataset.languagePanel !== lang;
            });
            root.querySelectorAll("[data-language-button]").forEach((button) => {
              button.setAttribute("aria-pressed", button.dataset.languageButton === lang ? "true" : "false");
            });
          });
        };
        document.addEventListener("click", (event) => {
          const globalBtn = event.target.closest("[data-global-lang]");
          if (globalBtn) {
            event.preventDefault();
            const lang = globalBtn.dataset.globalLang;
            applyGlobalLang(lang);
            const url = new URL(location.href);
            url.searchParams.set("lang", lang);
            history.replaceState(null, "", url);
          }
          const articleBtn = event.target.closest("[data-language-button]");
          if (articleBtn) {
            applyGlobalLang(articleBtn.dataset.languageButton);
          }
        });
        applyGlobalLang(globalLang);
        if (!fromUrl) {
          const url = new URL(location.href);
          url.searchParams.set("lang", globalLang);
          history.replaceState(null, "", url);
        }
      })();
      (() => {
        const slider = document.querySelector("[data-feature-slider]");
        if (!slider) return;
        const slides = [...slider.querySelectorAll("[data-slide]")];
        const dots = [...slider.querySelectorAll("[data-slide-dot]")];
        let current = 0;
        const show = (index) => {
          current = (index + slides.length) % slides.length;
          slides.forEach((slide, i) => {
            slide.hidden = i !== current;
          });
          dots.forEach((dot, i) => {
            dot.setAttribute("aria-current", i === current ? "true" : "false");
          });
        };
        slider.addEventListener("click", (event) => {
          const action = event.target.closest("[data-slide-action]");
          const dot = event.target.closest("[data-slide-dot]");
          if (action) show(current + Number(action.dataset.slideAction));
          if (dot) show(Number(dot.dataset.slideDot));
        });
        setInterval(() => show(current + 1), 7000);
      })();
    </script>
  </body>
</html>`;
}

function titleFor(review, preferred = "en") {
  const post = review.posts[preferred] || review.posts.zh || review.posts.en;
  return stripTags(post.title.rendered);
}

function excerptFor(review, preferred = "en") {
  const post = review.posts[preferred] || review.posts.zh || review.posts.en;
  return stripTags(post.excerpt.rendered);
}

function imageFor(review) {
  const post = review.posts.en || review.posts.zh;
  return normalizeAssetUrls(firstImage(post.content.rendered));
}

function dateFor(review) {
  const post = review.posts.en || review.posts.zh;
  return post.date;
}

function languageLabel(review) {
  const langs = Object.keys(review.posts);
  if (langs.length === 2) return "EN / 中文";
  return langs[0] === "zh" ? "中文" : "EN";
}

function card(review) {
  const title = titleFor(review);
  const subtitle = review.posts.zh && review.posts.en ? titleFor(review, "zh") : "";
  const img = imageFor(review);
  const excerpt = excerptFor(review).slice(0, 145);
  return `<article class="post-card">
    ${img ? `<a href="${pathTo(reviewUrl(review))}"><img src="${escapeHtml(img)}" alt=""></a>` : ""}
    <div class="post-card-body">
      <div class="meta">${fmtDate(dateFor(review))} / ${languageLabel(review)}</div>
      <h3><a href="${pathTo(reviewUrl(review))}">${escapeHtml(title)}</a></h3>
      ${subtitle && subtitle !== title ? `<p class="subtitle">${escapeHtml(subtitle)}</p>` : ""}
      <p>${escapeHtml(excerpt)}${excerpt.length >= 145 ? "..." : ""}</p>
    </div>
  </article>`;
}

function slide(review, index) {
  const img = imageFor(review);
  const enPost = review.posts.en;
  const zhPost = review.posts.zh;
  const enTitle = enPost ? stripTags(enPost.title.rendered) : stripTags(zhPost.title.rendered);
  const zhTitle = zhPost ? stripTags(zhPost.title.rendered) : enTitle;
  const enExcerpt = enPost ? stripTags(enPost.excerpt.rendered).slice(0, 180) : "";
  const zhExcerpt = zhPost ? stripTags(zhPost.excerpt.rendered).slice(0, 180) : "";
  const mainDate = dateFor(review);
  const same = enTitle === zhTitle;
  return `<article class="feature-slide" data-slide="${index}" ${index ? "hidden" : ""}>
    ${img ? `<img src="${escapeHtml(img)}" alt="">` : ""}
    <div class="feature-copy">
      <div class="meta">${fmtDate(mainDate)} / EN / 中文</div>
      <h2 data-language-panel="en">${escapeHtml(enTitle)}</h2>
      <h2 data-language-panel="zh" hidden>${escapeHtml(zhTitle)}</h2>
      <p data-language-panel="en">${escapeHtml(enExcerpt)}${enExcerpt.length >= 180 ? "…" : ""}</p>
      <p data-language-panel="zh" hidden>${escapeHtml(zhExcerpt)}${zhExcerpt.length >= 180 ? "…" : ""}</p>
      <a class="button" href="${pathTo(reviewUrl(review))}" data-language-panel="en">Read review</a>
      <a class="button" href="${pathTo(reviewUrl(review))}" data-language-panel="zh" hidden>阅读文章</a>
    </div>
  </article>`;
}

async function writePage(path, html) {
  const file = new URL(path.replace(/^\//, ""), OUT);
  const filename = fileURLToPath(file);
  await mkdir(dirname(filename), { recursive: true });
  await writeFile(file, html);
}

function normalizeAssetUrls(html = "") {
  return html
    .replace(/https?:\/\/cms\.theatremaniac\.com\/wp-content\/uploads\/https?:\/\/cms\.theatremaniac\.com\/wp-content\/uploads\//g, `${CMS_SITE}/wp-content/uploads/`)
    .replace(/https?:\/\/i[0-3]\.wp\.com\/theatremaniac\.com(\/wp-content\/[^"'\s?]+)(\?[^"'\s]*)?/g, `${CMS_SITE}$1`)
    .replaceAll(`${LEGACY_SITE}/wp-content/`, `${CMS_SITE}/wp-content/`)
    .replaceAll("http://theatremaniac.com/wp-content/", `${CMS_SITE}/wp-content/`)
    .replaceAll(`${CMS_SITE}/wp-content/`, `${CMS_SITE}/wp-content/`)
    .replace(new RegExp(`${CMS_SITE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/wp-content/uploads/${CMS_SITE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/wp-content/uploads/`, "g"), `${CMS_SITE}/wp-content/uploads/`);
}

function cleanContent(html = "") {
  return normalizeAssetUrls(html)
    .replaceAll(LEGACY_SITE, "")
    .replace(/(src|href)=["']\/wp-content\//g, `$1="${CMS_SITE}/wp-content/`)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\s(?:style|width|height|sizes)=["'][^"']*["']/gi, "")
    .replace(/\sdata-(?:darkmode|style|autoskip|lazy-src|lazyloaded)[A-Za-z0-9_-]*=["'][^"']*["']/gi, "")
    .replace(/\sclass=["'](?:js_darkmode__[0-9]+|alignnone|aligncenter|alignleft|alignright|size-[^"']+|wp-image-[0-9]+|wp-caption|wp-caption-text)(?:\s[^"']*)?["']/gi, (match) => {
      const classValue = match.match(/["']([^"']*)["']/)?.[1] || "";
      const kept = classValue
        .split(/\s+/)
        .filter((name) => !/^(js_darkmode__\d+|alignnone|aligncenter|alignleft|alignright|size-.+|wp-image-\d+)$/.test(name))
        .join(" ");
      return kept ? ` class="${kept}"` : "";
    });
}

function buildReviews(posts) {
  const postById = new Map(posts.map((post) => [post.id, post]));
  const grouped = [];
  const used = new Set();

  for (const group of translationGroups) {
    const postsByLanguage = {};
    if (postById.has(group.en)) postsByLanguage.en = postById.get(group.en);
    if (postById.has(group.zh)) postsByLanguage.zh = postById.get(group.zh);
    Object.values(postsByLanguage).forEach((post) => used.add(post.id));
    if (Object.keys(postsByLanguage).length) {
      grouped.push({ slug: group.slug, posts: postsByLanguage });
    }
  }

  for (const post of posts) {
    if (used.has(post.id)) continue;
    const lang = languageOf(post);
    grouped.push({
      slug: `${post.id}-${post.slug}`,
      posts: { [lang]: post },
    });
  }

  return grouped.sort((a, b) => new Date(dateFor(b)) - new Date(dateFor(a)));
}

function languageSwitcher(review) {
  const langs = Object.keys(review.posts);
  if (langs.length < 2) return "";
  return `<div class="language-switcher" aria-label="Article language switcher">
    ${langs.includes("en") ? `<button type="button" data-language-button="en">English</button>` : ""}
    ${langs.includes("zh") ? `<button type="button" data-language-button="zh">中文</button>` : ""}
  </div>`;
}

function articlePanel(post, lang, fallbackHidden) {
  const title = stripTags(post.title.rendered);
  return `<section data-language-panel="${lang}" ${fallbackHidden ? "hidden" : ""}>
    <div class="meta">${fmtDate(post.date)} / ${lang === "zh" ? "中文" : "EN"}</div>
    <h1>${escapeHtml(title)}</h1>
    <div class="article-content">${cleanContent(post.content.rendered)}</div>
  </section>`;
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(new URL("assets/", OUT), { recursive: true });
  await writeFile(new URL("assets/styles.css", OUT), await readFile(STYLE, "utf8"));

  const posts = await fetchJson(`${CMS_SITE}/wp-json/wp/v2/posts?per_page=100&_fields=id,slug,date,title,excerpt,content,link`);
  const reviews = buildReviews(posts);
  const featured = reviews.filter(imageFor).slice(0, 5);

  await writePage("/index.html", layout({
    title: "Home",
    body: `<main>
      <section class="hero" data-language-root data-available="en,zh">
        <div class="wrap hero-layout">
          <div>
            <p class="eyebrow" data-language-panel="en">European theatre criticism</p>
            <p class="eyebrow" data-language-panel="zh" hidden>欧洲剧场评论</p>
            <h1 data-language-panel="en">Theatre, dance, opera and performance across European stages.</h1>
            <h1 data-language-panel="zh" hidden>剧场、舞蹈、歌剧与表演，纵观欧洲舞台。</h1>
            <p class="dek" data-language-panel="en">Reviews and essays for readers who care about direction, bodies, music, space and the strange electricity of live performance.</p>
            <p class="dek" data-language-panel="zh" hidden>关于欧洲当代剧场演出的评论与随笔，关注导演、肢体、音乐、空间与现场表演的奇异电光。</p>
          </div>
          <aside class="issue-note">
            <span class="brand-mark" aria-hidden="true">TM</span>
            <p data-language-panel="en">Independent notes on contemporary stages, festivals and performance culture.</p>
            <p data-language-panel="zh" hidden>关于当代舞台、戏剧节与表演文化的独立笔记。</p>
          </aside>
        </div>
      </section>
      <section class="feature-section" data-language-root data-available="en,zh">
        <div class="wrap">
          <div class="feature-shell" data-feature-slider>
            <div class="feature-header">
              <p class="eyebrow" data-language-panel="en">Featured</p>
              <p class="eyebrow" data-language-panel="zh" hidden>精选</p>
              <div class="slide-controls" aria-label="Featured article controls">
                <button type="button" data-slide-action="-1" aria-label="Previous featured article">‹</button>
                <button type="button" data-slide-action="1" aria-label="Next featured article">›</button>
              </div>
            </div>
            <div class="feature-slides">
              ${featured.map(slide).join("")}
            </div>
            <div class="slide-dots" aria-label="Choose featured article">
              ${featured.map((_, index) => `<button type="button" data-slide-dot="${index}" ${index ? "" : `aria-current="true"`}>${index + 1}</button>`).join("")}
            </div>
          </div>
        </div>
      </section>
      <section class="section">
        <div class="wrap">
          <div class="section-title">
            <h2 data-language-panel="en">Latest Articles</h2>
            <h2 data-language-panel="zh" hidden>最新文章</h2>
            <a href="${pathTo("/articles/")}">View all</a>
          </div>
          <div class="grid">${reviews.slice(0, 9).map(card).join("")}</div>
        </div>
      </section>
    </main>`,
  }));

  await writePage("/articles/index.html", layout({
    title: "Articles",
    body: `<main class="section">
      <div class="wrap">
        <div class="section-title" data-language-root data-available="en,zh">
          <h1 data-language-panel="en">Articles</h1>
          <h1 data-language-panel="zh" hidden>文章</h1>
          <span class="meta">${reviews.length} reviews / ${posts.length} posts</span>
        </div>
        <div class="grid">${reviews.map(card).join("")}</div>
      </div>
    </main>`,
  }));

  for (const review of reviews) {
    const langs = Object.keys(review.posts);
    const defaultLang = review.posts.en ? "en" : langs[0];
    await writePage(`${reviewUrl(review)}index.html`, layout({
      title: titleFor(review, defaultLang),
      description: excerptFor(review, defaultLang),
      body: `<main class="article" data-language-root data-available="${langs.join(",")}">
        ${languageSwitcher(review)}
        ${langs.map((lang) => articlePanel(review.posts[lang], lang, lang !== defaultLang)).join("")}
      </main>`,
    }));
  }

  if (PUBLIC_URL) {
    const urls = ["/", "/articles/", ...reviews.map(reviewUrl)];
    await writePage("/sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url><loc>${escapeHtml(absoluteUrl(url))}</loc></url>`).join("\n")}
</urlset>`);
  }

  await writePage("/robots.txt", `User-agent: *
Allow: /
${PUBLIC_URL ? `Sitemap: ${PUBLIC_URL}/sitemap.xml\n` : ""}`);
  await writePage("/404.html", layout({
    title: "Not Found",
    body: `<main class="article"><h1>Page not found</h1><p><a href="${pathTo("/")}">Return home</a></p></main>`,
  }));

  console.log(`Generated ${posts.length} posts into ${OUT.pathname}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
