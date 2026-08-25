/** Generated HTML artifacts may run only their embedded code in a sandbox. */
export function htmlPreviewSandbox(): string {
  return "allow-scripts"
}

function htmlPreviewHeadPrelude(): string {
  return [
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; connect-src 'none'; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'; font-src data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';">`,
    "<style>html,body{background:transparent;}body{min-width:0;}</style>",
  ].join("")
}

export function htmlPreviewSrcDoc(source: string): string {
  const prelude = htmlPreviewHeadPrelude()
  const { body, doctype } = splitHtmlPreviewDoctype(source)
  // A meta-delivered CSP only protects content parsed after the meta element.
  // Emit it before every untrusted source token; Chromium will place these
  // head-only elements into the document head before parsing the supplied HTML.
  return `${doctype}${prelude}${body}`
}

function splitHtmlPreviewDoctype(source: string): { body: string; doctype: string } {
  const trimmedSource = source.trimStart()
  const doctypeMatch = /^<!doctype[^>]*>/i.exec(trimmedSource)

  if (!doctypeMatch) {
    return { body: trimmedSource, doctype: "<!doctype html>" }
  }

  return {
    body: trimmedSource.slice(doctypeMatch[0].length),
    doctype: doctypeMatch[0],
  }
}
