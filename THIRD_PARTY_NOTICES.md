# Third-Party Notices

Wanta incorporates and redistributes open-source components. The entries below document the key
runtime components that Wanta starts or places directly in a packaged application's resources.
They do not replace the license files shipped inside npm dependencies. A complete generated report
for all transitive build and runtime dependencies remains part of release preparation.

## OpenCode

Wanta uses [OpenCode](https://github.com/anomalyco/opencode) as its local Agent engine:

- `opencode-ai@1.18.21` — packaged executable and local `opencode serve` sidecar;
- `@opencode-ai/sdk@1.18.21` — HTTP/SSE client used by the Electron main process;
- `@opencode-ai/plugin@1.18.21` — tool API bundled into Wanta's Agent tool runtime.

License: MIT. Copyright (c) 2025 opencode.

Wanta is not a fork of OpenCode. It embeds the pinned OpenCode runtime and builds desktop lifecycle,
security isolation, model configuration, permissions, sessions, Connector tools, and artifact UI
around it.

## Codex ACP Bridge

Wanta packages `@agentclientprotocol/codex-acp@1.6.2` as the local ACP bridge used to connect a
user-installed Codex CLI to the common external-agent adapter.

Source: [agentclientprotocol/codex-acp](https://github.com/agentclientprotocol/codex-acp).
License: Apache License 2.0. Copyright 2025 JetBrains s.r.o. The complete license text is included
in this repository's [`LICENSE`](LICENSE) file.

## Claude Agent ACP Bridge

Wanta packages `@agentclientprotocol/claude-agent-acp@0.70.0` as the sole Claude Code transport.
The bridge exposes the official Claude Agent SDK over ACP while continuing to launch the user's
own Claude Code executable and native configuration.

Source: [agentclientprotocol/claude-agent-acp](https://github.com/agentclientprotocol/claude-agent-acp).
License: Apache License 2.0. Copyright Zed Industries and contributors. The complete license text
is included in this repository's [`LICENSE`](LICENSE) file.

## oo CLI and Bundled Skills

Wanta downloads and packages `@oomol-lab/oo-cli@1.7.12` platform binaries from the public npm
registry. The default package also contains four Skills exported by that distribution:

- `oo`;
- `oo-find-skills`;
- `oo-create-skill`;
- `oo-publish-skill`.

Source: [oomol-lab/oo-cli](https://github.com/oomol-lab/oo-cli). License: MIT.

The CLI and Skills are included by default so official OOMOL Connector and endpoint-compatible,
self-hosted OpenConnector deployments can use the same invocation path. Local BYOK mode does not
register Connector tools or inject the oo runtime environment.

## WeCom CLI and Skills

Wanta packages the official `@wecom/cli@1.1.0` platform binary and the matching `wecomcli-*`
Skills from source commit `cd0480e0e4013c99cc9e7bb4a3247ec949a052d8` for the local WeCom Direct
provider.

Source: [WecomTeam/wecom-cli](https://github.com/WecomTeam/wecom-cli). License: MIT. Copyright (c)
2026 WeCom.

## DingTalk Workspace CLI and Skills

Wanta packages the official DingTalk Workspace CLI (`dws`) version 1.0.59 and the matching stable
mono Skill from the same release for the local DingTalk Direct provider.

Source: [DingTalk-Real-AI/dingtalk-workspace-cli](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli).
License: Apache License 2.0; the complete license text is included in this repository's
[`LICENSE`](LICENSE) file. Copyright 2026 Alibaba Group.

The upstream platform archives include the following `NOTICE`, reproduced here as required:

```text
DingTalk Workspace CLI (dws)
Copyright 2026 Alibaba Group

This product includes software developed at
DingTalk (https://www.dingtalk.com/).
```

The CLI keeps account tokens encrypted through its platform credential backend. Wanta supplies
private configuration and ciphertext directories and exposes only redacted account and connection
state to the renderer.

## MIT License Text

The following text applies to the OpenCode, oo CLI, and WeCom CLI entries above:

```text
MIT License

Copyright (c) 2025 opencode
Copyright (c) 2026 OOMOL Lab
Copyright (c) 2026 WeCom

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
