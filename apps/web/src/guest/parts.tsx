import { useEffect, useState } from 'react'
import type { ServerPersona } from '../api'
import { Avatar } from '../avatars'

/**
 * Фоновое слайд-шоу: кадры сменяют друг друга растворением и медленно
 * наезжают. На приветствии, в шапке стола и на «Спасибо».
 *
 * Картинки — фоном, а не <img>: их не нужно читать скринридеру, и браузер
 * не тянет все восемь сразу — грузится только показанный и следующий.
 */
export function Slideshow({
  images,
  interval = 8000,
  position = '50% 20%',
  offset = 0
}: {
  images: string[]
  interval?: number
  position?: string
  /** Сдвиг начального кадра — чтобы стол и «Спасибо» не открывались тем же фото. */
  offset?: number
}) {
  const n = images.length
  const [i, setI] = useState(() => (n ? (Math.floor(Math.random() * n) + offset) % n : 0))
  useEffect(() => {
    // «Меньше движения»: CSS гасит переходы, а смену кадров делает JS — стоп
    if (n < 2 || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const t = setInterval(() => setI(x => (x + 1) % n), interval)
    return () => clearInterval(t)
  }, [n, interval])
  if (!n) return null
  const next = (i + 1) % n
  return (
    <>
      {images.map((src, k) =>
        k === i || k === next || k === (i - 1 + n) % n ? (
          <span
            key={src}
            aria-hidden
            className="absolute inset-0 bg-cover"
            style={{
              backgroundImage: `url("${src}")`,
              backgroundPosition: position,
              opacity: k === i ? 1 : 0,
              transform: k === i || k === (i - 1 + n) % n ? 'scale(1.08)' : 'scale(1)',
              transition: 'opacity 2.4s cubic-bezier(.4,0,.2,1), transform 10s linear'
            }}
          />
        ) : null
      )}
    </>
  )
}

/** Гости стола кружками внахлёст — «кто уже здесь» одним взглядом. */
export function AvatarStack({
  personas,
  size = 32,
  overlap = 10,
  ring = 'rgba(14,13,12,.6)',
  max = 4
}: {
  personas: Pick<ServerPersona, 'id' | 'animal' | 'name'>[]
  size?: number
  overlap?: number
  ring?: string
  max?: number
}) {
  return (
    <div className="flex shrink-0">
      {personas.slice(0, max).map((p, k) => (
        <span
          key={p.id}
          className="flex rounded-full"
          style={{ border: `2px solid ${ring}`, marginLeft: k === 0 ? 0 : -overlap }}
        >
          <Avatar animal={p.animal} size={size - 4} label={p.name} />
        </span>
      ))}
    </div>
  )
}

export function GToast({ msg }: { msg: string }) {
  return (
    <div
      role="status"
      className="g-anim-up absolute top-4 left-1/2 z-30 max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-[22px] px-4.5 py-3 text-[15px] text-g-on-acc"
      style={{ background: '#F3F0EA', boxShadow: '0 12px 30px -12px rgba(0,0,0,.5)' }}
    >
      {msg}
    </div>
  )
}

/** Кружок-плюс или «✓ 2»: сколько этого блюда уже в вашем черновике. */
export function AddButton({
  qty,
  onClick,
  size,
  label,
  onPhoto = false
}: {
  qty: number
  onClick: (e: React.MouseEvent) => void
  size: 40 | 48
  label: string
  onPhoto?: boolean
}) {
  const h = size === 48 ? 'h-12 min-w-12' : 'h-10 min-w-10'
  if (qty > 0) {
    return (
      <button
        aria-label={`${label}: ещё одну, сейчас ${qty}`}
        onClick={onClick}
        className={`${h} shrink-0 rounded-full bg-g-acc px-3 font-bold text-g-on-acc g-num ${size === 48 ? 'text-[15px]' : 'text-[13px]'}`}
      >
        ✓ {qty}
      </button>
    )
  }
  return (
    <button
      aria-label={`Добавить: ${label}`}
      onClick={onClick}
      className={`${h} shrink-0 rounded-full text-g-fg ${size === 48 ? 'text-2xl' : 'text-xl'}`}
      style={{ background: onPhoto ? 'rgba(20,18,16,.8)' : 'var(--g-sand)' }}
    >
      +
    </button>
  )
}
