import type { Metadata } from "next";
import { Michroma } from "next/font/google";
import "./globals.css";
import TopNavigationBar from "../components/TopNavigationBar";
import Footer from "../components/Footer";

export const metadata: Metadata = {
  title: "McRyptoX", // tab title
  icons: {
    icon: "../favicon.ico", // yeh public/app/favicon.ico ko use karega
  },
};

const michroma = Michroma({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-michroma",
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={michroma.variable}>
      <body>
        <div className="flex flex-col overflow-x-clip">
          <div className="sticky top-0 z-50">
            <TopNavigationBar />
          </div>
            <main className="flex flex-col flex-grow">{children}</main>
          <Footer />
        </div>
      </body>
    </html>
  );
}
