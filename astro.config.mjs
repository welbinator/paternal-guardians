import { defineConfig, fontProviders } from "astro/config";

// Static site — no server, no CMS. Content lives in the .astro files and
// images in public/. Deployed to Cloudflare at the root domain (production)
// and to GitHub Pages under /paternal-guardians/ (staging).
//
// PORTABILITY: all internal links/assets are mount-relative — HTML refs use
// import.meta.env.BASE_URL, CSS url()s use ../images (relative to the bundled
// stylesheet). Set PAGES_BASE at build time to mount under a subpath; leave it
// unset for the root domain. Change the domain/subpath and every link follows.
export default defineConfig({
	site: "https://paternalguardians.org",
	base: process.env.PAGES_BASE || "/",
	// Keep CSS as an external file at /_astro/ so its url("../images/…")
	// resolves against the stylesheet's location, not the page URL. Inlined
	// CSS would break the fibre-bg background at any non-root mount.
	build: { inlineStylesheets: "never" },
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
