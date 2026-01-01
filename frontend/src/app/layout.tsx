// frontend/src/app/layout.tsx
import "./globals.css";

export const metadata = {
  title: "TalktoAnatomy",
  description: "3D Anatomy Viewer",
  icons: {
    icon: "/icon.png"
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-[100svh] bg-[#1c1c1c] text-white">
        {children}
      </body>
    </html>
  );
}
