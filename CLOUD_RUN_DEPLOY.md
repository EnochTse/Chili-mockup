# Cloud Run Deploy

This branch keeps Netlify for the frontend and moves Gemini image generation to a separate Cloud Run service.

## What gets deployed where

- Netlify: static frontend
- Cloud Run: `POST /generate-mockup`

## Files for Cloud Run

- `cloud-run/package.json`
- `cloud-run/server.mjs`
- `cloud-run/.env.example`

## 1. Deploy the Cloud Run service

From the repo root:

```bash
cd cloud-run
gcloud run deploy chili-mockup-generate \
  --source . \
  --region asia-east1 \
  --allow-unauthenticated
```

Cloud Run will ask for environment variables. Set at least:

```bash
GEMINI_API_KEY=your_key
GEMINI_IMAGE_MODEL=gemini-3.1-flash-image-preview
GEMINI_IMAGE_ASPECT_RATIO=1:1
GEMINI_IMAGE_SIZE=1K
GEMINI_REQUEST_TIMEOUT_MS=360000
ALLOWED_ORIGIN_PATTERNS=https://*.netlify.app,http://localhost:3000,http://127.0.0.1:3000
SHOW_DEBUG=false
```

After deploy, Cloud Run gives you a URL similar to:

```text
https://chili-mockup-generate-xxxxx.a.run.app
```

The frontend endpoint should be:

```text
https://chili-mockup-generate-xxxxx.a.run.app/generate-mockup
```

## 2. Point Netlify to Cloud Run

In Netlify environment variables, set:

```bash
NEXT_PUBLIC_GENERATE_ENDPOINT=https://chili-mockup-generate-xxxxx.a.run.app/generate-mockup
NEXT_PUBLIC_GENERATE_TIMEOUT_MS=360000
```

Keep your existing Gemini server secrets on Cloud Run, not Netlify.

## 3. Branch deploy testing

Once the branch is pushed:

1. Make sure Netlify branch deploys are enabled
2. Add `NEXT_PUBLIC_GENERATE_ENDPOINT` to the branch deploy context if needed
3. Trigger a new deploy for the branch

## Notes

- This flow avoids Gemini Batch API for interactive mockup generation.
- The app still applies the uploaded logo locally after Gemini returns the base generated product image.
- The Cloud Run service returns a data URL, so it does not rely on persistent filesystem storage.
