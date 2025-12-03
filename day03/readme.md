# WebGPU: Measuring FPS and GPU Render Time

To truly harness the power of WebGPU, it's not enough to just render pixels on the screen. You need to **understand how fast your code runs**, where the bottlenecks are, and how efficiently your GPU is being used. In this article, we'll explore **two essential metrics** for WebGPU developers: **Frames Per Second (FPS)** and **stable GPU render-pass timing** using the `timestamp-query` feature and a rolling average. By the end, you'll have a robust workflow to profile and optimize your WebGPU applications.

----------

## 1. Setting Up WebGPU: A Solid Foundation 

Before we can measure performance, we need a stable WebGPU context. This means detecting available features, requesting a capable device, and configuring the canvas correctly.


```typescript
/**
 * Initializes WebGPU with optional features such as:
 * - bgra8unorm-storage
 * - timestamp-query (for GPU timing)
 *
 * Returns: { device, context, adapter, supportsTimestampQuery }
 */
export async function initWebGPU(
    canvas: HTMLCanvasElement,
    options?: GPURequestAdapterOptions
) {
    const adapter = await navigator.gpu?.requestAdapter(options);
    if (!adapter) {
        throw new Error("WebGPU adapter not available — your browser or GPU may not support WebGPU.");
    }

    const hasBGRA8unormStorage = adapter.features.has("bgra8unorm-storage");
    const hasTimestampQuery = adapter.features.has("timestamp-query");

    const requiredFeatures: GPUFeatureName[] = [];
    if (hasBGRA8unormStorage) requiredFeatures.push("bgra8unorm-storage");
    if (hasTimestampQuery) requiredFeatures.push("timestamp-query");

    const device = await adapter.requestDevice({ requiredFeatures });
    if (!device) {
        throw new Error("Unable to request WebGPU device — ensure WebGPU is enabled.");
    }

    const context = canvas.getContext("webgpu");
    if (!context) {
        throw new Error("Failed to get WebGPU rendering context.");
    }

    context.configure({
        device,
        format: hasBGRA8unormStorage
            ? navigator.gpu.getPreferredCanvasFormat()
            : "rgba8unorm",
        usage:
            GPUTextureUsage.RENDER_ATTACHMENT |
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.STORAGE_BINDING,
        alphaMode: "premultiplied"
    });

    return {
        device,
        context,
        adapter,
        supportsTimestampQuery: hasTimestampQuery
    };
}

```

----------

## 2. Measuring CPU Frame Rate (FPS)

FPS measures CPU and browser overhead. Since we are focusing on GPU bottlenecks, this in-app meter primarily serves as a quick check for heavy CPU-side work (e.g., complex scene graph updates).


```typescript
let then = 0;

function render(now: number) {
    now *= 0.001; // convert to seconds
    const deltaTime = now - then;
    then = now;

    const fps = 1 / deltaTime;
    console.log(`FPS: ${fps.toFixed(1)}`);

    // Your rendering logic goes here...

    requestAnimationFrame(render);
}

```

----------

## 3. Measuring Stable GPU Render Pass Time

To get a true indicator of GPU performance, we use `timestamp-query` and a **Rolling Average** to smooth out instantaneous spikes in render time.

### A. The Rolling Average Class

A fixed-size rolling average provides a stable metric by averaging the last 'N' samples.

```typescript
export class RollingAverage {
    total: number = 0;
    samples: number[] = [];
    cursor: number = 0;
    private readonly numSamples: number;

    constructor(numSamples: number = 30) {
        this.numSamples = numSamples;
    }
    
    /** Adds a new sample value (v) and updates the total. */
    addSample(v: number) {
        // Subtract the oldest sample before replacing it
        this.total += v - (this.samples[this.cursor] || 0);
        this.samples[this.cursor] = v;
        // Move to the next index in the circular buffer
        this.cursor = (this.cursor + 1) % this.numSamples;
    }
    
    /** Returns the average of all collected samples (up to numSamples). */
    get(): number {
        return this.total / this.samples.length; 
    }
}

```

### B. The WebGPUTiming Class

This class manages the WebGPU objects needed for timing: the **QuerySet**, the **Resolve Buffer**, and the **Read Buffer**.

```typescript
export class WebGPUTiming {
    supportsTimeStampQuery: boolean;
    querySet: GPUQuerySet | undefined;
    resolveBuffer: GPUBuffer | undefined;
    readBuffer: GPUBuffer | undefined;

    constructor(public device: GPUDevice) {
        this.supportsTimeStampQuery = device.features.has("timestamp-query");

        if (this.supportsTimeStampQuery) {
            this.querySet = device.createQuerySet({ type: "timestamp", count: 2 });
            this.resolveBuffer = device.createBuffer({
                size: this.querySet.count * 8, // 64-bit timestamps
                usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
            });
            this.readBuffer = device.createBuffer({
                size: this.querySet.count * 8,
                usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
            });
        }
    }
}

```

### C. Integrating GPU Timing into Your Render Loop

The timing process involves a three-step command pipeline executed on the GPU, followed by a CPU read: **Record** $\rightarrow$ **Resolve** $\rightarrow$ **Copy** $\rightarrow$ **Read**.

```typescript
const { device, supportsTimestampQuery } = await initWebGPU(canvas);
const gpuTimer = new WebGPUTiming(device);
const gpuAverage = new RollingAverage(60); // Average over 60 frames

function render(now: number) {
    // ... FPS calculation ...
    const commandEncoder = device.createCommandEncoder();
    
    const renderPassEncoder = commandEncoder.beginRenderPass({
        // ... color attachments ...
        ...(supportsTimestampQuery && {
            timestampWrites: {
                querySet: gpuTimer.querySet!,
                beginningOfPassWriteIndex: 0,
                endOfPassWriteIndex: 1,
            }
        })
    });
    // ... draw calls ...
    renderPassEncoder.end();

    if (supportsTimestampQuery) {
        commandEncoder.resolveQuerySet(gpuTimer.querySet!, 0, 2, gpuTimer.resolveBuffer!, 0);
        if (gpuTimer.readBuffer!.mapState === 'unmapped') {
            commandEncoder.copyBufferToBuffer(gpuTimer.resolveBuffer!, 0, gpuTimer.readBuffer!, 0, gpuTimer.resolveBuffer!.size);
        }
    }
    device.queue.submit([commandEncoder.finish()]);

    // Read the result asynchronously after GPU work is done
    device.queue.onSubmittedWorkDone().then(() => {
        if (supportsTimestampQuery) {
            const timer = gpuTimer!;
            if (timer!.readBuffer!.mapState === 'unmapped') {
                timer!.readBuffer!.mapAsync(GPUMapMode.READ).then(() => {
                    const times = new BigInt64Array(timer!.readBuffer!.getMappedRange());
                    
                    // Difference is in nanoseconds (ns)
                    const gpuTime_ns = Number(times[1] - times[0]);
                    
                    // Convert nanoseconds (ns) to milliseconds (ms) by dividing by 1,000,000
                    const gpuTime_ms = gpuTime_ns / 1_000_000; 

                    gpuAverage.addSample(gpuTime_ms);
                    timer!.readBuffer!.unmap();
                    
                    console.log(`Smoothed GPU Render Time: ${gpuAverage.get().toFixed(3)}ms`);
                });
            }
        }
    });

    requestAnimationFrame(render);
}

```

----------

## 4. Interpreting FPS vs GPU Time

Let's say your profiler reports:

-   **Smoothed GPU time:** 0.103 ms
    
-   **FPS:** 60
    

**Analysis:**

-   **Frame budget at 60 FPS:** $\approx 16.67$ ms
    
-   **GPU load percentage:** $0.103 / 16.67 \approx 0.62\%$
    

✅ Conclusion: GPU is barely utilized. The bottleneck is likely **CPU-bound** (too much work on the CPU side) or **VSync-limited**.

----------

## 5. Caveats and Considerations

### WebGL vs. WebGPU: The Profiling Upgrade 

**Standardized GPU timing was not reliably available in WebGL.** WebGL relied on the optional and often restricted `EXT_disjoint_timer_query` extension.

#### WebGL Timing Concept (Pseudocode)

```javascript
// 1. Create a timer query object
GL_TimerQuery query = gl.createTimerQueryEXT()

// 2. Start the timer before GPU work
gl.beginQueryEXT(query)

// 3. Issue all WebGL draw calls...

// 4. End the timer after GPU work
gl.endQueryEXT(query)

// 5. In a future frame, check if the results are ready
if (gl.getQueryParameterEXT(query, GL_QUERY_RESULTS_AVAILABLE_EXT)) {
    // 6. Get the result (time in nanoseconds)
    time_ns = gl.getQueryObjectEXT(query)
    // IMPORTANT: The result may be unreliable if the clock was 'disjoint'
}

```

The WebGPU approach, using the explicit resolve/copy pipeline and an official feature, offers significantly **more reliable** and consistent timing data.

Other caveats:

-   `timestamp-query` is optional and may not be supported on all devices.
    
-   Some browsers **coarsen timestamps** ($\approx 100 \ \mu \text{s}$ resolution) for security reasons.
    
-   Mapping buffers every frame adds tiny overhead — batching or sampling periodically is recommended for production.
    

----------

## Conclusion

FPS tells you if your thing is smooth, but **GPU render-pass timing tells you why**. Using the `timestamp-query` feature in WebGPU, stabilized by a **Rolling Average**, provides the precise, actionable metric required for effective shader and pipeline optimization. This robust workflow is **essential** for advanced WebGPU development.

