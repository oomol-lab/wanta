# Third-Party Notices

Wanta incorporates and redistributes open-source components. The entries below document the key
runtime components that Wanta starts or places directly in a packaged application's resources.
They do not replace the license files shipped inside npm dependencies. A complete generated report
for all transitive build and runtime dependencies remains part of release preparation.

## OpenCode

Wanta uses [OpenCode](https://github.com/anomalyco/opencode) as its local Agent engine:

- `opencode-ai@1.17.13` — packaged executable and local `opencode serve` sidecar;
- `@opencode-ai/sdk@1.17.13` — HTTP/SSE client used by the Electron main process;
- `@opencode-ai/plugin@1.17.13` — tool API bundled into Wanta's Agent tool runtime.

License: MIT. Copyright (c) 2025 opencode.

Wanta is not a fork of OpenCode. It embeds the pinned OpenCode runtime and builds desktop lifecycle,
security isolation, model configuration, permissions, sessions, Connector tools, and artifact UI
around it.

## oo CLI and Bundled Skills

Wanta downloads and packages `@oomol-lab/oo-cli@1.5.1` platform binaries from the public npm
registry. The default package also contains four Skills exported by that distribution:

- `oo`;
- `oo-find-skills`;
- `oo-create-skill`;
- `oo-publish-skill`.

Source: [oomol-lab/oo-cli](https://github.com/oomol-lab/oo-cli). License: MIT.

The CLI and Skills are included by default so official OOMOL Connector and endpoint-compatible,
self-hosted OpenConnector deployments can use the same invocation path. Local BYOK mode does not
register Connector tools or inject the oo runtime environment.

## MIT License Text

The following text applies to the OpenCode and oo CLI entries above:

```text
MIT License

Copyright (c) 2025 opencode
Copyright (c) 2026 OOMOL Lab

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Each copyright line above applies to its corresponding component family.

## OOMOL-Maintained Public Packages

Wanta uses the publicly downloadable `@oomol/connection@0.2.28` and
`@oomol/connection-electron-adapter@0.2.12` packages for typed Electron IPC. They are maintained by
OOMOL and their published tarballs include source code. Their current package versions do not yet
declare license metadata or include a license file. Public npm availability permits anonymous
installation but does not by itself grant redistribution rights. Before an official distributable
Wanta release, OOMOL must either publish package versions with explicit license terms or record
written redistribution permission for these exact versions. Until then, this is a release-readiness
blocker for redistributed binaries, not an installation or source-build blocker.

## Other Dependencies and Assets

The repository also depends on Electron, React, Univer, wiki-graph, Streamdown, Iconify data, fonts,
and other direct and transitive packages under their respective licenses. Product names, service
logos, and trademarks are not licensed merely because an open-source package contains a reference
or icon. See [TRADEMARKS.md](TRADEMARKS.md).
