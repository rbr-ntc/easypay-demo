import type { Dish } from '../../../data'
import { getStaffToken } from '../../../staff'
import { staffPost, type StaffResult } from '../../staffApi'

/** Конструктор меню: черновик, публикация, фото. */

export interface MenuCat {
  name: string
  dishes: EditDish[]
}

/** Блюдо в редакторе: аллергены обязательны к публикации, но в черновике могут отсутствовать. */
export type EditDish = Dish & { hidden?: boolean }

export interface EditorPayload {
  published: { version: number; publishedAt: number | null; categories: MenuCat[] }
  draft: { categories: MenuCat[]; updatedAt: number } | null
  allergens: string[]
}

export async function fetchEditor(): Promise<EditorPayload | null> {
  try {
    const res = await fetch('/api/menu/editor', { headers: { 'x-staff-token': getStaffToken() } })
    return res.ok ? ((await res.json()) as EditorPayload) : null
  } catch (err) {
    console.error('меню: не удалось загрузить редактор', err)
    return null
  }
}

export async function fetchStop(): Promise<string[]> {
  try {
    const res = await fetch('/api/menu/live')
    return res.ok ? (((await res.json()) as { stop: string[] }).stop ?? []) : []
  } catch {
    return []
  }
}

export const saveDraft = (categories: MenuCat[]) => staffPost('/api/menu/draft', { categories })
export const discardDraft = () => staffPost('/api/menu/discard')
export const publishMenu = () => staffPost('/api/menu/publish')

/** Фото 4:5, как в карточке гостя: 800×1000, JPEG, не больше 300 КБ. */
const W = 800
const H = 1000
const MAX_BYTES = 300 * 1024

export async function uploadPhoto(file: File): Promise<StaffResult & { url?: string }> {
  const blob = await squeeze(file)
  if (!blob) return { ok: false, status: 0, error: 'bad image', body: {} }
  try {
    const res = await fetch('/api/menu/photo', {
      method: 'POST',
      headers: { 'Content-Type': blob.type, 'x-staff-token': getStaffToken() },
      body: blob
    })
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    return { ok: res.ok, status: res.status, error: res.ok ? null : String(body.error ?? res.statusText), body, url: body.url as string }
  } catch {
    return { ok: false, status: 0, error: 'offline', body: {} }
  }
}

/** Обрезать по центру до 4:5 и сжимать, пока не влезет в 300 КБ. */
async function squeeze(file: File): Promise<Blob | null> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return null
  }
  const scale = Math.max(W / bitmap.width, H / bitmap.height)
  const sw = W / scale
  const sh = H / scale
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(bitmap, (bitmap.width - sw) / 2, (bitmap.height - sh) / 2, sw, sh, 0, 0, W, H)
  bitmap.close()
  for (const quality of [0.84, 0.74, 0.64, 0.54]) {
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (blob && blob.size <= MAX_BYTES) return blob
  }
  return null
}

export const MENU_ERRORS: Record<string, string> = {
  'no draft': 'Нечего публиковать — изменений нет',
  'menu invalid': 'Меню не прошло проверку',
  'bad menu': 'Черновик не сохранился — проверьте поля',
  'too large': 'Фото слишком большое',
  'bad image': 'Не получилось прочитать картинку',
  'not an image': 'Файл не похож на картинку',
  'photo must be jpeg, webp or png': 'Нужна картинка JPEG, WebP или PNG'
}

/** «new-toast: allergens required» → человеческая строка для менеджера. */
export function humanDetail(detail: string, dishes: EditDish[]): string {
  const [id, what] = detail.split(': ')
  const name = dishes.find(d => d.id === id)?.name ?? id
  if (what === 'allergens required') return `«${name}» — отметьте аллергены или «нет аллергенов»`
  if (what === 'name required') return `У блюда ${id} нет названия`
  if (what === 'bad price') return `«${name}» — проверьте цену`
  if (detail === 'menu is empty') return 'В меню нет ни одного блюда'
  return detail
}
