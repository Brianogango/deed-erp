# Visual Regression Baseline

This folder stores baseline screenshots for core ERP routes and breakpoints.

## Capture

```bash
VISREG_BYPASS_AUTH=true npm run dev
VISREG_SKIP_LOGIN=true npm run screenshots:core
```

Or run in one shell where app is already running:

```bash
npm run screenshots:core
```

## Defaults

- Base URL: `http://127.0.0.1:3000`
- Username: `brian`
- Password: `Og@835408`

You can override defaults with:

- `VISREG_BASE_URL`
- `VISREG_USERNAME`
- `VISREG_PASSWORD`
- `VISREG_OUT_DIR`
- `VISREG_SKIP_LOGIN` (set `true` when `VISREG_BYPASS_AUTH=true` is used in app runtime)
