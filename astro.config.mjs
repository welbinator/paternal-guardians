import { defineConfig, fontProviders } from "astro/config";

// Static site — no server, no CMS. Content lives in the .astro files and
// images in public/. Deployed as static assets to Cloudflare; GitHub Pages
// (staging.paternalguardians.org) serves as the staging preview.
// Served at domain root in BOTH environments, so no base path is needed —
// this keeps all absolute paths (/images, /contact, CSS url()) working.
export default defineConfig({
	site: "https://paternalguardians.org",
	image: {
		layout: "constrained",
		responsiveStyles: true,
	},
	fonts: [
		{
			provider: fontProviders.google(),
			name: "Inter",
			cssVariable: "--font-body",
			weights: [400, 500, 600, 700, 800],
			fallbacks: ["sans-serif"],
		},
	],
	devToolbar: { enabled: false },
});
