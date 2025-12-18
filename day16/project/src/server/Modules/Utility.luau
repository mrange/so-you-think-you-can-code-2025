local Workspace = game:GetService("Workspace")
local Utility = {}
local Config = require(script.Parent.Config)

local RAYCAST_PARAMS = RaycastParams.new()
RAYCAST_PARAMS.FilterType = Enum.RaycastFilterType.Include
RAYCAST_PARAMS.FilterDescendantsInstances = {Workspace.Terrain}

function Utility.noise2D(x, z)
    local total, freq, amp = 0, 0.0035, 1.0
    for i = 1, 8 do
        total += math.noise(x * freq, z * freq) * amp
        freq *= 2.0
        amp *= 0.6
    end
    local zeroToOne = (math.clamp(total, -2.0, 1.5) + 2.0) / 3.5 
    return zeroToOne * Config.HEIGHT_SCALE
end

function Utility.getGroundY(x, z)
    local result = Workspace:Raycast(Vector3.new(x, 1000, z), Vector3.new(0, -2000, 0), RAYCAST_PARAMS)
    return result and result.Position.Y or 0
end

function Utility.isLocationFlat(x, z)
    local result = Workspace:Raycast(Vector3.new(x, 1000, z), Vector3.new(0, -2000, 0), RAYCAST_PARAMS)
    if result then
        return result.Normal.Y > 0.9 
    end
    return false
end

function Utility.createPart(size, color, pos, material, parent)
    local p = Instance.new("Part")
    p.Size, p.Color, p.Position, p.Anchored, p.Material, p.Parent = size, color, pos, true, material, parent
    return p
end

return Utility