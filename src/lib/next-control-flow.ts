// Compatibility adapter for pinned Next.js 16.4.3. Avoid importing client navigation
// contexts into App Route bundles. Verify redirect/notFound before upgrading Next.
export { unstable_rethrow } from "next/dist/client/components/unstable-rethrow.js";
