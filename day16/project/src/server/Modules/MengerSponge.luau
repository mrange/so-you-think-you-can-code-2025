local MengerSponge = {}

-- Recursive function to generate parts
function MengerSponge.generate(position, size, level)
    -- Base case: If we are at level 0, draw the cube
    if level == 0 then
        local part = Instance.new("Part")
        part.Size = Vector3.new(size, size, size)
        part.Position = position
        part.Anchored = true
        part.Material = Enum.Material.Concrete
        part.Color = Color3.fromRGB(150, 150, 150)
        part.Parent = game.Workspace
        return
    end

    local newSize = size / 3
    for x = -1, 1 do
        for y = -1, 1 do
            for z = -1, 1 do
                -- Logic: Remove center pieces where more than one coordinate is 0
                local sum = math.abs(x) + math.abs(y) + math.abs(z)
                if sum > 1 then
                    local offset = Vector3.new(x * newSize, y * newSize, z * newSize)
                    MengerSponge.generate(position + offset, newSize, level - 1)
                end
            end
        end
    end
end

return MengerSponge