# Интеграции с кассами (iiko / R-keeper)

Статус: скелет. Полные детали API — в [../PRD.md](../PRD.md), раздел 7.

## Общий контракт `PosAdapter`

Бизнес-логика работает только с этим интерфейсом; реализации скрывают REST/XML-различия.

```
interface PosAdapter {
  getMenu(): Menu                                  // + стоп-лист, модификаторы
  subscribeStopList(cb): void                      // webhook/поллинг
  getOrCreateOrder(tableId): PosOrder
  getOrder(posOrderId): PosOrder
  addItems(posOrderId, items[], idemKey): Result   // волна на кухню; items несут привязку к гостю
  registerExternalPayment(posOrderId, amount, idemKey, fiscalizedExternally): Result
  closeOrder(posOrderId): Result
  onOrderChanged(cb): void                         // изменения из кассы (официант дозаказал и т.п.)
}
```

Правила:
- Все мутации — с идемпотентным ключом; результат подтверждается webhook'ом/повторным чтением.
- Номенклатура (меню) кэшируется на нашей стороне (рекомендация R-keeper), инвалидация по webhook.
- Двусторонняя синхронизация: изменения, сделанные официантом в кассе, прилетают к нам
  и обновляют экраны гостей (иначе рассинхрон).

## IikoAdapter (REST, iikoCloud/iikoTransport)

- База `https://api-ru.iiko.services`, auth: `/api/1/auth/access_token` (apiLogin из iikoWeb).
- Нужны лицензии: iikoCloud/iikoTransport + модуль table-service.
- Ключевые методы: `order/create`, `order/by_table`, `order/add_items`, `order/close`,
  `order/change_payments`; меню/стоп-листы; `reserve/available_restaurant_sections` (столы).
- Персоны: поле guests в заказе; глубокий split/move по гостям — только через
  iikoFront plugin (фаза 3, `SplitOrderCookingItem`/`MoveOrderItemToAnotherGuest`).
- Платёж: тип «Внешняя» + `isProcessedExternally=true`; при облачной кассе провайдера —
  `isFiscalizedExternally=true`.
- ⚠️ Грабли: ID столов из Transport API и из iikoFront **не совпадают** — хранить два маппинга.
- ⚠️ Точное написание путей by_table/add_items/close сверить на api-ru.iiko.services.

## RKeeperAdapter (RK7 XML interface)

- Путь `/rk7api/v0/xmlinterface.xml`, HTTPS с v7.05.03+, Basic Auth, UTF-8.
- Нужна лицензия **«XML сохранение заказов»** (платная, на объект) — без неё только чтение
  (`GetOrder`/`GetOrderList`) → режим «только оплата готового счёта».
- Ключевые команды: `CreateOrder` (блок `<Guests>` с `GuestLabel` = наши персоны),
  `SaveOrder` (привязка блюда к месту через seat/line_guid), `GetRefData MENUITEMS`,
  `PayOrder`, `MakeRetunGoods`.
- ⚠️ Если у заказа указано меню в r_keeper — закрыть заказ можно только на стороне r_keeper.
- Запросы на запись подписываются `<LicenseInfo>`.

## Сценарий выбора адаптера

Конфиг ресторана (tenant) содержит `posType: iiko | rkeeper` + креды. Один ресторан — один
адаптер. Смоук-тест при онбординге ресторана: получить меню → создать тестовый заказ →
добавить позицию → отменить.

## Открытые вопросы

- [ ] У первого клиента iiko или R-keeper? (определяет порядок реализации адаптеров)
- [ ] Есть ли у клиента лицензия XML-записи (R-keeper) / table-service (iiko)?
- [ ] Версии кассового ПО клиента (минимумы: RK7 v7.05.03+ для HTTPS).
- [ ] Механика webhooks iiko: какие события реально доступны на тарифе клиента.
