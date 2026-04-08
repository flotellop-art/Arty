interface StarIconProps {
  size?: number
  className?: string
}

export function StarIcon({ size = 24, className = '' }: StarIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M50 0C52 38 62 48 100 50C62 52 52 62 50 100C48 62 38 52 0 50C38 48 48 38 50 0Z"
        fill="#E05510"
      />
    </svg>
  )
}
