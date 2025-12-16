local World = {}

local Config = require(script.Parent.Config)

World.gridSize = (Config.TERRAIN_SIZE * 2) / Config.TERRAIN_RES
World.terrainMap = {}

function World.setTerrainHeight(ix, iz, y)
    if not World.terrainMap[ix] then
        World.terrainMap[ix] = {}
    end
    World.terrainMap[ix][iz] = y
end

function World.getTerrainHeight(ix, iz)
    if World.terrainMap[ix] then
        return World.terrainMap[ix][iz]
    end
    return nil
end

return World