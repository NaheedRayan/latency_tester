import './globals.css'

export const metadata = {
    title: 'Postgres Latency Tester',
}

export default function RootLayout({ children }) {
    return (
        <html lang="en">
            <body className="bg-gray-50 text-gray-900">
                {children}
            </body>
        </html>
    )
}
