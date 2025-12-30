// frontend/src/app/layout.tsx
import "./globals.css";

export const metadata = {
  title: "AnatomyGPT",
  description: "AI-driven 3D anatomy viewer",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#1c1c1c] text-white">
        {children}
      </body>
    </html>
  );
}
