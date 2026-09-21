# Cloud knowledge base

Wanta uses the same team-scoped cloud knowledge service as Console. The Knowledge
route is available with an OOMOL account and is keyed by account and team. Its
renderer client uses the existing HttpOnly cookie transport and the centrally
derived knowledge endpoint. File operations send `x-oo-team-id`; this is an ID,
not the team name used by the Connector CLI.

The page supports uploads up to 150 MiB, cursor pagination, asynchronous file
status polling, deletion confirmation, and manual retrieval with source snippets.
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
and return to chat to retrieve. Guidance does not turn every message into a
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
inside tool execution details. It uses the persisted tool result rather than
re-querying a potentially changed document. Unknown output shapes retain the
normal raw tool result view. No page numbers, document URLs, per-file search
filters, or new knowledge-base containers are invented.

## Validation

Unit and component coverage checks HTTP scoping/cancellation, upload validation,
pagination, polling, late responses after team switching, read-only controls,
host scope rejection, and source parsing. Real-service qualification additionally
requires an authenticated Wanta profile: upload a fixture, wait until ready,
retrieve it in the page and in chat, reopen history, switch teams, and verify both
built-in and external-agent paths. Do not infer successful end-to-end retrieval
from schema discovery alone.
