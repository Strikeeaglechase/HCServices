import { HCUser } from "common/shared.js";
import { Callable } from "serviceLib/serviceHandler.js";

import { AuthenticationManager } from "./authenticationManager.js";
import { SteamAuthManager } from "./steamAuth.js";

class AuthService {
	private manager: AuthenticationManager;
	private steamAuth: SteamAuthManager;

	public async init() {
		this.manager = new AuthenticationManager();
		this.steamAuth = new SteamAuthManager(this.manager, this.manager.api);

		await this.manager.init();
		await this.steamAuth.init();
	}

	@Callable
	public readToken(token: string): HCUser {
		return this.manager.readToken(token);
	}

	@Callable
	public async cloneJWT(user: HCUser): Promise<string> {
		return await this.manager.cloneJWT(user);
	}
}

export { AuthService };
