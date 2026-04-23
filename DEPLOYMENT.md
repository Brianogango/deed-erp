# Deployment Guide: Vercel / Netlify

## Environment Variables

Copy `.env.example` to `.env.local` and fill required vars. For production:

### Core
```
AUTH_SECRET=your-super-secret-key-64-chars-min
DATABASE_URL="your-prisma-postgres-url"
NEXTAUTH_SECRET=your-nextauth-secret
NEXTAUTH_URL=https://your-app.vercel.app
```

### Upstash Redis (Rate Limiting)
```
UPSTASH_REDIS_REST_URL=https://your-cluster.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-rest-token
```

### Integrations (from .env.example)
```
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=...
SENDGRID_API_KEY=...
WHATSAPP_ACCESS_TOKEN=...
WHATSAPP_PHONE_NUMBER_ID=...
# etc.
```

## Vercel
1. `vercel --prod`
2. Dashboard → Settings → Environment Variables → Add all from `.env`
3. Auto-deploys on git push

## Netlify
1. Connect Git repo
2. Build: `npm run build`
3. Publish dir: `.next`
4. Env vars in Site settings

## PWA Notes
- Manifest: `/manifest.json` (add icons to `/public`)
- SW: `/sw.js` auto-registers
- Test: Chrome DevTools → Application → Install

## Rate Limiting
Protected: Login (10/min/IP), Sales API (50/hr/IP)
