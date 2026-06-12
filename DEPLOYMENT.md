# Production Domain Plan

Goal:

- Public visitors see the headless frontend.
- WordPress remains the private CMS/backend for writing and media.

Current state:

- `theatremaniac.com` points to Hostinger / LiteSpeed at `92.113.18.178`.
- `cms.theatremaniac.com` points to the existing WordPress install on Hostinger.
- WordPress Address and Site Address are set to `https://cms.theatremaniac.com`.
- The headless preview is published at:
  `https://bancesun.github.io/theatremaniac-headless/`

## Recommended Production Shape

```text
theatremaniac.com          Headless frontend
www.theatremaniac.com      Headless frontend
cms.theatremaniac.com      WordPress backend
```

WordPress admin would move to:

```text
https://cms.theatremaniac.com/wp-admin/
```

## DNS Records For GitHub Pages

For apex domain:

```text
A     @     185.199.108.153
A     @     185.199.109.153
A     @     185.199.110.153
A     @     185.199.111.153
```

For `www`:

```text
CNAME www   bancesun.github.io
```

For WordPress CMS, keep the Hostinger target available:

```text
A     cms   92.113.18.178
```

Hostinger may also require creating the `cms` subdomain in hPanel and mapping it to the existing WordPress install.

## GitHub Pages Custom Domain

After DNS is changed, configure the repo custom domain:

```text
theatremaniac.com
```

Then rebuild with:

```sh
BASE_PATH= \
PUBLIC_URL=https://theatremaniac.com \
/Users/bancesun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/build.mjs
rm -rf docs && cp -R dist docs && touch docs/.nojekyll
```

## WordPress Settings

Completed:

- WordPress Address (URL): `https://cms.theatremaniac.com`
- Site Address (URL): `https://cms.theatremaniac.com`

The frontend generator should then read from:

```text
https://cms.theatremaniac.com/wp-json/wp/v2/posts
```
