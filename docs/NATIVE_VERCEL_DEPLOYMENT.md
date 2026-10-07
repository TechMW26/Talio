# Native Vercel deployment

Talio uses Next.js on Vercel Fluid Compute with Firebase Firestore. Container
build files and container deployment candidates have been removed. No local
container daemon is required.

## Release path

1. Run `npm ci --legacy-peer-deps` and `npm run release:check`.
2. Run `npm run build` with production-equivalent configuration.
3. Push the verified release to `main`. Only `main` automatically deploys.
4. Vercel runs the focused release checks before its native Next.js build.
5. Verify the exact deployment is READY and `app.talio.in` points to it. Check
   login, authenticated data loading, and tenant isolation before acceptance.

GitHub Actions runs the same tests on pull requests and main pushes. Vercel's
build gate does not depend on GitHub Actions finishing first. Branch protection
may additionally require the `test` job; that is an account-level setting.

## Performance and cost controls

- Fluid Compute and autoscaling stay enabled. Start with standard build resources,
  not a paid enhanced build machine, and increase only for measured failures.
- Node 22 is the supported production runtime. Public frontend settings must be
  present at build time; server credentials stay in Vercel environment variables.
- The function region is Mumbai (`bom1`), matching the verified Firestore database
  location (`asia-south1`). Browser assets are served through the global CDN.
- Do not cache authenticated responses publicly. Existing user/tenant-scoped
  request deduplication, mutation invalidation and bounded queries remain active.
- Queue handlers remain native functions. Cron schedules remain unchanged until
  their deadlines and tenant time zones can be safely preserved. Avoid replacing
  precise notification/attendance jobs with coarse schedules solely to cut calls.
- Review function CPU, transfer, Firestore reads, screenshot storage and AI costs
  after deployment. Alerts are not hard budget caps; do not enable an automatic
  production pause without an explicit spending limit and availability decision.
- Screenshot/AI processing should stay outside interactive request paths. Retain
  lazy, paginated screenshot loading and avoid analyzing unchanged captures twice.

Keep the previous READY production deployment for rollback. Never rotate or copy
production secrets into source control as part of a release.
