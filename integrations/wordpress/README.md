# Talio Recruitment Sync

Companion plugin for HireZoot / WP Job Openings. It does not replace, alter or call the existing TalentLens integration. No WordPress database credentials or Talio user passwords are needed.

## Setup

1. Deploy the Talio API and settings changes in this repository.
2. As HR/admin, open **Talio Settings → Recruitment → WordPress careers sync**. Select the department assigned to website-created jobs, enter the website's canonical HTTPS home URL, and create a connection.
3. Install `talio-recruitment/talio-recruitment.php` as a separate WordPress plugin and activate it. Requires PHP 7.4+ and the active WP Job Openings/HireZoot plugin.
4. In **WordPress Settings → Talio Recruitment**, enter the Talio endpoint and one-time connection token. Save and test. Keep the token out of screenshots and logs.
5. Select **Import existing jobs and applications / rescan** to queue historical WordPress records and fetch existing Talio records. Then use **Sync now** or let scheduled runs process the queue.
6. Configure the hosting scheduler to execute WordPress cron every minute. WP-Cron depends on visits unless driven by a real scheduler, so the schedule is not a guaranteed one-minute delivery SLA.
7. Check both platforms' connection status and the WordPress records-needing-attention list. Validate one draft job and one synthetic application in each direction before relying on live sync.

The connection is bound to one Talio tenant and one exact site URL. HR/admin can disable or rotate the token in Talio. Only the token hash is stored in Talio; WordPress stores the token in a non-autoloaded option to make authenticated outbound requests. Protect WordPress admin, its database and backups accordingly. Changing the paired site/tenant needs a deliberate migration rather than silently reusing IDs.

## Data and behaviour

- Jobs sync title, description, status, location, employment/work mode, requirements, responsibilities, skills, benefits and deadline. WordPress descriptions become plain text in Talio; structured Talio fields are rendered into the website job description. WordPress-created jobs use the configured default department.
- Open jobs become public website listings. Draft/closed/on-hold/cancelled jobs are not published. Closing or trashing a website job updates its Talio status. **Permanent deletions do not propagate**: close a job before deleting it. Candidate deletion also does not delete its counterpart.
- Applications sync identity/contact details, cover letter, job relation and pipeline stage. Talio-origin submissions are inserted directly without replaying applicant emails or the TalentLens submission hook.
- IDs and revisions prevent echo loops and duplicates. Exact email+job matches link to an existing candidate without replacing their Talio screening decision. Applications to different jobs remain separate.
- Queued WordPress edits are not overwritten by incoming feeds. Concurrent edits on both platforms produce a visible conflict. Resolve the record in WordPress, or explicitly choose **Discard queued edits and use Talio version**. Incoming feed progress pauses at a conflicted record until resolved.
- Network failures retry with bounded exponential backoff (up to one hour between retries). Rescanning is safe for already-linked records. Edits made during an outbound request remain queued.
- Resumes up to 25 MB (PDF/DOC/DOCX) upload from WordPress in 256 KB chunks with SHA-256 and file-signature checks. Large files span multiple scheduled runs. Pending uploads are visibly marked in Talio.
- Talio-hosted resumes appear in WordPress as private attachment proxies. Downloads require a WordPress user with permission to edit the application plus a nonce. Files are not copied into a publicly accessible WordPress uploads directory. Existing WordPress files remain in their original storage.
- Legacy Talio resumes at arbitrary external URLs are not fetched by the server: re-upload them into Talio secure storage to enable cross-platform downloads. This prevents arbitrary internal-network URL fetches.
- Internal employee data, salary ranges, interview notes, offer compensation and hiring-manager identities are excluded from the feed. The service token can read and write recruitment records in its paired tenant; grant it only to a trusted company website.
- Job/application lists in Talio refresh every 30 seconds while visible. Resume availability updates on refresh/navigation.

## Checks

```sh
npx jest tests/api/wordpress-recruitment.test.js tests/web/wordpress-settings.test.js --runInBand
php -l integrations/wordpress/talio-recruitment/talio-recruitment.php
php integrations/wordpress/tests/connector.php integrations/wordpress/talio-recruitment/talio-recruitment.php
npm run build
```

PHP contract tests use isolated WordPress stubs; they do not replace acceptance checks on the actual hosting environment. The plugin has also been exercised in PHP 8.3 WebAssembly when a native PHP binary is unavailable. No test invokes real candidate notifications or production submissions.

Packaging (from this folder): `zip -r /tmp/talio-recruitment-sync.zip talio-recruitment`.
