import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

/**
 * Флаг `photo` читают меню и кухня, а файл лежит в apps/web/public/dishes.
 * Рассинхрон в одну сторону — битая картинка без фоллбэка, в другую — фото,
 * которое никто не видит. А снимок без записи об авторе нарушает CC BY:
 * лицензия требует назвать автора в интерфейсе.
 */

const read = rel => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'))
const menu = read('../menu.json')
const credits = read('../photo-credits.json')
const dishesDir = new URL('../../../apps/web/public/dishes/', import.meta.url)

const dishes = Object.values(menu).flat()
const withFlag = new Set(dishes.filter(d => d.photo).map(d => d.id))
const files = new Set(
  readdirSync(dishesDir)
    .filter(f => f.endsWith('.jpg'))
    .map(f => f.slice(0, -4))
)

test('у каждого блюда с флагом photo есть файл', () => {
  assert.deepEqual([...withFlag].filter(id => !files.has(id)), [])
})

test('у каждого файла есть блюдо с флагом photo', () => {
  assert.deepEqual([...files].filter(id => !withFlag.has(id)), [])
})

test('у каждой фотографии записаны автор и лицензия', () => {
  const missing = [...withFlag].filter(id => {
    const c = credits[id]
    return !c || !c.author || !c.license || !c.licenseUrl || !c.page
  })
  assert.deepEqual(missing, [])
})

test('в авторах нет записей о несуществующих фото', () => {
  assert.deepEqual(Object.keys(credits).filter(id => !withFlag.has(id)), [])
})

test('ни одной лицензии с запретом коммерции или переработки', () => {
  const bad = Object.entries(credits)
    .filter(([, c]) => /\bNC\b|\bND\b/i.test(c.license))
    .map(([id]) => id)
  assert.deepEqual(bad, [])
})
