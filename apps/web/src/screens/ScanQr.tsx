/**
 * Гость открыл ссылку стола без подписи из QR — например, переслали в мессенджер
 * или набрали номер руками. Сесть так нельзя (иначе из интернета садились бы
 * за чужие столы), и говорим об этом сразу, а не после выбора блюд и имени.
 */
export function ScanQr() {
  return (
    <div className="g-anim-fade absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center">
      <div className="g-serif text-[40px] leading-tight">отсканируйте QR на столе</div>
      <p className="max-w-sm text-[16px] leading-normal text-g-body">
        Меню и заказ открываются по коду, который стоит у вас на столе: так за ваш стол не сядет никто посторонний. Если кода
        нет — позовите официанта.
      </p>
    </div>
  )
}
