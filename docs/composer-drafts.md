# Composer drafts

The composer is a view of a draft owned by `ComposerDrafts`, not the owner of the draft's lifetime. Opening New chat or a project restores its draft. Discarding content is an explicit Clear draft action with an eight-second undo notice.

## Identity and ownership

Drafts are separated by account, workspace/team and project, or by an existing session ID. Changing pages does not discard them. An attachment import captures the originating draft and its generation before it starts. Completion updates that draft even if its input has unmounted. Clearing a draft invalidates older import completions; late results are released instead of reviving discarded content.

Selecting a project from the composer moves the current draft only when the destination is empty and no imports are pending. A conflict offers navigation to the destination while preserving both drafts. Existing project sidebar entries restore their own drafts without moving another draft.

Submission consumes only the captured draft state after acceptance. A later edit is not cleared by an earlier send completion. Failed submissions retain their input. Pending attachment imports block submission.

## Persistence

The main process stores draft metadata in `composer-drafts.json` under userData, using serialized atomic writes and mode 0600. Text edits are coalesced for 250 ms; attachment and destructive transitions are written immediately. Storage failure is visible and has a retry action. The retry action independently retries loading and outstanding writes, so a persistent load failure cannot strand newly edited drafts in memory. This is local persistence, not cloud synchronization.

Only attachment metadata is persisted. Blob and temporary resource URLs are regenerated from the original snapshots. Draft preferences include the agent, native model/effort selection, knowledge references and permission mode; full access is never restored as a saved default.

The main process verifies the active account and validates newly introduced attachment paths before writing. Existing draft references remain visible if a file disappears. Only original draft snapshot paths participate in normal trusted-path checks, so an attachment does not lose access merely because the file-picker grant expired. Account changes are checked again after asynchronous reads.

A short main-process undo lease retains the paths of a cleared draft for 30 seconds, allowing the eight-second UI undo to persist its restored references. This lease is not restored after process restart. Message cleanup and startup garbage collection retain snapshots referenced by drafts. Unreferenced snapshots remain eligible for the existing age-based cleanup. Internal agent copies are retained for cleanup purposes but do not grant renderer preview or open access.

Malformed or unsupported draft stores enter a degraded state with empty in-memory drafts. Before the first replacement write, the unreadable file is moved into `composer-drafts-recovery` under userData. Attachment pruning is paused while unknown references may exist, including after saving new drafts and restarting. Retention reports this pause separately from known paths; session and message record deletion can still complete while physical snapshot deletion is skipped. Preserved files must be recovered or deliberately removed before restarting to resume pruning. Filesystem failures remain retryable; a failed quarantine never replaces the original store. Logs do not include parser errors or draft contents.

Imports already underway survive page navigation. A process exit can interrupt an import whose source bytes have not been captured; restored drafts show an interruption notice so the unfinished files can be added again. As with other debounced editors, an abrupt process kill can lose the final unsaved text interval.

## Verification

Regression tests cover disk round trips, account isolation, authorization, attachment retention, asynchronous completion after unmount, clearing during imports, undo, project conflicts, submission races, save retries and preview recovery. The Electron check exercises New chat navigation, renderer reload, process restart, image decoding, clear/undo and confirmation that the undo was written back to disk.
