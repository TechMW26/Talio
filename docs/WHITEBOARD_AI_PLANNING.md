# Context-aware board planning

AI Search and both Talio Board AI panels use a shared floating glass treatment. `AIActivityBeam` lazily loads Libraries.dev `border-beam`, runs only for active requests, respects reduced motion, and never reparents the form. Search aborts stale requests to prevent old results overwriting new queries.

Agent Mode offers **Let MIRA plan** alongside optional visual-style preferences. Preparation uses DeepSeek Pro reasoning with the request and a bounded text snapshot of the existing board. It returns concise sections, stable section IDs, a user-facing plan summary, and explicitly labeled relationships. The prompt does not ask for hidden reasoning or invented research/probabilities. The UI shows indeterminate status rather than simulated completion.

`whiteboardAIContent` validates and bounds plans. `whiteboardAIPlan` arranges editable text and shapes as a layered graph, radial map, or grid, using actual content dimensions. Invalid/self/duplicate edges are discarded; cycles cannot cause infinite layout loops. Saved legacy content without a diagram keeps its original renderer.

Plotting is still an explicit review-and-plot action. A new generation preserves existing content; an update removes only objects tagged with that generation ID. Saving uses one atomic update with an `updatedAt` conflict check, not clearing the page and appending batches. A concurrent change returns 409 and asks the user to refresh. The existing tenant/auth/board-edit permissions apply unchanged.

Validation includes geometry, normalization, AI route, theme-scope and save-conflict tests. Browser checks do not mutate existing boards just to test plotting.
