# WordPress to GitHub Automation

This setup makes the daily Ulysses workflow automatic:

1. Ulysses uploads a Chinese post to WordPress.
2. The WordPress plugin triggers GitHub Actions.
3. GitHub Actions runs `scripts/postprocess.mjs`.
4. The script cleans markup/images, adds tags, creates the English draft, links Polylang translations, rebuilds `docs/`, and pushes the frontend update.

## GitHub Setup

Create these repository secrets in:

```txt
GitHub repo -> Settings -> Secrets and variables -> Actions -> New repository secret
```

Required:

```txt
WP_URL=https://cms.theatremaniac.com
WP_USER=your-wordpress-username
WP_APP_PASSWORD=your-wordpress-application-password
OPENAI_API_KEY=your-openai-api-key
```

Optional:

```txt
OPENAI_MODEL=gpt-4.1-mini
```

The workflow file is:

```txt
.github/workflows/wordpress-postprocess.yml
```

It can run automatically through `repository_dispatch`, or manually from the GitHub Actions tab with a WordPress post ID.

## WordPress Plugin Setup

The plugin source is:

```txt
wordpress-plugin/theatre-maniac-automation/
```

Install it in WordPress:

1. Zip the `theatre-maniac-automation` folder.
2. Open `https://cms.theatremaniac.com/wp-admin/plugins.php`.
3. Upload and activate the plugin.
4. Open `Settings -> Theatre Maniac Automation`.
5. Enter:

```txt
GitHub repository: bancesun/theatremaniac-headless
Source language: zh
Target language: en
Generated translation status: draft
```

The plugin also needs a GitHub token that can create repository dispatch events for this repo. Use a fine-grained token limited to this repository if possible.

## How It Avoids Loops

The plugin only triggers for normal WordPress posts, skips autosaves/revisions, skips English posts when Polylang language is available, and writes this private post meta after dispatching:

```txt
_tm_automation_dispatched
```

That prevents the source cleanup and English draft creation from triggering the same automation again.

## Manual Rerun

If a post needs reprocessing, use GitHub:

```txt
Actions -> WordPress Postprocess -> Run workflow
```

Enter the WordPress post ID and keep:

```txt
source_lang=zh
target_lang=en
status=draft
```
