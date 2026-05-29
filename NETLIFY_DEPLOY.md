# Netlify Deploy Guide

This project deploys to Netlify from GitHub as a static export. Image coloring and logo compositing run in the browser with the local layered renderer, so no image-generation function or server-side image key is required.

## Build Settings

`netlify.toml` already defines the required settings:

```toml
[build]
  command = "npm run build:netlify"
  publish = "out"
```

## Fastest Path

1. Connect the GitHub repo `EnochTse/Chili-mockup` in Netlify.
2. Keep the build command as `npm run build:netlify`.
3. Keep the publish directory as `out`.
4. If using Supabase live template storage, set:
   `NEXT_PUBLIC_SUPABASE_URL`
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   `NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET`
5. Set `APP_BASE_URL` to the branch deploy or production site URL if needed.
6. Trigger a branch deploy.

## Notes

- `.env.local` is for local development only.
- Setup Studio saving is local-only; commit template and asset changes before deploying.
- Branch deploys render from checked-in template JSON and files under `public/mockup-templates/`.
