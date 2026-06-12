const DEFAULT_CMS = "https://cms.theatremaniac.com";
const CMS_URL = (process.env.WP_URL || DEFAULT_CMS).replace(/\/$/, "");
const WP_USER = process.env.WP_USER || "";
const WP_APP_PASSWORD = process.env.WP_APP_PASSWORD || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

function usage() {
  return `Usage:
  node scripts/postprocess.mjs --post-id 123 --source-lang zh --target-lang en --status publish

What it does after you publish from Ulysses:
  - cleans fixed image widths, inline styles, and old imported markup
  - infers useful tags
  - translates the article
  - creates the target-language post
  - links both posts in Polylang

Required env:
  WP_USER
  WP_APP_PASSWORD

Optional env:
  WP_URL            Defaults to ${DEFAULT_CMS}
  OPENAI_API_KEY    Enables AI tags and translation
  OPENAI_MODEL      Defaults to ${OPENAI_MODEL}
`;
}

function parseArgs(argv) {
  const args = { status: "publish", sourceLang: "zh", targetLang: "en" };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--post-id") args.postId = value, i += 1;
    else if (key === "--source-lang") args.sourceLang = value, i += 1;
    else if (key === "--target-lang") args.targetLang = value, i += 1;
    else if (key === "--status") args.status = value, i += 1;
    else if (key === "--tags") args.tags = value, i += 1;
    else if (key === "--help" || key === "-h") args.help = true;
  }
  return args;
}

function authHeader() {
  return `Basic ${Buffer.from(`${WP_USER}:${WP_APP_PASSWORD}`).toString("base64")}`;
}

async function wpFetch(path, options = {}) {
  const url = `${CMS_URL}${path}`;
  let res;
  try {
    res = await fetch(url, {
      ...options,
      headers: {
        Authorization: authHeader(),
        ...(options.headers || {}),
      },
    });
  } catch (error) {
    const cause = error.cause ? ` (${error.cause.code || error.cause.message || error.cause})` : "";
    throw new Error(`Network error calling WordPress ${url}: ${error.message}${cause}`);
  }
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

function stripTags(html = "") {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAssetUrls(html = "") {
  return html
    .replace(/https?:\/\/cms\.theatremaniac\.com\/wp-content\/uploads\/https?:\/\/cms\.theatremaniac\.com\/wp-content\/uploads\//g, `${CMS_URL}/wp-content/uploads/`)
    .replace(/https?:\/\/i[0-3]\.wp\.com\/theatremaniac\.com(\/wp-content\/[^"'\s?]+)(\?[^"'\s]*)?/g, `${CMS_URL}$1`)
    .replaceAll("https://theatremaniac.com/wp-content/", `${CMS_URL}/wp-content/`)
    .replaceAll("http://theatremaniac.com/wp-content/", `${CMS_URL}/wp-content/`)
    .replace(new RegExp(`${CMS_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/wp-content/uploads/${CMS_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/wp-content/uploads/`, "g"), `${CMS_URL}/wp-content/uploads/`);
}

function cleanPostHtml(html = "") {
  return normalizeAssetUrls(html)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\s(?:style|width|height|sizes)=["'][^"']*["']/gi, "")
    .replace(/\sdata-[A-Za-z0-9_-]+=["'][^"']*["']/gi, "")
    .replace(/\sclass=["']([^"']*)["']/gi, (_, classValue) => {
      const kept = classValue
        .split(/\s+/)
        .filter((name) => !/^(js_darkmode__\d+|alignnone|aligncenter|alignleft|alignright|size-.+|wp-image-\d+)$/.test(name))
        .join(" ");
      return kept ? ` class="${kept}"` : "";
    })
    .replace(/<p>\s*(<img\b[^>]*>)\s*<\/p>/gi, "<figure>$1</figure>");
}

function csv(value = "") {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openaiResponses(body, label) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let res;
    try {
      res = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      const cause = error.cause ? ` (${error.cause.code || error.cause.message || error.cause})` : "";
      lastError = new Error(`Network error calling OpenAI ${label}: ${error.message}${cause}`);
      if (attempt < 3) await sleep(1500 * attempt);
      continue;
    }

    const json = await res.json();
    if (res.ok) {
      return json;
    }

    const message = JSON.stringify(json, null, 2);
    lastError = new Error(`OpenAI ${label} failed: ${message}`);
    const retryable = res.status === 429 || res.status >= 500 || json?.error?.type === "server_error";
    if (!retryable || attempt === 3) {
      throw lastError;
    }
    await sleep(1500 * attempt);
  }
  throw lastError;
}

function openaiText(json) {
  return json.output_text || json.output?.flatMap((item) => item.content || []).map((c) => c.text || "").join("") || "";
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

async function inferTags(title, html, sourceLang) {
  if (!OPENAI_API_KEY) return [];
  try {
    const json = await openaiResponses({
        model: OPENAI_MODEL,
        input: [
          {
            role: "system",
            content: "Create 5 to 8 concise WordPress tags for a theatre criticism website. Prefer production title, art form, city, venue, director, company, festival, and theme. Return comma-separated tags only.",
          },
          {
            role: "user",
            content: `Language: ${sourceLang}\nTitle: ${title}\nArticle:\n${stripTags(html).slice(0, 6000)}`,
          },
        ],
      }, "tag inference");
    return csv(openaiText(json)).slice(0, 8);
  } catch (error) {
    console.warn(`${error.message}\nContinuing with fallback tags.`);
    return ["Review", "Theatre"];
  }
}

function protectMedia(html) {
  const media = [];
  const text = html.replace(/<figure[\s\S]*?<\/figure>|<img\b[^>]*>/gi, (match) => {
    const token = `[[MEDIA_${media.length}]]`;
    media.push(match);
    return token;
  });
  return { text, media };
}

function restoreMedia(html, media) {
  return html.replace(/\[\[MEDIA_(\d+)]]/g, (_, n) => media[Number(n)] || "");
}

async function translateHtml(html, title, sourceLang, targetLang) {
  if (!OPENAI_API_KEY) return "";
  const { text, media } = protectMedia(html);
  const json = await openaiResponses({
    model: OPENAI_MODEL,
    input: [
      {
        role: "system",
        content: "Translate this WordPress article faithfully. Preserve HTML tags, paragraph structure, links, and placeholders like [[MEDIA_0]]. Return only translated HTML.",
      },
      {
        role: "user",
        content: `Translate from ${sourceLang} to ${targetLang}.\nTitle: ${title}\n\n${text}`,
      },
    ],
  }, "translation");
  const output = openaiText(json);
  return restoreMedia(output.trim(), media);
}

async function translateText(text, sourceLang, targetLang) {
  if (!OPENAI_API_KEY || !text) return "";
  const json = await openaiResponses({
    model: OPENAI_MODEL,
    input: [
      { role: "system", content: "Translate this title faithfully. Preserve proper nouns when appropriate. Return only the translated title." },
      { role: "user", content: `Translate from ${sourceLang} to ${targetLang}: ${text}` },
    ],
  }, "title translation");
  return openaiText(json).trim();
}

async function updatePost(postId, body, lang) {
  const query = new URLSearchParams();
  if (lang) query.set("lang", lang);
  return wpFetch(`/wp-json/wp/v2/posts/${postId}${query.toString() ? `?${query}` : ""}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createPost(body, lang) {
  const query = new URLSearchParams();
  if (lang) query.set("lang", lang);
  return wpFetch(`/wp-json/wp/v2/posts${query.toString() ? `?${query}` : ""}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function linkTranslations(postId, lang, translations) {
  const query = new URLSearchParams({ lang });
  for (const [key, value] of Object.entries(translations)) {
    query.set(`translations[${key}]`, String(value));
  }
  return wpFetch(`/wp-json/wp/v2/posts/${postId}?${query}`, { method: "POST" });
}

function rendered(value) {
  return typeof value === "string" ? value : value?.rendered || value?.raw || "";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.postId) {
    console.log(usage());
    return;
  }
  if (!WP_USER || !WP_APP_PASSWORD) {
    throw new Error(`Missing WordPress credentials.\n\n${usage()}`);
  }

  const post = await wpFetch(`/wp-json/wp/v2/posts/${args.postId}?context=edit`);
  const title = stripTags(rendered(post.title));
  const cleanedHtml = cleanPostHtml(rendered(post.content));
  const manualTags = csv(args.tags);
  const aiTags = manualTags.length ? [] : await inferTags(title, cleanedHtml, args.sourceLang);
  const tagNames = [...new Set([...manualTags, ...aiTags])];
  const tagIds = await Promise.all(tagNames.map((name) => getOrCreateTerm("tags", name)));

  const sourcePost = await updatePost(args.postId, {
    content: cleanedHtml,
    tags: tagIds,
  }, args.sourceLang);
  console.log(`cleaned source post: ${sourcePost.link}`);
  if (tagNames.length) console.log(`tags: ${tagNames.join(", ")}`);

  const translatedHtml = await translateHtml(cleanedHtml, title, args.sourceLang, args.targetLang);
  if (!translatedHtml) {
    console.log("OPENAI_API_KEY not set; skipped translation.");
    return;
  }

  const translatedTitle = await translateText(title, args.sourceLang, args.targetLang) || title;
  const translatedPost = await createPost({
    title: translatedTitle,
    content: translatedHtml,
    excerpt: stripTags(rendered(post.excerpt)),
    status: args.status,
    featured_media: post.featured_media || undefined,
    categories: post.categories || undefined,
    tags: tagIds,
  }, args.targetLang);
  console.log(`created ${args.targetLang} post: ${translatedPost.link}`);

  await linkTranslations(translatedPost.id, args.targetLang, { [args.sourceLang]: Number(args.postId) });
  await linkTranslations(args.postId, args.sourceLang, { [args.targetLang]: translatedPost.id });
  console.log("linked translations in Polylang");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
