# New Year fire

A New Year ritual website: people write what they want to leave in the old year, pay a small amount, and watch their paper burn in a shared fire, on the site and on a YouTube live stream. 20% of every payment goes to New Year gifts for children in Armenian orphanages.

The brand name is a placeholder. Change it in one place: `site/config/site.json`.

## Layout

| Path | What |
|---|---|
| `site/` | Source of the website: templates, texts (`i18n/`), legal pages (`content/`), styles and scripts (`assets/`), config |
| `site/build.py` | Generates the static site into `public/` |
| `public/` | Generated output that Vercel serves (committed, so no build step runs on Vercel) |
| `supabase/` | Database migrations, server functions (payments, orders), tests |
| `docs/` | Architecture and backend notes |
| `vercel.json` | Hosting config: security headers, redirects, clean URLs |

## Everyday tasks

Rebuild after changing anything in `site/`:

```sh
python3 site/build.py        # needs python3 with jinja2 and markdown
```

Commit both `site/` and `public/`. Pushing to `main` deploys to Vercel.

- **Open payments:** set `"payments_open": true` in `site/config/site.json`, rebuild, and set the `PAYMENT_PROVIDER` function secret in Supabase (see `docs/BACKEND.md`).
- **Company details for the legal pages:** `company` in `site/config/site.json`.
- **Domain:** `domain` and `site_url` in `site/config/site.json`, plus `SITE_URL` and `ALLOWED_ORIGINS` in Supabase function secrets.
- **YouTube stream:** `stream.youtube_embed_id` in the config.
- **Gift partner and reports:** `gifts` in the config.
- **The stream capture page:** open `/live/?stream=1` in OBS (browser source, 1920×1080).

See `docs/ARCHITECTURE.md` for how the parts fit together.
