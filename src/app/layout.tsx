import type { Metadata } from "next";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "ĐiĐâu — đúng chỗ, đúng lúc, đúng người",
  description:
    "Bản đồ theo hoàn cảnh cho nhóm nhỏ: tìm nơi phù hợp với mood, khoảng cách và rating của người bạn tin."
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
