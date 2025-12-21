#define L 170000.0

struct Scene { 
    float d;
    int f;
    int id;
};

Scene ss[4];

void getSequenceState(float time, out int id, out float prog, out int flags) {
    float phead = (time * 1000.0 * 44.1) / (L * 2.0);

    ss[0] = Scene(0.3243, 0x4000, 1);
    ss[1] = Scene(0.6485, 0x0001, 2);
    ss[2] = Scene(0.1297, 0x4001, 3);
    ss[3] = Scene(255.0, 0, 0);

    float acc = 0.0;
    id = 0; prog = 0.0; flags = 0;

    /* NOTE: On some GPUs, accumulating small floats in a loop (acc += ss[i].d)
    can lead to precision "drift" over long timelines. For production,
    pre-calculate absolute start/end times in your Transpiler. */
    for (int i = 0; i < 4; i++) {
        if (phead >= acc && phead < acc + ss[i].d) {
            id = ss[i].id;
            flags = ss[i].f;
            prog = clamp((phead - acc) / ss[i].d, 0.0, 1.0);
            return;
        }
        acc += ss[i].d;
    }
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    int sId; float sProg; int sFlags;
    getSequenceState(iTime, sId, sProg, sFlags);

    vec3 col = vec3(0.0);
    if (sId == 1) col = vec3(0.8, 0.2, 0.2);
    if (sId == 2) col = vec3(0.2, 0.2, 0.8);
    if (sId == 3) col = vec3(0.2, 0.8, 0.2);

    float fade = smoothstep(0.0, 0.25, sProg) *
                (1.0 - smoothstep(0.75, 1.0, sProg));

    if ((sFlags & 0x4000) != 0) {
        vec2 uv = fragCoord / iResolution.xy;
        col *= 0.5 + 0.5 * pow(16.0 * uv.x * uv.y *
            (1.0 - uv.x) * (1.0 - uv.y), 0.1);
    }

    fragColor = vec4(col * fade, 1.0);
}