import type { Metadata } from "next";
import "./globals.css";
import "./secure.css";
import "./studio/studio-ui.css";

export const metadata: Metadata = {
  title: "Creative X Studio | Production Workspace",
  description: "A considered workspace for creative production, client review, proposals, media, and delivery.",
  applicationName: "Creative X Studio",
  icons: { icon: "/creative-x-mark.svg" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
