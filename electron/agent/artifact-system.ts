export function buildArtifactSystem(artifactDir: string | undefined, outputProjectRoot?: string): string | undefined {
  if (!artifactDir) {
    return undefined
  }
  const projectPublication = outputProjectRoot
    ? [
        `- This turn belongs to a folder project. Wanta will publish final deliverables from this managed directory into the visible project directory: ${outputProjectRoot}`,
        "- Use descriptive user-facing file and directory names. Preserve any project-relative output layout explicitly requested by the user inside this managed directory; Wanta will reproduce that layout in the project.",
        "- Do not write a second copy directly into the project directory. Wanta performs the checked, collision-safe publication after the turn completes.",
        "- In the final response, refer to deliverables by their user-facing names or requested project-relative locations. Do not present the managed artifact path as the final project location.",
      ]
    : []
  return [
    "Artifact output contract for this turn:",
    `- Use this exact directory for files you create, convert, export, download, or modify as user-facing deliverables: ${artifactDir}`,
    "- Do not create files just because this artifact directory is provided.",
    ...projectPublication,
    "- For edits to an existing local project, modify the requested project files in place; even when this artifact directory is inside the project, use it only for exported deliverables, generated assets, converted files, reports, or packaged outputs.",
    "- Temporary scripts, raw API or query responses, logs, checkpoints, caches, and machine-review files belong in the managed process directory, never in the artifact directory.",
    "- When you create one or more deliverables, write .wanta-artifact.json in the artifact directory as the explicit publication declaration. Use only relative paths to files that already exist under the artifact directory.",
    '- The declaration format is {"version":2,"title":"...","kind":"document|spreadsheet|presentation|web_page|image_set|code_project|archive|mixed","display":"single|document|table|project|gallery|file_list","items":[{"path":"report.html","role":"primary","order":1}],"supporting":[{"path":"report.md","role":"supporting","order":1}]}. Use role "metadata" for reproducibility data that must remain hidden from normal artifact UI.',
    "- Wanta validates the declaration and publishes only declared primary, summary, and supporting files. Do not declare temporary or machine-facing files as primary/supporting. Do not describe files that do not exist.",
    "- Treat HTML reports, images, PDFs, charts, spreadsheets, presentations, archives, and documents as user-facing deliverables.",
    "- Keep HTML reports usable in a resizable preview viewport. Include a standard viewport meta tag, avoid overflow:hidden on html/body unless the user explicitly requests a fixed non-scrollable canvas, and make fixed-size content responsive or leave the document scrollable.",
    "- For image sets, save every final image in display order with stable padded names such as 001.jpg and 002.jpg.",
    "- Image preview and artifact persistence are separate outputs, and both are required for every final generated image whenever the source can be materialized. Preserve a useful inline preview whenever an image provider or tool returns a viewable image, even when that preview is remote, data-backed, or temporary.",
    "- Persist every final generated image into this directory. If a tool returns only a remote, data-backed, or temporary preview, keep the preview reference intact so Wanta can materialize the same image during turn finalization. Do not describe it as a saved local file until persistence succeeds.",
    "- When a generated image has both a successfully saved local path and a matching remote or temporary preview, use the local path for the inline Markdown image. Keep the remote reference only as recovery metadata; do not make it the primary preview.",
    "- When the final deliverable is one to four image files and inline viewing helps the user, include Markdown image references in the final response using their absolute local paths, for example ![short title](</absolute/path/image.png>).",
    "- On Windows, use drive-letter paths such as C:/Users/name/output.png or C:\\Users\\name\\output.png without an extra leading slash. Never emit /C:/Users/... as a local Markdown image destination.",
    "- If only a provider-backed image preview is available, keep that preview visible in the final response instead of omitting it. Wanta will materialize supported preview sources and independently report persistence failures.",
    "- When there are many images, such as crawled or downloaded image sets, do not inline every image in the final response. Summarize the set and rely on the artifact browser.",
    "- Do not reuse output folders from earlier turns or other chats.",
    "- If you reuse a script from an earlier turn, copy or update it before running and replace every embedded output path with this turn's artifact directory. Never run a prior-turn script while it still targets an earlier output directory.",
    "- Do not write deliverables to Desktop, Downloads, the OpenCode workspace, or prior output directories unless the user explicitly requested that exact destination.",
    outputProjectRoot
      ? "- When you finish, summarize the deliverable contents and names in prose; Wanta will surface the checked final project locations after publication."
      : "- When you finish, summarize the deliverable contents and report generated file paths in prose or inline code, not fenced code blocks; fenced blocks are only for code or multi-line text.",
    "- Do not open generated files with system commands unless the user explicitly asks you to open them externally; the app is responsible for surfacing artifacts in the UI.",
  ].join("\n")
}
