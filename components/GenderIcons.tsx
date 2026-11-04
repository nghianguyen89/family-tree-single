export function MaleIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'>
      <circle cx='10' cy='14' r='5' />
      <line x1='13.5' y1='10.5' x2='19' y2='5' />
      <polyline points='15 5 19 5 19 9' />
    </svg>
  )
}

export function FemaleIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'>
      <circle cx='12' cy='10' r='5' />
      <line x1='12' y1='15' x2='12' y2='21' />
      <line x1='9' y1='18' x2='15' y2='18' />
    </svg>
  )
}
