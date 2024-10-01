import { Logger } from "common/logger.js";
import { AuthType, DbUserEntry, HCUser, UserScopes } from "common/shared.js";
import cors from "cors";
import express, { Response } from "express";
import jwt from "jsonwebtoken";
import fetch from "node-fetch";
import { DBService } from "serviceLib/serviceDefs/DBService.js";

import { UserObject } from "./steamAuth.js";

type UserAuthObject = UserObject;
declare global {
	namespace Express {
		interface Request {
			user: HCUser;
		}
	}
}
const JWT_EXPIRY = 60 * 60 * 24 * 14; // 14 days in seconds
const cookieKey = "user_token";
const cookieOpts = { expires: new Date(253402300000000), domain: process.env.COOKIE_DOMAIN };

class AuthenticationManager {
	public api: express.Express;
	constructor() {
		this.api = express();
		this.api.use(cors());

		this.api.listen(parseInt(process.env.API_PORT), () => {
			console.log(`Workshop API opened on ${process.env.API_PORT}`);
		});
	}

	public async init() {
		this.api.use((req, res, next) => {
			const token = req.cookies?.[cookieKey];
			if (token) {
				// Read token
				req.user = this.readToken(token);
			}
			next();
		});

		this.api.get("/logout", (req, res) => {
			res.clearCookie(cookieKey).redirect(process.env.CLIENT_URL);
		});

		this.api.get("/refresh", async (req, res) => {
			const user = req.user;
			if (!user) return res.sendStatus(401);
			const token = await this.cloneJWT(user);

			res.cookie(cookieKey, token, cookieOpts).redirect(process.env.CLIENT_URL);
		});

		setInterval(() => this.checkForDonors(), 1000 * 60); // Check for donors every minute
		this.checkForDonors();
	}

	private async checkForDonors() {
		const donorsReq = await fetch("https://sso.isan.to/members/1015729793733492756/1070916759932117034");
		const donors = (await donorsReq.json()) as string[];

		const users = await Promise.all(
			donors.map(async donorId => {
				const req = await fetch("https://hs.vtolvr.live/api/v1/public/users_did/" + donorId);
				if (req.status !== 200) return null;
				const hsAccount = (await req.json()) as { id: string; discordId: string };
				const hcAccount = await DBService.getUser(hsAccount.id);
				return { hsAccount, hcAccount };
			})
		);

		users.forEach(u => {
			if (!u) return;
			if (!u.hcAccount) return;
			if (!u.hcAccount.scopes.includes(UserScopes.DONOR)) {
				u.hcAccount.scopes.push(UserScopes.DONOR);
				DBService.updateUserScopes(u.hcAccount.id, u.hcAccount.scopes);

				console.log(`Added donor scope to ${u.hcAccount.id}`);
			}
		});

		const donorSteamIds = users.map(u => u?.hcAccount?.id);
		const hcDonors = await DBService.getUsersWithScope(UserScopes.DONOR);
		hcDonors.forEach(d => {
			if (!donorSteamIds.includes(d.id)) {
				d.scopes = d.scopes.filter(s => s !== UserScopes.DONOR);
				DBService.updateUserScopes(d.id, d.scopes);

				console.log(`Removed donor scope from ${d.id}`);
			}
		});
	}

	public readToken(token: string): HCUser | null {
		try {
			const decoded = jwt.verify(token, process.env.JWT_KEY);
			return decoded as HCUser;
		} catch (e) {
			return null;
		}
	}

	private async createHCUser(user: UserAuthObject, type: AuthType) {
		let hcUser: HCUser = null;
		switch (type) {
			case AuthType.STEAM:
				hcUser = {
					id: user.steamid,
					username: user.username,
					authType: type,
					// userObject: user,
					scopes: [],
					pfpUrl: user.avatar.medium
				};
				break;

			default:
				Logger.error(`Unhandled auth type for createHCUser: ${type}`);
		}

		await this.fetchUserScopesOrCreate(hcUser); // Fill out scopes field

		return hcUser;
	}

	private async fetchUserScopesOrCreate(user: HCUser) {
		const dbUser = await DBService.getUser(user.id);
		if (dbUser) {
			user.scopes = dbUser.scopes;
			Logger.info(`User ${user.username} (${user.id}) has scopes: ${user.scopes.join(", ")}`);
			DBService.updateUserLastLogin(user.id, user);
		} else {
			const newUser: DbUserEntry = {
				id: user.id,
				scopes: [UserScopes.USER],
				lastLoginTime: Date.now(),
				createdAt: Date.now(),
				lastUserObject: user
			};
			user.scopes = newUser.scopes;
			DBService.createUser(newUser);
		}
	}

	private getExp() {
		return Math.floor(Date.now() / 1000) + JWT_EXPIRY;
	}

	private async createJWT(userObj: UserAuthObject, type: AuthType) {
		const user = await this.createHCUser(userObj, type);

		const token = jwt.sign(user, process.env.JWT_KEY, { expiresIn: JWT_EXPIRY });
		Logger.info(`Created a JWT for user ${user.username} (${user.id}) using auth type ${AuthType[user.authType]}`);
		return token;
	}

	public async cloneJWT(user: HCUser) {
		if (user.exp) delete user.exp;
		if (user.iat) delete user.iat;

		// Load scopes
		await this.fetchUserScopesOrCreate(user);

		const token = jwt.sign(user, process.env.JWT_KEY, { expiresIn: JWT_EXPIRY });
		Logger.info(`Cloned a JWT for user ${user.username} (${user.id})`);
		return token;
	}

	public async handleUserLoginRequest(user: UserObject, authType: AuthType, res: Response) {
		const token = await this.createJWT(user, authType);
		console.log(cookieOpts);
		res.cookie(cookieKey, token, cookieOpts).redirect(process.env.CLIENT_URL);
		// res.cookie(cookieKey, token, ).redirect(process.env.CLIENT_URL);
	}
}

export { AuthenticationManager, AuthType, UserAuthObject, DbUserEntry, cookieKey };
