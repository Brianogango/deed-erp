export default function TrackLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style>{`
        body {
          overflow: auto !important;
          height: auto !important;
          min-height: 100dvh;
        }
      `}</style>
      {children}
    </>
  )
}
