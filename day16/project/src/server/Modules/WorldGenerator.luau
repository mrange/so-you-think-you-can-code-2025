local Workspace = game:GetService("Workspace")
local Terrain = Workspace.Terrain
local Random = Random.new(tick())

local WorldGenerator = {}

local Config = require(script.Parent.Config)
local World = require(script.Parent.World)
local Utility = require(script.Parent.Utility)

local TERRAIN_RES = Config.TERRAIN_RES
local TERRAIN_SIZE = Config.TERRAIN_SIZE
local HEIGHT_SCALE = Config.HEIGHT_SCALE

local TERRAIN_FLOOR_Y = 10 
local CARVING_TOP_Y = HEIGHT_SCALE + 50 

local TUNNEL_RADIUS = 9
local MAX_TURN_ANGLE = math.rad(15) 
local CARVE_STEP = TUNNEL_RADIUS * 0.75 
local EXIT_HOLE_RADIUS = TUNNEL_RADIUS + 5

function WorldGenerator.generateTerrain()
    print("🏔️ Building Mountains...")

    local TERRAIN_VOLUME_HEIGHT = CARVING_TOP_Y - TERRAIN_FLOOR_Y
    local terrainCenter = Vector3.new(0, TERRAIN_FLOOR_Y + (TERRAIN_VOLUME_HEIGHT / 2), 0)
    local terrainSize = Vector3.new(TERRAIN_SIZE * 2, TERRAIN_VOLUME_HEIGHT, TERRAIN_SIZE * 2)
    
    Terrain:FillBlock(CFrame.new(terrainCenter), terrainSize, Enum.Material.Rock)

    for ix = 1, World.gridSize + 1 do
        local worldX = -TERRAIN_SIZE + (ix - 1) * TERRAIN_RES
        if ix % 50 == 0 then task.wait() end 
        
        for iz = 1, World.gridSize + 1 do
            local worldZ = -TERRAIN_SIZE + (iz - 1) * TERRAIN_RES
            local y = math.max(Utility.noise2D(worldX, worldZ), TERRAIN_FLOOR_Y)
            World.setTerrainHeight(ix, iz, y)

            local airHeight = CARVING_TOP_Y - y
            local airSize = Vector3.new(TERRAIN_RES, airHeight, TERRAIN_RES)
            local airCenterY = y + (airHeight / 2)
            Terrain:FillBlock(CFrame.new(Vector3.new(worldX, airCenterY, worldZ)), airSize, Enum.Material.Air)

            local grassSize = Vector3.new(TERRAIN_RES, 2, TERRAIN_RES)
            local grassPos = Vector3.new(worldX, y + 1, worldZ)
            Terrain:FillBlock(CFrame.new(grassPos), grassSize, Enum.Material.Grass)
        end
    end
end

function WorldGenerator.generateBoundaryWalls()
    print("🧱 Generating boundary walls...")
    local wallLength = (2 * TERRAIN_SIZE) + Config.WALL_THICKNESS
    local wallHeight = Config.BOUNDARY_WALLHEIGHT
    local offset = TERRAIN_SIZE + (Config.WALL_THICKNESS / 2)

    local wallModel = Instance.new("Model", Workspace)
    wallModel.Name = "BoundaryWalls"

    local function createWall(size, pos)
        Utility.createPart(size, Color3.fromRGB(180, 220, 255), pos, Enum.Material.Glass, wallModel)
    end

    createWall(Vector3.new(Config.WALL_THICKNESS, wallHeight, wallLength), Vector3.new(offset, wallHeight/2, 0))
    createWall(Vector3.new(Config.WALL_THICKNESS, wallHeight, wallLength), Vector3.new(-offset, wallHeight/2, 0))
    createWall(Vector3.new(wallLength, wallHeight, Config.WALL_THICKNESS), Vector3.new(0, wallHeight/2, offset))
    createWall(Vector3.new(wallLength, wallHeight, Config.WALL_THICKNESS), Vector3.new(0, wallHeight/2, -offset))
end

function WorldGenerator.generateCaves()
    print("🌌 Carving Caves...")

    for i = 1, Config.CAVE_COUNT do
        local x = Random:NextNumber(-TERRAIN_SIZE, TERRAIN_SIZE)
        local z = Random:NextNumber(-TERRAIN_SIZE, TERRAIN_SIZE)
        
        if not Utility.isLocationFlat(x, z) then continue end

        local surfaceY = Utility.getGroundY(x, z)
        
        local markerPos = Vector3.new(x, surfaceY + 20, z)
        local marker = Utility.createPart(Vector3.new(10, 10, 10), Color3.fromRGB(0, 170, 255), markerPos, Enum.Material.Neon, Workspace)
        marker.Shape = Enum.PartType.Ball
        marker.Name = "EntranceMarker_" .. i

        local currentPos = Vector3.new(x, surfaceY - TUNNEL_RADIUS, z)
        local dir = Vector3.new(Random:NextNumber(-1, 1), Random:NextNumber(-0.2, 0.2), Random:NextNumber(-1, 1)).Unit

        Terrain:FillBall(Vector3.new(x, surfaceY, z), EXIT_HOLE_RADIUS, Enum.Material.Air)

        for j = 1, 60 do
            if j % 15 == 0 then task.wait() end
            
            local rotation = CFrame.Angles(0, Random:NextNumber(-MAX_TURN_ANGLE, MAX_TURN_ANGLE), 0)
            dir = rotation:VectorToWorldSpace(dir).Unit
            currentPos = currentPos + dir * CARVE_STEP
            
            if currentPos.Y < TERRAIN_FLOOR_Y + 5 then
                dir = (dir + Vector3.new(0, 0.5, 0)).Unit
            end

            Terrain:FillBall(currentPos, TUNNEL_RADIUS, Enum.Material.Air)
        end
        
        local exitSurfaceY = Utility.getGroundY(currentPos.X, currentPos.Z)
        local exitMarker = Utility.createPart(Vector3.new(8, 8, 8), Color3.fromRGB(255, 85, 0), Vector3.new(currentPos.X, exitSurfaceY + 20, currentPos.Z), Enum.Material.Neon, Workspace)
        exitMarker.Shape = Enum.PartType.Ball
        exitMarker.Name = "ExitMarker_" .. i
    end
end

function WorldGenerator.generateWorld()
    WorldGenerator.generateTerrain()
    WorldGenerator.generateBoundaryWalls()
    WorldGenerator.generateCaves()
end

return WorldGenerator