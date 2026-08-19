// Данные заведения для серверной стороны. Клиент импортирует JSON напрямую
// (`@easypay/config/menu.json`), сервер — отсюда, чтобы не зависеть от JSON-модулей Node.
import { readFileSync } from 'node:fs'

const read = name => JSON.parse(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'))

export const menu = read('menu.json')
export const hall = read('hall.json')
export const staff = read('staff.json')
