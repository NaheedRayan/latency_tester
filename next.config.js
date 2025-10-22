/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
    // Ensure Turbopack treats this folder as the workspace root
    turbopack: {
        root: __dirname,
    },
}

module.exports = nextConfig
