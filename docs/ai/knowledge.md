# Cloud knowledge base

Wanta uses the same team-scoped cloud knowledge service as Console. The Knowledge
route is available with an OOMOL account and is keyed by account and team. Its
renderer client uses the existing HttpOnly cookie transport and the centrally
derived knowledge endpoint. File operations send `x-oo-team-id`; this is an ID,
not the team name used by the Connector CLI.

The page supports uploads up to 150 MiB through the file picker or by dropping
files on the knowledge list area, cursor pagination, asynchronous file status
polling, and deletion confirmation. Dragging files over the writable list area
highlights it; a drop uploads the supported files in sequence. The Knowledge
route keeps files in a list. The top-right ask button opens a conversation panel
beside that list using the same ChatArea and ChatComposer as the main chat;
closing the panel leaves the list in place. A question starts a distinct task
through the existing agent submission path with the current team's
`cloud-knowledge` context.
The analysis stays in the Knowledge route, retaining the normal ChatArea and
ChatComposer. Session metadata records `knowledgeMode` so reopening the task from
the sidebar restores the conversation panel; follow-up turns keep knowledge
retrieval enabled. Selecting a file opens its inline reader over the list area,
and selecting a retrieved source during analysis opens the evidence and file
preview beside the conversation. Its preview reads
`GET /v1/files/:id/content` using the same account cookie and team header as the
list. The renderer bounds downloads before buffering them and lazily reuses the
existing PDF, DOCX, image, text, and read-only Univer spreadsheet viewers. The
PDF viewer module loads in parallel with the authenticated content request, and
PDF.js receives the bounded downloaded bytes directly without a Blob URL reload.
The current rich preview limit is 16 MiB, with an 8 MiB XLSX limit; the upload limit
does not imply that every accepted file can be previewed. A text response from
the knowledge service is displayed as service text rather than described as a
pixel-faithful original. The source pane shows only excerpts from a completed
chat retrieval, not a complete chunk listing.
Unsupported, oversized, unavailable, and not-yet-ready content has an explicit
state. Preview Blob URLs and requests are released when the file, route, account,
or team changes.
Uploads have no fixed deadline and offer an in-page Cancel upload action, as well
as cancellation on route/account/team changes. Cancellation releases management
controls immediately and ignores late completion of the cancelled request. It
refreshes the list because files already accepted by the server may still process.
Listing and retrieval retain bounded deadlines. Upload acceptance means queued
processing, not search readiness. Read-only workspaces disable mutations.

## Default RAG Skill and upload guidance

The published `oo-oomol-rag` Registry Skill is enabled by default in the document
category (minimum version 1.0.0). The normal post-login installer installs missing
Skills and respects explicit user removals. This is a runtime Skill, not a document
uploaded into the knowledge index.

Both agent paths receive the same conditional RAG guidance in the per-turn system
context whenever an OOMOL team is active. Relevant requests load the Skill when
available and direct manual ingestion to Wanta or the current environment's
`/team/<encoded-team-name>/knowledge` Console page. Users upload, wait for Ready,
and ask from Wanta's Knowledge route or chat. Guidance does not turn every message into a
retrieval, invent an upload action, or imply a queued document is indexed.

## Chat

The composer book button adds a `cloud-knowledge` context mention bound to the
current team ID. Existing drafts, queues and retries preserve this intent. The
host rejects the selection if it does not match the request team or if the active
Link runtime is not OOMOL. Legacy WikiGraph `knowledge` mentions remain ignored.

Both built-in and external agents receive the same selected-context instructions:
inspect and invoke `oomol_rag.retrieve` through their existing guarded Link
transport, preserve the host workspace, cite filenames and supporting excerpts,
and distinguish an empty result from failure. Retrieval is agent-executed; the
host does not silently issue additional searches or guarantee that a third-party
agent follows every instruction. Connector fields are `query`, `topK` and
`enableReranking`; the HTTP fields use `top_k` and `enable_reranking`.

Successful structured retrieval output is rendered as expandable source snippets
inside tool execution details and as file-grouped source cards below the turn.
It uses the persisted tool result rather than
re-querying a potentially changed document. Unknown output shapes retain the
normal raw tool result view. No page numbers, document URLs, per-file search
filters, or new knowledge-base containers are invented.
The source detail can be opened in Wanta's Knowledge route from a completed
retrieval. This preserves the historical excerpt while separately re-checking
access to current file content through the selected team's HTTP endpoint.

## Validation

Unit and component coverage checks HTTP scoping/cancellation, upload validation,
pagination, polling, late responses after team switching, read-only controls,
knowledge task creation and persisted mode, host scope rejection, and source
parsing. Real-service qualification additionally requires an authenticated Wanta
profile: upload a fixture, wait until ready, ask from the file list, inspect the
answer and source cards, reopen the knowledge task from the sidebar, switch teams,
and verify both built-in and external-agent paths. Do not infer successful
end-to-end retrieval from schema discovery alone.
