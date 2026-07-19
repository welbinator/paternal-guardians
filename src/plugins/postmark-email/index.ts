/**
 * Postmark email provider plugin (general / shareable).
 *
 * Turns EmDash's transactional email (magic-link sign-in, invites, email
 * verification) into real delivered mail via Postmark's HTTP API — no SMTP,
 * no hardcoded secrets. Everything is configured from the admin UI:
 *
 *   Admin -> Extensions -> enable "Postmark Email"
 *   Admin -> Postmark  (settings page: API token, From address, Message Stream)
 *   Admin -> Settings -> Email -> select "Postmark Email" as the provider
 *
 * WHY A CUSTOM ADMIN PAGE + SAVE ROUTE (not settingsSchema):
 *   EmDash 0.29.x ships no auto-rendered settings form — `settingsSchema` is
 *   dead code in the admin bundle (0 references). Plugins that need config must
 *   render their own Block Kit admin page and provide their own save route.
 *   This is the supported, forward-compatible path.
 *
 * HOW SETTINGS PERSIST:
 *   The admin Block Kit page POSTs interactions to the plugin route `admin`.
 *   On form submit we call `ctx.kv.set("settings:<key>", value)`, which writes
 *   the option key `plugin:postmark-email:settings:<key>`. At delivery time the
 *   host reads the exact same key via `getPluginSetting(pluginId, key)` — so
 *   the email:deliver hook and the settings page share one source of truth.
 *   `ctx.kv` is backed by the factory's DB reference, so it works inside the
 *   email:deliver hook even though hooks run without request context.
 *
 * CAPABILITIES:
 *   - hooks.email-transport:register  -> allows registering the exclusive
 *                                        email:deliver provider hook
 *   - network:request (+ allowedHosts) -> ctx.http POST to api.postmarkapp.com
 *
 * PORTABILITY: no site-specific values live in code. Drop this folder into any
 * EmDash + Astro project, add it to the emdash() plugins array, and configure
 * it from the admin. Safe to publish as an npm package unchanged.
 */

import { definePlugin, getPluginSetting } from "emdash";
import type { PluginDefinition, RouteContext } from "emdash";

const PLUGIN_ID = "postmark-email";
const POSTMARK_HOST = "api.postmarkapp.com";
const POSTMARK_SEND_URL = `https://${POSTMARK_HOST}/email`;

/** Settings keys, kept in one place so the page and the hook never drift. */
const KEY = {
	token: "postmarkToken",
	from: "fromAddress",
	stream: "messageStream",
	replyTo: "replyTo",
} as const;

/** Postmark's Message Stream defaults to "outbound" for transactional mail. */
const DEFAULT_STREAM = "outbound";

// ---------------------------------------------------------------------------
// email:deliver — the exclusive provider hook
// ---------------------------------------------------------------------------

interface EmailMessage {
	to: string;
	subject: string;
	text: string;
	html?: string;
}

interface DeliverEvent {
	message: EmailMessage;
	source: string;
}

async function deliver(event: DeliverEvent, ctx: any): Promise<void> {
	const { message } = event;

	// Read config at send time (never cached, so admin edits take effect at once).
	const [token, from, streamRaw, replyTo] = await Promise.all([
		getPluginSetting(PLUGIN_ID, KEY.token),
		getPluginSetting(PLUGIN_ID, KEY.from),
		getPluginSetting(PLUGIN_ID, KEY.stream),
		getPluginSetting(PLUGIN_ID, KEY.replyTo),
	]);

	if (!token || typeof token !== "string") {
		throw new Error(
			"[postmark-email] Not configured: set your Postmark Server API Token under Admin -> Postmark.",
		);
	}
	if (!from || typeof from !== "string" || !from.includes("@")) {
		throw new Error(
			"[postmark-email] Not configured: set a verified From address under Admin -> Postmark.",
		);
	}

	const stream =
		typeof streamRaw === "string" && streamRaw.trim() ? streamRaw.trim() : DEFAULT_STREAM;

	const payload: Record<string, unknown> = {
		From: from,
		To: message.to,
		Subject: message.subject,
		TextBody: message.text,
		MessageStream: stream,
	};
	if (message.html) payload.HtmlBody = message.html;
	if (typeof replyTo === "string" && replyTo.includes("@")) payload.ReplyTo = replyTo;

	// ctx.http is gated on the network:request capability + allowedHosts.
	const res = await ctx.http.fetch(POSTMARK_SEND_URL, {
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
			"X-Postmark-Server-Token": token,
		},
		body: JSON.stringify(payload),
	});

	if (!res.ok) {
		let detail = "";
		try {
			const body: any = await res.json();
			// Postmark returns { ErrorCode, Message } on failure.
			detail = body?.Message ? ` — ${body.Message} (code ${body.ErrorCode})` : "";
		} catch {
			/* non-JSON error body; fall through with status only */
		}
		throw new Error(`[postmark-email] Postmark rejected the message: HTTP ${res.status}${detail}`);
	}

	ctx.log.info("email delivered via Postmark", {
		to: message.to,
		subject: message.subject,
		stream,
	});
}

// ---------------------------------------------------------------------------
// Block Kit admin settings page  (route: `admin`)
// ---------------------------------------------------------------------------

type BlockResponse = {
	blocks: unknown[];
	toast?: { message: string; type: "success" | "error" | "info" };
};

const SAVE_ACTION = "save_settings";

/** Build the settings form from currently-stored values. */
async function renderSettingsPage(hasToken: boolean, current: {
	from: string;
	stream: string;
	replyTo: string;
}): Promise<BlockResponse> {
	return {
		blocks: [
			{ type: "header", text: "Postmark Email" },
			{
				type: "section",
				text:
					"Send EmDash's sign-in links, invites and verification emails through " +
					"Postmark's API. After saving, go to Settings -> Email and select " +
					"**Postmark Email** as the active provider.",
			},
			{ type: "divider" },
			{
				type: "form",
				block_id: "postmark_settings",
				fields: [
					{
						type: "secret_input",
						action_id: KEY.token,
						label: "Server API Token",
						placeholder: "Postmark server token",
						// has_value tells the UI a secret is already stored (shows ••••).
						has_value: hasToken,
					},
					{
						type: "text_input",
						action_id: KEY.from,
						label: "From address",
						placeholder: "cms@yourdomain.com",
						initial_value: current.from,
					},
					{
						type: "text_input",
						action_id: KEY.replyTo,
						label: "Reply-To address (optional)",
						placeholder: "hello@yourdomain.com",
						initial_value: current.replyTo,
					},
					{
						type: "text_input",
						action_id: KEY.stream,
						label: "Message Stream",
						placeholder: DEFAULT_STREAM,
						initial_value: current.stream || DEFAULT_STREAM,
					},
				],
				submit: { label: "Save settings", action_id: SAVE_ACTION },
			},
			{
				type: "context",
				text:
					"The From address must be a verified Sender Signature (or on a verified " +
					"domain) in your Postmark account, or delivery will fail.",
			},
		],
	};
}

/**
 * The admin interaction handler. The admin UI POSTs one of:
 *   { type: "page_load", page }
 *   { type: "form_submit", action_id, values }
 *   { type: "block_action", action_id, value }
 * and expects `{ blocks, toast? }` back.
 */
async function adminHandler(ctx: RouteContext): Promise<BlockResponse> {
	const interaction = (ctx.input ?? {}) as {
		type?: string;
		action_id?: string;
		values?: Record<string, unknown>;
	};

	const readCurrent = async () => {
		const [token, from, stream, replyTo] = await Promise.all([
			ctx.kv.get(`settings:${KEY.token}`),
			ctx.kv.get(`settings:${KEY.from}`),
			ctx.kv.get(`settings:${KEY.stream}`),
			ctx.kv.get(`settings:${KEY.replyTo}`),
		]);
		return {
			hasToken: typeof token === "string" && token.length > 0,
			from: typeof from === "string" ? from : "",
			stream: typeof stream === "string" ? stream : "",
			replyTo: typeof replyTo === "string" ? replyTo : "",
		};
	};

	if (interaction.type === "form_submit" && interaction.action_id === SAVE_ACTION) {
		const values = interaction.values ?? {};

		// From is required to save anything meaningful.
		const from = String(values[KEY.from] ?? "").trim();
		const replyTo = String(values[KEY.replyTo] ?? "").trim();
		const stream = String(values[KEY.stream] ?? "").trim() || DEFAULT_STREAM;
		const tokenInput = values[KEY.token];

		if (!from || !from.includes("@")) {
			const cur = await readCurrent();
			return {
				...(await renderSettingsPage(cur.hasToken, cur)),
				toast: { message: "Enter a valid From address.", type: "error" },
			};
		}

		// A secret_input submits its new value only when the user typed one;
		// an empty/undefined value means "keep the existing token".
		if (typeof tokenInput === "string" && tokenInput.length > 0) {
			await ctx.kv.set(`settings:${KEY.token}`, tokenInput);
		}
		await ctx.kv.set(`settings:${KEY.from}`, from);
		await ctx.kv.set(`settings:${KEY.stream}`, stream);
		if (replyTo) await ctx.kv.set(`settings:${KEY.replyTo}`, replyTo);
		else await ctx.kv.delete(`settings:${KEY.replyTo}`);

		const cur = await readCurrent();
		return {
			...(await renderSettingsPage(cur.hasToken, cur)),
			toast: { message: "Postmark settings saved.", type: "success" },
		};
	}

	// page_load (and any unrecognized interaction): render current state.
	const cur = await readCurrent();
	return renderSettingsPage(cur.hasToken, cur);
}

// ---------------------------------------------------------------------------

const definition: PluginDefinition = {
	id: PLUGIN_ID,
	version: "1.0.0",
	capabilities: ["hooks.email-transport:register", "network:request"],
	allowedHosts: [POSTMARK_HOST],
	hooks: {
		"email:deliver": {
			exclusive: true,
			handler: deliver,
		},
	},
	admin: {
		pages: [{ path: "/", label: "Postmark", icon: "envelope" }],
	},
	routes: {
		admin: { handler: adminHandler },
	},
};

/**
 * Factory the EmDash astro integration calls at build time.
 *
 * The generated `virtual:emdash/plugins` module does:
 *   `import { createPlugin as createPluginN } from "<entrypoint>"`
 *   `createPluginN(<options>)`
 * so a named `createPlugin` export is required (a bare default is NOT enough).
 */
export function createPlugin(): PluginDefinition {
	return definePlugin(definition);
}

export default createPlugin;
