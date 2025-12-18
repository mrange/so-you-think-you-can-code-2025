// The entry file of your WebAssembly module.

export function add(a: i32, b: i32): i32 {
  return a + b;
}


// Calculates PI using the Monte Carlo method over a large number of samples.
// This is CPU-intensive and ideal for Wasm.
export function calculatePi(samples: i64): f64 {
  // Wasm types for high-performance math:
  let pointsInCircle: i64 = 0;
  let i: i64 = 0;

  // Use the native Wasm Math library (imported by AssemblyScript)
  // for efficient random number generation.
  // Note: Wasm currently lacks a true CSPRNG, this is fast but predictable.
  while (i < samples) {
    // Generate a random coordinate (x, y) between 0 and 1
    const x: f64 = Math.random();
    const y: f64 = Math.random();

    // Check if the point falls inside the unit circle (x² + y² < 1)
    if (x * x + y * y < 1.0) {
      pointsInCircle += 1;
    }

    i += 1;
  }
  // The formula for Monte Carlo PI is: (4 * pointsInCircle) / totalSamples
  // The result must be an f64 (double-precision float).
  return (4.0 * <f64>pointsInCircle) / <f64>samples;
}


// 3. Canvas Manipulation Example: Draw Mandelbrot Fractal
// Takes the memory address (ptr), dimensions, and a max iteration count.
export function drawMandelbrot(
  ptr: usize,
  width: i32,
  height: i32,
  max_iterations: i32
): void {
  // Define the complex plane boundaries for the default view
  const x_min: f64 = -2.0;
  const x_max: f64 = 1.0;
  const y_min: f64 = -1.2;
  const y_max: f64 = 1.2;

  // Pre-calculate the scale factors
  const x_scale: f64 = (x_max - x_min) / <f64>width;
  const y_scale: f64 = (y_max - y_min) / <f64>height;

  let mem_offset: usize = ptr;

  // Loop through every pixel (x, y) on the screen
  for (let py: i32 = 0; py < height; ++py) {
    for (let px: i32 = 0; px < width; ++px) {
      // Map pixel coordinates to the complex plane (c = c_r + c_i * i)
      const c_r: f64 = x_min + <f64>px * x_scale;
      const c_i: f64 = y_min + <f64>py * y_scale;

      // Start the iteration at z = 0 (z_r + z_i * i)
      let z_r: f64 = 0.0;
      let z_i: f64 = 0.0;

      let iterations: i32 = 0;

      // Mandelbrot Iteration: z = z^2 + c
      while (
        z_r * z_r + z_i * z_i <= 4.0 && // Escape condition: magnitude > 2 (2^2 = 4)
        iterations < max_iterations // Stop condition: max iterations reached
      ) {
        const temp_z_r: f64 = z_r * z_r - z_i * z_i + c_r;
        z_i = 2.0 * z_r * z_i + c_i;
        z_r = temp_z_r;
        iterations += 1;
      }

      // --- Color Mapping ---
      let r: u8 = 0;
      let g: u8 = 0;
      let b: u8 = 0;
      
      if (iterations < max_iterations) {
        // Pixel escaped, assign a color based on the escape speed (iterations)
        r = <u8>(iterations % 8 * 32); 
        g = <u8>(iterations % 16 * 16);
        b = <u8>(iterations % 32 * 8);
      }
      
      // Write the RGBA data directly to the shared memory buffer (4 bytes per pixel)
      store<u8>(mem_offset + 0, r);      // R
      store<u8>(mem_offset + 1, g);      // G
      store<u8>(mem_offset + 2, b);      // B
      store<u8>(mem_offset + 3, 0xFF);   // A (Always opaque)

      mem_offset += 4; // Move pointer to the next pixel
    }
  }
}
