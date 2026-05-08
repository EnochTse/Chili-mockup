# Netlify Deploy Guide

This project is ready to deploy to Netlify from GitHub.

Important:

- `.env.local` is for local development only.
- Netlify does not use `.env.local` from your repository during deploys.
- Real secrets such as `GEMINI_API_KEY` must be imported into Netlify as environment variables.

## Files added for deployment

- `netlify.toml`: build and functions configuration
- `netlify.env.example`: safe template for Netlify environment variables
- `netlify.env`: local-only file generated from `.env.local` for Netlify import

## Fastest path

1. Generate a local Netlify env file:

   ```bash
   npm run netlify:env
   ```

2. Open `netlify.env` and replace:

   ```text
   APP_BASE_URL=https://your-site-name.netlify.app
   ```

   with your real Netlify site URL after the site is created.

3. In Netlify:

   - Add new site from Git
   - Choose GitHub
   - Select `EnochTse/Chili-mockup`

4. Keep these build settings:

   - Build command: `npm run build:netlify`
   - Publish directory: `out`
   - Functions directory: `netlify/functions`

   These are already defined in `netlify.toml`.

5. Import environment variables:

   - Go to `Project configuration -> Environment variables`
   - Choose `Import from a .env file`
   - Paste the contents of your local `netlify.env`
   - Make sure the variable scope includes `Functions`
   - Apply to the deploy contexts you want, usually all deploy contexts for the first setup

6. Trigger the deploy.

## CLI option instead of the Netlify UI

If you use the Netlify CLI, you can import the file with:

```bash
netlify env:import netlify.env
```

Then deploy from Netlify or connect the repo in the UI.

## Recommended Netlify values

Use these values for the first deploy:

```text
AI_STUB_MODE=false
GEMINI_IMAGE_MODEL=gemini-3.1-flash-image-preview
GEMINI_IMAGE_ASPECT_RATIO=1:1
GEMINI_IMAGE_SIZE=1K
GEMINI_REQUEST_TIMEOUT_MS=300000
GEMINI_CONTROL_REQUEST_TIMEOUT_MS=20000
GEMINI_BATCH_POLL_INTERVAL_MS=3000
GEMINI_BATCH_MAX_WAIT_MS=180000
NODE_ENV=production
NEXT_PUBLIC_SHOW_DEBUG=false
OUTPUT_STORAGE_MODE=data_url
MAX_UPLOAD_SIZE_MB=4
```

## Notes

- `OUTPUT_STORAGE_MODE=data_url` is intentional for Netlify. It avoids depending on persistent local filesystem writes in serverless functions.
- `APP_BASE_URL` should be your final Netlify site URL, not `http://localhost:3000`.
- Do not upload `.env.local` to GitHub.
- Do not put `GEMINI_API_KEY` into `netlify.toml`. Keep it in Netlify environment variables only.
