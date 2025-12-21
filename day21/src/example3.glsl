// s.xyz = duration, start, packed(id + flags)
// We pack ID in the 1s place and Flags in the 10s place.
// Example: 31.0 = Scene ID 1 + Flag 3
vec3 s[4] = vec3[](
    vec3(1.94, 0, 11),   // Sc 1: 15s (ID 1, Flag 10)
    vec3(1.94, 1.94, 2), // Sc 2: 15s (ID 2, No Flags)
    vec3(1.94, 3.88, 33),// Sc 3: 15s (ID 3, Flag 30)
    vec3(255, 5.82, 0)   // Blackout sentinel
);

void mainImage(out vec4 O, vec2 U) {
    // p = Playhead: Current time mapped to World Space
    float p = iTime * .13, t; 
    
    // O *= 0.0 is the shortest way to initialize fragColor to black
    O *= 0.; 
    
    for(int i=0; i<4; i++) {
        vec3 v = s[i];
        
        // Check if the current playhead is within this scene's window
        if (p >= v.y && p < v.y + v.x) {
            
            // Calculate local progress (0.0 to 1.0) within the active scene
            t = (p - v.y) / v.x;
            
            // Decode packed float: Modulo gets the ID, Division gets the Flag
            int id = int(v.z) % 10;   
            int fl = int(v.z) / 10;   

            // Golfed scene selection using a nested ternary chain
            O = id < 1 ? O*0. : 
                id < 2 ? vec4(1,.5,.2,1) : 
                id < 3 ? vec4(.2,.6,1,1) : vec4(.2,.8,.2,1);
            
            // Behavior: If Flag > 0, apply a rhythmic pulse modulation
            if(fl > 0) O *= sin(t * 31.4) * .5 + .5; 
            
            // Visual accent: Add a white flash that decays at scene start
            O += smoothstep(.2, 0., t); 
        }
    }
}
