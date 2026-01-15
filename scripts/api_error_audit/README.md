# API Error Audit Script

Static analysis helper to list API error responses, status codes, and likely causes/solutions for Talio's Next.js API routes.

## What it does
- Scans `app/api/**/route.js|ts`
- Maps endpoints, handlers, models (`getAuthAndModels`), and internal imports
- Extracts `NextResponse.json` status codes
- Suggests likely causes and fixes for 4xx/5xx responses

## Usage

```bash
python3 scripts/api_error_audit/audit.py
```

### Filter examples

```bash
python3 scripts/api_error_audit/audit.py --only-status 500
python3 scripts/api_error_audit/audit.py --format json --output /tmp/api-errors.json
python3 scripts/api_error_audit/audit.py --include app/api/employees/**/route.js
```

### Runtime logs and live endpoint checks

```bash
# Scan logs (file or directory of *.log)
python3 scripts/api_error_audit/audit.py --log-file /var/log/talio.log
python3 scripts/api_error_audit/audit.py --log-dir ./logs

# Hit live endpoints (GET only, skips dynamic routes)
python3 scripts/api_error_audit/audit.py --base-url http://localhost:3000

# Include auth header for protected endpoints
python3 scripts/api_error_audit/audit.py \
	--base-url http://localhost:3000 \
	--header 'Authorization: Bearer <token>'

# Login with email/password and reuse the token
python3 scripts/api_error_audit/audit.py \
	--base-url http://localhost:3000 \
	--login-email you@example.com \
	--login-password 'your-password'

# Print token only (no audit)
python3 scripts/api_error_audit/audit.py \
	--base-url http://localhost:3000 \
	--login-email you@example.com \
	--login-password 'your-password' \
	--print-token-only

# Debug login failures (prints response body on error)
python3 scripts/api_error_audit/audit.py \
	--base-url http://localhost:3000 \
	--login-email you@example.com \
	--login-password 'your-password' \
	--login-debug
```

## Notes
- This is static analysis, not runtime monitoring.
- For tenant-aware routes, ensure `getAuthAndModels` is used instead of static model imports.
- For 500 errors, check server logs for stack traces and environment variables.
