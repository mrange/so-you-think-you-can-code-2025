local Players = game:GetService("Players")
local ServerScriptService = game:GetService("ServerScriptService")

local Modules = script:WaitForChild("Modules") 
local WorldGenerator = require(Modules:WaitForChild("WorldGenerator"))
local Utility = require(Modules:WaitForChild("Utility"))

local spawnCheckCords = Vector2.new(0, 0)

print("🌍 World initialization sequence started...")

local success, err = pcall(function()
    WorldGenerator.generateWorld()
end)

if success then
    print("✅ World generation successfully completed!")
else
    warn("❌ World generation failed: " .. tostring(err))
end

local function spawnPlayerOnSurface(player)
    player.CharacterAdded:Connect(function(character)
        character:WaitForChild("HumanoidRootPart")
        
        local surfaceY = Utility.getGroundY(spawnCheckCords.X, spawnCheckCords.Y)
        local safeSpawnPos = Vector3.new(spawnCheckCords.X, surfaceY + 10, spawnCheckCords.Y)
        
        character:PivotTo(CFrame.new(safeSpawnPos))
        print("👤 Player " .. player.Name .. " moved to surface Y: " .. surfaceY)
    end)
    
    if player.character then
        task.spawn(function()
            local surfaceY = Utility.getGroundY(spawnCheckCords.X, spawnCheckCords.Y)
            player.character:PivotTo(CFrame.new(spawnCheckCords.X, surfaceY + 10, spawnCheckCords.Y))
        end)
    end
end

Players.PlayerAdded:Connect(spawnPlayerOnSurface)

for _, player in ipairs(Players:GetPlayers()) do
    spawnPlayerOnSurface(player)
end