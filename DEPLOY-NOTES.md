# Deploying My Sales Desk UAE to GitHub Pages (free)

- Live URL: https://tinyupgrade7860-cyber.github.io/my-sales-desk-uae/
- Repo (public, required for free Pages): https://github.com/tinyupgrade7860-cyber/my-sales-desk-uae
- Pages source: branch `gh-pages`, path `/` (HTTPS enforced). `main` holds source only.

## REQUIRED: base path
The site lives under the sub-path `/my-sales-desk-uae/`. Production builds MUST use
`vite build --base=/my-sales-desk-uae/` (`npm run build:pages`). Keep `base: './'` in
vite.config.ts for local dev/tests. Everything else is already sub-path safe:
manifest `start_url`/`scope` = `./`, SW registered as `./sw.js` with scope `./`,
icon/apple-touch-icon links relative, routing is hash-based (`#/...`) so no 404.html SPA hack is needed.

## Deploy
```bash
npm ci                    # once
RUN_TESTS=1 npm run deploy   # = scripts/deploy.sh: tsc, vite build --base, .nojekyll, force-push dist/ as single-commit gh-pages
gh api repos/tinyupgrade7860-cyber/my-sales-desk-uae/pages/builds/latest -q .status   # wait for "built" (~1 min)
```
One-time setup (already done): `gh repo create ... --public --source=. --remote=origin --push`;
Pages was auto-enabled by the first gh-pages push (the POST /pages call returns 409 "already enabled").

## Verify
```bash
U=https://tinyupgrade7860-cyber.github.io/my-sales-desk-uae
for p in / /manifest.webmanifest /sw.js; do curl -s -o /dev/null -w "%{http_code} %{content_type} $p\n" $U$p; done
npx playwright test -c playwright.subpath.config.ts   # local build served under /my-sales-desk-uae/
npx playwright test -c playwright.live.config.ts      # against the live site (Chromium + WebKit)
```
Note: the screenshots spec rewrites screenshots/*.png; `git checkout -- screenshots` afterwards if unwanted.

## Adopting in the main project (/workspace/my-sales-desk-uae)
Copy `scripts/deploy.sh`, `playwright.subpath.config.ts`, `playwright.live.config.ts`, add `.pages-root/` to
.gitignore and the npm scripts `build:pages`, `test:e2e:pages`, `deploy`. Add remote:
`git remote add github https://github.com/tinyupgrade7860-cyber/my-sales-desk-uae.git` and run with `REMOTE=github`.
The public repo's `main` is a fresh history (snapshot of local 23e3dda) – don't push the local history, which contains
committed node_modules/dist in older commits. Push source by fetching github/main and committing on top, or keep
deploying only gh-pages from the main project.
Service worker uses registerType autoUpdate: a new deploy is picked up on the next app launch (online).
