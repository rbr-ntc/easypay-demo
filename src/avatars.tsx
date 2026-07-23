import type { Animal } from './data'

const TINTS: Record<Animal, string> = {
  fox: '#FCEAE4',
  bear: '#E7EFFD',
  panda: '#E3F3EB',
  raccoon: '#EEF0F2',
  owl: '#EFEAFB',
  cat: '#EEF0F2'
}

const SVGS: Record<Animal, JSX.Element> = {
  fox: (
    <svg viewBox="0 0 48 48" width="100%" height="100%">
      <polygon points="8,7 22,17 11,25" fill="#E8743B" />
      <polygon points="40,7 26,17 37,25" fill="#E8743B" />
      <circle cx="24" cy="27" r="15" fill="#EE8B4E" />
      <path d="M24 42 C16 42 11 35 11 29 C16 31 20 32 24 32 C28 32 32 31 37 29 C37 35 32 42 24 42 Z" fill="#FFF4EC" />
      <circle cx="18.5" cy="26" r="2.2" fill="#2B2B33" />
      <circle cx="29.5" cy="26" r="2.2" fill="#2B2B33" />
      <path d="M24 32 l-2.4 -2.6 h4.8 Z" fill="#2B2B33" />
    </svg>
  ),
  bear: (
    <svg viewBox="0 0 48 48" width="100%" height="100%">
      <circle cx="13" cy="13" r="7" fill="#A9763F" />
      <circle cx="35" cy="13" r="7" fill="#A9763F" />
      <circle cx="13" cy="13" r="3.4" fill="#C9A06A" />
      <circle cx="35" cy="13" r="3.4" fill="#C9A06A" />
      <circle cx="24" cy="26" r="16" fill="#B5824A" />
      <ellipse cx="24" cy="30" rx="9" ry="7.5" fill="#EBD8B8" />
      <circle cx="18.5" cy="24" r="2.2" fill="#2B2B33" />
      <circle cx="29.5" cy="24" r="2.2" fill="#2B2B33" />
      <ellipse cx="24" cy="28" rx="2.4" ry="1.8" fill="#2B2B33" />
    </svg>
  ),
  panda: (
    <svg viewBox="0 0 48 48" width="100%" height="100%">
      <circle cx="13" cy="12" r="6.5" fill="#2B2B33" />
      <circle cx="35" cy="12" r="6.5" fill="#2B2B33" />
      <circle cx="24" cy="26" r="16" fill="#fff" stroke="#E6E6EA" strokeWidth="1" />
      <ellipse cx="17" cy="25" rx="4.2" ry="5.4" fill="#2B2B33" transform="rotate(-18 17 25)" />
      <ellipse cx="31" cy="25" rx="4.2" ry="5.4" fill="#2B2B33" transform="rotate(18 31 25)" />
      <circle cx="17.5" cy="25" r="1.7" fill="#fff" />
      <circle cx="30.5" cy="25" r="1.7" fill="#fff" />
      <ellipse cx="24" cy="31" rx="2.3" ry="1.7" fill="#2B2B33" />
    </svg>
  ),
  raccoon: (
    <svg viewBox="0 0 48 48" width="100%" height="100%">
      <polygon points="9,10 18,18 12,22" fill="#8A8F98" />
      <polygon points="39,10 30,18 36,22" fill="#8A8F98" />
      <circle cx="24" cy="26" r="16" fill="#A7ADB6" />
      <path d="M9 24 C14 20 20 20 24 24 C28 20 34 20 39 24 C36 32 30 34 24 30 C18 34 12 32 9 24 Z" fill="#3A3E46" />
      <ellipse cx="24" cy="32" rx="8" ry="6" fill="#EDEEF1" />
      <circle cx="18.5" cy="25" r="2" fill="#fff" />
      <circle cx="29.5" cy="25" r="2" fill="#fff" />
      <ellipse cx="24" cy="31" rx="2.2" ry="1.6" fill="#2B2B33" />
    </svg>
  ),
  owl: (
    <svg viewBox="0 0 48 48" width="100%" height="100%">
      <polygon points="11,9 18,16 11,18" fill="#7C5CCB" />
      <polygon points="37,9 30,16 37,18" fill="#7C5CCB" />
      <circle cx="24" cy="26" r="16" fill="#8E70D6" />
      <circle cx="18" cy="24" r="6" fill="#fff" />
      <circle cx="30" cy="24" r="6" fill="#fff" />
      <circle cx="18" cy="24" r="2.6" fill="#2B2B33" />
      <circle cx="30" cy="24" r="2.6" fill="#2B2B33" />
      <polygon points="24,28 21,31 27,31" fill="#F4B400" />
    </svg>
  ),
  cat: (
    <svg viewBox="0 0 48 48" width="100%" height="100%">
      <polygon points="10,8 19,18 11,22" fill="#6B7280" />
      <polygon points="38,8 29,18 37,22" fill="#6B7280" />
      <circle cx="24" cy="26" r="15" fill="#7C8694" />
      <circle cx="18.5" cy="25" r="2.2" fill="#2B2B33" />
      <circle cx="29.5" cy="25" r="2.2" fill="#2B2B33" />
      <path d="M24 29 l-2 2 h4 Z" fill="#F2A0A8" />
      <path d="M13 27 h6 M13 30 h6 M29 27 h6 M29 30 h6" stroke="#5A6573" strokeWidth="1" />
    </svg>
  )
}

export const ANIMAL_LIST: Animal[] = ['fox', 'bear', 'panda', 'raccoon', 'owl', 'cat']

// Тона «Времён года»: каждому зверю соответствует свой тон (identity сохраняется между темами)
export function Avatar({ animal, size, label }: { animal: Animal; size: number; label?: string }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: '50%',
        background: TINTS[animal],
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <div style={{ width: '68%', height: '68%', display: 'flex' }}>{SVGS[animal]}</div>
    </div>
  )
}

// Значок «общие блюда» — не чей-то аватар, а нейтральная группа
export function SharedIcon({ size }: { size: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: '50%',
        background: 'var(--ep-accent-bg)',
        color: 'var(--ep-accent)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.5
      }}
    >
      ◍
    </div>
  )
}
