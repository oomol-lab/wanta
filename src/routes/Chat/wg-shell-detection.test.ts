import { describe, expect, it } from "vitest"
import { isWgKnowledgeShellCommand, isWgShellCommand } from "./wg-shell-detection.ts"

const positiveCases = [
  'wg wikg://lib --query "唐僧" --json',
  'wg wikg://lib/arc/book-1/entity --query "孙悟空" --json',
  "wikigraph wikg://lib inspect",
  '/usr/local/bin/wg wikg://lib/chunk --query "取经"',
  'NO_COLOR=1 WG_LOG=warn wg wikg://lib --query "佛教" --json',
  'env NO_COLOR=1 PATH=/opt/bin:$PATH wg wikg://lib/entity --query "沙僧"',
  'wg wikg://lib/entity --query "唐僧" --json | jq -r ".items[].title"',
  'printf "%s\\n" "唐僧" | wg wikg://lib/entity --query - --json | jq .',
  "cd /tmp && wg wikg://lib inspect",
  'test -f cache.json || wg wikg://lib --query "缺失" --json',
  '(wg wikg://lib --query "三藏" --json | jq .)',
  'bash -lc "wg wikg://lib --query \\\"观音\\\" --json | jq ."',
  'sh -c "NO_COLOR=1 wg wikg://lib inspect"',
  "wg wikg://lib --query - <<'QUERY'\n唐僧 和 孙悟空\nQUERY",
  "diff <(wg wikg://lib/entity --query 唐僧 --json) old.json",
  'echo "$(wg wikg://lib/entity --query 唐僧 --json)" | jq .',
  "OO=$(wg wikg://lib/entity --query 唐僧 --json) node -e 1",
  "env FOO=$(wg wikg://lib/entity --query 唐僧 --json) node -e 1",
  "FOO=$(wikigraph wikg://lib inspect) node -e 1",
  "env -i FOO=$(wg wikg://lib/entity --query 唐僧 --json) node -e 1",
  "env --unset PATH FOO=$(wg wikg://lib/entity --query 唐僧 --json) node -e 1",
]

const negativeCases = [
  'wg wikg://lib --query "唐僧',
  "echo '$(wg wikg://lib/entity --query 唐僧 --json)'",
  "echo wg wikg://lib/entity --query 唐僧",
  'curl "https://example.com/?u=wikg://lib&cmd=wg"',
  "wg --help",
  "grep wg notes.txt",
  'grep "wikg://lib" notes.txt',
  'node -e "console.log(\\\"wg wikg://lib\\\")"',
  "python -c \"print('wg wikg://lib')\"",
  "cat <<'EOF'\nwg wikg://lib --query 唐僧\nEOF",
  "cat <<EOF\nwg wikg://lib --query 唐僧\nEOF",
  "OO='$(wg wikg://lib/entity --query 唐僧 --json)' node -e 1",
  "env FOO='$(wg wikg://lib/entity --query 唐僧 --json)' node -e 1",
  'OO="wg wikg://lib/entity --query 唐僧 --json" node -e 1',
  'env FOO="wg wikg://lib/entity --query 唐僧 --json" node -e 1',
]

const unbashBoundaryCases = [
  'env -i NO_COLOR=1 bash -lc "wg wikg://lib --query \\\"菩萨\\\" --json"',
  'zsh -c "wikigraph wikg://lib inspect"',
  'echo "`wg wikg://lib/entity --query 唐僧 --json`" | jq .',
]

const unbashBoundaryNegativeCases = [
  'env -i node -e "console.log(\\\"wg wikg://lib\\\")"',
  "printf '%s\n' 'wg wikg://lib/entity --query 唐僧'",
]

describe("WG shell detection", () => {
  it.each(positiveCases)("recognizes WG knowledge command: %s", (command) => {
    expect(isWgKnowledgeShellCommand(command)).toBe(true)
  })

  it.each(negativeCases)("does not recognize non-executed WG text: %s", (command) => {
    expect(isWgKnowledgeShellCommand(command)).toBe(false)
  })

  it.each(unbashBoundaryCases)("keeps unbash boundary behavior positive: %s", (command) => {
    expect(isWgKnowledgeShellCommand(command)).toBe(true)
  })

  it.each(unbashBoundaryNegativeCases)("keeps unbash boundary behavior negative: %s", (command) => {
    expect(isWgKnowledgeShellCommand(command)).toBe(false)
  })

  it.each(["wg help recipe 2>&1", "wg maintenance upgrade --help 2>&1", 'bash -lc "wg help recipe 2>&1"'])(
    "recognizes any executed WG command for locked knowledge activity: %s",
    (command) => {
      expect(isWgShellCommand(command)).toBe(true)
    },
  )

  it.each(["echo wg help", "node -e \"console.log('wg help')\"", "grep wg notes.txt"])(
    "does not recognize plain WG text as an executed WG command: %s",
    (command) => {
      expect(isWgShellCommand(command)).toBe(false)
    },
  )
})
