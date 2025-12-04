/**
 * GPUSynth Class Definition
 *
 * This class handles the core logic for initializing WebGL 2.0 to run a fragment
 * shader as a Digital Signal Processor (DSP), and manages the continuous
 * streaming of the generated audio data via the Web Audio API.
 *
 */

// --- WebGL Constants (Copied from the browser's GL constants) ---
const GL_ARRAY_BUFFER = 34962;
const GL_STATIC_DRAW = 35044;
const GL_VERTEX_SHADER = 35633;
const GL_FRAGMENT_SHADER = 35632;
const GL_COMPILE_STATUS = 35713;
const GL_TRIANGLES = 0x0004;
const GL_RGBA = 6408;
const GL_UNSIGNED_BYTE = 5121;

type AudioGenerator = (
    absoluteBufferTimeInSamples: number,
    channel: 0 | 1,
    preAllocatedBuffer?: Uint8Array
) => Uint8Array;

// --- GPUSynth Class ---
class GPUSynth {
    // Simple Vertex Shader to draw a full-screen triangle covering the viewport
    private static vs: string = `#version 300 es
      #ifdef GL_ES
        precision highp float;
        precision highp int;
      #endif
      layout(location = 0) in vec2 pos; 
      void main() { gl_Position = vec4(2.0 * pos - 1.0, 0.0, 1.0); }`;

    // Static timer ID for the playback loop
    private static timer: number | null = null;
    
    // Web Audio API context
    private audioContext: AudioContext | null = null;
    
    // Error handler callback (used to report issues to the UI)
    public onError: ((message: string) => void) | undefined; 

    constructor() {
        // Initialization occurs on user interaction (Play/Generate methods)
    }

    /**
     * Initializes the WebGL context, compiles the shaders, and returns the generator function.
     * @param dsp - The GLSL fragment shader code (the DSP logic).
     * @param sr - The desired sample rate (e.g., 44100).
     * @param w - The width of the GPU render target.
     * @param h - The height of the GPU render target.
     * @returns A function that generates a single audio buffer chunk on the GPU.
     */
    public Generate(dsp: string, sr: number, w: number, h: number): AudioGenerator | null {
        // We create an off-screen canvas for WebGL rendering
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;

        // Get the WebGL2 context
        const g = canvas.getContext("webgl2", { preserveDrawingBuffer: true });

        if (!g) {
            this.onError?.("WebGL 2 not supported. Cannot run GPU synthesis.");
            return null;
        }
    
        const p = g.createProgram();
        
        // Helper to compile shaders and check for errors
        const compileShader = (type: number, source: string): WebGLShader | null => {
            const shader = g.createShader(type)!;
            g.shaderSource(shader, source);
            g.compileShader(shader);
            
            if (!g.getShaderParameter(shader, GL_COMPILE_STATUS)) {
                const log = g.getShaderInfoLog(shader);
                const typeName = type === GL_VERTEX_SHADER ? "Vertex" : "Fragment";
                this.onError?.(`${typeName} Shader Compilation Error: ${log}`);
                g.deleteShader(shader);
                return null;
            }
            return shader;
        };

        // 1. Compile and attach shaders
        const v = compileShader(GL_VERTEX_SHADER, GPUSynth.vs);
        const f = compileShader(GL_FRAGMENT_SHADER, dsp);
        
        if (!v || !f) return null;

        g.attachShader(p, v);
        g.attachShader(p, f);
    
        // 2. Link Program and Setup Buffers
        g.viewport(0, 0, w, h);
        g.linkProgram(p);
        g.useProgram(p);
        
        // Setup the single fullscreen triangle buffer
        const buffer = g.createBuffer();
        g.bindBuffer(GL_ARRAY_BUFFER, buffer);
        g.bufferData(GL_ARRAY_BUFFER, new Int8Array([-3, 1, 1, -3, 1, 1]), GL_STATIC_DRAW);
        
        const posLoc = g.getAttribLocation(p, 'pos');
        g.enableVertexAttribArray(posLoc);
        g.vertexAttribPointer(posLoc, 2, 5120, false, 0, 0);

        // 3. Get Uniform Locations
        const sampleRateLoc = g.getUniformLocation(p, 'sampleRate');
        const resolutionLoc = g.getUniformLocation(p, 'resolution');
        const bufferTimeLoc = g.getUniformLocation(p, 'bufferTime');
        const channelLoc = g.getUniformLocation(p, 'channel');

        // 4. Set Static Uniforms
        g.uniform1f(sampleRateLoc, sr);
        g.uniform2f(resolutionLoc, w, h);
    
        // 5. Return the generator function
        const bufferSizeInSamples = w * h * 4;
        
        return (t, c, _b) => {
            // t: absolute buffer time (in samples)
            // c: channel index (0 for Left, 1 for Right)
            
            // Use provided buffer for efficiency, or allocate a new one
            const b = _b || new Uint8Array(bufferSizeInSamples);
            
            // Set dynamic uniforms for the current draw call
            g.uniform1f(bufferTimeLoc, t / sr); // Convert sample index time to seconds
            g.uniform1f(channelLoc, c);
            
            // Draw the fullscreen triangle to render the audio samples
            g.drawArrays(GL_TRIANGLES, 0, 3);
            
            // Read the rendered pixels (audio data) from the GPU's framebuffer
            g.readPixels(0, 0, w, h, GL_RGBA, GL_UNSIGNED_BYTE, b);
            return b;
        };
    }

    /**
     * Stops the playback loop and closes the AudioContext.
     */
    public Stop(): void {
        if (GPUSynth.timer !== null) {
            clearTimeout(GPUSynth.timer);
            GPUSynth.timer = null;
        }
        if (this.audioContext && this.audioContext.state !== "closed") {
            this.audioContext.close().catch(console.error);
        }
        this.audioContext = null;
    }

    /**
     * Starts the playback loop, continuously calling the generator function.
     * @param gen - The AudioGenerator function returned by Generate.
     */
    public Play(gen: AudioGenerator): void {
        this.Stop(); // Ensure previous context is stopped
        
        // Initialize or resume the AudioContext (requires user interaction)
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
        
        const sr = this.audioContext.sampleRate;
    
        let abt = 0; // Absolute buffer time (in samples)
        let aat = this.audioContext.currentTime; // Absolute AudioContext time (in seconds)
    
        // Setup simple audio signal chain (Gain -> Compressor -> Output)
        const d = this.audioContext.createGain();
        const dc = this.audioContext.createDynamicsCompressor(); 
        const g = this.audioContext.createGain();
    
        g.gain.value = 0.6; // Master volume
        d.connect(dc);
        dc.connect(g);
        g.connect(this.audioContext.destination);
    
        const w = 128; // Render width
        const h = 64;  // Render height
        const bufferSizeInSamples = w * h * 4;
        const durationInSeconds = bufferSizeInSamples / sr;
        
        // Stores active audio buffers to prevent garbage collection and track playback
        let activeBuffers: { bufferTime: number; duration: number; destroy: () => void; }[] = [];

        const scheduleNextBuffer = () => {
            const bufferSource = this.audioContext!.createBufferSource();
            bufferSource.connect(d);
            
            // Generate raw byte buffers for Left (0) and Right (1) channels
            const rawBufferLeft = gen(abt, 0);
            const rawBufferRight = new Uint8Array(bufferSizeInSamples);
            gen(abt, 1, rawBufferRight); // Use pre-allocated buffer for the second channel

            // Create AudioBuffer: 2 channels, size, sample rate
            const ab = this.audioContext!.createBuffer(2, bufferSizeInSamples, sr);

            const audioDataL = ab.getChannelData(0);
            const audioDataR = ab.getChannelData(1);

            // Unpack and convert the GPU's RGBA byte data (0-255) back to Float32 audio data (-1.0 to 1.0)
            for (let i = 0; i < bufferSizeInSamples; i++) {
                // p: Start of the 4-sample RGBA block
                const p = Math.floor(i / 4) * 4; 
                // c: Index within the block (0=R, 1=G, 2=B, 3=A)
                const c = i % 4; 

                // Conversion: (byte / 255.0) -> float [0.0, 1.0] -> audio [-1.0, 1.0]
                const byteToAudio = (b: number): number => (b / 255.0) * 2.0 - 1.0;

                audioDataL[i] = byteToAudio(rawBufferLeft[p + c]);
                audioDataR[i] = byteToAudio(rawBufferRight[p + c]);
            }
            
            bufferSource.buffer = ab;
            bufferSource.start(aat); // Schedule to play at the calculated absolute time

            activeBuffers.push({
                bufferTime: abt,
                duration: durationInSeconds,
                destroy: () => bufferSource.disconnect(d),
            });
            
            // Update time pointers for the next buffer
            abt += bufferSizeInSamples;
            aat += durationInSeconds;
        };

        // Pre-fill the buffer queue to prevent initial startup gaps
        scheduleNextBuffer();
        scheduleNextBuffer();
        scheduleNextBuffer();
    
        const loop = () => {
            if (!this.audioContext || this.audioContext.state !== 'running') {
                return;
            }

            // Clean up buffers that have already finished playing
            activeBuffers = activeBuffers.filter((b) => {
                const bufferEndTimeInSamples = b.bufferTime + b.duration * sr;
                const currentTimeInSamples = Math.floor(this.audioContext!.currentTime * sr);
                if (bufferEndTimeInSamples < currentTimeInSamples) {
                    b.destroy();
                    return false;
                }
                return true;
            });

            // If less than 8 seconds of audio is scheduled, schedule more buffers
            const lookAheadTime = 8.0; 
            if (this.audioContext.currentTime + lookAheadTime > aat) {
                scheduleNextBuffer();
                scheduleNextBuffer();
                scheduleNextBuffer();
            }
            
            // Note: UI updates are handled externally in a complete application
            
            GPUSynth.timer = window.setTimeout(loop, 100);
        };
        
        // Start the scheduler loop
        loop();
    }
}