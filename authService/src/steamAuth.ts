import { Logger } from "common/logger.js";
import express from "express";
import SteamAuth from "node-steam-openid";

import { AuthenticationManager, AuthType } from "./authenticationManager.js";

interface UserObject {
	_json: Record<string, any>;
	steamid: string;
	username: string;
	name: string;
	profile: string;
	avatar: {
		small: string;
		medium: string;
		large: string;
	};
}

class SteamAuthManager {
	private steam: SteamAuth;
	constructor(private authenticationManager: AuthenticationManager, private api: express.Express) {}

	public async init() {
		this.steam = new SteamAuth({
			realm: process.env.STEAM_REALM,
			returnUrl: process.env.STEAM_RETURN_URL,
			apiKey: process.env.STEAM_API_KEY
		});

		// console.log(`Registered /auth/steam/login`);
		this.api.get("/steam/login", async (req, res) => {
			const redirectUrl = await this.steam.getRedirectUrl();
			res.redirect(redirectUrl);
		});

		this.api.get("/steam/return", async (req, res) => {
			try {
				const user = await this.steam.authenticate(req);
				Logger.info(`User ${user.username} (${user.steamid}) authenticated via Steam.`);
				this.authenticationManager.handleUserLoginRequest(user, AuthType.STEAM, res);
			} catch (err) {
				Logger.error(`Exception while trying to authenticate user: ${err.message}`);
				Logger.error(err);
				Logger.error(err.stack);
				console.error(err);
			}
		});
	}
}

export { SteamAuthManager, UserObject };
