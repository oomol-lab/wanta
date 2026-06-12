"use strict"

// electron-builder afterPack hook：删除 Electron 自带的 Chromium 第三方
// 聚合 license 文件（约 20 MB）。
//
// macOS 平台 electron-builder 自身就会在 createMacApp 时 unlink 这两个文件
// （见 app-builder-lib/out/electron/electronMac.js），这里只是兜底覆盖
// Windows / Linux，保持跨平台行为一致。
//
// 合规说明：Chromium 主体走 BSD-3-Clause，原文允许许可证通知以"文档或
// 其他材料"形式提供；项目应在应用 About 菜单 / 官网维护开源声明，承担
// LICENSES.chromium.html 原本承担的通知义务，故不在二进制包内重复嵌入。
// 保留 LICENSE.electron.txt（Electron 自身 MIT），它体积可忽略且 MIT 要求
// 必须随分发包含 license。
//
// .cjs 而非 .ts：electron-builder 用 require(path) 加载 hook，Node 子进程
// 不带 --experimental-strip-types，无法直接 require .ts。

const { unlink } = require("node:fs/promises")
const path = require("node:path")

const REMOVED_LICENSE_FILES = ["LICENSES.chromium.html"]

module.exports = async function afterPack(context) {
  for (const name of REMOVED_LICENSE_FILES) {
    const filePath = path.join(context.appOutDir, name)
    try {
      await unlink(filePath)
      console.log(`afterPack: removed ${filePath}`)
    } catch (err) {
      if (err && err.code !== "ENOENT") throw err
    }
  }
}
