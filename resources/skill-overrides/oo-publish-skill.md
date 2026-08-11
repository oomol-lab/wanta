## Wanta fast path for publishing a new version

When the user asks to publish a new version of an existing local Skill, keep the workflow deterministic and short:

1. Resolve the concrete source path once. If multiple installed copies are identical, use the current runtime copy; ask only when their contents differ and no source is already clear.
2. Read `SKILL.md` frontmatter once. If `metadata.version` exists, increment its patch component unless the user requested another bump. If it is missing, use `0.0.1`.
3. Keep an existing `metadata.packageName`. If it is missing, create `@<account>/<skill-name>` from the non-secret `WANTA_ACCOUNT_NAME` environment value and the frontmatter `name`. If that value is unavailable, run the publish command once and apply only the smallest correction named by its error.
4. For an existing package whose visibility should remain unchanged, omit `--visibility`. For a genuinely new package with no requested visibility, ask exactly once whether it should be private or public.
5. In a non-interactive agent session, run `oo skills publish <path> -y` with `--visibility` only when visibility is explicitly chosen for a new package or explicitly changed by the user.
6. On a version-conflict error, increment patch once and retry once. For any other failure, report the exact error and smallest next fix; do not begin an open-ended investigation.

Do not search logs, shell history, SQLite databases, unrelated Skill metadata, registry caches, or alternate guessed package names to infer version or visibility. Do not infer this Skill's visibility from other packages. Before the first publish attempt, use at most the source resolution and frontmatter read above.
