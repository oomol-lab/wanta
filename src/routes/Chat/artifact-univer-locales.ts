import type { AppLocale } from "../../../electron/app-locale.ts"

import { LocaleType } from "@univerjs/core"

export const univerLocales: Record<AppLocale, LocaleType> = {
  en: LocaleType.EN_US,
  "zh-CN": LocaleType.ZH_CN,
  "zh-TW": LocaleType.ZH_TW,
  ja: LocaleType.JA_JP,
  ko: LocaleType.KO_KR,
  ru: LocaleType.RU_RU,
  fr: LocaleType.FR_FR,
  es: LocaleType.ES_ES,
}
const loaders = {
  en: () => import("@univerjs/preset-sheets-core/locales/en-US"),
  "zh-CN": () => import("@univerjs/preset-sheets-core/locales/zh-CN"),
  "zh-TW": () => import("@univerjs/preset-sheets-core/locales/zh-TW"),
  ja: () => import("@univerjs/preset-sheets-core/locales/ja-JP"),
  ko: () => import("@univerjs/preset-sheets-core/locales/ko-KR"),
  ru: () => import("@univerjs/preset-sheets-core/locales/ru-RU"),
  fr: () => import("@univerjs/preset-sheets-core/locales/fr-FR"),
  es: () => import("@univerjs/preset-sheets-core/locales/es-ES"),
}
export async function loadUniverMessages(locale: AppLocale) {
  return (await (loaders[locale] ?? loaders.en)()).default
}
