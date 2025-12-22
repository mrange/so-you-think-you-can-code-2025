'use strict';

/**
 * Blizzard - A synchronized snow effect system that creates interactive snowflakes
 * across multiple browser windows/tabs using BroadcastChannel API.
 *
 * Features:
 * - Interactive snowflake creation on mouse movement
 * - Cross-tab synchronization via BroadcastChannel
 * - Physics-based snowflake animation with swaying motion
 * - Automatic cleanup of off-screen flakes
 */
const Blizzard = {
  /** Unique identifier for this Blizzard instance */
  id: Math.random().toString(36).substr(2, 9),
  /** BroadcastChannel for cross-tab communication */
  bus: new BroadcastChannel('xmas_portal'),
  /** Array storing active snowflake objects */
  flakes: [],
  /** Canvas element for rendering snowflakes */
  canvas: null,
  /** 2D rendering context for the canvas */
  ctx: null,
  /** Timestamp of last mouse message to throttle broadcasts */
  lastMsgTime: 0,

  /**
   * Initializes the Blizzard system by creating canvas, setting up event listeners,
   * and starting the animation loop.
   */
  init() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    Object.assign(this.canvas.style, {
      position: 'fixed', top: '0', left: '0',
      width: '100vw', height: '100vh',
      pointerEvents: 'none', zIndex: '9999'
    });
    document.body.appendChild(this.canvas);
    this.resize();

    window.addEventListener('resize', () => this.resize());
    
    window.addEventListener('mousemove', (e) => {
      const now = performance.now();
      if (now - this.lastMsgTime > 40) { 
        this.createFlake(e.clientX, e.clientY, true);
        this.lastMsgTime = now;
      }
    });

    this.bus.onmessage = (msg) => {
      if (msg.data.sourceId === this.id) return;
      this.receive(msg.data);
    };

    this.update();
  },

  /**
   * Resizes the canvas to match the current window dimensions.
   */
  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  },

  /**
   * Creates a new snowflake at the specified position with physics properties.
   * If this is the originating instance, broadcasts the flake data to other tabs.
   *
   * @param {number} x - X coordinate of the snowflake
   * @param {number} y - Y coordinate of the snowflake
   * @param {boolean} isOriginator - Whether this instance created the flake
   * @param {Object} [remotePhysics] - Physics data from remote instance (optional)
   */
  createFlake(x, y, isOriginator, remotePhysics = null) {
    if (this.flakes.length > 60) return;

    const physics = remotePhysics || {
      vx: (Math.random() - 0.5) * 1,
      vy: Math.random() * 3 + 4,
      swayOffset: Math.random() * 10,
      size: 16
    };

    if (isOriginator) {
      this.bus.postMessage({ 
        sourceId: this.id,
        gx: x + window.screenX, 
        gy: y + window.screenY,
        physics 
      });
    }

    this.flakes.push({
      x, y,
      ...physics,
      opacity: 1,
      life: 180
    });
  },

  /**
   * Processes incoming snowflake data from other browser tabs/windows.
   * Converts global coordinates to local coordinates and creates the flake.
   *
   * @param {Object} data - Message data containing flake information
   * @param {number} data.gx - Global X coordinate
   * @param {number} data.gy - Global Y coordinate
   * @param {Object} data.physics - Physics properties of the flake
   */
  receive(data) {
    const lx = data.gx - window.screenX;
    const ly = data.gy - window.screenY;

    if (ly > window.innerHeight) return;

    this.createFlake(lx, ly, false, data.physics);
  },

  /**
   * Main animation loop that updates and renders all snowflakes.
   * Handles physics simulation, cleanup, and rendering with fade effects.
   */
  update() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    this.ctx.font = '16px serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';

    const now = performance.now();

    for (let i = this.flakes.length - 1; i >= 0; i--) {
      const f = this.flakes[i];
      
      f.x += f.vx + Math.sin(now / 300 + f.swayOffset) * 0.8;
      f.y += f.vy;
      f.life--;

      if (f.life <= 0 || f.y > window.innerHeight + 50) {
        this.flakes.splice(i, 1);
        continue;
      }

      if (f.y > -20 && f.x > -20 && f.x < this.canvas.width + 20) {
        this.ctx.globalAlpha = f.life < 40 ? f.life / 40 : 1;
        this.ctx.fillText('❄️', f.x, f.y);
      }
    }

    requestAnimationFrame(() => this.update());
  }
};

Blizzard.init();