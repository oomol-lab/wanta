const htmlPreviewHeadPrelude = [
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'; font-src data:;">`,
  "<style>html,body{background:transparent;}body{min-width:0;}</style>",
].join("")

export function htmlPreviewSrcDoc(source: string): string {
  const { body, doctype } = splitHtmlPreviewDoctype(source)

  if (/<head[\s>]/i.test(body)) {
    return `${doctype}${body.replace(/<head([^>]*)>/i, `<head$1>${htmlPreviewHeadPrelude}`)}`
  }

  if (/<html[\s>]/i.test(body)) {
    return `${doctype}${body.replace(/<html([^>]*)>/i, `<html$1><head>${htmlPreviewHeadPrelude}</head>`)}`
  }

  if (/<body[\s>]/i.test(body)) {
    return `${doctype}<html><head>${htmlPreviewHeadPrelude}</head>${body}</html>`
  }

  return `${doctype}<html><head>${htmlPreviewHeadPrelude}</head><body>${body}</body></html>`
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
