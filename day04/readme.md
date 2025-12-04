# **How to Turn Your GPU into a Synthesizer**

Use your GPU to generate high-fidelity audio. By treating the GPU like an audio processor, we can write entire songs in code. This is the core idea behind this **GPU Synth** .

This approach is one of several extremely efficient methods for procedural audio generation. Outside the browser, demoscene tools like **4klang** have long demonstrated what tiny synthesizers can do. In the browser ecosystem, projects like **Sonant / Sonant-X**, **Efflux Tracker**, and **BeepBox** offer procedural and pattern-based workflows.

Platforms like **ShaderToy** also show the raw power of “Shader Music,” treating GPUs as Digital Signal Processors. This article walks through how to apply the same principles in a clean TypeScript/WebGL environment.

----------

# **From Pixels to Sound Waves**

At its heart, the technique is beautifully simple:

> **Audio = numbers.**  
> **Shaders output numbers.**  
> **Therefore, shaders can output audio.**

The GPU normally computes millions of pixels per frame. Each pixel contains four channels of data (RGBA). If we reinterpret those values as **audio samples**, we can use the GPU as a parallel DSP engine.

----------

# **From GLSL Code to AudioContext**

We’ll walk through the two modules that make GPU audio work:

-   [SWEET_DREAMS_SHADER.ts](SWEET_DREAMS_SHADER.ts) — your music engine (the DSP)    
-   [GPUSynth.ts](GPUSynth.ts) — the driver that bridges WebGL and the Web Audio API
    
----------

# GPU Setup and Compilation 

## `synth.Generate()`

This phase runs **once**. Its goal is to compile the DSP shader and return a function that can generate audio on demand.

### **What happens in Generate():**

1.  **Create a hidden WebGL2 canvas**    
2.  **Compile vertex + fragment shaders** (the fragment shader _is_ your synth)    
3.  **Cache uniform locations**    
4.  **Return an AudioGenerator function**    

This function is called repeatedly during playback to produce audio blocks.

```ts
return (absoluteSampleTime, channel) => {
    gl.uniform1f(bufferTimeLoc, absoluteSampleTime / sr);
    gl.uniform1f(channelLoc, channel);
    gl.drawArrays(GL_TRIANGLES, 0, 3);
    gl.readPixels(0, 0, w, h, gl.RGBA, 
	    gl.UNSIGNED_BYTE, rawByteBuffer);
    return rawByteBuffer;
};
```
Each call runs your DSP shader and returns **w × h × 4 samples** as raw bytes.

----------

# DSP Execution + Continuous Playback

Playback happens via the Web Audio API.

### **Inside the audio scheduler loop:**

1.  Call `generator(time, 0)` → left samples    
2.  Call `generator(time, 1)` → right samples    
3.  Convert bytes to floats    
4.  Create an AudioBuffer    
5.  Schedule it with `AudioBufferSourceNode`    
6.  Repeat with a look-ahead to avoid gaps    

### **Byte → Float conversion:**

```ts
floatSample = (byte / 255) * 2 - 1
```

The GPU writes colors, the CPU turns those colors into sound.

----------

# **Writing Music as Math**

Writing audio shaders is both challenging and rewarding. There are:

-   no samples    
-   no MIDI    
-   no plugins    
-   no synths
    
You build everything mathematically: oscillators, envelopes, filters, sequencing, even mixing.

The GPU receives one time value per sample:

```glsl
float t = bufferTime +
          (fragCoord.x + fragCoord.y * resolution.x) / sampleRate;

```
From there, everything is just functions of `t`.

----------

# **Building a Sequencer on the GPU**


Inside the fragment shader, sequencing is handled entirely by _math_, not MIDI events.

### **The core concept:**

You use **modulo arithmetic** on time to pick which note should be active.

Example:

```glsl
float step = mod(t * bps * 2.0, 16.0);

```

This expresses:

-   `t` = global time    
-   `bps` = beats per second   
-   `t * bps * 2` = musical time    
-   `mod(..., 16)` = 16-step loop
    
Every step corresponds to one of the elements in the `notes[]` array:

```glsl
int notes[16] = int[](24,24,36,48, ... );
```

Then for each note, we compute:

-   The note's frequency    
-   Its ADSR envelope    
-   Its oscillator output    
-   Add it to the mix    

This gives a **fully GPU-driven step sequencer**—all inside a fragment shader, all parallelized.

----------

# **DSP Shader: SWEET_DREAMS_SHADER.**

Below is the full GLSL module implementing:

-   ADSR envelope    
-   Triangle/sine/saw oscillators    
-   Kick drum synthesis    
-   Noise-based hi-hat    
-   Multi-oscillator synth voice    
-   16-step sequencer for the Sweet Dreams riff    
-   Stereo modulation    
-   Four-samples-per-pixel packing

This is the exact shader used in the demo.

```glsl
export const SWEET_DREAMS_SHADER: string = /*glsl*/`#version 300 es
#ifdef GL_ES
  precision highp int;
  precision highp float;
#endif
uniform float bufferTime;
uniform float sampleRate;
uniform vec2  resolution;
uniform float channel;
out vec4 fragColor;

#define PI acos(-1.)
#define TAU (2.0 * PI)

float bpm = 126.0;
float bps = 2.1;

// MIDI note → frequency
float noteToFreq(float n) {
  return pow(2.0, (n - 49.0) / 12.0) * 440.0;
}

// ADSR
float adsr(float tabs, vec4 env, float start, float duration) {
  float t = tabs - start;
  float sustain = env[2];
  float t1 = env[0];
  float t2 = t1 + env[1];
  float t3 = max(t2, duration);
  float t4 = t3 + env[3];
  
  if (t < 0.0 || t > t4) return 0.0;
  if (t <= t1) return smoothstep(0.0, t1, t);
  if (t <= t2) return sustain + smoothstep(t2, t1, t) * (1.0 - sustain);
  if (t <= t3) return sustain;
  return sustain * smoothstep(t4, t3, t);
}

// Noise (for hi-hat)
float rand(float co) {
  return fract(sin(dot(vec2(co), vec2(12.9898,78.233))) * 43758.5453);
}

// Basic waveforms
float sine(float t, float x){ return sin(2.0 * PI * t * x); }
float tri (float t, float x){ return abs(1.0 - mod(2.0*t*x, 2.0))*2.0 - 1.0; }
float saw (float t, float x){ return fract(2.0*t*x)*2.0 - 1.0; }
float sat (float t, float amp){ return clamp(t, -amp, amp); }

// Kick drum
float beat(float t, float s, float f) {
  t = min(t, s);
  float p = f * smoothstep(2.0*s, 0.0, t);
  return tri(t, p);
}

// Multi-wave synth
float synth(float t, float f) {
  t += mix(0.2, 0.6, channel) * sin(t*2.0) / f;
  return 0.3 * tri(t, f/2.0)
       + sat(0.8*sine(t, f/4.0 + 0.2), 0.2)
       + 0.2 * saw(t, f/4.0)
       + 0.2 * saw(t, f/4.0 + mix(0.3,0.2,channel));
}

// Sweet Dreams melody
float sweetDreamSynth(float t) {
  int notes[16];
  notes[0]=24; notes[1]=24; notes[2]=36; notes[3]=48;
  notes[4]=39; notes[5]=51; notes[6]=36; notes[7]=48;
  notes[8]=32; notes[9]=32; notes[10]=44; notes[11]=48;
  notes[12]=31; notes[13]=31; notes[14]=46; notes[15]=48;

  float m = mod(t * bps * 2.0, 16.0);
  float sound = 0.0;

  for (int i=0; i<16; ++i) {
    float pf = (mod(t*bps*2.0, 32.0) > 16.0 ? 1.0 : 2.0);
    sound += synth(t, pf * noteToFreq(float(notes[i])))
             * adsr(m, vec4(0.1,0.2,0.7,0.8), float(i), 0.6);
  }
  return sound;
}

// Mixer
float dsp(float t) {
  float beat_mix = 0.0;
  float block = mod(t*bps*2.0, 6.0 * 16.0) / 16.0;

  if (block < 6.0 - 2.0) {
    beat_mix =
      0.6 * beat(mod(t*bps,2.0), 0.2, 60.0) * mix(0.6,1.0,channel) +
      0.3 * adsr(mod(t*bps,2.0), vec4(0.02,0.05,0.7,1.0), 1.0,0.1)
          * rand(t) * mix(0.8,1.0,channel);
  }

  return beat_mix +
         0.4 * sweetDreamSynth(t) * mix(1.0,0.8,channel);
}

void main() {
  float index = gl_FragCoord.y * resolution.x + gl_FragCoord.x;
  float t = bufferTime + 4.0 * index / sampleRate;

  vec4 r = vec4(
    dsp(t),
    dsp(t + 1.0/sampleRate),
    dsp(t + 2.0/sampleRate),
    dsp(t + 3.0/sampleRate)
  );

  fragColor = (r + 1.0) * 0.5;
}
`;
```

----------

# Running the Example

```ts
const SAMPLE_RATE = 44100;
const WIDTH = 128;
const HEIGHT = 64;
const synth = new GPUSynth();
const generator = synth.Generate(SWEET_DREAMS_SHADER, SAMPLE_RATE, WIDTH, HEIGHT);
synth.Play(generator);

```

**Note on Playback:** While `synth.Play(generator)` demonstrates real-time capability, for **production stability and performance**, the best approach is to **pre-render** the entire song. This involves running the GPU generator for the full duration and collecting the samples into a single **AudioBuffer** or **WAV Blob** once, eliminating real-time scheduling pressure.


# Demo
  
[https://jsfiddle.net/54exqz61/](https://jsfiddle.net/54exqz61/)

---

*Thanks for reading, 
Happy holidays.*


