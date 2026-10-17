/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@resto/shared', '@resto/ui'],
  // Les tests fonctionnels (Playwright) utilisent leur propre dossier : ils ne cassent pas `next dev`.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
};
export default nextConfig;
