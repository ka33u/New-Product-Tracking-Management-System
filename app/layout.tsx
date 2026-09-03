import "./globals.css";
import "./npd-v2.css";

export const metadata = {
  title: {
    default: "亨达新品开发",
    template: "%s｜亨达新品开发",
  },
  description:
    "以项目多规格、阶段 Sheet、节点确认、试验和质量记录为主线的电机新品开发全流程监控平台。",
  applicationName: "亨达新品开发",
  openGraph: {
    title: "亨达新品开发",
    description: "多规格电机、阶段 Sheet、节点、试验、质量与归档一体化管理。",
    type: "website",
    locale: "zh_CN",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
