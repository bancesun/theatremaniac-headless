# Theatre Maniac Headless Prototype

Static headless frontend for Theatre Maniac.

- WordPress remains the CMS: https://theatremaniac.com/wp-admin/
- Content source: WordPress REST API
- Generated public site lives in `docs/` for GitHub Pages.

## Build

```sh
BASE_PATH=/theatremaniac-headless \
PUBLIC_URL=https://bancesun.github.io/theatremaniac-headless \
/Users/bancesun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/build.mjs
```

Then copy `dist/` to `docs/` for GitHub Pages:

```sh
rm -rf docs && cp -R dist docs && touch docs/.nojekyll
```

## Local Preview

```sh
/Users/bancesun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/serve.mjs
```

