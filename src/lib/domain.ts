// 渲染层取 oomol 各服务 base URL 的唯一入口：直接复用主进程同款 electron/domain.ts
// （唯一域名来源，由构建期常量 __OO_ENDPOINT__ 派生）。这样渲染层发请求时不硬编码任何域名（守 R2），
// 又能以 @/lib/domain 的整洁路径引用，不必跨目录写深相对路径。
export * from "../../electron/domain.ts"
