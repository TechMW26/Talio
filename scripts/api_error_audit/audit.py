#!/usr/bin/env python3
"""API Error Audit

Static analysis script for Next.js API routes. It scans for:
- HTTP handlers (GET/POST/PUT/PATCH/DELETE)
- tenant model usage (getAuthAndModels)
- status codes returned in NextResponse.json
- common error causes and suggested fixes
- connectivity (imports + models)
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

METHOD_NAMES = {"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"}
STATUS_PATTERN = re.compile(r"status\s*:\s*(\d{3})")
IMPORT_PATTERN = re.compile(r"^\s*import\s+.*?from\s+['\"]([^'\"]+)['\"]", re.MULTILINE)
METHOD_PATTERN = re.compile(r"export\s+(?:async\s+)?function\s+(\w+)")
GET_AUTH_MODELS_PATTERN = re.compile(
    r"getAuthAndModels\(\s*[^,]+,\s*\[([^\]]*)\]\s*\)", re.DOTALL
)
MESSAGE_PATTERN = re.compile(
    r"(?:message|error|errors)\s*:\s*([`'\"])(.+?)\1"
)
MODEL_IMPORT_PATTERN = re.compile(r"^@/models|/models/")
LOG_ERROR_PATTERN = re.compile(
    r"(error|exception|traceback|failed|status\s*=?\s*5\d\d)",
    re.IGNORECASE,
)
HTTP_STATUS_PATTERN = re.compile(r"\b(\d{3})\b")


@dataclass
class ErrorEntry:
    status: int
    line: int
    message: str
    cause: str
    suggestion: str
    context: str


@dataclass
class RouteInfo:
    endpoint: str
    file_path: str
    methods: List[str] = field(default_factory=list)
    models: List[str] = field(default_factory=list)
    imports: List[str] = field(default_factory=list)
    errors: List[ErrorEntry] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)


@dataclass
class AuditReport:
    root: str
    routes: List[RouteInfo]
    summary: Dict[str, int]
    log_findings: List["LogFinding"] = field(default_factory=list)
    live_checks: List["LiveCheckResult"] = field(default_factory=list)


@dataclass
class LogFinding:
    file_path: str
    line: int
    message: str
    status: Optional[int]


@dataclass
class LiveCheckResult:
    endpoint: str
    method: str
    url: str
    status: Optional[int]
    ok: bool
    error: str


def derive_endpoint(file_path: Path, root: Path) -> str:
    rel = file_path.relative_to(root)
    parts = list(rel.parts)
    if "app" in parts and "api" in parts:
        api_index = parts.index("api")
        segments = parts[api_index + 1 : -1]
    else:
        segments = parts[:-1]
    normalized: List[str] = []
    for segment in segments:
        if segment.startswith("[") and segment.endswith("]"):
            inner = segment[1:-1]
            if inner.startswith("..."):
                normalized.append(f"*{inner[3:]}")
            else:
                normalized.append(f":{inner}")
        else:
            normalized.append(segment)
    suffix = "/".join(normalized)
    return f"/api/{suffix}" if suffix else "/api"


def parse_methods(content: str) -> List[str]:
    methods = []
    for match in METHOD_PATTERN.finditer(content):
        name = match.group(1)
        if name in METHOD_NAMES and name not in methods:
            methods.append(name)
    return methods


def parse_imports(content: str) -> List[str]:
    imports = []
    for match in IMPORT_PATTERN.finditer(content):
        module_path = match.group(1)
        if module_path not in imports:
            imports.append(module_path)
    return imports


def parse_models(content: str) -> List[str]:
    models: List[str] = []
    for match in GET_AUTH_MODELS_PATTERN.finditer(content):
        raw = match.group(1)
        for token in raw.split(","):
            model = token.strip().strip("'\"`")
            if model and model not in models:
                models.append(model)
    return models


def extract_message(context_lines: Sequence[str]) -> str:
    for line in context_lines:
        match = MESSAGE_PATTERN.search(line)
        if match:
            return match.group(2).strip()
    return ""


def classify_error(status: int, message: str, context: str) -> Tuple[str, str]:
    lower_message = message.lower()
    lower_context = context.lower()

    if status == 400:
        cause = "Bad request or validation failure"
        suggestion = "Verify required fields, data types, and schema validation rules."
        if "schema" in lower_message or "schema" in lower_context:
            cause = "Schema validation failure"
            suggestion = "Ensure payload matches schema; update validation or client payload."
        if "validation" in lower_message or "validation" in lower_context:
            cause = "Validation error"
            suggestion = "Check field constraints and ensure required fields are provided."
    elif status == 401:
        cause = "Authentication failed or token missing"
        suggestion = (
            "Send a valid Bearer token. Ensure JWT includes databaseName and user is active."
        )
    elif status == 403:
        cause = "Authorization denied (role/permission)"
        suggestion = "Confirm user role and RBAC checks; update roles or allowlist if needed."
    elif status == 404:
        cause = "Resource not found"
        suggestion = "Verify the ID/lookup criteria and ensure the resource exists in the tenant DB."
    elif status == 409:
        cause = "Conflict (duplicate or state mismatch)"
        suggestion = "Check for unique constraint collisions or invalid state transitions."
    elif status == 422:
        cause = "Unprocessable entity (validation)"
        suggestion = "Validate payload and handle schema errors before submitting."
    elif status == 429:
        cause = "Too many requests"
        suggestion = "Throttle requests or add retry/backoff logic."
    elif status == 500:
        cause = "Unhandled server exception"
        suggestion = (
            "Inspect server logs for stack traces. Common causes: DB errors, missing env vars, "
            "invalid IDs, or external service failures."
        )
    elif status == 503:
        cause = "Upstream service unavailable"
        suggestion = "Check external dependencies (AI, push, email) and retry with backoff."
    else:
        cause = "Unexpected response"
        suggestion = "Review route logic and response handling."

    if "invalid session" in lower_message:
        suggestion = "Force re-login to refresh JWT with tenant context."
    if "database" in lower_message and status >= 500:
        suggestion = "Verify MongoDB connectivity and tenant databaseName configuration."

    return cause, suggestion


def parse_errors(lines: Sequence[str]) -> List[ErrorEntry]:
    errors: List[ErrorEntry] = []
    for index, line in enumerate(lines, start=1):
        match = STATUS_PATTERN.search(line)
        if not match:
            continue
        status = int(match.group(1))
        context_start = max(0, index - 4)
        context_end = min(len(lines), index + 1)
        context_lines = lines[context_start:context_end]
        message = extract_message(context_lines)
        context = " ".join(l.strip() for l in context_lines if l.strip())
        cause, suggestion = classify_error(status, message, context)
        errors.append(
            ErrorEntry(
                status=status,
                line=index,
                message=message,
                cause=cause,
                suggestion=suggestion,
                context=context[:240],
            )
        )
    return errors


def collect_warnings(content: str, imports: Sequence[str], has_auth_models: bool) -> List[str]:
    warnings: List[str] = []
    if any(MODEL_IMPORT_PATTERN.search(module) for module in imports):
        warnings.append(
            "Uses direct model imports; consider getAuthAndModels for tenant isolation."
        )
    if not has_auth_models and "getAuthAndModels" not in content:
        warnings.append("No getAuthAndModels usage detected; verify auth handling.")
    if "try" in content and "catch" not in content:
        warnings.append("Try block without catch; potential unhandled errors.")
    if "ValidationError" in content or "CastError" in content:
        warnings.append("Mongoose validation/cast errors handled here; check schema inputs.")
    return warnings


def scan_route_file(file_path: Path, root: Path) -> RouteInfo:
    content = file_path.read_text(encoding="utf-8", errors="ignore")
    lines = content.splitlines()
    endpoint = derive_endpoint(file_path, root)
    methods = parse_methods(content)
    imports = parse_imports(content)
    models = parse_models(content)
    errors = parse_errors(lines)
    warnings = collect_warnings(content, imports, bool(models))
    return RouteInfo(
        endpoint=endpoint,
        file_path=str(file_path),
        methods=methods,
        models=models,
        imports=imports,
        errors=errors,
        warnings=warnings,
    )


def find_route_files(root: Path, include: Optional[str]) -> List[Path]:
    if include:
        return [
            path
            for path in sorted(root.glob(include))
            if ".next" not in path.parts and "node_modules" not in path.parts
        ]
    candidates = [
        path
        for path in root.rglob("app/api/**/route.*")
        if path.suffix in {".js", ".ts"}
        and ".next" not in path.parts
        and "node_modules" not in path.parts
    ]
    return sorted(candidates)


def build_summary(routes: Sequence[RouteInfo]) -> Dict[str, int]:
    summary: Dict[str, int] = {
        "routes": len(routes),
        "errors": 0,
    }
    for route in routes:
        summary["errors"] += len(route.errors)
        for error in route.errors:
            key = f"status_{error.status}"
            summary[key] = summary.get(key, 0) + 1
    return summary


def filter_errors(errors: List[ErrorEntry], only_status: Optional[Sequence[int]]) -> List[ErrorEntry]:
    if not only_status:
        return errors
    return [error for error in errors if error.status in only_status]


def render_text(report: AuditReport, max_errors: Optional[int]) -> str:
    lines: List[str] = []
    lines.append("API Error Audit Report")
    lines.append(f"Root: {report.root}")
    lines.append(
        f"Routes: {report.summary.get('routes', 0)} | Errors: {report.summary.get('errors', 0)}"
    )
    status_counts = sorted(
        (k, v) for k, v in report.summary.items() if k.startswith("status_")
    )
    if status_counts:
        lines.append(
            "Status breakdown: "
            + ", ".join(f"{k.replace('status_', '')}={v}" for k, v in status_counts)
        )
    lines.append("")

    for route in report.routes:
        if not route.errors:
            continue
        methods = ", ".join(route.methods) if route.methods else "(no handler)"
        lines.append(f"{methods} {route.endpoint}")
        lines.append(f"  File: {route.file_path}")
        if route.models:
            lines.append(f"  Models: {', '.join(route.models)}")
        internal_imports = [imp for imp in route.imports if imp.startswith("@/")]
        if internal_imports:
            lines.append(f"  Imports: {', '.join(internal_imports)}")
        if route.warnings:
            lines.append("  Warnings:")
            for warning in route.warnings:
                lines.append(f"    - {warning}")
        lines.append("  Errors:")
        count = 0
        for error in route.errors:
            count += 1
            if max_errors and count > max_errors:
                lines.append("    - (more errors omitted; use --max-errors to increase)")
                break
            msg = f" - {error.message}" if error.message else ""
            lines.append(
                f"    - {error.status} (line {error.line}){msg}"
            )
            lines.append(f"      Cause: {error.cause}")
            lines.append(f"      Fix: {error.suggestion}")
        lines.append("")

    if report.summary.get("errors", 0) == 0:
        lines.append("No error responses found.")

    if report.log_findings:
        lines.append("")
        lines.append("Runtime log findings:")
        for finding in report.log_findings[:200]:
            status = f" status={finding.status}" if finding.status else ""
            lines.append(
                f"  - {finding.file_path}:{finding.line}{status} {finding.message}"
            )

    if report.live_checks:
        lines.append("")
        lines.append("Live endpoint checks:")
        for check in report.live_checks:
            status = check.status if check.status is not None else "n/a"
            result = "OK" if check.ok else "FAIL"
            suffix = f" ({check.error})" if check.error else ""
            lines.append(
                f"  - {check.method} {check.url} => {status} [{result}]{suffix}"
            )
    return "\n".join(lines)


def build_report(
    root: Path,
    include: Optional[str],
    only_status: Optional[Sequence[int]],
    log_paths: Optional[Sequence[Path]],
    base_url: Optional[str],
    live_headers: Optional[Dict[str, str]],
    batch_size: Optional[int] = None,
    batch_number: Optional[int] = None,
) -> AuditReport:
    routes: List[RouteInfo] = []
    for route_file in find_route_files(root, include):
        route = scan_route_file(route_file, root)
        route.errors = filter_errors(route.errors, only_status)
        routes.append(route)

    # Batch only routes that have errors when batching is enabled
    if batch_size and batch_number:
        error_routes = [route for route in routes if route.errors]
        start = (batch_number - 1) * batch_size
        end = start + batch_size
        routes = error_routes[start:end]

    summary = build_summary(routes)
    log_findings = scan_logs(log_paths or [])
    live_checks = run_live_checks(routes, base_url, live_headers or {})
    return AuditReport(
        root=str(root),
        routes=routes,
        summary=summary,
        log_findings=log_findings,
        live_checks=live_checks,
    )


def parse_status_list(values: Optional[str]) -> Optional[List[int]]:
    if not values:
        return None
    result: List[int] = []
    for part in values.split(","):
        part = part.strip()
        if not part:
            continue
        result.append(int(part))
    return result


def parse_headers(raw_headers: Optional[Sequence[str]]) -> Dict[str, str]:
    headers: Dict[str, str] = {}
    if not raw_headers:
        return headers
    for header in raw_headers:
        if ":" not in header:
            continue
        key, value = header.split(":", 1)
        headers[key.strip()] = value.strip()
    return headers


def scan_logs(log_paths: Sequence[Path]) -> List[LogFinding]:
    findings: List[LogFinding] = []
    for path in log_paths:
        if path.is_dir():
            candidates = sorted(path.glob("**/*.log"))
        else:
            candidates = [path]
        for log_file in candidates:
            if not log_file.exists():
                continue
            try:
                content = log_file.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            for idx, line in enumerate(content.splitlines(), start=1):
                if not LOG_ERROR_PATTERN.search(line):
                    continue
                status_match = HTTP_STATUS_PATTERN.search(line)
                status = int(status_match.group(1)) if status_match else None
                findings.append(
                    LogFinding(
                        file_path=str(log_file),
                        line=idx,
                        message=line.strip()[:240],
                        status=status,
                    )
                )
    return findings


def is_dynamic_endpoint(endpoint: str) -> bool:
    return ":" in endpoint or "*" in endpoint


def run_live_checks(
    routes: Sequence[RouteInfo],
    base_url: Optional[str],
    headers: Dict[str, str],
) -> List[LiveCheckResult]:
    if not base_url:
        return []
    results: List[LiveCheckResult] = []
    sanitized_base = base_url.rstrip("/")
    for route in routes:
        if is_dynamic_endpoint(route.endpoint):
            results.append(
                LiveCheckResult(
                    endpoint=route.endpoint,
                    method="GET",
                    url=f"{sanitized_base}{route.endpoint}",
                    status=None,
                    ok=False,
                    error="dynamic endpoint skipped",
                )
            )
            continue
        if route.methods and "GET" not in route.methods:
            continue
        url = f"{sanitized_base}{route.endpoint}"
        request = Request(url, method="GET", headers=headers)
        try:
            with urlopen(request, timeout=10) as response:
                status = response.status
                ok = 200 <= status < 300
                results.append(
                    LiveCheckResult(
                        endpoint=route.endpoint,
                        method="GET",
                        url=url,
                        status=status,
                        ok=ok,
                        error="",
                    )
                )
        except HTTPError as error:
            results.append(
                LiveCheckResult(
                    endpoint=route.endpoint,
                    method="GET",
                    url=url,
                    status=error.code,
                    ok=False,
                    error=error.reason,
                )
            )
        except URLError as error:
            results.append(
                LiveCheckResult(
                    endpoint=route.endpoint,
                    method="GET",
                    url=url,
                    status=None,
                    ok=False,
                    error=str(error.reason),
                )
            )
    return results


def login_for_token(
    base_url: str,
    endpoint: str,
    email: str,
    password: str,
    headers: Dict[str, str],
    debug: bool = False,
) -> str:
    url = f"{base_url.rstrip('/')}{endpoint}"
    payload = json.dumps({"email": email, "password": password}).encode("utf-8")
    request = Request(
        url,
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            **headers,
        },
    )
    try:
        with urlopen(request, timeout=15) as response:
            body = response.read().decode("utf-8", errors="ignore")
            data = json.loads(body) if body else {}
            token = data.get("token") or data.get("data", {}).get("token")
            if not token:
                raise RuntimeError("Login succeeded but no token was returned.")
            return token
    except HTTPError as error:
        body = error.read().decode("utf-8", errors="ignore") if error.fp else ""
        message = ""
        try:
            data = json.loads(body) if body else {}
            message = data.get("message", "")
        except json.JSONDecodeError:
            message = body
        if debug and body:
            print(f"[login-debug] {body}", file=sys.stderr)
        raise RuntimeError(
            f"Login failed with status {error.code}. {message}".strip()
        ) from error
    except URLError as error:
        raise RuntimeError(f"Login request failed: {error.reason}") from error


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit API routes for error responses.")
    parser.add_argument("--root", type=str, default=None, help="Repo root path")
    parser.add_argument(
        "--include",
        type=str,
        default=None,
        help="Glob pattern relative to root (e.g., app/api/**/route.js)",
    )
    parser.add_argument(
        "--format",
        choices=["text", "json"],
        default="text",
        help="Output format",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=None,
        help="Write output to file instead of stdout",
    )
    parser.add_argument(
        "--only-status",
        type=str,
        default=None,
        help="Comma-separated list of status codes to include",
    )
    parser.add_argument(
        "--max-errors",
        type=int,
        default=None,
        help="Max errors to show per route (text only)",
    )
    parser.add_argument(
        "--log-file",
        action="append",
        default=None,
        help="Log file to scan (can be repeated)",
    )
    parser.add_argument(
        "--log-dir",
        action="append",
        default=None,
        help="Directory containing logs (*.log) to scan (can be repeated)",
    )
    parser.add_argument(
        "--base-url",
        type=str,
        default=None,
        help="Base URL for live endpoint checks (e.g. http://localhost:3000)",
    )
    parser.add_argument(
        "--header",
        action="append",
        default=None,
        help="Custom HTTP header for live checks (e.g. 'Authorization: Bearer <token>')",
    )
    parser.add_argument(
        "--login-email",
        type=str,
        default=None,
        help="Email address for login before live checks",
    )
    parser.add_argument(
        "--login-password",
        type=str,
        default=None,
        help="Password for login before live checks",
    )
    parser.add_argument(
        "--login-endpoint",
        type=str,
        default="/api/auth/login",
        help="Login endpoint path (default: /api/auth/login)",
    )
    parser.add_argument(
        "--print-token-only",
        action="store_true",
        help="Print JWT token from login and exit (skips audit output)",
    )
    parser.add_argument(
        "--login-debug",
        action="store_true",
        help="Print login response body on failure",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=None,
        help="Process error routes in batches of N (e.g. 10)",
    )
    parser.add_argument(
        "--batch-number",
        type=int,
        default=None,
        help="Batch number to process when using --batch-size (1-based)",
    )

    args = parser.parse_args()

    script_root = Path(__file__).resolve().parents[2]
    root = Path(args.root).resolve() if args.root else script_root

    if not root.exists():
        print(f"Root path not found: {root}", file=sys.stderr)
        return 1

    only_status = parse_status_list(args.only_status)
    log_paths: List[Path] = []
    for file_path in args.log_file or []:
        log_paths.append(Path(file_path).expanduser())
    for dir_path in args.log_dir or []:
        log_paths.append(Path(dir_path).expanduser())
    headers = parse_headers(args.header)
    if args.login_email or args.login_password:
        if not args.base_url:
            print("--base-url is required for login-based live checks.", file=sys.stderr)
            return 2
        if not args.login_email or not args.login_password:
            print("Both --login-email and --login-password are required.", file=sys.stderr)
            return 2
        try:
            token = login_for_token(
                args.base_url,
                args.login_endpoint,
                args.login_email,
                args.login_password,
                headers,
                args.login_debug,
            )
        except RuntimeError as error:
            print(str(error), file=sys.stderr)
            return 2
        if args.print_token_only:
            print(token)
            return 0
        headers = {**headers, "Authorization": f"Bearer {token}"}
        if "Cookie" not in {k.title(): v for k, v in headers.items()}:
            headers["Cookie"] = f"token={token}"
    if (args.batch_size and not args.batch_number) or (args.batch_number and not args.batch_size):
        print("--batch-size and --batch-number must be provided together.", file=sys.stderr)
        return 2
    if args.batch_number and args.batch_number < 1:
        print("--batch-number must be >= 1.", file=sys.stderr)
        return 2

    report = build_report(
        root,
        args.include,
        only_status,
        log_paths,
        args.base_url,
        headers,
        args.batch_size,
        args.batch_number,
    )

    if args.format == "json":
        payload = {
            "root": report.root,
            "summary": report.summary,
            "routes": [
                {
                    **asdict(route),
                    "errors": [asdict(error) for error in route.errors],
                }
                for route in report.routes
            ],
            "log_findings": [asdict(finding) for finding in report.log_findings],
            "live_checks": [asdict(check) for check in report.live_checks],
        }
        output = json.dumps(payload, indent=2)
    else:
        output = render_text(report, args.max_errors)

    if args.output:
        output_path = Path(args.output).expanduser()
        output_path.write_text(output, encoding="utf-8")
    else:
        print(output)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
