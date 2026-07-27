---
name: wikigraph-knowledge
description: Use Wanta WikiGraph knowledge contexts through the managed wg command.
---

# WikiGraph Knowledge

Use this skill whenever the current turn includes a Wanta knowledge context such as `@Knowledge library`, `@知识库`, or a specific imported `.wikg` archive.

## Context scopes

- `wikg://lib` means the whole Wanta local WikiGraph library. Use it for broad questions, cross-archive lookup, discovery, or when the user says only `@知识库` / the knowledge library.
- `wikg://lib/arc/<id>` means one specific imported WikiGraph archive. Use it when the user selected a book/archive or the question clearly names that archive.
- If both library and archive contexts are present, choose the narrowest scope that can answer the request. Start with the archive for focused questions; use the library for cross-book comparison, unknown-source lookup, or when the focused archive lacks enough evidence.

## Command boundary

- Run WikiGraph only through Wanta's managed `wg` command on PATH.
- Do not depend on a global WikiGraph installation, raw storage paths, or `.wikg` files as normal attachments.
- Treat knowledge bases as read-only by default. Import, rebuild, delete, edit, or maintenance operations require explicit user intent.

## Retrieval path

1. Pick the scope URI (`wikg://lib` or `wikg://lib/arc/<id>`) from the turn context.
2. Use broad library/archive search first when the target entity, chapter, or source is unclear.
3. Use entity search for people, organizations, places, works, concepts, aliases, or disambiguation.
4. Use triple search for relationships, chronology, cause/effect, ownership, family, conflict, cooperation, or graph-style questions.
5. Use chunk or full-text search for wording, quotations, passages, events, and source-grounded summaries.
6. Retrieve evidence/source context before stating factual relationships. Use related or pack only after a relevant entity, triple, chunk, or source handle is selected.

## Readiness and failures

- If an index is unavailable, stale, or not ready, report that limitation and use any available search path rather than inventing evidence.
- If the library is empty, explain that no imported WikiGraph knowledge is available and suggest importing a `.wikg` file when useful.
- If a query fails, do not pretend the knowledge base was searched. Summarize the failure and try a narrower or broader scope when reasonable.

## Answering with evidence

- Cite chapter names, source handles, evidence handles, or other WikiGraph-provided source identifiers when available.
- Distinguish evidence-backed facts from interpretation, synthesis, or uncertainty.
- For relationship diagrams, verify important edges with evidence, keep the graph focused, merge aliases only when evidence supports identity, and use dotted edges for inference or uncertainty.
- Do not expose Wanta managed storage paths unless the user explicitly asks for low-level debugging details.
