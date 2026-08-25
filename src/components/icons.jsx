const S = ({ children, size = 16, ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
    {children}
  </svg>
)

export const Chevron = (p) => <S {...p}><path d="M9 6l6 6-6 6" /></S>
export const Back = (p) => <S {...p}><path d="M15 6l-6 6 6 6" /></S>
export const Spinner = (p) => (
  <S {...p}><path d="M12 3a9 9 0 1 0 9 9" opacity=".35" /><path d="M12 3a9 9 0 0 1 9 9" /></S>
)
export const Rollback = (p) => (
  <S {...p}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></S>
)
export const Rocket = (p) => (
  <S {...p}><path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2" /><path d="M14 4c3 0 6 3 6 6-3 3-7 5-9 5l-2-2c0-2 2-6 5-9Z" /><circle cx="14.5" cy="9.5" r="1.5" /></S>
)
export const Grid = (p) => (
  <S {...p}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></S>
)
export const List = (p) => (
  <S {...p}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></S>
)
export const Split = (p) => (
  <S {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M12 4v16" /></S>
)
export const Check = (p) => <S {...p}><path d="M20 6 9 17l-5-5" /></S>
export const X = (p) => <S {...p}><path d="M18 6 6 18M6 6l12 12" /></S>
export const Warn = (p) => (
  <S {...p}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></S>
)
export const Info = (p) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></S>
export const Folder = (p) => (
  <S {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></S>
)
export const Clock = (p) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></S>
export const Branch = (p) => (
  <S {...p}><circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="8" r="2.5" /><path d="M6 8.5v7M6 15.5c0-4 3-6 9-6.5" /></S>
)
export const Diamond = (p) => <S {...p}><path d="M12 3 21 12 12 21 3 12Z" /></S>
export const Star = (p) => (
  <S {...p}><path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19l1-5.8L3.5 9l5.9-.9Z" /></S>
)

// --- added for the intent workspace ---
export const Sparkles = (p) => (
  <S {...p}><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z" /><path d="M19 14l.7 1.9L21.5 17l-1.8.7L19 19.5l-.7-1.8L16.5 17l1.8-.6L19 14Z" /></S>
)
export const Play = (p) => <S {...p}><path d="M7 5l12 7-12 7V5Z" /></S>
export const Shield = (p) => (
  <S {...p}><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z" /><path d="M9 12l2 2 4-4" /></S>
)
export const Cube = (p) => (
  <S {...p}><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="M4 7.5 12 12l8-4.5M12 12v9" /></S>
)
export const Api = (p) => <S {...p}><path d="M9 7 4 12l5 5M15 7l5 5-5 5M13 5l-2 14" /></S>
export const Beaker = (p) => (
  <S {...p}><path d="M9 3h6M10 3v6L5 18a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9V3" /><path d="M7.5 14h9" /></S>
)
export const Reset = (p) => (
  <S {...p}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 8v4l3 2" opacity=".5" /></S>
)
export const Graph = (p) => (
  <S {...p}><circle cx="5" cy="6" r="2.4" /><circle cx="5" cy="18" r="2.4" /><circle cx="19" cy="12" r="2.4" /><path d="M7.3 7.2 16.8 11M7.3 16.8 16.8 13" /></S>
)
export const Cascade = (p) => (
  <S {...p}><path d="M4 6h9M4 6l3-3M4 6l3 3" /><path d="M8 12h9M8 12l3-3M8 12l3 3" opacity=".8" /><path d="M12 18h8M12 18l3-3M12 18l3 3" opacity=".6" /></S>
)
export const File = (p) => (
  <S {...p}><path d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" /><path d="M14 3v4h4" /></S>
)
export const Dep = (p) => (
  <S {...p}><circle cx="6" cy="6" r="2.4" /><circle cx="18" cy="18" r="2.4" /><path d="M8 8l8 8M16 8l-8 8" opacity=".4" /></S>
)
export const Send = (p) => <S {...p}><path d="M4 12 20 4l-6 16-3-7-7-1Z" /></S>
