import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'

/**
 * Картинки и витрина гостя живут в двух местах: конфиг называет, файлы лежат
 * в apps/web/public. Рассинхрон молча ломает экран — битая картинка без
 * фоллбэка или подборка с пропавшим блюдом. Эти тесты стерегут связку.
 */

const read = rel => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'))
const menu = read('../menu.json')
const showcase = read('../showcase.json')
const pub = rel => new URL(`../../../apps/web/public/${rel}`, import.meta.url)

const dishes = Object.values(menu).flat()
const ids = new Set(dishes.map(d => d.id))
const withFlag = new Set(dishes.filter(d => d.photo).map(d => d.id))
const files = new Set(
  readdirSync(pub('dishes/'))
    .filter(f => f.endsWith('.jpg'))
    .map(f => f.slice(0, -4))
)

test('у каждого блюда с флагом photo есть фото и миниатюра', () => {
  assert.deepEqual([...withFlag].filter(id => !files.has(id)), [])
  assert.deepEqual([...withFlag].filter(id => !existsSync(pub(`dishes/thumb/${id}.jpg`))), [])
})

test('у каждого файла фото есть блюдо с флагом photo', () => {
  assert.deepEqual([...files].filter(id => !withFlag.has(id)), [])
})

test('вертикальные кадры: блюдо существует и файл лежит в hero/', () => {
  assert.deepEqual(showcase.tall.filter(id => !ids.has(id)), [])
  assert.deepEqual(showcase.tall.filter(id => !existsSync(pub(`hero/${id}.jpg`))), [])
})

test('обложки приветствия, стола и «Спасибо» лежат в art/', () => {
  const missing = Object.values(showcase.art)
    .flat()
    .filter(name => !existsSync(pub(`art/${name}.jpg`)))
  assert.deepEqual(missing, [])
})

test('подборки и сезонные слайды ссылаются только на блюда из меню', () => {
  const referenced = [
    ...Object.values(showcase.seasons).flatMap(s => s.slides),
    ...showcase.collections.flatMap(c => [
      ...(Array.isArray(c.hero) ? c.hero : []),
      ...(Array.isArray(c.sections) ? c.sections.flatMap(s => (Array.isArray(s.dishes) ? s.dishes : [])) : [])
    ])
  ]
  assert.deepEqual(
    referenced.filter(id => !ids.has(id)),
    []
  )
})

test('сезон и гамма — из допустимых значений', () => {
  assert.ok(['auto', 'winter', 'spring', 'summer', 'autumn'].includes(showcase.season))
  assert.ok(['soft', 'pastel', 'vivid'].includes(showcase.palette))
  assert.deepEqual(Object.keys(showcase.seasons).sort(), ['autumn', 'spring', 'summer', 'winter'])
})
