
# The Grinch Who Stole Swizzle Write

If you are coming from GLSL, you likely have muscle memory for **swizzling** on the left side of an assignment. It is a powerful syntactic feature that allows you to selectively write to specific components of a vector.

In GLSL, this works perfectly:

OpenGL Shading Language

```glsl
// GLSL
vec3 pixel = vec3(0.0, 0.0, 0.0);
vec2 uv = vec2(1.0, 0.5);

// "Swizzle Write" - treating .yz as a writeable target
pixel.yz = uv; 

// pixel is now (0.0, 1.0, 0.5)

```

However, if you try this in WGSL, the compiler will stop you:

```glsl   
// WGSL
var pixel = vec3<f32>(0.0, 0.0, 0.0);
let uv = vec2<f32>(1.0, 0.5);

// ❌ ERROR: cannot assign to swizzle component
pixel.yz = uv; 

```

----------

## The Technical Reason: R-Value Restriction

The reason this assignment is disallowed lies in how WGSL distinguishes between **memory** and **values**.

In WGSL, a swizzle operation (like `pixel.yz`) creates a new temporary **value** (an **r-value**) containing copies of the selected components. It does **not** give you a direct, addressable **reference** (an **l-value**) to the actual memory locations of $y$ and $z$ inside the original vector.

When you attempt `pixel.yz = ...`, you are trying to assign data to a _temporary copy_ that immediately vanishes. WGSL explicitly forbids this to:

1.  Maintain a simpler language design.
    
2.  Avoid the implied **Read-Modify-Write** operation (reading the vector, masking, and then writing back) that the hardware would otherwise hide. By making you do the reconstruction explicitly, WGSL ensures you are always aware of the data flow.
    

----------

## Swizzle Reads: The Allowed Functionality

While writing to swizzles is forbidden, using swizzles to **read** components is a fundamental and highly optimized feature of WGSL. This allows you to efficiently copy, duplicate, and reorder vector components to create new temporary vectors.

WGSL supports both **coordinate aliases** and **color aliases** for reading:

**Component Set**

**Coordinate Aliases**

**Color Aliases**

4D Vector

`x, y, z, w`

`r, g, b, a`

Here are examples showing how you can still efficiently **read** and manipulate vector data:

```glsl 
var a: vec4<f32> = vec4<f32>(1.0, 2.0, 3.0, 4.0);

// Reading a single component
var b: f32 = a.y;          // b = 2.0

// Duplicating components
var c: vec2<f32> = a.bb;   // c = (3.0, 3.0) (Note: a.z and a.b are the same component!)

// Reordering (using coordinate aliases)
var d: vec3<f32> = a.zyx;  // d = (3.0, 2.0, 1.0)

// Using Color Aliases
var rgb_read: vec3<f32> = a.rgb; // (1.0, 2.0, 3.0)
var gba_read: vec3<f32> = a.gba; // (2.0, 3.0, 4.0)

// Indexing also works
var e: f32 = a[1];         // e = 2.0 (same as a.y or a.g)

```

----------

## The WGSL Solution: Vector Reconstruction

Since direct assignment is disallowed, the standard approach is to **reconstruct the entire vector** by combining the original components you want to keep with the new components you want to introduce.

```glsl 
// WGSL Solution
var pixel = vec3<f32>(0.0, 0.0, 0.0);
let uv = vec2<f32>(1.0, 0.5);

// Keep 'x', but replace 'y' and 'z' with 'uv'
// We manually build the new state
pixel = vec3<f32>(pixel.x, uv.x, uv.y);

```

For frequently used patterns, defining a simple helper function improves code readability with no runtime cost, as the compiler aggressively inlines these calls:

```glsl 
fn with_yz(v: vec3<f32>, yz: vec2<f32>) -> vec3<f32> {
    return vec3<f32>(v.x, yz.x, yz.y);
}

```

----------

## Future Ergonomics: The WESL Project

While the core WGSL specification remains strict, the community is building **WESL** (WGSL Enhanced Shading Language). Think of WESL as a high-level **superset** that compiles down to vanilla WGSL, solving common ergonomic challenges without fracturing the WebGPU standard.

WESL's goals include features that improve code structure and authoring efficiency:

-   **Module System (Imports):** Introducing an **`import` statement** for clean, modular, and reusable shader libraries.
    
-   **Conditional Translation:** Adding a preprocessor-like **`@if` statement** for compile-time toggling of shader features.
    
-   **Swizzle Assignment:** Regaining the ability to write to swizzles is a highly requested feature! WESL is the most likely place where this syntactic sugar could be introduced, as it can automate the reconstruction process for the developer.
    

The WESL project is an excellent example of the community filling in quality-of-life gaps in the WGSL ecosystem.

[Introducing WESL - Community Extended WGSL at 3D on Web 2025](https://www.youtube.com/watch?v=Na1XTKK_Mig) This video provides an overview of WESL and its goals.

----------

## Further Reading: GLSL to WGSL Migration

This topic highlights just one of many differences you'll encounter when migrating. For a comprehensive breakdown of the full transition from GLSL to WGSL, you can check out the deep dive from the **2024 Shader Advent Calendar**:

**[From GLSL to WGSL - Day 17 (2024)](https://github.com/mrange/shader-advent-2024/blob/main/day-17/README.md)**
