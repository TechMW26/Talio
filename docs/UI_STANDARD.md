# Talio UI & Bundle Standard

Single source of truth for which libraries the web app uses and how to add UI
safely. The goal is one component system, one icon system, and predictable
bundle size. New code must follow this; existing drift is migrated incrementally.

## 1. Component primitives

| Layer | Import | Status |
| --- | --- | --- |
| App primitives | `@/components/ui/fernly` | **Canonical** — use this |
| Raw HeroUI re-exports | `@/components/ui/heroui` | Legacy, do not add new usage |
| `@heroui/react` | — | **Do not import directly in app code** |

- `@/components/ui/fernly` wraps HeroUI with the Fernly visual language (Button,
  Card, Input, Select, Modal, Tabs, Table, …) and re-exports the HeroUI
  collection children (`Tab`, `SelectItem`, `TableColumn`, …).
- `@/components/ui/fernly/native` exposes framework-neutral `Native*` elements
  (`NativeButton`, `NativeInput`, `NativeSelect`, `NativeTextarea`) for markup
  that must not depend on HeroUI.
- The wrapper layer is the only place allowed to import `@heroui/react`
  (see the ESLint override in `.eslintrc.json`).
- Do not introduce another component library. Adding one requires a documented
  decision because it duplicates HeroUI's React Aria behaviour and weight.

## 2. Icons

- **Library:** `react-icons` only, imported by subpath, e.g.
  `import { FaSearch, FaUsers } from 'react-icons/fa'`.
- Import individual icons (subpath imports are tree-shaken). Never
  `import * as Icons`.
- Icon sets in use: `react-icons/fa` (primary), `react-icons/hi2` (outline).
  Prefer `fa` for consistency unless the outline style is required.
- `lucide-react` is **not** allowed (removed). It is blocked by ESLint.

## 3. Feedback, motion, state

| Concern | Standard |
| --- | --- |
| Toasts | `@/utils/toast` (wraps react-hot-toast) |
| Motion | `framer-motion` — already a HeroUI dependency; keep animations small |
| Auth-aware data | `@/hooks/useAuthedSWR` (`useAuthedSWR`, `useAuthedSWRStatic`, `useAuthedSWRRealtime`) |
| Dashboard reads | `@/lib/client/dashboardRequest` |
| Loading/empty/error | `@/components/ui/heroui` `Loading`/`States` or `@/components/ui/fernly` equivalents |

## 4. Bundle discipline

Initial route bundles stay small. Anything heavy or route-specific loads on
demand, never at module scope on the dashboard shell:

- Prefer `next/dynamic(() => import('...'), { ssr: false })` for components.
- Prefer `await import('pkg')` inside the handler that needs it for libraries.
- Already lazy (keep it that way): `canvas-confetti`, `jspdf` + `jspdf-autotable`,
  `globe.gl`, `pdfjs-dist`, `@aiden0z/pptx-renderer`.
- Always use **named** imports from large libraries (e.g. `recharts`) rather than
  `import *`, so the bundler can tree-shake.
- `livekit-client`, `recharts`, and the meeting stack are route-scoped; do not
  pull them into shared/layout components.

## 5. Enforcement

`.eslintrc.json` restricts `lucide-react` and `@headlessui/react` as errors.
Run `npm run lint` before opening a PR.

## 6. Known migration backlog

- ~31 files still import `@heroui/react` directly; migrate to
  `@/components/ui/fernly` opportunistically when touching those files.
- `@/components/ui/heroui` should be folded into the Fernly layer over time.
