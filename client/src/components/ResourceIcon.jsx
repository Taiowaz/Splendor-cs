// 六种资源的线条符号 + 配色，和 card-preview.html 里那套 <symbol> 一致。
// 符号统一 viewBox 0 0 24 24、stroke=currentColor，颜色由外层 .requirement-item 决定。
const PATHS = {
  data: (
    <>
      <ellipse cx="12" cy="5" rx="7" ry="3" />
      <path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5" />
      <path d="M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
    </>
  ),
  compute: (
    <>
      <rect x="7" y="7" width="10" height="10" rx="1.5" />
      <rect x="10" y="10" width="4" height="4" />
      <path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" />
    </>
  ),
  citation: (
    <>
      <circle cx="6" cy="7" r="2.3" />
      <circle cx="18" cy="6.5" r="2.3" />
      <circle cx="12.5" cy="18" r="2.3" />
      <path d="M7.6 8.8 11.2 16" />
      <path d="M16.9 8.4 13.6 16" />
      <path d="M8.3 6.7 15.7 6.5" />
    </>
  ),
  collaborator: (
    <>
      <circle cx="8" cy="8" r="3" />
      <path d="M2.5 20a5.5 5.5 0 0 1 11 0" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M15 20a4.8 4.8 0 0 1 7.5-4" />
    </>
  ),
  funding: (
    <>
      <circle cx="12" cy="12" r="10.5" />
      <path d="M7.5 8 12 12.5 16.5 8" />
      <path d="M12 12.5v5.5" />
      <path d="M8.5 14.5h7" />
      <path d="M8.5 16.5h7" />
    </>
  ),
  coffee: (
    <>
      <path d="M4 8h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z" />
      <path d="M17 9h1.5a2.5 2.5 0 0 1 0 5H17" />
      <path d="M7 3v2M11 3v2M15 3v2" />
    </>
  )
}

export default function ResourceIcon({ resource, className }) {
  const path = PATHS[resource]
  if (!path) return null
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {path}
    </svg>
  )
}
