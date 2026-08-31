import { redirect } from 'next/navigation'

// Keep old bookmarks working while employee lifecycle orchestration remains
// behind the normal people flows instead of exposing a separate workflow UI.
export default function LegacyHrmsWorkflowRedirect() {
  redirect('/dashboard/employees')
}
