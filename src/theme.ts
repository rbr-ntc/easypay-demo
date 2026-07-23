// Две визуальные темы демо: 'classic' (навы/пилюли) и 'seasons' («Времена года»:
// пергамент, острые углы, outline-кнопки — из Claude Design проекта пользователя).
export type ThemeName = 'classic' | 'seasons'

export const theme: ThemeName =
  (document.documentElement.dataset.theme as ThemeName) === 'seasons' ? 'seasons' : 'classic'

export function setTheme(next: ThemeName): void {
  localStorage.setItem('easypay-style', next)
  const url = new URL(window.location.href)
  url.searchParams.set('style', next)
  // Перезагрузка — осознанно: тема читается один раз при старте (аватары, константы)
  window.location.href = url.toString()
}
