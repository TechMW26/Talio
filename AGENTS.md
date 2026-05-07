# AGENTS.md

## Purpose

This file is the project-level instruction source for coding agents working in this repository. Before analyzing, planning, coding, or changing files for any new user prompt, read and follow this file.

## Required Workflow For Every Prompt

1. Analyze the prompt first
   - Understand the feature, bug, or task clearly.
   - Identify the expected outcome, user flow, inputs, outputs, and edge cases.
   - Check the existing codebase before making assumptions.
   - If something is ambiguous, make a reasonable assumption and mention it briefly before proceeding.

2. Read this project instruction file
   - Always read `AGENTS.md` before working on any new prompt.
   - Use `AGENTS.md` as the source of truth for implementation behavior.
   - Never ignore the rules inside `AGENTS.md`.
   - If a new prompt conflicts with `AGENTS.md`, mention the conflict and follow the user's latest instruction unless it would break the project.

3. Create a quick implementation plan
   - Break the task into clear steps.
   - Mention which files, folders, components, APIs, services, or utilities will be affected.
   - If the task involves UI, describe the layout and user interaction first.
   - If the task involves backend logic, describe the data flow first.

4. Wireframe before implementation when UI is involved
   - Create a simple textual wireframe before coding.
   - Define page structure, sections, components, buttons, forms, cards, tables, modals, loading states, empty states, and error states.
   - Ensure the UI is responsive and consistent with the existing project style.

5. Inspect and respect the existing project structure
   - Do not randomly create files.
   - First inspect the current folder structure, naming conventions, routing patterns, component patterns, styling approach, API structure, and state management.
   - Follow the project's existing conventions.
   - Only create new folders/files when necessary.

6. Handle API integrations properly
   - If the prompt includes an API, first understand the API requirements:
     - endpoint
     - method
     - request body
     - headers/auth
     - response shape
     - loading state
     - error handling
     - retry or fallback behavior if needed
   - If API details are missing, create a clean placeholder service/function and clearly mark where the real API details should be added.
   - Keep API calls separated from UI components when possible, using services, hooks, utilities, or store actions according to the project structure.

7. Design folder and file structure before coding
   - Propose or infer the correct folder structure.
   - Group related files logically.
   - Use reusable components where appropriate.
   - Avoid creating duplicate logic or unnecessary abstractions.
   - Keep components small, readable, and maintainable.

8. Implement carefully
   - Make minimal, focused changes.
   - Integrate the feature end-to-end.
   - Ensure imports, exports, types, routes, environment variables, and dependencies are handled correctly.
   - Maintain consistent formatting and code style.
   - Do not break existing functionality.

9. Validate after implementation
   - Check for syntax errors, missing imports, broken references, incorrect paths, type errors, and obvious runtime issues.
   - Verify the user flow mentally or through available project commands.
   - If tests or linting commands exist, suggest or run them when appropriate.
   - Summarize what was implemented and mention any assumptions or TODOs.

## Important Behavior

- Always create `AGENTS.md` if it does not exist.
- Always read `AGENTS.md` before working on every new prompt.
- Always use `AGENTS.md` as the base instruction file for the project.
- Always analyze before coding.
- Always plan before editing files.
- Always wireframe UI features before implementation.
- Always inspect existing structure before creating new files.
- Always separate API logic cleanly.
- Always integrate the full flow, not just partial snippets.
- Never overwrite unrelated code.
- Never introduce unnecessary libraries unless there is a strong reason.
- Never leave the project in a broken or half-integrated state.

## Project Rules

- Respect the existing repository layout and naming conventions.
- Keep edits minimal, focused, and consistent with nearby code.
- Prefer existing utilities, components, hooks, services, models, and API patterns over creating new abstractions.
- Do not move or rename files unless required by the task.
- Do not modify unrelated files or revert unrelated user changes.
- Avoid adding dependencies unless the requirement cannot be met reasonably with existing project tools.
- Maintain authentication, authorization, tenant isolation, and data access patterns already established in the project.

## Folder Structure Guidelines

- Inspect current folders and routing patterns before creating anything new.
- Place UI components near existing related components or in an established shared component location.
- Place reusable logic in the existing utilities, hooks, contexts, services, or library folders according to current project conventions.
- Place API routes following existing framework and route structure.
- Group related files logically and avoid duplicate logic.
- Keep components and modules small, readable, and maintainable.

## API Integration Rules

- Understand the API endpoint, method, request body, headers/auth, response shape, loading state, error handling, and fallback behavior before implementation.
- Keep API calls separated from UI components when the project structure supports it.
- Use existing authentication and authorization helpers.
- Preserve tenant isolation and project data-access rules.
- Add placeholder service functions only when API details are missing, and clearly mark where real API details should be added.
- Handle loading, success, empty, and error states for user-facing API flows.

## UI Implementation Standards

- Wireframe UI changes before coding.
- Follow existing design language, styling approach, spacing, typography, and responsive behavior.
- Define loading, empty, error, and success states where applicable.
- Keep user interactions clear and accessible.
- Avoid unnecessary visual redesigns outside the requested scope.
- Build the actual usable workflow, not partial snippets.

## Backend Implementation Standards

- Describe data flow before coding backend changes.
- Use existing models, database connection helpers, auth helpers, and validation conventions.
- Keep business logic readable and testable.
- Handle expected edge cases and failure modes.
- Avoid weakening security, authorization, tenant isolation, or input validation.

## Validation Checklist

Before finishing, check as appropriate:

- Syntax errors.
- Missing imports or exports.
- Incorrect paths or broken references.
- Type or lint issues when tooling is available.
- Runtime issues visible from the changed flow.
- Loading, empty, success, and error states for UI/API work.
- Auth, role, and tenant behavior for protected backend flows.
- Existing tests, lint, or focused commands relevant to the change.

## Response Format

Use this format when responding to implementation prompts:

```text
Analysis:
Briefly explain what the request means and what needs to be built.

AGENTS.md Check:
Mention whether AGENTS.md exists, was created, or was read.

Wireframe:
Only include this section if UI is involved. Show a simple text-based layout.

Implementation Plan:
List the steps you will take.

Folder/File Plan:
Mention the files you will create or modify.

Implementation:
Make the required code changes.

Validation:
Explain what was checked and how to test it.

Final Summary:
Summarize the completed work and any assumptions.
```
