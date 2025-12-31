"use client";

export default function Navbar() {
  return (
    <div
      className="w-full bg-[#1c1c1c] flex items-center px-4"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        height: "calc(3.5rem + env(safe-area-inset-top))",
      }}
    >
      <div className="text-white font-semibold text-lg">
        TalkToAnatomy
      </div>
    </div>
  );
}
