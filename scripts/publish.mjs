import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_CMS = "https://cms.theatremaniac.com";
const CMS_URL = (process.env.WP_URL || DEFAULT_CMS).replace(/\/$/, "");
const WP_USER = process.env.WP_USER || "";
const WP_APP_PASSWORD = process.env.WP_APP_PASSWORD || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

const mimeTypes = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
]);

function usage() {
  return `Usage:
  node scripts/publish.mjs --file path/to/article.md --source-lang zh --target-lang en --status draft

Required env:
  WP_USER           WordPress username
  WP_APP_PASSWORD   WordPress application password

Optional env:
  WP_URL            Defaults to ${DEFAULT_CMS}
  OPENAI_API_KEY    Enables automatic translation
  OPENAI_MODEL      Defaults to ${OPENAI_MODEL}

Markdown front matter:
  title: My article title
  slug: optional-slug
  excerpt: Optional summary
  tags: theatre, opera
  categories: Reviews
`;
}

function parseArgs(argv) {
  const args = { status: "draft", sourceLang: "zh", targetLang: "en" };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--file") args.file = value, i += 1;
    else if (key === "--source-lang") args.sourceLang = value, i += 1;
    else if (key === "--target-lang") args.targetLang = value, i += 1;
    else if (key === "--status") args.status = value, i += 1;
    else if (key === "--help" || key === "-h") args.help = true;
  }
  return args;
}

function parseFrontMatter(markdown) {
  if (!markdown.startsWith("---\n")) return [{}, markdown];
  const end = markdown.indexOf("\n---\n", 4);
  if (end === -1) return [{}, markdown];
  const raw = markdown.slice(4, end).trim();
  const meta = {};
  for (const line of raw.split("\n")) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) meta[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return [meta, markdown.slice(end + 5).trim()];
}

function csv(value = "") {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function authHeader() {
  return `Basic ${Buffer.from(`${WP_USER}:${WP_APP_PASSWORD}`).toString("base64")}`;
}

async function wpFetch(path, options = {}) {
  const res = await fetch(`${CMS_URL}${path}`, {
    ...options,
    headers: {
      Authorization: authHeader(),
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) {
    throw new Error(`WordPress ${res.status} ${path}\n${typeof json === "string" ? json : JSON.stringify(json, null, 2)}`);
  }
  return json;
}

async function getOrCreateTerm(taxonomy, name) {
  const search = new URLSearchParams({ search: name, per_page: "20" });
  const existing = await wpFetch(`/wp-json/wp/v2/${taxonomy}?${search}`);
  const match = existing.find((term) => term.name.toLowerCase() === name.toLowerCase());
  if (match) return match.id;

  const created = await wpFetch(`/wp-json/wp/v2/${taxonomy}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return created.id;
}

async function resolveTerms(meta) {
  const categories = await Promise.all(csv(meta.categories).map((name) => getOrCreateTerm("categories", name)));
  const tags = await Promise.all(csv(meta.tags).map((name) => getOrCreateTerm("tags", name)));
  return { categories, tags };
}

function resolveImagePath(markdownFile, src) {
  if (/^https?:\/\//i.test(src)) return null;
  const clean = src.split(/[?#]/)[0];
  return isAbsolute(clean) ? clean : join(dirname(markdownFile), clean);
}

async function uploadMedia(markdownFile, src, alt = "") {
  const filePath = resolveImagePath(markdownFile, src);
  if (!filePath) return { source_url: src, id: null };
  const bytes = await readFile(filePath);
  const filename = basename(filePath);
  const mime = mimeTypes.get(extname(filePath).toLowerCase()) || "application/octet-stream";
  const media = await wpFetch("/wp-json/wp/v2/media", {
    method: "POST",
    body: bytes,
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `attachment; filename="${filename.replaceAll('"', "")}"`,
    },
  });
  if (alt && media?.id) {
    await wpFetch(`/wp-json/wp/v2/media/${media.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alt_text: alt }),
    });
  }
  return media;
}

async function uploadImages(markdownFile, markdown) {
  const imageMap = new Map();
  const imagePattern = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const matches = [...markdown.matchAll(imagePattern)];
  for (const match of matches) {
    const [full, alt, src] = match;
    if (imageMap.has(src)) continue;
    const media = await uploadMedia(markdownFile, src, alt);
    imageMap.set(src, { media, alt, full });
    console.log(`uploaded image: ${src} -> ${media.source_url}`);
  }
  return imageMap;
}

function escapeHtml(value = "") {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inlineMarkdown(value = "") {
  return escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>');
}

function markdownToHtml(markdown, imageMap) {
  const normalized = markdown.replace(/\r\n/g, "\n").trim();
  const blocks = normalized.split(/\n{2,}/);
  const html = [];
  for (const block of blocks) {
    const trimmed = block.trim();
    const imageOnly = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imageOnly) {
      const [, alt, src] = imageOnly;
      const media = imageMap.get(src)?.media;
      html.push(`<figure><img src="${media?.source_url || src}" alt="${escapeHtml(alt)}">${alt ? `<figcaption>${escapeHtml(alt)}</figcaption>` : ""}</figure>`);
      continue;
    }
    if (trimmed.startsWith("### ")) html.push(`<h3>${inlineMarkdown(trimmed.slice(4))}</h3>`);
    else if (trimmed.startsWith("## ")) html.push(`<h2>${inlineMarkdown(trimmed.slice(3))}</h2>`);
    else if (trimmed.startsWith("# ")) html.push(`<h1>${inlineMarkdown(trimmed.slice(2))}</h1>`);
    else {
      const paragraph = trimmed
        .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
          const media = imageMap.get(src)?.media;
          return `<img src="${media?.source_url || src}" alt="${escapeHtml(alt)}">`;
        })
        .split("\n")
        .map(inlineMarkdown)
        .join("<br>");
      html.push(`<p>${paragraph}</p>`);
    }
  }
  return html.join("\n");
}

function protectImages(markdown) {
  const images = [];
  const text = markdown.replace(/!\[[^\]]*\]\([^)]+\)/g, (match) => {
    const token = `[[IMAGE_${images.length}]]`;
    images.push(match);
    return token;
  });
  return { text, images };
}

function restoreImages(markdown, images) {
  return markdown.replace(/\[\[IMAGE_(\d+)]]/g, (_, n) => images[Number(n)] || "");
}

async function translateMarkdown(markdown, sourceLang, targetLang) {
  if (!OPENAI_API_KEY) return "";
  const { text, images } = protectImages(markdown);
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        {
          role: "system",
          content: "Translate the article faithfully. Preserve Markdown headings, links, image placeholders like [[IMAGE_0]], paragraph breaks, titles of productions when appropriate, and critical tone. Return only translated Markdown.",
        },
        {
          role: "user",
          content: `Translate from ${sourceLang} to ${targetLang}:\n\n${text}`,
        },
      ],
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`OpenAI translation failed: ${JSON.stringify(json, null, 2)}`);
  const translated = json.output_text || json.output?.flatMap((item) => item.content || []).map((c) => c.text || "").join("") || "";
  return restoreImages(translated.trim(), images);
}

async function translateText(text, sourceLang, targetLang) {
  if (!OPENAI_API_KEY || !text) return "";
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        {
          role: "system",
          content: "Translate this title faithfully. Preserve proper nouns and production titles when appropriate. Return only the translated title.",
        },
        {
          role: "user",
          content: `Translate from ${sourceLang} to ${targetLang}: ${text}`,
        },
      ],
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`OpenAI title translation failed: ${JSON.stringify(json, null, 2)}`);
  return (json.output_text || json.output?.flatMap((item) => item.content || []).map((c) => c.text || "").join("") || "").trim();
}

async function createPost({ title, slug, excerpt, html, lang, status, featuredMedia, categories, tags }) {
  const query = new URLSearchParams();
  if (lang) query.set("lang", lang);
  const path = `/wp-json/wp/v2/posts${query.toString() ? `?${query}` : ""}`;
  return wpFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      slug,
      excerpt,
      content: html,
      status,
      featured_media: featuredMedia || undefined,
      categories: categories?.length ? categories : undefined,
      tags: tags?.length ? tags : undefined,
    }),
  });
}

async function linkTranslations(postId, lang, translations) {
  const query = new URLSearchParams({ lang });
  for (const [key, value] of Object.entries(translations)) {
    query.set(`translations[${key}]`, String(value));
  }
  return wpFetch(`/wp-json/wp/v2/posts/${postId}?${query}`, { method: "POST" });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.file) {
    console.log(usage());
    return;
  }
  if (!WP_USER || !WP_APP_PASSWORD) {
    throw new Error(`Missing WordPress credentials.\n\n${usage()}`);
  }

  const markdownFile = isAbsolute(args.file) ? args.file : join(process.cwd(), args.file);
  const raw = await readFile(markdownFile, "utf8");
  const [meta, markdown] = parseFrontMatter(raw);
  const title = meta.title || markdown.match(/^#\s+(.+)$/m)?.[1] || basename(markdownFile, extname(markdownFile));
  const excerpt = meta.excerpt || "";
  const slug = meta.slug || "";
  const terms = await resolveTerms(meta);

  const imageMap = await uploadImages(markdownFile, markdown);
  const featuredMedia = [...imageMap.values()].find((entry) => entry.media?.id)?.media?.id;
  const sourceHtml = markdownToHtml(markdown, imageMap);

  const sourcePost = await createPost({
    title,
    slug,
    excerpt,
    html: sourceHtml,
    lang: args.sourceLang,
    status: args.status,
    featuredMedia,
    ...terms,
  });
  console.log(`created ${args.sourceLang} post: ${sourcePost.link}`);

  let translatedPost = null;
  const translatedMarkdown = await translateMarkdown(markdown, args.sourceLang, args.targetLang);
  if (translatedMarkdown) {
    const translatedTitle = meta[`title_${args.targetLang}`] || await translateText(title, args.sourceLang, args.targetLang) || title;
    const translatedHtml = markdownToHtml(translatedMarkdown, imageMap);
    translatedPost = await createPost({
      title: translatedTitle,
      slug: slug ? `${slug}-${args.targetLang}` : "",
      excerpt,
      html: translatedHtml,
      lang: args.targetLang,
      status: args.status,
      featuredMedia,
      ...terms,
    });
    console.log(`created ${args.targetLang} post: ${translatedPost.link}`);
    await linkTranslations(translatedPost.id, args.targetLang, { [args.sourceLang]: sourcePost.id });
    await linkTranslations(sourcePost.id, args.sourceLang, { [args.targetLang]: translatedPost.id });
    console.log("linked translations in Polylang");
  } else {
    const out = markdownFile.replace(new RegExp(`${extname(markdownFile)}$`), `.${args.targetLang}.md`);
    await writeFile(out, `---\ntitle: ${title}\nsource_post_id: ${sourcePost.id}\n---\n\n`, "utf8");
    console.log(`OPENAI_API_KEY not set; created source post only. Translation draft placeholder: ${out}`);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
