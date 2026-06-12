import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = "https://theatremaniac.com";
const OUT = new URL("../dist/", import.meta.url);
const STYLE = new URL("../src/styles.css", import.meta.url);
const BASE_PATH = (process.env.BASE_PATH || "").replace(/\/$/, "");
const PUBLIC_URL = (process.env.PUBLIC_URL || "").replace(/\/$/, "");

const pairs = new Map([
  [119, 120],
  [120, 119],
  [123, 124],
  [124, 123],
  [128, 129],
  [129, 128],
  [131, 130],
  [130, 131],
  [132, 133],
  [133, 132],
]);

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

function localPostUrl(post) {
  return `/posts/${post.id}-${post.slug}/`;
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
          <strong>Theatre Maniac</strong>
          <span>Reviews / Essays / Performance</span>
        </a>
        <nav class="nav" aria-label="Main navigation">
          <a href="${pathTo("/")}">Home</a>
          <a href="${pathTo("/articles/")}">Articles</a>
          <a href="${SITE}/wp-admin/">WP Admin</a>
        </nav>
      </div>
    </header>
    ${body}
    <footer class="site-footer">
      <div class="wrap">Powered by WordPress as a headless CMS. Frontend prototype generated locally.</div>
    </footer>
  </body>
</html>`;
}

function card(post) {
  const title = stripTags(post.title.rendered);
  const img = firstImage(post.content.rendered);
  const excerpt = stripTags(post.excerpt.rendered).slice(0, 145);
  return `<article class="post-card">
    ${img ? `<a href="${pathTo(localPostUrl(post))}"><img src="${escapeHtml(img)}" alt=""></a>` : ""}
    <div class="post-card-body">
      <div class="meta">${fmtDate(post.date)} / ${languageOf(post).toUpperCase()}</div>
      <h3><a href="${pathTo(localPostUrl(post))}">${escapeHtml(title)}</a></h3>
      <p>${escapeHtml(excerpt)}${excerpt.length >= 145 ? "..." : ""}</p>
    </div>
  </article>`;
}

async function writePage(path, html) {
  const file = new URL(path.replace(/^\//, ""), OUT);
  const filename = fileURLToPath(file);
  await mkdir(dirname(filename), { recursive: true });
  await writeFile(file, html);
}

function cleanContent(html = "") {
  return html
    .replaceAll(SITE, "")
    .replace(/(src|href)=["']\/wp-content\//g, `$1="${SITE}/wp-content/`)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(new URL("assets/", OUT), { recursive: true });
  await writeFile(new URL("assets/styles.css", OUT), await readFile(STYLE, "utf8"));

  const posts = await fetchJson(`${SITE}/wp-json/wp/v2/posts?per_page=100&_fields=id,slug,date,title,excerpt,content,link`);
  const postById = new Map(posts.map((post) => [post.id, post]));
  const latest = posts[0];

  await writePage("/index.html", layout({
    title: "Home",
    body: `<main>
      <section class="hero">
        <div class="wrap hero-grid">
          <div>
            <p class="eyebrow">Independent theatre criticism</p>
            <h1>Sharp, elegant writing on theatre, opera, dance and performance.</h1>
            <p class="dek">A headless WordPress prototype: the writing stays in WordPress; the public site becomes fast, custom, and free from theme UI constraints.</p>
          </div>
          <article class="hero-card">
            ${firstImage(latest.content.rendered) ? `<img src="${escapeHtml(firstImage(latest.content.rendered))}" alt="">` : ""}
            <div class="hero-card-content">
              <div class="meta">Latest / ${fmtDate(latest.date)}</div>
              <h2>${escapeHtml(stripTags(latest.title.rendered))}</h2>
              <a class="button" href="${pathTo(localPostUrl(latest))}">Read review</a>
            </div>
          </article>
        </div>
      </section>
      <section class="section">
        <div class="wrap">
          <div class="section-title">
            <h2>Latest Articles</h2>
            <a href="${pathTo("/articles/")}">View all</a>
          </div>
          <div class="grid">${posts.slice(0, 6).map(card).join("")}</div>
        </div>
      </section>
    </main>`,
  }));

  await writePage("/articles/index.html", layout({
    title: "Articles",
    body: `<main class="section">
      <div class="wrap">
        <div class="section-title">
          <h1>Articles</h1>
          <span class="meta">${posts.length} imported posts</span>
        </div>
        <div class="grid">${posts.map(card).join("")}</div>
      </div>
    </main>`,
  }));

  for (const post of posts) {
    const translation = postById.get(pairs.get(post.id));
    const title = stripTags(post.title.rendered);
    await writePage(`${localPostUrl(post)}index.html`, layout({
      title,
      description: stripTags(post.excerpt.rendered),
      body: `<main class="article">
        <div class="meta">${fmtDate(post.date)} / ${languageOf(post).toUpperCase()}</div>
        <h1>${escapeHtml(title)}</h1>
        ${translation ? `<p class="meta">Translation pair: <a href="${pathTo(localPostUrl(translation))}">${escapeHtml(stripTags(translation.title.rendered))}</a></p>` : ""}
        <div class="article-content">${cleanContent(post.content.rendered)}</div>
      </main>`,
    }));
  }

  if (PUBLIC_URL) {
    const urls = ["/", "/articles/", ...posts.map(localPostUrl)];
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
