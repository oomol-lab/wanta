# Internationalization

Wanta supports English (`en`), Simplified Chinese (`zh-CN`), Traditional Chinese
(`zh-TW`, Taiwan terminology), Japanese (`ja`), Korean (`ko`), Russian (`ru`),
French (`fr`) and Spanish (`es`). Language names in the settings selector use
native spelling. The `system` preference follows the first supported browser
language; explicit script subtags take precedence over Chinese region subtags.

## Ownership and persistence

`electron/app-locale.ts` is a pure shared registry: codes, native names, language
names, validation, and locale matching. Renderer imports are explicitly allowed
by the renderer boundary test. Neither React nor Electron runtime is imported by
this registry.

The native `settings.json` owns `localePreference`. Renderer localStorage is a
startup cache and the migration source for existing `en` and `zh-CN` preferences.
If no native preference exists, the renderer sends the legacy selection or
`system` to the native store after hydration. A late native response cannot
replace a selection the user just made. Language changes update the React
context, HTML `lang`, native menus, tray, and subsequent notifications without
remounting the app. A development `VITE_WANTA_LOCALE` override is not persisted.
The operating system may continue to control standard file picker and system
permission dialog language independently of Wanta's preference.

## Translation resources

- `src/i18n/app-messages.{en,zh}.ts` and `skills-messages.ts` retain existing keys.
- `src/i18n/locales/*.json` contain complete merged dictionaries for new locales.
- `electron/locales/*.json` contain native menu, tray, task/update notification,
  and login-confirmation copy; the main process does not import renderer dictionaries.
- English is the fallback for unavailable translations. Missing keys are rejected
  by catalog validation before application builds.
- `src/i18n/plurals/*.json` supplies count variants for English, French, Spanish and Russian.
  Pass raw numeric `count` values so `Intl.PluralRules` can choose the grammatical form.
  Chinese, Japanese and Korean use their ordinary count-neutral translations.
- `t(key, vars)` supports both `{name}` and `{{name}}`. Keep variable names intact.
- Preserve product names, commands, URLs, and identifiers. Do not translate user
  files, chat history, or third-party web pages when changing the interface language.

Translation drafts were generated using OOMOL's hosted LLM and validated locally.
There is no runtime translation service or added network dependency. Native-language
editorial review, especially of permission and billing copy, remains a release-quality
review step; automated checks do not certify linguistic correctness.

## Formatting and embedded content

Use the effective application locale for dates, numbers, lists and relative time.
Pass locale explicitly into pure formatting helpers and include it in memo/callback
dependencies. Currency codes come from billing data, never from the chosen language.

The installed Univer version provides all eight language packs. They are dynamically
imported via `artifact-univer-locales.ts`; a language change rebuilds the read-only
preview runtime with that language while leaving source files unchanged.
Connections requests already include locale and isolate cached catalogs by locale.
Remote provider descriptions depend on server translation coverage; Wanta does not
claim to translate third-party metadata automatically.

## Agent language policy

Interface language is only a fallback. Explicit user language instructions take
precedence within their scope, then the latest substantive request, then established
conversation language. Source documents, quoted content, tool results and identifiers
must not determine reply language. The shared per-turn policy applies to built-in and
external agents. Detection is conservative: ambiguous short text remains unresolved,
and Chinese script is only asserted when there is distinguishing evidence.

## Verification

Run `pnpm run i18n:check`, `pnpm run ts-check`, `pnpm run lint`, and `pnpm test`.
`build:app` runs catalog validation before TypeScript and Vite. Catalog tests compare
all keys and interpolation variables for all eight application and native dictionaries.
Provider tests exercise migration, persistence hydration, system language changes,
late-response races and preservation of mounted input state.

Before release, check actual desktop menus, language switching, narrow layouts,
IME composition, and preview controls on supported operating systems. Signed builds
are required to verify macOS notification delivery. Actual agent-model response
quality and native-language editorial review are separate from unit tests.
