import type { AppLocale } from "../app-locale.ts"

import { supportedAppLocales } from "../app-locale.ts"
import { nativeTranslate } from "../native-messages.ts"

export interface ApplicationMenuLabels {
  about: string
  checkForUpdates: string
  closeWindow: string
  copy: string
  cut: string
  delete: string
  developer: string
  edit: string
  exit: string
  file: string
  focusComposer: string
  forceReload: string
  front: string
  help: string
  hide: string
  hideOthers: string
  minimize: string
  newChat: string
  paste: string
  pasteAndMatchStyle: string
  quit: string
  redo: string
  reload: string
  resetZoom: string
  searchTasks: string
  selectAll: string
  services: string
  settings: string
  showAll: string
  stopGeneration: string
  toggleDevTools: string
  toggleFullScreen: string
  toggleSidebar: string
  undo: string
  view: string
  window: string
  zoom: string
  zoomIn: string
  zoomOut: string
}

function menuLabels(locale: AppLocale): ApplicationMenuLabels {
  return {
    about: nativeTranslate(locale, "menu.about"),
    checkForUpdates: nativeTranslate(locale, "menu.checkForUpdates"),
    closeWindow: nativeTranslate(locale, "menu.closeWindow"),
    copy: nativeTranslate(locale, "menu.copy"),
    cut: nativeTranslate(locale, "menu.cut"),
    delete: nativeTranslate(locale, "menu.delete"),
    developer: nativeTranslate(locale, "menu.developer"),
    edit: nativeTranslate(locale, "menu.edit"),
    exit: nativeTranslate(locale, "menu.exit"),
    file: nativeTranslate(locale, "menu.file"),
    focusComposer: nativeTranslate(locale, "menu.focusComposer"),
    forceReload: nativeTranslate(locale, "menu.forceReload"),
    front: nativeTranslate(locale, "menu.front"),
    help: nativeTranslate(locale, "menu.help"),
    hide: nativeTranslate(locale, "menu.hide"),
    hideOthers: nativeTranslate(locale, "menu.hideOthers"),
    minimize: nativeTranslate(locale, "menu.minimize"),
    newChat: nativeTranslate(locale, "menu.newChat"),
    paste: nativeTranslate(locale, "menu.paste"),
    pasteAndMatchStyle: nativeTranslate(locale, "menu.pasteAndMatchStyle"),
    quit: nativeTranslate(locale, "menu.quit"),
    redo: nativeTranslate(locale, "menu.redo"),
    reload: nativeTranslate(locale, "menu.reload"),
    resetZoom: nativeTranslate(locale, "menu.resetZoom"),
    searchTasks: nativeTranslate(locale, "menu.searchTasks"),
    selectAll: nativeTranslate(locale, "menu.selectAll"),
    services: nativeTranslate(locale, "menu.services"),
    settings: nativeTranslate(locale, "menu.settings"),
    showAll: nativeTranslate(locale, "menu.showAll"),
    stopGeneration: nativeTranslate(locale, "menu.stopGeneration"),
    toggleDevTools: nativeTranslate(locale, "menu.toggleDevTools"),
    toggleFullScreen: nativeTranslate(locale, "menu.toggleFullScreen"),
    toggleSidebar: nativeTranslate(locale, "menu.toggleSidebar"),
    undo: nativeTranslate(locale, "menu.undo"),
    view: nativeTranslate(locale, "menu.view"),
    window: nativeTranslate(locale, "menu.window"),
    zoom: nativeTranslate(locale, "menu.zoom"),
    zoomIn: nativeTranslate(locale, "menu.zoomIn"),
    zoomOut: nativeTranslate(locale, "menu.zoomOut"),
  }
}
export const applicationMenuMessages = Object.fromEntries(
  supportedAppLocales.map((locale) => [locale, menuLabels(locale)]),
) as Record<AppLocale, ApplicationMenuLabels>

export function applicationMenuLabels(locale: AppLocale): ApplicationMenuLabels {
  return applicationMenuMessages[locale]
}
