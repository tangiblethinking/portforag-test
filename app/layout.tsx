import "./globals.css";
export const metadata = { title: "Christopher Kenreigh — Product Design, Product Management, Product Strategy", description: "Ask about Christopher’s projects, resume and skills." };
// the on-screen keyboard resizes the layout (Chrome/Android), so the chat composer stays above it
export const viewport = { interactiveWidget: "resizes-content" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.theme;if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}` }} /></head>
    <body className="bg-[#f5f5f7] text-neutral-900 dark:bg-black dark:text-neutral-100 antialiased">{children}</body></html>);
}
