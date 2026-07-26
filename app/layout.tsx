import "./globals.css";

export const metadata = {
  title: {
    default: "恒达新品开发协同系统",
    template: "%s｜恒达新品开发",
  },
  description:
    "从立项、设计、评审、验证到定型、变更和归档的一体化电机新品开发工作台。",
  applicationName: "恒达新品开发协同系统",
  openGraph: {
    title: "恒达新品开发协同系统",
    description: "订单驱动、阶段门控制、受控表单与全程追溯的一体化新品开发平台。",
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
