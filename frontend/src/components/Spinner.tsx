// frontend/src/components/Spinner.tsx
export default function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      className="
        inline-block
        rounded-full
        border-2
        border-white/30
        border-t-white
        animate-spin
      "
      style={{
        width: size,
        height: size,
      }}
      aria-label="Loading"
    />
  );
}
