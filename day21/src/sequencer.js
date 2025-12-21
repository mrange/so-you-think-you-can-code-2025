class Sequencer {
  constructor(bpm = 120, beatsPerBar = 4) {
    this.bpm = bpm;
    this.beatsPerBar = beatsPerBar;
  }

  getUnitsFromMs(ms, totalLength) {
    return (ms * 44.1) / (totalLength * 2);
  }

  getUnitsFromBars(bars, totalLength) {
    const secondsPerBeat = 60 / this.bpm;
    const secondsPerBar = secondsPerBeat * this.beatsPerBar;
    return this.getUnitsFromMs(bars * secondsPerBar * 1000, totalLength);
  }

  // Updated Transpiler with "Absolute Anchoring" for GPU Stability
  static bakeToGLSL(timeline, worldL) {
    let glsl = `// Generated Sequencer\n`;
    glsl += `#define L ${worldL.toFixed(1)}\n\n`;
    glsl += `struct Scene { float d; float start; int f; int id; };\n`;
    glsl += `Scene ss[${timeline.length}];\n\n`;
    glsl += `void loadSequencer() {\n`;

    let currentAcc = 0;
    timeline.forEach((s, i) => {
      glsl += `    ss[${i}] = Scene(${s[0].toFixed(4)}, ${currentAcc.toFixed(
        4
      )}, ${s[1]}, ${s[2]});\n`;
      currentAcc += s[0] === 255 ? 0 : s[0];
    });

    glsl += `}\n\n`;
    glsl += `void getSequenceState(float time, out int id, out float prog, out int flags) {\n`;
    glsl += `    loadSequencer();\n`;
    glsl += `    float phead = (time * 1000.0 * 44.1) / (L * 2.0);\n`;
    glsl += `    id = 0; prog = 0.0; flags = 0;\n`;
    glsl += `    for (int i = 0; i < ${timeline.length}; i++) {\n`;
    glsl += `        if (phead >= ss[i].start && phead < ss[i].start + ss[i].d) {\n`;
    glsl += `            id = ss[i].id; flags = ss[i].f; \n`;
    glsl += `            prog = clamp((phead - ss[i].start) / ss[i].d, 0.0, 1.0);\n`;
    glsl += `            return;\n`;
    glsl += `        }\n`;
    glsl += `    }\n`;
    glsl += `}`;
    return glsl;
  }
}