export interface HtmlPreviewOptions {
  scriptsEnabled?: boolean
}

export function htmlPreviewSandbox(scriptsEnabled: boolean): string {
  return scriptsEnabled ? "allow-scripts" : ""
}

export function htmlPreviewHasScripts(source: string): boolean {
  return /<script[\s>]/iu.test(source) || /\son[a-z]+\s*=/iu.test(source)
}

function htmlPreviewHeadPrelude(scriptsEnabled: boolean): string {
  const scriptSource = scriptsEnabled ? "'unsafe-inline'" : "'none'"
  return [
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${scriptSource}; connect-src 'none'; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'; font-src data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';">`,
    "<style>html,body{background:transparent;}body{min-width:0;}</style>",
  ].join("")
}

export function htmlPreviewSrcDoc(source: string, options: HtmlPreviewOptions = {}): string {
  const prelude = htmlPreviewHeadPrelude(options.scriptsEnabled ?? true)
  const { body, doctype } = splitHtmlPreviewDoctype(source)

  if (/<head[\s>]/i.test(body)) {
    return `${doctype}${body.replace(/<head([^>]*)>/i, `<head$1>${prelude}`)}`
  }

  if (/<html[\s>]/i.test(body)) {
    return `${doctype}${body.replace(/<html([^>]*)>/i, `<html$1><head>${prelude}</head>`)}`
  }

  if (/<body[\s>]/i.test(body)) {
    return `${doctype}<html><head>${prelude}</head>${body}</html>`
  }

  return `${doctype}<html><head>${prelude}</head><body>${body}</body></html>`
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
