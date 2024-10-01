
## MessageHandler (instance)

### Alt Names: None
- [IN] `NetInstantiate(id: number, ownerId: string, path: string, pos: Vector3, rot: Vector3, active: boolean)`
- [IN] `NetDestroy(id: number)`
- [IN] `SetEntityUnitID(entityId: number, unitId: number)`


## Application (singleInstance)

### Alt Names: None
- [IN] `CreateLobby(id: string)`
- [OUT] `requestJoinLobby(id: string)`
- [OUT] `requestJoinPrivateLobby(id: string, password: string)`
- [OUT] `genNewAlphaKey(key: string, adminPassword: string)`


## AIAirVehicle (instance)

### Alt Names: None
- [IN] `UpdateData(pos: Vector3, vel: Vector3, accel: Vector3, rot: Vector3)`
- [IN] `Damage()`
- [IN] `Die()`
- [IN] `Spawn()`


## AIGroundUnit (instance)

### Alt Names: None
- [IN] `UpdateData(pos: Vector3, vel: Vector3, accel: Vector3, rot: Vector3)`
- [IN] `FireBullet(position: Vector3, velocity: Vector3)`
- [IN] `Damage()`
- [IN] `Die()`
- [IN] `Spawn()`


## MissileEntity (instance)

### Alt Names: None
- [IN] `SyncShit(syncedPos: Vector3, syncedRot: Vector3, syncedVel: Vector3, syncedAccel: Vector3)`
- [IN] `Detonate()`


## GunEntity (instance)

### Alt Names: None
- [IN] `FireBullet(position: Vector3, velocity: Vector3)`


## HardpointEntity (instance)

### Alt Names: None



## PlayerVehicle (instance)

### Alt Names: F45A, FA26B, AV42, AH94
- [IN] `UpdateData(pos: Vector3, vel: Vector3, accel: Vector3, rot: Vector3, throttle: number)`
- [IN] `UpdateTGP(direction: Vector3, lockedWorldPoint: Vector3, lockedActor: number)`
- [IN] `UpdatePilotHead(direction: Vector3)`
- [IN] `FireCMS()`
- [IN] `SetLock(actorId: number, isLocked: boolean)`
- [IN] `Damage()`
- [IN] `Die()`
- [IN] `SetFuel(tank: number, fuel: number)`


## VTOLLobby (instance)

### Alt Names: None
- [IN] `UpdateLobbyInfo(name: string, missionName: string, playerCount: number, maxPlayers: number, isPrivate: boolean, isConnected: boolean, players: RawPlayerInfo[])`
- [IN] `UpdateMissionInfo(name: string, id: string, campaignId: string, workshopId: string, mapId: string, isBuiltin: boolean)`
- [IN] `CloseLobby()`
- [IN] `ConnectionResult(success: boolean)`
- [IN] `SyncLeaveLobby()`


## Client (instance)

### Alt Names: None
- [OUT] `subscribe(gameId: string)`
- [OUT] `setAlphaKey(key: string)`
- [IN] `createAlphaKey(key: string)`
- [IN] `alphaAuthResult(success: boolean)`
- [OUT] `replayGame(id: string)`
- [IN] `expectChunks(count: number)`
- [IN] `ping(n: number)`
- [OUT] `pong(n: number)`

