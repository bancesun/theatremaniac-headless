# Publishing Workflow

This project includes two publishing paths while keeping the public frontend static and fast.

- Daily workflow: write and upload with Ulysses, then run the post-processing script.
- Backup workflow: publish a local Markdown file directly with `npm run publish`.

## One-Time Setup

Create a WordPress Application Password:

1. Open `https://cms.theatremaniac.com/wp-admin/profile.php`.
2. Find **Application Passwords**.
3. Create one named `Theatre Maniac Publisher`.
4. Copy it once and store it locally, not in Git.

Set local environment variables:

```sh
export WP_URL="https://cms.theatremaniac.com"
export WP_USER="your-wordpress-username"
export WP_APP_PASSWORD="xxxx xxxx xxxx xxxx xxxx xxxx"
export OPENAI_API_KEY="sk-..." # optional, enables translation
```

## Daily Workflow: Ulysses First

Use Ulysses to publish the Chinese article to WordPress as a draft or private post.

After upload, open the post in WordPress and copy the numeric post ID from the URL. It looks like this:

```txt
post.php?post=123&action=edit
```

Then run:

```sh
npm run postprocess -- --post-id 123 --source-lang zh --target-lang en --status draft
```

What the post-processing script does:

- Cleans fixed image widths, inline styles, and old imported markup.
- Keeps images in their original article positions.
- Adds AI-inferred WordPress tags.
- Translates the Chinese article into English.
- Creates the English draft.
- Links both posts in Polylang.

You can override AI tags manually:

```sh
npm run postprocess -- --post-id 123 --tags "Berlin, Theatre, Schaubühne, Review"
```

After reviewing the drafts in WordPress, rebuild the public frontend:

```sh
npm run deploy
git add docs
git commit -m "Publish latest articles"
git push
```

## Backup Workflow: Local Markdown

Write a Markdown file with images placed where they should appear:

```md
---
title: My Review Title
slug: my-review-title
excerpt: A short summary for article cards.
---

# My Review Title

Opening paragraph.

![Production photo](images/production-01.jpg)

More text.
```

Local image paths are resolved relative to the Markdown file.

## Publish Drafts

```sh
npm run publish -- --file path/to/article.md --source-lang zh --target-lang en --status draft
```

What the script does:

- Uploads local images to WordPress media.
- Replaces image positions with WordPress media URLs.
- Creates a source-language WordPress draft.
- If `OPENAI_API_KEY` is set, translates the article while preserving image positions.
- Creates a target-language draft.
- Links both drafts in Polylang.

After you review and publish the drafts in WordPress, rebuild the public frontend:

```sh
npm run deploy
git add docs
git commit -m "Publish latest articles"
git push
```

## Recommended Writing App

For daily writing, use **Ulysses** if you prefer Markdown and a clean writing environment, or **MarsEdit** if you prefer a blog-editor interface with stronger media management. The script remains useful when you want automatic translation and language linking.
