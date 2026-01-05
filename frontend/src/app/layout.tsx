// frontend/src/app/layout.tsx
import "./globals.css";

export const metadata = {
  title: "TalktoAnatomy",
  description: "3D Anatomy Viewer",
  icons: {
    icon: "/icon.png",
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
      <head>
        {/* Cloudflare Web Analytics */}
        <script
          defer
          src="https://static.cloudflareinsights.com/beacon.min.js"
          data-cf-beacon='{"token":"af75fc1b51964fe4ba02817d82d635f9"}'
        />
      </head>

      <body className="min-h-[100svh] bg-[#1c1c1c] text-white">
        {children}
      </body>
    </html>
  );
}
