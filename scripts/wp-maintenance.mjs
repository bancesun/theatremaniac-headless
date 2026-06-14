const DEFAULT_CMS = "https://cms.theatremaniac.com";
const CMS_URL = (process.env.WP_URL || DEFAULT_CMS).replace(/\/$/, "");
const WP_USER = process.env.WP_USER || "";
const WP_APP_PASSWORD = process.env.WP_APP_PASSWORD || "";

function usage() {
  return `Usage:
  node scripts/wp-maintenance.mjs --mode audit
  node scripts/wp-maintenance.mjs --mode apply --publish-ids 1,2 --trash-ids 3,4

Required env:
  WP_USER
  WP_APP_PASSWORD
`;
}

function parseArgs(argv) {
  const args = { mode: "audit", publishIds: [], trashIds: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--mode") args.mode = value, i += 1;
    else if (key === "--publish-ids") args.publishIds = csv(value), i += 1;
    else if (key === "--trash-ids") args.trashIds = csv(value), i += 1;
    else if (key === "--help" || key === "-h") args.help = true;
  }
  return args;
}

function csv(value = "") {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function authHeader() {
  return `Basic ${Buffer.from(`${WP_USER}:${WP_APP_PASSWORD}`).toString("base64")}`;
}

async function wpFetch(path, options = {}) {
  let res;
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      res = await fetch(`${CMS_URL}${path}`, {
        ...options,
        headers: {
          Authorization: authHeader(),
          ...(options.headers || {}),
        },
      });
      break;
    } catch (error) {
      lastError = error;
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, attempt * 2500));
    }
  }
  if (!res) {
    const cause = lastError?.cause ? ` (${lastError.cause.code || lastError.cause.message || lastError.cause})` : "";
    throw new Error(`Network error calling WordPress ${path}: ${lastError?.message || "fetch failed"}${cause}`);
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
  return { json, headers: res.headers };
}

function rendered(value) {
  return typeof value === "string" ? value : value?.rendered || value?.raw || "";
}

function stripTags(html = "") {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(text = "") {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\u4e00-\u9fff]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cjkCount(text = "") {
  return (text.match(/[\u3400-\u9fff]/g) || []).length;
}

function wordSet(text = "") {
  return new Set(normalizeText(text).split(" ").filter((word) => word.length > 2));
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection += 1;
  }
  return intersection / (a.size + b.size - intersection);
}

function summarizePost(post) {
  const title = stripTags(rendered(post.title));
  const text = stripTags(rendered(post.content));
  return {
    id: post.id,
    status: post.status,
    slug: post.slug,
    lang: post.lang || post.polylang_current_lang || "",
    translations: post.translations || {},
    title,
    link: post.link || "",
    modified: post.modified,
    cjk: cjkCount(text),
    words: wordSet(`${title} ${text.slice(0, 4000)}`),
  };
}

async function fetchPostsByStatus(status) {
  const fields = "id,slug,status,date,modified,title,content,excerpt,link,categories,tags,lang,translations,polylang_current_lang";
  const all = [];
  for (let page = 1; ; page += 1) {
    const params = new URLSearchParams({
      status,
      per_page: "100",
      page: String(page),
      context: "edit",
      _fields: fields,
    });
    const { json, headers } = await wpFetch(`/wp-json/wp/v2/posts?${params}`);
    all.push(...json);
    const totalPages = Number(headers.get("x-wp-totalpages") || "1");
    if (page >= totalPages) break;
  }
  return all;
}

function findClosest(post, candidates) {
  let best = null;
  for (const candidate of candidates) {
    const titleSame = normalizeText(post.title) === normalizeText(candidate.title);
    const titleIncludes = normalizeText(post.title).includes(normalizeText(candidate.title)) || normalizeText(candidate.title).includes(normalizeText(post.title));
    const score = Math.max(jaccard(post.words, candidate.words), titleSame ? 1 : 0, titleIncludes ? 0.85 : 0);
    if (!best || score > best.score) best = { ...candidate, score };
  }
  return best;
}

async function audit() {
  const draftishRaw = [
    ...(await fetchPostsByStatus("draft")),
    ...(await fetchPostsByStatus("pending")),
    ...(await fetchPostsByStatus("future")),
    ...(await fetchPostsByStatus("private")),
  ];
  const publishedRaw = await fetchPostsByStatus("publish");
  const draftish = draftishRaw.map(summarizePost);
  const published = publishedRaw.map(summarizePost);

  console.log(`# WordPress draft/copy audit`);
  console.log(`CMS: ${CMS_URL}`);
  console.log(`Draft/pending/future/private posts: ${draftish.length}`);
  console.log(`Published posts: ${published.length}`);

  if (!draftish.length) {
    console.log("\nNo draft-like posts found.");
    return;
  }

  console.log("\n## Draft-like posts");
  for (const post of draftish) {
    const closest = findClosest(post, published);
    const likelyCopy = closest && closest.score >= 0.82;
    const likelySource = !likelyCopy && post.cjk >= 20;
    const recommendation = likelyCopy
      ? `TRASH_COPY_OF_${closest.id}`
      : likelySource
        ? "PUBLISH_AND_POSTPROCESS_ZH_SOURCE"
        : "REVIEW_MANUALLY";
    console.log(`- ID ${post.id} [${post.status}] ${post.title}`);
    console.log(`  lang=${post.lang || "unknown"} cjk=${post.cjk} modified=${post.modified}`);
    console.log(`  recommendation=${recommendation}`);
    if (closest) {
      console.log(`  closest_published=ID ${closest.id} score=${closest.score.toFixed(2)} title=${closest.title}`);
    }
    if (post.link) console.log(`  link=${post.link}`);
  }
}

async function updatePost(id, body) {
  const { json } = await wpFetch(`/wp-json/wp/v2/posts/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return json;
}

async function applyChanges(args) {
  for (const id of args.publishIds) {
    const post = await updatePost(id, { status: "publish" });
    console.log(`published ID ${id}: ${post.link}`);
  }
  for (const id of args.trashIds) {
    const post = await wpFetch(`/wp-json/wp/v2/posts/${id}`, { method: "DELETE" });
    console.log(`trashed ID ${id}: ${rendered(post.json?.title) || post.json?.id || "ok"}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!WP_USER || !WP_APP_PASSWORD) throw new Error(`Missing WordPress credentials.\n\n${usage()}`);
  if (args.mode === "audit") await audit();
  else if (args.mode === "apply") await applyChanges(args);
  else throw new Error(`Unknown mode: ${args.mode}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
