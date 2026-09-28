import test from 'node:test'
import assert from 'node:assert/strict'
import { buildQualityReport, dayOf, startOfDay, type QualityVisit } from '../src/quality.ts'

const H = 60 * 60 * 1000
const base = Date.UTC(2026, 8, 27, 12) // 15:00 по Москве

function visit(p: Partial<QualityVisit>): QualityVisit {
  return {
    sessionId: 's' + Math.random(),
    tableId: '1',
    zone: 'Зал',
    openedAt: base,
    closedAt: base + H,
    guests: 2,
    waiterId: 'olya',
    waiter: 'Оля',
    ratings: [],
    callWaits: [],
    kitchenWaits: [],
    tips: 0,
    ...p
  }
}
const r = (rating: 'good' | 'ok' | 'bad', note: string | null = null, resolvedAt: number | null = null) => ({
  guestId: 'g' + Math.random(),
  guest: 'Гость',
  rating,
  note,
  at: base,
  resolvedAt,
  resolvedBy: null,
  resolution: null
})

test('отклик и индекс: оценили трое из четырёх, индекс — хорошие минус плохие', () => {
  const rep = buildQualityReport([visit({ guests: 4, ratings: [r('good'), r('good'), r('bad')] })])
  assert.equal(rep.totals.responseRate, 75)
  assert.equal(rep.totals.index, 33) // (2 − 1) / 3
  assert.equal(rep.totals.rated, 3)
})

test('без оценок индекса нет — а не ноль, который выглядит как оценка', () => {
  const rep = buildQualityReport([visit({ guests: 3 })])
  assert.equal(rep.totals.index, null)
  assert.equal(rep.totals.responseRate, 0)
})

test('замечание — «плохо» или оценка с текстом; неразобранные «плохо» — наверху', () => {
  const rep = buildQualityReport([
    visit({ ratings: [r('ok', 'долго несли суп'), r('good')] }),
    visit({ ratings: [r('bad', 'холодное', base + 1)] }),
    visit({ ratings: [r('bad', 'грубо')] })
  ])
  assert.equal(rep.remarks.length, 3)
  assert.deepEqual(rep.remarks.map(x => x.note), ['грубо', 'долго несли суп', 'холодное'])
  assert.equal(rep.totals.openRemarks, 2)
})

test('по официантам: гости, оценки, чаевые, время ответа на вызов и кухни', () => {
  const rep = buildQualityReport([
    visit({ waiterId: 'olya', waiter: 'Оля', guests: 2, ratings: [r('good')], tips: 200, callWaits: [30_000, 90_000], kitchenWaits: [10 * 60_000] }),
    visit({ waiterId: 'max', waiter: 'Максим', guests: 4, ratings: [r('bad')], tips: 0, kitchenWaits: [20 * 60_000, 30 * 60_000] })
  ])
  assert.deepEqual(rep.byWaiter.map(w => w.waiter), ['Максим', 'Оля'])
  const olya = rep.byWaiter.find(w => w.waiter === 'Оля')!
  assert.equal(olya.callAvgSec, 60)
  assert.equal(olya.kitchenAvgMin, 10)
  assert.equal(olya.tips, 200)
  assert.equal(rep.byWaiter[0].kitchenAvgMin, 25)
})

test('дни — по часовому поясу заведения, а не по UTC', () => {
  const lateNight = Date.UTC(2026, 8, 27, 22) // 01:00 28-го по Москве
  assert.equal(dayOf(lateNight, 'Europe/Moscow'), '2026-09-28')
  assert.equal(startOfDay(lateNight, 'Europe/Moscow'), Date.UTC(2026, 8, 27, 21))
  const rep = buildQualityReport([visit({ openedAt: base }), visit({ openedAt: lateNight })], 'Europe/Moscow')
  assert.deepEqual(rep.byDay.map(d => d.day), ['2026-09-27', '2026-09-28'])
})

test('столы с замечаниями — первыми', () => {
  const rep = buildQualityReport([visit({ tableId: '1', guests: 6 }), visit({ tableId: '5', ratings: [r('bad')] })])
  assert.equal(rep.byTable[0].tableId, '5')
})
