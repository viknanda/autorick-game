/* ==========================================
   AutoRick Tour of India - Game Logic
   ========================================== */

// 1. Game Setup & Constants
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

// Image Loader for Mumbai Skyline Parallax Background
const bgImage = new Image();
bgImage.src = 'assets/mumbai_street_bg.jpg';
let bgImageLoaded = false;
bgImage.onload = () => {
  bgImageLoaded = true;
};

// Virtual Resolution (logical coordinates scaled to screen)
const GAME_WIDTH = 400;
const GAME_HEIGHT = 700;

// 3D Perspective Projection Constants
const HORIZON_Y = 325; // Height of sky/horizon line (lowered to flatten perspective to street level)
const PLAYER_Y = 540;   // Base logical Y of the player vehicle
const CAMERA_Z = 420;   // Focal length constant (massive zoom-in focal length)
const ROAD_CENTER_X = GAME_WIDTH / 2; // Road center X

// Game State
const state = {
  screen: 'start', // 'start', 'playing', 'how-to', 'gameover'
  city: 'mumbai', // chosen city route ('mumbai', 'delhi', 'bangalore', 'chennai', 'kolkata')
  cameraMode: 'zoomed', // 'zoomed' (3D follow) or 'windshield' (first-person)
  score: 0,
  distance: 0, // in meters
  level: 1,
  speed: 0, // current speed in pixels/frame
  maxSpeed: 8,
  targetSpeed: 0,
  baseRoadSpeed: 2,
  health: 100,
  maxHealth: 100,
  activeShield: 0, // remaining shield frames
  activeShieldMax: 300, // 5 seconds at 60fps
  keys: {},
  lastTime: 0,
  shakeIntensity: 0,
  yellTimer: 0, // timer for driver yell bubble when colliding
  passenger: null, // current active passenger object
  destination: null, // active destination zone object
  highScore: localStorage.getItem('autorick_highscore') || 0
};

// Road configuration
const ROAD = {
  leftBorder: 20,
  rightBorder: 380,
  width: 360,
  lanes: [80, 200, 320], // X-coordinate of center of each lane (widened to match bigger road)
  speed: 0
};

// Keyboard Listeners
window.addEventListener('keydown', (e) => {
  state.keys[e.code] = true;
  
  // Escape key to quit to main menu
  if (e.code === 'Escape') {
    e.preventDefault();
    quitToMainMenu();
  }
  
  // Space or H to Honk
  if ((e.code === 'Space' || e.code === 'KeyH') && state.screen === 'playing') {
    e.preventDefault();
    gameAudio.playHorn();
    triggerHornEffect();
  }

  // P to pause
  if (e.code === 'KeyP' && state.screen === 'playing') {
    // Basic pause toggle could go here
  }
});

window.addEventListener('keyup', (e) => {
  state.keys[e.code] = false;
});

// Mobile Controls Button Listeners
let touchSteerLeft = false;
let touchSteerRight = false;

const leftPad = document.getElementById('left-pad');
const rightPad = document.getElementById('right-pad');
const hornPad = document.getElementById('horn-pad');

// Add steering event listeners
const setupTouchButton = (btn, startFn, endFn) => {
  btn.addEventListener('mousedown', (e) => { e.preventDefault(); startFn(); });
  btn.addEventListener('mouseup', (e) => { e.preventDefault(); endFn(); });
  btn.addEventListener('touchstart', (e) => { e.preventDefault(); startFn(); });
  btn.addEventListener('touchend', (e) => { e.preventDefault(); endFn(); });
};

setupTouchButton(leftPad, () => touchSteerLeft = true, () => touchSteerLeft = false);
setupTouchButton(rightPad, () => touchSteerRight = true, () => touchSteerRight = false);

// Horn button
const handleHornTouch = (e) => {
  e.preventDefault();
  if (state.screen === 'playing') {
    gameAudio.playHorn();
    triggerHornEffect();
  }
};
hornPad.addEventListener('mousedown', handleHornTouch);
hornPad.addEventListener('touchstart', handleHornTouch);

// Dynamic sizing helper
function resizeCanvas() {
  const container = document.getElementById('game-container');
  const rect = container.getBoundingClientRect();
  
  // Set canvas backing store size to virtual resolution multiplied by device pixel ratio
  const dpr = window.devicePixelRatio || 1;
  canvas.width = GAME_WIDTH * dpr;
  canvas.height = GAME_HEIGHT * dpr;
  
  // Normalize coordinates
  ctx.scale(dpr, dpr);
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// ==========================================
// GAME CLASSES
// ==========================================

// 1. Particle System for Smoke and Sparks
class Particle {
  constructor(x, y, color, size, vx, vy, life, type = 'exhaust') {
    this.x = x;
    this.y = y;
    this.color = color;
    this.size = size;
    this.vx = vx;
    this.vy = vy;
    this.life = life; // Starting transparency/frames remaining
    this.maxLife = life;
    this.type = type; // 'exhaust', 'spark', 'coin'
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.life--;
    if (this.type === 'exhaust') {
      this.size += 0.2; // Smoke expands
    }
  }

  draw(c) {
    c.save();
    c.globalAlpha = this.life / this.maxLife;
    
    // Project particle coordinates into 3D space
    let proj = project(this.x, this.y);
    c.translate(proj.x, proj.y);
    c.scale(proj.scale, proj.scale);
    
    c.fillStyle = this.color;
    c.beginPath();
    if (this.type === 'exhaust') {
      c.arc(0, 0, this.size, 0, Math.PI * 2);
      c.fill();
    } else if (this.type === 'spark') {
      c.rect(-this.size / 2, -this.size / 2, this.size, this.size);
      c.fill();
    } else if (this.type === 'coin') {
      c.arc(0, 0, this.size, 0, Math.PI * 2);
      c.fillStyle = '#FFD54F';
      c.fill();
      c.strokeStyle = '#F57F17';
      c.lineWidth = 1;
      c.stroke();
    }
    c.restore();
  }
}

// 2. Player Auto Rickshaw class (Top-Down Vector Art)
class Rickshaw {
  constructor() {
    this.width = 44;
    this.height = 70;
    this.x = GAME_WIDTH / 2;
    this.y = GAME_HEIGHT - 160;
    this.targetX = this.x;
    this.angle = 0; // Tilting when steering
    this.exhaustTimer = 0;
  }

  update() {
    // 1. Handle Movement Input
    let steerDir = 0;
    if (state.keys['ArrowLeft'] || state.keys['KeyA'] || touchSteerLeft) {
      steerDir = -1;
    }
    if (state.keys['ArrowRight'] || state.keys['KeyD'] || touchSteerRight) {
      steerDir = 1;
    }

    // Smooth movement logic
    const steeringSpeed = 4.5;
    if (steerDir !== 0) {
      this.targetX += steerDir * steeringSpeed;
      // Tilt rickshaw based on direction
      this.angle = steerDir * 0.08;
    } else {
      // Return to straight angle
      this.angle *= 0.8;
    }

    // Keep rickshaw bound inside road borders
    const margin = this.width / 2 + 10;
    this.targetX = Math.max(ROAD.leftBorder + margin, Math.min(ROAD.rightBorder - margin, this.targetX));
    
    // Smooth transition to target position
    this.x += (this.targetX - this.x) * 0.25;

    // 2. Exhaust Particles (Only when driving)
    if (state.speed > 1) {
      this.exhaustTimer++;
      if (this.exhaustTimer % 4 === 0) {
        // Emit smoke from back-left exhaust pipe
        const smokeX = this.x - 12;
        const smokeY = this.y + this.height / 2 - 2;
        particles.push(new Particle(
          smokeX, 
          smokeY, 
          'rgba(180, 180, 180, 0.4)', 
          3, 
          -0.5 + Math.random() * -0.5, 
          1 + Math.random() * 2, 
          25, 
          'exhaust'
        ));
      }
    }
  }

  draw(c) {
    c.save();
    
    // Project position in 3D perspective space
    let proj = project(this.x, this.y);
    const engineVibration = state.speed > 0 ? Math.sin(Date.now() * 0.1) * 0.8 : 0;
    
    c.translate(proj.x + engineVibration * proj.scale, proj.y);
    c.rotate(this.angle);
    c.scale(proj.scale, proj.scale);

    // Apply high-fidelity drop shadow (Better Rendering)
    c.shadowColor = 'rgba(0, 0, 0, 0.4)';
    c.shadowBlur = 10;
    c.shadowOffsetY = 8;

    // --- DRAW RICKSHAW BODY (Top-down view) ---

    // 1. Wheels (Rear Left, Rear Right)
    c.fillStyle = '#222';
    c.fillRect(-22, 14, 6, 16); // Rear left wheel
    c.fillRect(16, 14, 6, 16);  // Rear right wheel

    // Front Wheel fork and single tire
    c.fillRect(-3, -34, 6, 14); // Front tire
    c.fillStyle = '#666';
    c.fillRect(-4, -25, 8, 2);   // Axle

    // 2. Main Chassis (Deep Green Base)
    c.fillStyle = '#2E7D32'; // Indian Rickshaw Green
    c.beginPath();
    c.roundRect(-18, -25, 36, 46, [8, 8, 4, 4]);
    c.fill();

    // Disable drop shadow for interior and roof elements
    c.shadowColor = 'transparent';
    c.shadowBlur = 0;
    c.shadowOffsetY = 0;

    // 3. Passenger Seats / Interior (Black / Tan)
    c.fillStyle = '#4E342E';
    c.fillRect(-15, 6, 30, 10); // Back passenger seat
    c.fillStyle = '#3E2723';
    c.fillRect(-10, -10, 20, 8); // Driver seat
    
    // 4. Rear Engine Deck
    c.fillStyle = '#1B5E20';
    c.fillRect(-16, 16, 32, 6);

    // Prominent MH License Plate (Always visible in 3D follow camera)
    c.fillStyle = '#FFEB3B'; // Bright yellow plate
    c.fillRect(-10, 17, 20, 5);
    c.strokeStyle = '#000';
    c.lineWidth = 0.5;
    c.strokeRect(-10, 17, 20, 5);
    c.fillStyle = '#000';
    c.font = 'bold 3.5px sans-serif';
    c.textAlign = 'center';
    c.fillText('MH 02 AA 7777', 0, 21);

    // 5. Yellow Roof Cover (Vibrant Yellow)
    c.fillStyle = '#FFD54F'; 
    c.beginPath();
    c.roundRect(-17, -23, 34, 37, [10, 10, 4, 4]);
    c.fill();

    // Fabric folds on the roof (visual detail)
    c.strokeStyle = '#F57F17';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(-17, -10); c.lineTo(17, -10);
    c.moveTo(-17, 4); c.lineTo(17, 4);
    c.stroke();

    // 6. Windshield / Front Nose (Yellow tapering front)
    c.fillStyle = '#FFD54F';
    c.beginPath();
    c.moveTo(-17, -23);
    c.lineTo(17, -23);
    c.lineTo(10, -32);
    c.lineTo(-10, -32);
    c.closePath();
    c.fill();

    // Glass windshield (Teal glossy look)
    c.fillStyle = '#E0F7FA';
    c.beginPath();
    c.moveTo(-14, -24);
    c.lineTo(14, -24);
    c.lineTo(8, -30);
    c.lineTo(-8, -30);
    c.closePath();
    c.fill();
    
    c.fillStyle = '#FFFFFF';
    c.globalAlpha = 0.5;
    c.beginPath();
    c.moveTo(-12, -25);
    c.lineTo(-2, -29);
    c.lineTo(-4, -29);
    c.lineTo(-14, -25);
    c.closePath();
    c.fill();
    c.globalAlpha = 1.0;

    // 7. Chrome Side Mirrors
    c.fillStyle = '#B0BEC5';
    c.fillRect(-22, -26, 4, 2); // Left mirror stem
    c.fillRect(18, -26, 4, 2);  // Right mirror stem
    c.fillStyle = '#ECEFF1';
    c.fillRect(-24, -29, 3, 5); // Left mirror
    c.fillRect(21, -29, 3, 5);  // Right mirror

    // 8. Marigold Garland Decoration on Nose (Classic Indian Touch)
    c.fillStyle = '#FF9900';
    for (let i = -8; i <= 8; i += 4) {
      c.beginPath();
      c.arc(i, -32, 2.5, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = i % 8 === 0 ? '#FFCC00' : '#FF9900';
    }

    // 9. Active Shield Effect (Chai Invincibility Glowing Ring)
    if (state.activeShield > 0) {
      c.strokeStyle = `rgba(0, 229, 255, ${0.4 + Math.sin(Date.now() * 0.02) * 0.3})`;
      c.lineWidth = 4;
      c.beginPath();
      c.arc(0, -4, 38, 0, Math.PI * 2);
      c.stroke();

      // Small sparks circulating
      c.fillStyle = '#00E5FF';
      const angle = (Date.now() * 0.01) % (Math.PI * 2);
      c.beginPath();
      c.arc(Math.cos(angle) * 38, Math.sin(angle) * 38, 3, 0, Math.PI * 2);
      c.fill();
    }

    c.restore();
  }

  // Bounding box for collisions
  getBounds() {
    return {
      left: this.x - this.width / 2 + 2,
      right: this.x + this.width / 2 - 2,
      top: this.y - this.height / 2 + 5,
      bottom: this.y + this.height / 2 - 5
    };
  }
}

// 3. Traffic Vehicle & Cow Obstacles Class
class Obstacle {
  constructor(lane, type) {
    this.lane = lane;
    this.type = type; // 'cow', 'truck', 'taxi', 'pothole', 'bicycle', 'dog'
    this.x = ROAD.lanes[lane];
    this.y = -100; // Start offscreen

    // Set properties based on type
    switch (type) {
      case 'cow':
        this.width = 55;
        this.height = 50;
        this.speed = 0; // Cows do not move!
        this.damage = 15;
        break;
      case 'truck':
        this.width = 48;
        this.height = 95;
        this.speed = 1.8 + Math.random() * 1.5; // Slow-moving heavy trucks
        this.damage = 30;
        this.color = ['#D32F2F', '#1976D2', '#F57C00'][Math.floor(Math.random() * 3)];
        break;
      case 'taxi':
        this.width = 42;
        this.height = 68;
        this.speed = 3.0 + Math.random() * 2.5; // Faster taxis
        this.damage = 20;
        break;
      case 'pothole':
        this.width = 38;
        this.height = 25;
        this.speed = 0; // Ground surface pothole
        this.damage = 8;
        break;
      case 'bicycle':
        this.width = 28;
        this.height = 60;
        this.speed = 1.2 + Math.random() * 0.8; // Very slow local bicycle delivery
        this.damage = 10;
        break;
      case 'dog':
        this.width = 32;
        this.height = 44;
        this.speed = 0.4 + Math.random() * 0.4; // Very slow stray dog walking on lane
        this.damage = 8;
        break;
    }
  }

  update() {
    // Move obstacle relative to road speed (which is controlled by player speed)
    // If obstacle speed is > 0, it also moves forward on the road
    this.y += state.speed - this.speed;
  }

  draw(c) {
    c.save();
    
    // Project position in 3D perspective space
    let proj = project(this.x, this.y);
    c.translate(proj.x, proj.y);
    c.scale(proj.scale, proj.scale);

    // Apply high-fidelity drop shadows (Better Rendering)
    c.shadowColor = 'rgba(0, 0, 0, 0.35)';
    c.shadowBlur = 8;
    c.shadowOffsetY = 6;

    if (this.type === 'cow') {
      // --- DRAW COW (Rear-Quarter 3D standing profile) ---
      // Four standing legs extending down to meet the road
      c.fillStyle = '#C7B198'; // Leg color (dirty beige/brown)
      c.fillRect(-12, 10, 5, 20); // Rear Left
      c.fillRect(7, 10, 5, 20);   // Rear Right
      c.fillRect(-18, 2, 5, 18);  // Front Left
      c.fillRect(-2, 2, 5, 18);   // Front Right
      
      c.fillStyle = '#3E2723'; // Black/dark hooves
      c.fillRect(-12, 28, 5, 3);
      c.fillRect(7, 28, 5, 3);
      c.fillRect(-18, 18, 5, 3);
      c.fillRect(-2, 18, 5, 3);

      // 1. Rump/Rear (large circular buttock volume)
      c.fillStyle = '#EFEBE9'; // Off-white cow skin
      c.beginPath();
      c.ellipse(2, 6, 17, 15, 0, 0, Math.PI * 2);
      c.fill();
      
      // 2. Shoulder/Front body (slightly smaller oval shifted left & up)
      c.beginPath();
      c.ellipse(-7, -4, 15, 13, 0, 0, Math.PI * 2);
      c.fill();

      // Disable shadow for details
      c.shadowColor = 'transparent';
      c.shadowBlur = 0;
      c.shadowOffsetY = 0;

      // Spots (black patches draped across rear and back)
      c.fillStyle = '#3E2723';
      c.beginPath();
      c.ellipse(6, 4, 10, 8, Math.PI/4, 0, Math.PI * 2);
      c.ellipse(-7, -8, 8, 6, -Math.PI/6, 0, Math.PI * 2);
      c.ellipse(-1, 10, 6, 5, 0, 0, Math.PI * 2);
      c.fill();

      // 3. Head & Neck (looking slightly left/forward)
      c.fillStyle = '#EFEBE9';
      c.beginPath();
      c.ellipse(-14, -14, 9, 8, 0, 0, Math.PI * 2);
      c.fill();
      
      // Snout (pink muzzle facing left)
      c.fillStyle = '#FFCDD2';
      c.beginPath();
      c.ellipse(-18, -16, 6, 5, Math.PI/6, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#8C7B7A'; // nostrils
      c.beginPath(); c.arc(-19, -17, 1, 0, Math.PI*2); c.arc(-17, -15, 1, 0, Math.PI*2); c.fill();

      // Garland marigold collar around neck (between head and shoulder)
      c.fillStyle = '#FF9800'; // Orange marigolds
      c.beginPath();
      c.arc(-11, -8, 3.5, 0, Math.PI * 2);
      c.arc(-7, -10, 3.5, 0, Math.PI * 2);
      c.arc(-13, -12, 3.5, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#FFEB3B'; // Yellow marigolds
      c.beginPath();
      c.arc(-9, -9, 3, 0, Math.PI * 2);
      c.arc(-11, -11, 3, 0, Math.PI * 2);
      c.fill();

      // Horns curving up from head
      c.strokeStyle = '#FFFFFF';
      c.lineWidth = 3.5;
      c.beginPath();
      c.arc(-11, -18, 6, Math.PI, Math.PI * 1.6);
      c.stroke();
      c.beginPath();
      c.arc(-7, -18, 6, Math.PI * 1.4, 0);
      c.stroke();

      // Ears (draped down)
      c.fillStyle = '#EFEBE9';
      c.beginPath();
      c.ellipse(-16, -11, 3, 6, -Math.PI / 3, 0, Math.PI * 2);
      c.ellipse(-10, -11, 3, 6, Math.PI / 3, 0, Math.PI * 2);
      c.fill();

      // 4. Tail (hanging down from the rump and swaying slightly)
      c.strokeStyle = '#EFEBE9';
      c.lineWidth = 2.5;
      c.beginPath();
      c.moveTo(8, 8);
      c.quadraticCurveTo(13, 18, 11, 25);
      c.stroke();
      // Black tail tuft
      c.fillStyle = '#3E2723';
      c.beginPath();
      c.ellipse(11, 26, 2.5, 4, 0, 0, Math.PI * 2);
      c.fill();

    } else if (this.type === 'truck') {
      // --- DRAW TRUCK ("HORN OK PLEASE") ---
      c.fillStyle = '#222';
      c.fillRect(-25, -34, 4, 15); // Tires
      c.fillRect(21, -34, 4, 15);
      c.fillRect(-25, 20, 5, 18);
      c.fillRect(20, 20, 5, 18);

      // Cabin (Vibrant Saffron/Red/Blue)
      c.fillStyle = this.color;
      c.beginPath();
      c.roundRect(-22, -45, 44, 30, [4, 4, 0, 0]);
      c.fill();

      // Windshield
      c.fillStyle = '#37474F';
      c.fillRect(-18, -41, 36, 6);

      // Cargo Bed (Red Painted wood frame + Yellow inner panel for text contrast)
      c.fillStyle = '#D32F2F'; // Traditional red wood frame
      c.fillRect(-23, -15, 46, 60);
      c.fillStyle = '#FFEB3B'; // Bright yellow inner panel
      c.fillRect(-20, -12, 40, 54);

      // Disable shadow for fine details
      c.shadowColor = 'transparent';
      c.shadowBlur = 0;
      c.shadowOffsetY = 0;


      // "HORN OK PLEASE" painted directly in large bold black letters on the truck's rear wood panel (cargo back wall)
      c.fillStyle = '#000000'; // Solid black paint
      c.font = 'bold 8.5px var(--font-family)';
      c.textAlign = 'center';
      c.fillText('HORN', 0, 1);
      c.fillText('OK', 0, 13);
      c.fillText('PLEASE', 0, 25);
      
      // Bottom warning banner on the rear bumper (yellow/black diagonal hazard stripes)
      c.fillStyle = '#FFFF00';
      c.fillRect(-22, 43, 44, 10);
      c.strokeStyle = '#222';
      c.lineWidth = 1;
      c.strokeRect(-22, 43, 44, 10);
      c.strokeStyle = '#000000';
      c.lineWidth = 2.5;
      for (let sx = -18; sx <= 22; sx += 8) {
        c.beginPath();
        c.moveTo(sx - 3, 43);
        c.lineTo(sx + 3, 53);
        c.stroke();
      }

      // Yellow license plate (Detail)
      c.fillStyle = '#FFEB3B';
      c.fillRect(-10, 36, 20, 5);
      c.strokeStyle = '#000';
      c.lineWidth = 0.5;
      c.strokeRect(-10, 36, 20, 5);
      c.fillStyle = '#000';
      c.font = 'bold 3.5px sans-serif';
      c.fillText('MH 02 BG 4821', 0, 40);

    } else if (this.type === 'taxi') {
      // --- DRAW PREMIER PADMINI TAXI ---
      c.fillStyle = '#222';
      c.fillRect(-21, -22, 3, 12);
      c.fillRect(18, -22, 3, 12);
      c.fillRect(-21, 12, 3, 12);
      c.fillRect(18, 12, 3, 12);

      // Black Hood & Trunk, Yellow Cabin Roof (Typical Mumbai/Kolkata Taxi)
      c.fillStyle = '#111111'; // Black body
      c.beginPath();
      c.roundRect(-19, -26, 38, 52, 6);
      c.fill();

      // Disable shadow for fine details
      c.shadowColor = 'transparent';
      c.shadowBlur = 0;
      c.shadowOffsetY = 0;

      c.fillStyle = '#FFCC00'; // Yellow roof
      c.beginPath();
      c.roundRect(-16, -14, 32, 28, 4);
      c.fill();

      // Windows
      c.fillStyle = '#37474F';
      c.fillRect(-13, -11, 26, 5); // Front wind
      c.fillRect(-13, 5, 26, 5);   // Rear wind
      c.fillRect(-14, -4, 2, 8);   // Left side
      c.fillRect(12, -4, 2, 8);    // Right side

      // Yellow license plate (Detail)
      c.fillStyle = '#FFEB3B';
      c.fillRect(-9, 18, 18, 5);
      c.strokeStyle = '#000';
      c.lineWidth = 0.5;
      c.strokeRect(-9, 18, 18, 5);
      c.fillStyle = '#000';
      c.font = 'bold 3.5px sans-serif';
      c.fillText('MH 03 A 8829', 0, 22);

    } else if (this.type === 'pothole') {
      // Disable shadow immediately for potholes
      c.shadowColor = 'transparent';
      c.shadowBlur = 0;
      c.shadowOffsetY = 0;

      // --- DRAW POTHOLE (Road surface crater) ---
      c.fillStyle = '#1C2833'; // Deep crack center
      c.beginPath();
      c.ellipse(0, 0, 19, 12, 0, 0, Math.PI * 2);
      c.fill();

      // Outer rim
      c.strokeStyle = '#34495E';
      c.lineWidth = 2;
      c.stroke();

      // Cracks extending outwards
      c.strokeStyle = '#273746';
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(-19, 0); c.lineTo(-27, -2);
      c.moveTo(19, 0); c.lineTo(26, 4);
      c.moveTo(0, 12); c.lineTo(2, 20);
      c.moveTo(0, -12); c.lineTo(-4, -18);
      c.stroke();

    } else if (this.type === 'bicycle') {
      // --- DRAW BICYCLE MILK DELIVERY RIDER ---
      // Wheels
      c.fillStyle = '#111';
      c.fillRect(-2, -26, 4, 10); // Front wheel
      c.fillRect(-2, 16, 4, 10);  // Rear wheel
      
      // Frame and handles
      c.strokeStyle = '#546E7A';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(0, -20); c.lineTo(0, 16); // Center bar
      c.moveTo(-10, -18); c.lineTo(10, -18); // Handlebar
      c.stroke();
      
      // Cargo Milk Canisters (Detail)
      c.fillStyle = '#B0BEC5'; // Silver canisters
      c.fillRect(-10, 0, 7, 12);
      c.fillRect(3, 0, 7, 12);
      c.fillStyle = '#37474F'; // Lids
      c.fillRect(-9, -2, 5, 2);
      c.fillRect(4, -2, 5, 2);
      
      // Rider Body (Wearing blue kurta/shirt)
      c.fillStyle = '#1E88E5';
      c.beginPath();
      c.ellipse(0, -5, 8, 12, 0, 0, Math.PI * 2);
      c.fill();

      // Disable shadow for fine details
      c.shadowColor = 'transparent';
      c.shadowBlur = 0;
      c.shadowOffsetY = 0;
      
      // Rider Head
      c.fillStyle = '#FFCC80';
      c.beginPath();
      c.arc(0, -12, 5, 0, Math.PI * 2);
      c.fill();
      // Black hair/cap
      c.fillStyle = '#37474F';
      c.beginPath();
      c.arc(0, -13, 5, Math.PI, 0);
      c.fill();

    } else if (this.type === 'dog') {
      // --- DRAW STRAY DOG (Side/Rear-Quarter Animated Trot Profile) ---
      c.save();
      
      // Animated walking legs (Trot leg cycle!)
      let walkCycle = Math.sin(Date.now() * 0.015);
      c.strokeStyle = '#C68E17'; // Darker gold/tan for legs
      c.lineWidth = 3;
      
      // Left Front leg
      c.beginPath();
      c.moveTo(-6, 2);
      c.lineTo(-9 + walkCycle * 4, 16);
      c.stroke();
      
      // Right Front leg
      c.beginPath();
      c.moveTo(-3, 2);
      c.lineTo(-1 - walkCycle * 4, 16);
      c.stroke();
      
      // Left Rear leg
      c.beginPath();
      c.moveTo(4, 2);
      c.lineTo(2 + walkCycle * 4, 16);
      c.stroke();
      
      // Right Rear leg
      c.beginPath();
      c.moveTo(7, 2);
      c.lineTo(9 - walkCycle * 4, 16);
      c.stroke();

      // Paws (brown pads)
      c.fillStyle = '#5C2E0B';
      c.fillRect(-11 + walkCycle * 4, 14, 4, 2);
      c.fillRect(-3 - walkCycle * 4, 14, 4, 2);
      c.fillRect(1 + walkCycle * 4, 14, 4, 2);
      c.fillRect(7 - walkCycle * 4, 14, 4, 2);

      // Body (Elongated side-profile oval, light tan coat)
      c.fillStyle = '#D2B48C'; // Light tan
      c.beginPath();
      c.ellipse(0, -2, 12, 8, Math.PI / 16, 0, Math.PI * 2);
      c.fill();

      // Disable shadow for fine details
      c.shadowColor = 'transparent';
      c.shadowBlur = 0;
      c.shadowOffsetY = 0;
      
      // Dog patches (Classic stray dog markings)
      c.fillStyle = '#5C2E0B'; // Dark brown patch on back
      c.beginPath();
      c.ellipse(3, -3, 7, 5, Math.PI / 10, 0, Math.PI * 2);
      c.fill();
      
      // Neck & Head (extended forward and up to the left)
      c.fillStyle = '#D2B48C';
      c.beginPath();
      c.ellipse(-10, -10, 7, 7, 0, 0, Math.PI * 2); // Head
      c.fill();
      
      // Pointed upright ears (Pariah dog style)
      c.fillStyle = '#A87C43';
      c.beginPath();
      c.moveTo(-14, -14);
      c.lineTo(-17, -23);
      c.lineTo(-11, -16);
      c.closePath();
      c.fill();
      c.beginPath();
      c.moveTo(-7, -14);
      c.lineTo(-8, -23);
      c.lineTo(-5, -16);
      c.closePath();
      c.fill();
      
      // Snout/Muzzle extending forward/left
      c.fillStyle = '#8B5A2B';
      c.fillRect(-16, -11, 6, 4);
      c.fillStyle = '#111'; // Black nose
      c.fillRect(-17, -11, 2, 2.5);
      
      // Wagging curly tail pointing up
      c.save();
      c.translate(10, -6);
      let tailWag = Math.sin(Date.now() * 0.22) * 0.4;
      c.rotate(tailWag);
      c.strokeStyle = '#D2B48C';
      c.lineWidth = 3.5;
      c.beginPath();
      c.arc(0, 0, 8, Math.PI, Math.PI * 1.7); // Curving tail up
      c.stroke();
      c.restore();
      
      c.restore();
    }

    c.restore();
  }

  getBounds() {
    return {
      left: this.x - this.width / 2,
      right: this.x + this.width / 2,
      top: this.y - this.height / 2,
      bottom: this.y + this.height / 2
    };
  }
}

// 4. Collectibles Class (Coins, Samosa, Chai)
class Collectible {
  constructor(lane, type) {
    this.lane = lane;
    this.type = type; // 'coin', 'samosa', 'chai'
    this.x = ROAD.lanes[lane];
    this.y = -50;
    this.width = 24;
    this.height = 24;
    this.angle = 0; // Rotate shine effect
  }

  update() {
    this.y += state.speed;
    this.angle += 0.05;
  }

  draw(c) {
    c.save();
    
    // Project position in 3D perspective space
    let proj = project(this.x, this.y);
    c.translate(proj.x, proj.y);
    c.scale(proj.scale, proj.scale);

    if (this.type === 'coin') {
      // --- GOLD COIN (Rupee symbol) ---
      c.rotate(this.angle);

      // Gold core
      const coinGrad = c.createRadialGradient(-3, -3, 2, 0, 0, 12);
      coinGrad.addColorStop(0, '#FFE082');
      coinGrad.addColorStop(0.8, '#FFC107');
      coinGrad.addColorStop(1, '#FF8F00');
      
      c.fillStyle = coinGrad;
      c.beginPath();
      c.arc(0, 0, 12, 0, Math.PI * 2);
      c.fill();

      c.strokeStyle = '#FFE082';
      c.lineWidth = 1.5;
      c.stroke();

      // Rupee Symbol Text
      c.rotate(-this.angle); // Keep text straight
      c.fillStyle = '#5D4037';
      c.font = 'black 11px var(--font-family)';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('₹', 0, 0.5);

    } else if (this.type === 'samosa') {
      // --- SAMOSA (Golden Triangle) ---
      c.shadowColor = 'rgba(0,0,0,0.3)';
      c.shadowBlur = 4;
      c.shadowOffsetY = 2;

      c.fillStyle = '#E65100'; // Outer crispy brown
      c.beginPath();
      c.moveTo(0, -12);
      c.lineTo(12, 10);
      c.lineTo(-12, 10);
      c.closePath();
      c.fill();

      c.fillStyle = '#FB8C00'; // Inner golden highlight
      c.beginPath();
      c.moveTo(0, -9);
      c.lineTo(9, 8);
      c.lineTo(-9, 8);
      c.closePath();
      c.fill();

      // Samosa texture folds
      c.strokeStyle = '#D84315';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(-2, 0); c.lineTo(2, 6);
      c.stroke();

    } else if (this.type === 'chai') {
      // --- CUTTING CHAI (Glass of tea) ---
      // Steel Holder/Saucer
      c.fillStyle = '#B0BEC5';
      c.fillRect(-8, 8, 16, 3);
      
      // Glass body
      c.fillStyle = 'rgba(255, 255, 255, 0.4)';
      c.beginPath();
      c.moveTo(-6, -10);
      c.lineTo(6, -10);
      c.lineTo(4, 8);
      c.lineTo(-4, 8);
      c.closePath();
      c.fill();

      // Brown tea inside glass
      c.fillStyle = '#8D6E63'; // Milk Tea color
      c.beginPath();
      c.moveTo(-5.5, -4);
      c.lineTo(5.5, -4);
      c.lineTo(4, 7);
      c.lineTo(-4, 7);
      c.closePath();
      c.fill();

      // Steaming Chai effect (small wave paths)
      c.strokeStyle = 'rgba(255, 255, 255, 0.6)';
      c.lineWidth = 1.5;
      const steamOffset = Math.sin(Date.now() * 0.01) * 2;
      c.beginPath();
      c.moveTo(-2, -12);
      c.quadraticCurveTo(-4 + steamOffset, -16, -2, -20);
      c.moveTo(2, -12);
      c.quadraticCurveTo(steamOffset, -16, 2, -20);
      c.stroke();
    }

    c.restore();
  }

  getBounds() {
    return {
      left: this.x - this.width / 2,
      right: this.x + this.width / 2,
      top: this.y - this.height / 2,
      bottom: this.y + this.height / 2
    };
  }
}

// 5. Passengers standing on the side of the road
class Passenger {
  constructor() {
    this.side = Math.random() < 0.5 ? 'left' : 'right';
    this.x = this.side === 'left' ? ROAD.leftBorder - 10 : ROAD.rightBorder + 10;
    this.y = -50;
    this.width = 20;
    this.height = 30;
    this.pickedUp = false;
    this.waveTimer = 0;
    
    // Choose a colorful clothes/turban theme
    this.color = ['#E91E63', '#9C27B0', '#3F51B5', '#009688', '#FF9800'][Math.floor(Math.random() * 5)];
    this.hasTurban = Math.random() < 0.6;
  }

  update() {
    if (!this.pickedUp) {
      this.y += state.speed;
      this.waveTimer += 0.15;
    }
  }

  draw(c) {
    if (this.pickedUp) return; // Hide once inside the rickshaw

    c.save();
    
    // Project position in 3D perspective space
    let proj = project(this.x, this.y);
    c.translate(proj.x, proj.y);
    c.scale(proj.scale, proj.scale);

    // Draw passenger (Top-down view)
    // 1. Hands waving
    c.fillStyle = '#FFCC80'; // Skin tone
    const waveY = Math.sin(this.waveTimer) * 4;
    if (this.side === 'left') {
      // Wave towards road (right)
      c.fillRect(6, -6 + waveY, 5, 3);
    } else {
      // Wave towards road (left)
      c.fillRect(-11, -6 + waveY, 5, 3);
    }

    // 2. Shoulders/Shirt
    c.fillStyle = this.color;
    c.beginPath();
    c.ellipse(0, 0, 10, 6, 0, 0, Math.PI * 2);
    c.fill();

    // 3. Head
    c.fillStyle = '#FFCC80';
    c.beginPath();
    c.arc(0, -6, 5, 0, Math.PI * 2);
    c.fill();

    // 4. Colorful Turban (Pugree) - Indian touch!
    if (this.hasTurban) {
      c.fillStyle = '#FFEB3B'; // Bright Yellow Turban
      c.beginPath();
      c.ellipse(0, -8, 6, 4, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#FF9800'; // Layer fold
      c.beginPath();
      c.ellipse(0, -8, 4, 2, 0.2, 0, Math.PI * 2);
      c.fill();
    }

    c.restore();
  }
}

// 6. Destination Zone (Blue highlighted rectangle box)
class DestinationZone {
  constructor() {
    this.lane = Math.floor(Math.random() * 3);
    this.x = ROAD.lanes[this.lane];
    this.y = -200; // Drops from ahead
    this.width = 80;
    this.height = 80;
    
    // Choose a destination tag
    const stations = ["METRO STATION", "RAILWAY STATION", "TAJ BAZAAR", "SPICE MARKET", "MUMBAI CHOWK"];
    this.name = stations[Math.floor(Math.random() * stations.length)];
  }

  update() {
    this.y += state.speed;
  }

  draw(c) {
    c.save();
    
    // Project position in 3D perspective space
    let proj = project(this.x, this.y);
    c.translate(proj.x, proj.y);
    c.scale(proj.scale, proj.scale);

    // Draw transparent glowing blue drop-off box
    c.fillStyle = 'rgba(0, 229, 255, 0.15)';
    c.strokeStyle = '#00E5FF';
    c.lineWidth = 3;
    c.setLineDash([6, 4]); // Dashed lines
    c.beginPath();
    c.roundRect(-this.width / 2, -this.height / 2, this.width, this.height, 8);
    c.fill();
    c.stroke();
    
    // Glowing corners
    c.setLineDash([]);
    c.lineWidth = 4;
    const cornerSize = 12;
    const w = this.width / 2;
    const h = this.height / 2;
    
    // Top-Left corner
    c.beginPath(); c.moveTo(-w, -h + cornerSize); c.lineTo(-w, -h); c.lineTo(-w + cornerSize, -h); c.stroke();
    // Top-Right corner
    c.beginPath(); c.moveTo(w, -h + cornerSize); c.lineTo(w, -h); c.lineTo(w - cornerSize, -h); c.stroke();
    // Bottom-Left corner
    c.beginPath(); c.moveTo(-w, h - cornerSize); c.lineTo(-w, h); c.lineTo(-w + cornerSize, h); c.stroke();
    // Bottom-Right corner
    c.beginPath(); c.moveTo(w, h - cornerSize); c.lineTo(w, h); c.lineTo(w - cornerSize, h); c.stroke();

    // Destination text tag
    c.fillStyle = '#0A1D37';
    c.fillRect(-this.width / 2 + 5, -this.height / 2 - 18, this.width - 10, 15);
    c.strokeStyle = '#00E5FF';
    c.lineWidth = 1;
    c.strokeRect(-this.width / 2 + 5, -this.height / 2 - 18, this.width - 10, 15);
    
    c.fillStyle = '#FFFFFF';
    c.font = 'bold 7px var(--font-family)';
    c.textAlign = 'center';
    c.fillText(this.name, 0, -this.height / 2 - 8);

    c.restore();
  }

  getBounds() {
    return {
      left: this.x - this.width / 2,
      right: this.x + this.width / 2,
      top: this.y - this.height / 2,
      bottom: this.y + this.height / 2
    };
  }
}

// ==========================================
// SCENERY DECORATION OBJECTS (Roadsides)
// ==========================================
class SceneryItem {
  constructor(y = -100) {
    this.side = Math.random() < 0.5 ? 'left' : 'right';
    this.x = this.side === 'left' ? Math.random() * 40 : GAME_WIDTH - Math.random() * 40;
    this.y = y;
    
    // Choose item: 0 = palm tree, 1 = regular bush, 2 = milestone marker, 3 = tea stall,
    // 4 = Xerox stall, 5 = parked scooters, 6 = net fence, 7 = blue tarpaulin cargo, 8 = tall building
    this.type = Math.floor(Math.random() * 9);
    
    if (this.type === 2) {
      // Milestones sit strictly near the road edge
      this.x = this.side === 'left' ? ROAD.leftBorder - 10 : ROAD.rightBorder + 10;
      this.km = Math.floor(100 - state.distance / 100);
    } else if (this.type === 8) {
      // Tall buildings sit on the outer sidewalk edge
      this.x = this.side === 'left' ? ROAD.leftBorder - 22 : ROAD.rightBorder + 22;
    } else if (this.type === 6) {
      // Fences sit right at the curb edge
      this.x = this.side === 'left' ? ROAD.leftBorder - 6 : ROAD.rightBorder + 6;
    } else if (this.type >= 3) {
      // Xerox stalls, tea stalls, parked scooters, tarpaulins sit on the pavement
      this.x = this.side === 'left' ? ROAD.leftBorder - 12 : ROAD.rightBorder + 12;
    } else {
      // Trees and bushes are placed further out
      this.x = this.side === 'left' ? ROAD.leftBorder - Math.random() * 20 - 15 : ROAD.rightBorder + Math.random() * 20 + 15;
    }
  }

  update() {
    this.y += state.speed;
  }

  draw(c) {
    c.save();
    
    // Project position in 3D perspective space
    let proj = project(this.x, this.y);
    c.translate(proj.x, proj.y);
    c.scale(proj.scale, proj.scale);

    if (this.type === 0) {
      // Roadside Shanty (Corrugated iron shack with blue tarp roof)
      // Base poles
      c.strokeStyle = '#5D4037';
      c.lineWidth = 2.5;
      c.beginPath();
      c.moveTo(-15, 15); c.lineTo(-15, -15);
      c.moveTo(15, 15); c.lineTo(15, -15);
      c.stroke();
      
      // Corrugated wall paneling
      c.fillStyle = '#A1887F'; // Weathered wood/iron
      c.fillRect(-14, -14, 28, 29);
      // Vertical panel lines
      c.strokeStyle = '#6D4C41';
      c.lineWidth = 1;
      for (let wx = -10; wx <= 10; wx += 5) {
        c.beginPath(); c.moveTo(wx, -14); c.lineTo(wx, 15); c.stroke();
      }
      
      // Door opening
      c.fillStyle = '#3E2723';
      c.fillRect(-4, -2, 8, 17);
      
      // Blue Plastic Tarpaulin Roof (Typical Indian slum detail)
      c.fillStyle = '#1976D2'; // Bright tarp blue
      c.beginPath();
      c.moveTo(-18, -14);
      c.lineTo(0, -24);
      c.lineTo(18, -14);
      c.lineTo(14, -10);
      c.lineTo(-14, -10);
      c.closePath();
      c.fill();
      
      // Tarp folds/ties
      c.strokeStyle = '#1565C0';
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(-18, -14); c.lineTo(18, -14);
      c.stroke();

    } else if (this.type === 1) {
      // Messy Indian Electricity Utility Pole
      c.strokeStyle = '#90A4AE'; // Concrete pole grey
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(0, 15); c.lineTo(0, -45); // Tall vertical pole
      c.stroke();
      
      // Cross-bars at the top
      c.strokeStyle = '#5D4037';
      c.lineWidth = 2.5;
      c.beginPath();
      c.moveTo(-14, -38); c.lineTo(14, -38);
      c.moveTo(-10, -42); c.lineTo(10, -42);
      c.stroke();
      
      // Glass insulators (tiny green dots)
      c.fillStyle = '#00B0FF';
      c.fillRect(-12, -40, 2, 2);
      c.fillRect(10, -40, 2, 2);
      c.fillRect(-8, -44, 2, 2);
      c.fillRect(6, -44, 2, 2);
      
      // Messy loop wires extending off-screen (Typical Indian streetscape detail)
      c.strokeStyle = '#212121';
      c.lineWidth = 0.5;
      c.beginPath();
      // Draping wire loops hanging down and going off-side
      c.moveTo(-12, -38);
      c.bezierCurveTo(-30, -25, -60, -20, -120, -30);
      c.moveTo(10, -38);
      c.bezierCurveTo(30, -25, 60, -20, 120, -30);
      
      // Secondary low loops
      c.moveTo(-8, -42);
      c.bezierCurveTo(-20, -35, -45, -30, -90, -40);
      c.moveTo(6, -42);
      c.bezierCurveTo(20, -35, 45, -30, 90, -40);
      c.stroke();

    } else if (this.type === 2) {
      // Indian Milestone Marker (Yellow top, white bottom)
      c.fillStyle = '#EEEEEE'; // White bottom
      c.fillRect(-6, -8, 12, 16);
      c.fillStyle = '#FFCC00'; // Yellow top
      c.beginPath();
      c.arc(0, -8, 6, Math.PI, 0);
      c.fill();
      c.fillRect(-6, -8, 12, 2);

      // Milestone text (KM count)
      c.fillStyle = '#333333';
      c.font = 'bold 5px var(--font-family)';
      c.textAlign = 'center';
      c.fillText('AGRA', 0, -4);
      c.font = 'bold 6px var(--font-family)';
      c.fillText(Math.max(1, this.km) + ' K', 0, 4);

    } else if (this.type === 3) {
      // Roadside tea stall (Dhabha) table
      c.fillStyle = '#A0522D';
      c.fillRect(-15, -10, 30, 20); // Wooden structure
      c.fillStyle = '#FFE4C4';
      c.fillRect(-12, -7, 24, 14); // Counter top

      c.fillStyle = '#555';
      c.beginPath(); c.arc(-6, -2, 2.5, 0, Math.PI * 2); c.fill(); // Kettle
      
      // Small fire/stove under kettle (Detail)
      c.fillStyle = '#FF7043';
      c.beginPath(); c.arc(-6, 1.5, 1.5, 0, Math.PI * 2); c.fill();
      
      // Cyan tea glasses (Detail)
      c.fillStyle = 'rgba(0, 188, 212, 0.6)';
      c.fillRect(2, -4, 2, 3.5);
      c.fillRect(6, -4, 2, 3.5);
      
      // "CHAI" sign board (Detail)
      c.fillStyle = '#FF9800';
      c.fillRect(-14, -18, 12, 6);
      c.strokeStyle = '#E65100';
      c.strokeRect(-14, -18, 12, 6);
      c.fillStyle = '#FFF';
      c.font = 'bold 3px sans-serif';
      c.fillText('CHAI ☕', -8, -13);
      
    } else if (this.type === 4) {
      // Xerox & A-1 Aliza Fast Food Corner Stall
      c.fillStyle = '#4E342E'; // Dark brown base/frame
      c.fillRect(-18, -25, 36, 45);
      
      // Roller Shutter (closed shop front, light grey with horizontal slots)
      c.fillStyle = '#78909C';
      c.fillRect(-15, -15, 30, 35);
      c.strokeStyle = '#37474F';
      c.lineWidth = 0.8;
      for (let sy = -12; sy <= 18; sy += 3) {
        c.beginPath();
        c.moveTo(-15, sy);
        c.lineTo(15, sy);
        c.stroke();
      }
      
      // Xerox Signboard (Top)
      c.fillStyle = '#FFF';
      c.fillRect(-16, -24, 32, 8);
      c.strokeStyle = '#0288D1';
      c.lineWidth = 1;
      c.strokeRect(-16, -24, 32, 8);
      
      c.fillStyle = '#01579B';
      c.font = 'bold 5px sans-serif';
      c.textAlign = 'center';
      c.fillText('XEROX', 0, -18);
      
      // Fast Food Signboard
      c.fillStyle = '#C62828'; // Red background
      c.fillRect(-14, -14, 28, 5);
      c.fillStyle = '#FDD835'; // Yellow text
      c.font = 'bold 3px sans-serif';
      c.fillText('A-1 ALIZA FAST FOOD', 0, -10);

      // Awning (Detail: Striped fabric awning)
      c.fillStyle = '#EF5350';
      c.fillRect(-18, -16, 36, 3);
      c.fillStyle = '#FFEB3B';
      for (let ax = -16; ax <= 16; ax += 8) {
        c.fillRect(ax - 2, -16, 4, 3);
      }
      
      // Hanging light bulb (Detail)
      c.strokeStyle = '#222';
      c.beginPath(); c.moveTo(0, -13); c.lineTo(0, -9); c.stroke();
      c.fillStyle = '#FFF59D'; // Glowing yellow bulb
      c.beginPath(); c.arc(0, -8, 2, 0, Math.PI * 2); c.fill();

    } else if (this.type === 5) {
      // Parked Scooters from Andheri Street scene
      // 1. White Scooter in the back
      c.save();
      c.translate(4, 5); // offset to back right
      c.scale(0.85, 0.85);
      // Wheels
      c.fillStyle = '#212121';
      c.beginPath(); c.arc(-10, 8, 4, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(10, 8, 4, 0, Math.PI * 2); c.fill();
      // Scooter Body
      c.fillStyle = '#ECEFF1'; // White metal
      c.beginPath();
      c.moveTo(-12, 6);
      c.quadraticCurveTo(0, -6, 12, 6);
      c.lineTo(8, -2);
      c.lineTo(-8, -2);
      c.closePath();
      c.fill();
      // Handlebar/Front cowl
      c.fillRect(-10, -8, 4, 12);
      c.fillStyle = '#37474F'; // Black seat
      c.fillRect(-6, -3, 13, 4);
      
      // White Scooter Mirrors (Detail)
      c.fillStyle = '#CFD8DC';
      c.beginPath(); c.arc(-10, -9, 1.5, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(-6, -9, 1.5, 0, Math.PI * 2); c.fill();
      
      // White Scooter License Plate (Detail)
      c.fillStyle = '#FFF';
      c.fillRect(8, 0, 4, 6);
      c.fillStyle = '#000';
      c.font = '2px sans-serif';
      c.fillText('MH', 10, 4);
      c.restore();

      // 2. Red Scooter in foreground
      c.save();
      c.translate(-6, 12); // foreground offset
      // Wheels
      c.fillStyle = '#212121';
      c.beginPath(); c.arc(-11, 8, 5, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(11, 8, 5, 0, Math.PI * 2); c.fill();
      // Red Body
      c.fillStyle = '#D32F2F'; // Rich red
      c.beginPath();
      c.moveTo(-13, 6);
      c.quadraticCurveTo(0, -7, 13, 6);
      c.lineTo(9, -2);
      c.lineTo(-9, -2);
      c.closePath();
      c.fill();
      // Handlebar / Front shield
      c.fillRect(-11, -9, 4, 13);
      // Tan seat (matches red scooter saddle in photo)
      c.fillStyle = '#D84315'; // Dark orange/saddle tan
      c.fillRect(-7, -3, 14, 5);
      
      // Red Scooter Mirrors (Detail)
      c.fillStyle = '#E53935';
      c.beginPath(); c.arc(-11, -10, 1.8, 0, Math.PI * 2); c.fill();
      
      // Kickstand leaning down (Detail)
      c.strokeStyle = '#222';
      c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(-2, 8); c.lineTo(-6, 13); c.stroke();
      
      // Yellow license plate (Detail)
      c.fillStyle = '#FFEB3B';
      c.fillRect(9, -1, 4, 7);
      c.fillStyle = '#000';
      c.font = '2px sans-serif';
      c.fillText('MH', 11, 3);
      c.restore();

    } else if (this.type === 6) {
      // Street Light Pole & Advertising Billboard
      // Tall curved metal pole
      c.strokeStyle = '#B0BEC5';
      c.lineWidth = 2.5;
      c.beginPath();
      c.moveTo(this.side === 'left' ? -10 : 10, 15);
      c.quadraticCurveTo(this.side === 'left' ? -10 : 10, -35, 0, -42);
      c.stroke();
      
      // Lamp head pointing down
      c.fillStyle = '#ECEFF1';
      c.fillRect(-4, -44, 8, 3);
      
      // Glowing yellow lamp light cone
      c.fillStyle = 'rgba(255, 235, 59, 0.22)';
      c.beginPath();
      c.moveTo(-4, -41);
      c.lineTo(-18, 15);
      c.lineTo(18, 15);
      c.closePath();
      c.fill();
      
      // Large colorful advertising billboard
      c.save();
      c.translate(this.side === 'left' ? -12 : 12, -15);
      c.fillStyle = '#FDD835'; // Yellow background
      c.fillRect(-14, -10, 28, 20);
      c.strokeStyle = '#FF9800'; // Orange frame
      c.lineWidth = 1.5;
      c.strokeRect(-14, -10, 28, 20);
      
      // Ad text
      c.fillStyle = '#E65100';
      c.font = 'bold 4.5px sans-serif';
      c.textAlign = 'center';
      c.fillText('TEA ☕', 0, -2);
      c.fillStyle = '#C62828';
      c.font = 'bold 3px sans-serif';
      c.fillText('DESI SPECIAL', 0, 4);
      c.restore();

    } else if (this.type === 7) {
      // Roadside cargo covered under a bright blue plastic tarpaulin sheet
      c.fillStyle = '#8D6E63'; // Wood pallets
      c.fillRect(-16, 12, 32, 4);
      c.fillRect(-12, 8, 24, 4);
      
      // Main blue tarpaulin bulk shape
      c.fillStyle = '#1565C0'; // Deep tarpaulin blue
      c.beginPath();
      c.moveTo(-14, 8);
      c.quadraticCurveTo(-15, -4, -6, -8);
      c.quadraticCurveTo(0, -12, 6, -6);
      c.quadraticCurveTo(15, -2, 14, 8);
      c.closePath();
      c.fill();
      
      // Rope bindings tied down
      c.strokeStyle = 'rgba(255, 255, 255, 0.6)';
      c.lineWidth = 0.8;
      
      c.beginPath();
      c.moveTo(-10, -7);
      c.lineTo(-14, 12);
      c.moveTo(0, -10);
      c.lineTo(-4, 12);
      c.moveTo(5, -7);
      c.lineTo(10, 12);
      c.stroke();
      
    } else if (this.type === 8) {
      // Tall Mumbai Apartment building (background layer, enlarged)
      c.save();
      // Select a random bright pastel building color based on coordinates/spawn
      const colors = ['#E57373', '#81C784', '#64B5F6', '#FFB74D', '#BA68C8', '#4DB6AC'];
      c.fillStyle = colors[Math.abs(Date.now() + Math.floor(this.x + this.y)) % colors.length];
      
      let bW = 42;  // Increased from 28
      let bH = 115; // Increased from 75
      c.fillRect(-bW / 2, -bH + 12, bW, bH);
      
      // Rooftop black water tank (Sintex tank style!)
      c.fillStyle = '#111';
      c.fillRect(-8, -bH + 6, 16, 6);
      c.beginPath();
      c.arc(0, -bH + 6, 8, Math.PI, 0);
      c.fill();
      
      // Draw windows & balconies (8 floors)
      c.lineWidth = 1;
      for (let floor = 0; floor < 8; floor++) {
        let wy = -bH + 20 + floor * 11;
        for (let win = -2; win <= 2; win += 2) {
          if (win === 0) continue; // Leaves center space column
          let wx = win * 8;
          // Glass window frame (light on/off)
          c.fillStyle = (Math.floor(this.y + floor + win) % 3 === 0) ? '#FFF9C4' : '#37474F';
          c.fillRect(wx - 3, wy - 3.5, 6, 7);
          c.strokeStyle = '#263238';
          c.strokeRect(wx - 3, wy - 3.5, 6, 7);
          
          // Balcony railing
          c.strokeStyle = '#78909C';
          c.beginPath();
          c.moveTo(wx - 4, wy + 2.5);
          c.lineTo(wx + 4, wy + 2.5);
          c.moveTo(wx - 4, wy + 2.5);
          c.lineTo(wx - 4, wy + 5);
          c.moveTo(wx + 4, wy + 2.5);
          c.lineTo(wx + 4, wy + 5);
          c.stroke();
          
          // Air Conditioner (AC) Unit (Detail)
          if ((floor + win) % 4 === 0) {
            c.fillStyle = '#ECEFF1';
            c.fillRect(wx - 5.5, wy + 3.5, 3.5, 2.5);
            c.strokeStyle = '#B0BEC5';
            c.strokeRect(wx - 5.5, wy + 3.5, 3.5, 2.5);
          }
          
          // Clothes drying line (Detail)
          if (floor === 3 && win === -2) {
            c.strokeStyle = '#CFD8DC';
            c.beginPath(); c.moveTo(wx, wy + 2.5); c.lineTo(wx + 10, wy + 2.5); c.stroke();
            // Tiny colorful clothes hanging
            c.fillStyle = '#FF5252'; c.fillRect(wx + 2, wy + 3, 1.5, 2.5);
            c.fillStyle = '#FFD740'; c.fillRect(wx + 6, wy + 3, 1.5, 2);
          }
        }
      }
      c.restore();
    }

    c.restore();
  }
}

// ==========================================
// GAME INSTANTIATED ENTITIES
// ==========================================
let rickshaw = null;
let obstacles = [];
let collectibles = [];
let scenery = [];
let particles = [];
let nextSpawns = { obstacle: 0, collectible: 0, scenery: 0, passenger: 0 };
let hornEffectFrames = 0; // Visual overlay when player honks

// Initiate all entities for a fresh game
function initEntities() {
  rickshaw = new Rickshaw();
  obstacles = [];
  collectibles = [];
  particles = [];
  scenery = [];
  state.passenger = null;
  state.destination = null;

  // Pre-fill some scenery along the highway
  for (let y = 100; y < GAME_HEIGHT; y += 120) {
    scenery.push(new SceneryItem(y));
  }

  nextSpawns = {
    obstacle: 80,
    collectible: 40,
    scenery: 60,
    passenger: 400 // Drop passenger spawn timer out a bit
  };
}

// ==========================================
// 3D PERSPECTIVE SCROLLING & PROJECTION SYSTEM
// ==========================================
let roadOffset = 0;
const SEGMENT_LENGTH = 30; // Logical length of each road segment

// 3D perspective coordinate translation helper
function project(x, y, h = 0) {
  let z = PLAYER_Y - y;
  
  let camHeight = 205;
  let camZOffset = -35;
  let cameraX = ROAD_CENTER_X;
  
  if (state.cameraMode === 'windshield') {
    camHeight = 145; // Low dashboard line-of-sight perspective
    camZOffset = 15;  // Slightly closer dashboard view
    cameraX = rickshaw ? rickshaw.x : ROAD_CENTER_X;
  } else {
    // Zoomed out 3D follow view
    camHeight = 205;  // Low street-level follow camera (down from 280)
    camZOffset = -35; // Closer behind the rickshaw
    // Track player movements with a bit of elastic lag
    cameraX = ROAD_CENTER_X + (rickshaw ? (rickshaw.x - ROAD_CENTER_X) * 0.35 : 0);
  }
  
  let relativeZ = z - camZOffset;
  let den = relativeZ + CAMERA_Z;
  if (den < 20) den = 20; // Clamp denominator to prevent division by zero or negative scaling
  let scale = CAMERA_Z / den;
  
  let px = ROAD_CENTER_X + (x - cameraX) * scale;
  let py = HORIZON_Y + (camHeight - h) * scale;
  
  return { x: px, y: py, scale: scale };
}

// Distant Horizon backdrop with Dawn Sky gradient and Taj Mahal dome
function drawHorizonBackground(c) {
  // 1. Draw beautiful dusk sky gradient matching each city route
  let skyGrad = c.createLinearGradient(0, 0, 0, HORIZON_Y);
  if (state.city === 'delhi') {
    skyGrad.addColorStop(0, '#D84315'); // Deep burnt sienna
    skyGrad.addColorStop(0.5, '#E65100'); // Sunset orange
    skyGrad.addColorStop(1, '#FFCC80');   // Golden horizon
  } else if (state.city === 'mumbai') {
    skyGrad.addColorStop(0, '#0D47A1'); // Cyber marine blue
    skyGrad.addColorStop(0.6, '#311B92'); // Deep violet
    skyGrad.addColorStop(1, '#FF80AB');   // Neon pink sunset
  } else if (state.city === 'bangalore') {
    skyGrad.addColorStop(0, '#311B92'); // Deep purple
    skyGrad.addColorStop(0.6, '#4A148C'); // Violet
    skyGrad.addColorStop(1, '#E040FB');   // Neon purple horizon
  } else if (state.city === 'chennai') {
    skyGrad.addColorStop(0, '#E65100'); // Tropical orange
    skyGrad.addColorStop(0.5, '#F57C00');
    skyGrad.addColorStop(1, '#FFD54F');   // Bright warm golden
  } else { // kolkata
    skyGrad.addColorStop(0, '#004D40'); // Dark gangetic teal
    skyGrad.addColorStop(0.5, '#006064'); // Cyan dusk
    skyGrad.addColorStop(1, '#80DEEA');   // Cool glowing horizon
  }
  
  c.fillStyle = skyGrad;
  c.fillRect(0, 0, GAME_WIDTH, HORIZON_Y);

  // Parallax camera pan offset based on steering
  let panX = rickshaw ? -(rickshaw.x - GAME_WIDTH / 2) * 0.55 : 0;

  // ====================================================
  // LAYER 1: FAR BACKGROUND SKYLINE (Slowest parallax, 0.25x)
  // ====================================================
  c.save();
  c.translate(panX * 0.25, 0);
  c.fillStyle = 'rgba(25, 34, 38, 0.22)';
  
  // Generic distant city blocks/hills
  c.fillRect(30, HORIZON_Y - 50, 20, 50);
  c.fillRect(55, HORIZON_Y - 70, 16, 70);
  c.fillRect(120, HORIZON_Y - 40, 22, 40);
  c.fillRect(250, HORIZON_Y - 60, 24, 60);
  c.fillRect(320, HORIZON_Y - 45, 18, 45);

  // Draw tiny distant glowing window dots
  c.fillStyle = 'rgba(255, 235, 59, 0.4)';
  c.fillRect(58, HORIZON_Y - 62, 1.5, 1.5);
  c.fillRect(66, HORIZON_Y - 54, 1.5, 1.5);
  c.fillRect(255, HORIZON_Y - 50, 1.5, 1.5);
  c.fillRect(264, HORIZON_Y - 40, 1.5, 1.5);
  c.restore();

  // ====================================================
  // LAYER 2: MID-GROUND LAYER (Moderate parallax, 0.50x)
  // ====================================================
  c.save();
  c.translate(panX * 0.5, 0);
  c.fillStyle = 'rgba(38, 50, 56, 0.48)';
  c.strokeStyle = 'rgba(38, 50, 56, 0.48)';
  c.lineWidth = 1;

  if (state.city === 'delhi') {
    // Delhi Mid-ground: Red Fort secondary battlements and cupolas
    c.fillRect(90, HORIZON_Y - 10, 220, 10);
    // Left and right guard turrets
    c.fillRect(100, HORIZON_Y - 20, 6, 10);
    c.fillRect(300, HORIZON_Y - 20, 6, 10);
    c.beginPath();
    c.arc(103, HORIZON_Y - 20, 3, Math.PI, 0);
    c.arc(303, HORIZON_Y - 20, 3, Math.PI, 0);
    c.fill();

  } else if (state.city === 'mumbai') {
    // Mumbai Mid-ground: Haji Ali Dargah base, Sea Link approach pylons
    // Sea Link Approach arches (left side)
    c.lineWidth = 1;
    for (let ax = 0; ax < 50; ax += 12) {
      c.beginPath();
      c.arc(ax + 6, HORIZON_Y, 5, Math.PI, 0);
      c.stroke();
    }
    // Haji Ali dome building base
    c.fillRect(320, HORIZON_Y - 7, 24, 7);
    c.beginPath();
    c.arc(332, HORIZON_Y - 7, 5, Math.PI, 0);
    c.fill();
    c.fillRect(323, HORIZON_Y - 14, 2, 7); // Minaret

  } else if (state.city === 'bangalore') {
    // Bangalore Mid-ground: Mid-level office blocks, garden foliage
    c.fillRect(80, HORIZON_Y - 28, 25, 28);
    c.fillRect(290, HORIZON_Y - 32, 22, 32);
    // Tree domes representing the garden city
    c.fillStyle = 'rgba(46, 125, 50, 0.4)';
    c.beginPath();
    c.arc(120, HORIZON_Y, 14, Math.PI, 0);
    c.arc(270, HORIZON_Y, 12, Math.PI, 0);
    c.fill();

  } else if (state.city === 'chennai') {
    // Chennai Mid-ground: Valluvar Kottam stone chariot base
    c.save();
    c.translate(250, HORIZON_Y);
    c.fillRect(-18, -12, 36, 12);
    // Wheels of the chariot
    c.beginPath();
    c.arc(-11, -3, 3.5, 0, Math.PI * 2);
    c.arc(11, -3, 3.5, 0, Math.PI * 2);
    c.fill();
    c.restore();

  } else {
    // Kolkata Mid-ground: Victoria Memorial palace block side wings
    c.save();
    c.translate(275, HORIZON_Y);
    c.fillRect(-45, -7, 90, 7); // Extended side wings
    c.fillRect(-38, -12, 10, 5); // Side wing tops
    c.fillRect(28, -12, 10, 5);
    c.restore();
  }
  c.restore();

  // ====================================================
  // LAYER 3: FOREGROUND LANDMARKS (Fastest parallax, 0.75x)
  // ====================================================
  c.save();
  c.translate(panX * 0.75, HORIZON_Y); // Origin is now exactly on the horizon line
  c.scale(1.45, 1.45); // Scale up landmarks significantly for prominence and details!
  
  // Sharp, high-contrast dark silhouette color
  c.fillStyle = 'rgba(21, 26, 30, 0.94)';
  c.strokeStyle = 'rgba(21, 26, 30, 0.94)';
  c.lineWidth = 1.5;

  if (state.city === 'delhi') {
    // 1. Qutub Minar
    c.save();
    c.translate(50, 0);
    c.beginPath();
    c.moveTo(-6, 0);
    c.lineTo(-2.2, -48);
    c.lineTo(2.2, -48);
    c.lineTo(6, 0);
    c.closePath();
    c.fill();
    
    // Tumbbi balconies and rings
    c.fillStyle = '#0D1214';
    c.fillRect(-4.5, -14, 9, 2);
    c.fillRect(-3.3, -28, 6.6, 2);
    c.fillRect(-2.5, -40, 5, 1.5);
    
    // Glowing minar top light (Delhi Cyber Beacon)
    c.fillStyle = '#FF9100';
    c.fillRect(-1, -50, 2, 2);
    c.restore();

    // 2. Red Fort
    c.fillStyle = 'rgba(21, 26, 30, 0.94)';
    c.fillRect(80, -14, 150, 14); // Main wall
    c.fillRect(130, -26, 12, 26);  // Gate Towers
    c.fillRect(178, -26, 12, 26);
    c.beginPath();
    c.arc(136, -26, 6, Math.PI, 0); // Cupola domes
    c.arc(184, -26, 6, Math.PI, 0);
    c.fill();
    
    // Portal Archway cutout
    c.fillStyle = '#0D1214';
    c.beginPath();
    c.ellipse(160, 0, 8, 12, 0, Math.PI, 0);
    c.fill();
    
    // Cyber red/orange spotlights illuminating fort towers
    c.fillStyle = 'rgba(255, 112, 67, 0.85)';
    c.beginPath(); c.arc(136, -26, 1, 0, Math.PI*2); c.fill();
    c.beginPath(); c.arc(184, -26, 1, 0, Math.PI*2); c.fill();

  } else if (state.city === 'mumbai') {
    // 1. Bandra-Worli Sea Link
    c.save();
    c.translate(35, 0);
    c.strokeStyle = 'rgba(21, 26, 30, 0.94)';
    c.lineWidth = 2.5;
    // Inverted-Y main pylon
    c.beginPath();
    c.moveTo(-1, 0); c.lineTo(-1, -44);
    c.moveTo(-1, -44); c.lineTo(-11, 0);
    c.moveTo(-1, -44); c.lineTo(9, 0);
    c.stroke();
    
    // Glowing cyan cyber stay cables (Slope.io wireframe vibe!)
    c.lineWidth = 0.6;
    c.strokeStyle = 'rgba(0, 229, 255, 0.85)'; // Neon cyan cables
    for (let cy = -38; cy < 0; cy += 8) {
      c.beginPath();
      c.moveTo(-1, cy);
      c.lineTo(-25 + (cy + 38) * 0.42, 0);
      c.moveTo(-1, cy);
      c.lineTo(25 - (cy + 38) * 0.42, 0);
      c.stroke();
    }
    
    // Glowing neon red aircraft beacon on top pylon
    c.fillStyle = '#FF1744';
    c.beginPath(); c.arc(-1, -44, 1.5, 0, Math.PI * 2); c.fill();
    c.restore();

    // 2. Gateway of India
    c.save();
    c.translate(160, 0);
    c.fillStyle = 'rgba(21, 26, 30, 0.94)';
    c.fillRect(-22, -26, 44, 26);
    c.fillStyle = '#0D1214'; // Arch cutout
    c.beginPath();
    c.roundRect(-8, -18, 16, 18, [8, 8, 0, 0]);
    c.fill();
    
    c.fillStyle = 'rgba(21, 26, 30, 0.94)';
    c.beginPath();
    c.arc(-18, -26, 4, Math.PI, 0);
    c.arc(18, -26, 4, Math.PI, 0);
    c.fill();
    
    // Golden neon outline lighting on the arch corners
    c.fillStyle = '#FFD54F';
    c.fillRect(-19, -23, 2, 2);
    c.fillRect(17, -23, 2, 2);
    c.restore();

  } else if (state.city === 'bangalore') {
    // 1. Tech Park Skyscrapers (Neon-edge cyber towers)
    c.fillStyle = 'rgba(21, 26, 30, 0.94)';
    c.fillRect(10, -50, 18, 50);
    c.fillRect(240, -58, 22, 58);
    
    // Glowing neon edge stripes (Slope.io style)
    c.strokeStyle = '#00E5FF'; // Cyber cyan
    c.lineWidth = 1;
    c.strokeRect(10, -50, 18, 50);
    c.strokeStyle = '#E040FB'; // Cyber magenta
    c.strokeRect(240, -58, 22, 58);
    
    // Glowing yellow office window patterns
    c.fillStyle = '#FFEB3B';
    c.fillRect(14, -42, 2, 2);
    c.fillRect(22, -30, 2, 2);
    c.fillRect(245, -48, 2, 2);
    c.fillRect(253, -36, 2, 2);

    // 2. Vidhana Soudha
    c.save();
    c.translate(130, 0);
    c.fillStyle = 'rgba(21, 26, 30, 0.94)';
    c.fillRect(-45, -12, 90, 12);
    c.fillRect(-35, -20, 70, 8);
    
    c.strokeStyle = '#0D1214';
    c.lineWidth = 1;
    for (let px = -30; px <= 30; px += 6) {
      c.beginPath(); c.moveTo(px, -20); c.lineTo(px, -12); c.stroke();
    }
    c.beginPath();
    c.arc(0, -20, 10, Math.PI, 0);
    c.fill();
    c.fillRect(-0.8, -34, 1.6, 4);
    
    // Glowing warm orange illumination for the grand dome
    c.fillStyle = '#FF9100';
    c.beginPath(); c.arc(0, -20, 2.5, 0, Math.PI * 2); c.fill();
    c.restore();

  } else if (state.city === 'chennai') {
    // 1. Chennai Central Clock Tower
    c.save();
    c.translate(60, 0);
    c.fillStyle = 'rgba(21, 26, 30, 0.94)';
    c.fillRect(-6, -42, 12, 42);
    
    // Glowing white clock face
    c.fillStyle = '#FFF';
    c.beginPath(); c.arc(0, -32, 2.5, 0, Math.PI * 2); c.fill();
    
    // Glowing cyber clock hands
    c.strokeStyle = '#000';
    c.lineWidth = 0.5;
    c.beginPath();
    c.moveTo(0, -32); c.lineTo(0, -34.2);
    c.moveTo(0, -32); c.lineTo(1.5, -32);
    c.stroke();
    
    // pointed roof cupola
    c.fillStyle = 'rgba(21, 26, 30, 0.94)';
    c.beginPath();
    c.moveTo(-6, -42); c.lineTo(0, -52); c.lineTo(6, -42);
    c.closePath();
    c.fill();
    c.restore();

    // 2. Valluvar Kottam Vimana tower
    c.save();
    c.translate(180, 0);
    c.fillStyle = 'rgba(21, 26, 30, 0.94)';
    c.beginPath();
    c.moveTo(-12, -12);
    c.lineTo(-4, -38);
    c.lineTo(4, -38);
    c.lineTo(12, -12);
    c.closePath();
    c.fill();
    
    // Neon gold highlights along Gopuram steps
    c.strokeStyle = '#FFD54F';
    c.lineWidth = 1;
    for (let stepY = -18; stepY >= -38; stepY -= 6) {
      let widthAtY = 24 * (1 - (stepY + 12) / -26);
      c.beginPath();
      c.moveTo(-widthAtY / 2, stepY);
      c.lineTo(widthAtY / 2, stepY);
      c.stroke();
    }
    c.restore();

  } else {
    // 1. Howrah Bridge Pylon & Suspension cables
    c.save();
    c.strokeStyle = 'rgba(21, 26, 30, 0.94)';
    c.lineWidth = 2.0;
    // Main tower pylon
    c.beginPath();
    c.moveTo(40, 0); c.lineTo(40, -45);
    c.moveTo(56, 0); c.lineTo(56, -45);
    c.stroke();
    
    // Cross bracings
    c.lineWidth = 0.8;
    for (let cy = -40; cy <= 0; cy += 10) {
      c.beginPath();
      c.moveTo(40, cy); c.lineTo(56, cy - 5);
      c.moveTo(56, cy); c.lineTo(40, cy - 5);
      c.stroke();
    }
    
    // Glowing cyan suspension stay cables (EDM/Synthwave deck wires)
    c.strokeStyle = '#00E5FF';
    c.lineWidth = 0.8;
    c.beginPath();
    c.moveTo(0, -5);
    c.quadraticCurveTo(48, -46, 130, -5);
    c.stroke();
    c.restore();

    // 2. Victoria Memorial Dome
    c.save();
    c.translate(200, 0);
    c.fillStyle = 'rgba(21, 26, 30, 0.94)';
    c.fillRect(-28, -8, 56, 8);
    c.fillRect(-18, -14, 36, 6);
    
    c.beginPath();
    c.arc(0, -14, 8, Math.PI, 0);
    c.fill();
    
    c.fillStyle = 'rgba(15, 23, 27, 0.9)';
    c.fillRect(-0.6, -26, 1.2, 4);
    c.beginPath(); c.arc(0, -28, 1.5, 0, Math.PI*2); c.fill();
    
    // Glowing yellow central dome window lights
    c.fillStyle = '#FFE082';
    c.fillRect(-2, -18, 4, 2);
    c.restore();
  }

  c.restore();
}

// 3D Perspective Road segments loop
function drawRoad3D(c) {
  // Fill the entire ground area below the horizon with grey concrete pavement first
  c.fillStyle = '#788890'; // Dusty slate grey pavement
  c.fillRect(0, HORIZON_Y, GAME_WIDTH, GAME_HEIGHT - HORIZON_Y);

  let startZ = - (roadOffset % SEGMENT_LENGTH);
  let segmentIndex = Math.floor(roadOffset / SEGMENT_LENGTH);
  
  // Loop segments starting from behind the camera (z = startZ - 120) to cover the bottom of screen
  for (let z = startZ - 120; z < 1800; z += SEGMENT_LENGTH) {
    let z1 = z;
    let z2 = z + SEGMENT_LENGTH;
    
    // Project logical boundaries
    let y1 = PLAYER_Y - z1;
    let y2 = PLAYER_Y - z2;
    
    let p1_left = project(ROAD.leftBorder, y1);
    let p1_right = project(ROAD.rightBorder, y1);
    let p2_left = project(ROAD.leftBorder, y2);
    let p2_right = project(ROAD.rightBorder, y2);
    
    // Colors alternate for segments
    let activeIdx = segmentIndex + Math.floor(z / SEGMENT_LENGTH);
    let isEven = (activeIdx % 2 === 0);
    
    // 1. Concrete slate sidewalks
    c.fillStyle = isEven ? '#6E7D84' : '#78878F';
    c.fillRect(0, p2_left.y, GAME_WIDTH, p1_left.y - p2_left.y + 1);
    
    // 2. Concrete curbs
    // Left Curb
    let p1_shL = project(ROAD.leftBorder - 10, y1);
    let p2_shL = project(ROAD.leftBorder - 10, y2);
    c.fillStyle = '#B0BEC5'; // Silver-concrete curb block
    c.beginPath();
    c.moveTo(p1_shL.x, p1_shL.y);
    c.lineTo(p2_shL.x, p2_shL.y);
    c.lineTo(p2_left.x, p2_left.y);
    c.lineTo(p1_left.x, p1_left.y);
    c.fill();
    
    // Right Curb
    let p1_shR = project(ROAD.rightBorder + 10, y1);
    let p2_shR = project(ROAD.rightBorder + 10, y2);
    c.beginPath();
    c.moveTo(p1_right.x, p1_right.y);
    c.lineTo(p2_right.x, p2_right.y);
    c.lineTo(p2_shR.x, p2_shR.y);
    c.lineTo(p1_shR.x, p1_shR.y);
    c.fill();
    
    // 3. Asphalt road center
    c.fillStyle = '#3E3E3E'; // Dusty dark asphalt
    c.beginPath();
    c.moveTo(p1_left.x, p1_left.y);
    c.lineTo(p2_left.x, p2_left.y);
    c.lineTo(p2_right.x, p2_right.y);
    c.lineTo(p1_right.x, p1_right.y);
    c.fill();
    
    // 4. Curb Rumble Strips (alternating red/white curb borders)
    c.fillStyle = isEven ? '#EEEEEE' : '#D32F2F';
    // Left curb
    let p1_curbL = project(ROAD.leftBorder - 3, y1);
    let p2_curbL = project(ROAD.leftBorder - 3, y2);
    c.beginPath();
    c.moveTo(p1_curbL.x, p1_curbL.y);
    c.lineTo(p2_curbL.x, p2_curbL.y);
    c.lineTo(p2_left.x, p2_left.y);
    c.lineTo(p1_left.x, p1_left.y);
    c.fill();
    
    // Right curb
    let p1_curbR = project(ROAD.rightBorder + 3, y1);
    let p2_curbR = project(ROAD.rightBorder + 3, y2);
    c.beginPath();
    c.moveTo(p1_right.x, p1_right.y);
    c.lineTo(p2_right.x, p2_right.y);
    c.lineTo(p2_curbR.x, p2_curbR.y);
    c.lineTo(p1_curbR.x, p1_curbR.y);
    c.fill();
    
    // 5. Dashed Yellow Lane lines (even segments only)
    if (isEven) {
      c.fillStyle = '#FFD54F';
      let laneW = ROAD.width / 3;
      
      let p1_ln1 = project(ROAD.leftBorder + laneW, y1);
      let p2_ln1 = project(ROAD.leftBorder + laneW, y2);
      let p1_ln2 = project(ROAD.leftBorder + laneW * 2, y1);
      let p2_ln2 = project(ROAD.leftBorder + laneW * 2, y2);
      
      let sw1 = 3.5 * p1_left.scale;
      let sw2 = 3.5 * p2_left.scale;
      
      c.beginPath();
      c.moveTo(p1_ln1.x - sw1 / 2, p1_ln1.y);
      c.lineTo(p2_ln1.x - sw2 / 2, p2_ln1.y);
      c.lineTo(p2_ln1.x + sw2 / 2, p2_ln1.y);
      c.lineTo(p1_ln1.x + sw1 / 2, p1_ln1.y);
      c.fill();
      
      c.beginPath();
      c.moveTo(p1_ln2.x - sw1 / 2, p1_ln2.y);
      c.lineTo(p2_ln2.x - sw2 / 2, p2_ln2.y);
      c.lineTo(p2_ln2.x + sw2 / 2, p2_ln2.y);
      c.lineTo(p1_ln2.x + sw1 / 2, p1_ln2.y);
      c.fill();
    }
  }

  // Taper the asphalt road to a point at the horizon center to cover the gap at the top
  let lastZ = 1800;
  let y_last = PLAYER_Y - lastZ;
  let p_last_L = project(ROAD.leftBorder, y_last);
  let p_last_R = project(ROAD.rightBorder, y_last);
  let p_horizon = project(ROAD_CENTER_X, PLAYER_Y - 5000); // Shifting center at horizon
  
  c.fillStyle = '#3E3E3E'; // Dusty dark asphalt
  c.beginPath();
  c.moveTo(p_last_L.x, p_last_L.y);
  c.lineTo(p_horizon.x, HORIZON_Y);
  c.lineTo(p_last_R.x, p_last_R.y);
  c.closePath();
  c.fill();

  // Draw a smooth linear atmospheric haze gradient over the road vanishing point
  let hazeGrad = c.createLinearGradient(0, HORIZON_Y, 0, HORIZON_Y + 120);
  let hazeColor = '#FF8A80'; // fallback
  if (state.city === 'delhi') hazeColor = '#FFCC80';
  else if (state.city === 'mumbai') hazeColor = '#FF80AB';
  else if (state.city === 'bangalore') hazeColor = '#E040FB';
  else if (state.city === 'chennai') hazeColor = '#FFD54F';
  else hazeColor = '#80DEEA'; // kolkata
  
  hazeGrad.addColorStop(0, hazeColor);
  hazeGrad.addColorStop(0.2, hazeColor); // Solid color right at the horizon line
  hazeGrad.addColorStop(1, 'transparent'); // Fades to reveal the asphalt road
  c.fillStyle = hazeGrad;
  c.fillRect(0, HORIZON_Y, GAME_WIDTH, 120);
  
  // Honk Ripple Wave Visual Effect in 3D Perspective
  if (hornEffectFrames > 0) {
    c.save();
    c.strokeStyle = `rgba(0, 229, 255, ${hornEffectFrames / 20})`;
    c.lineWidth = 3;
    
    // Waves move out ahead in perspective
    let waveYOffset = (20 - hornEffectFrames) * 12;
    // Project position of the wave
    let waveProj = project(rickshaw ? rickshaw.x : ROAD_CENTER_X, PLAYER_Y - 40 - waveYOffset);
    let radius = (20 - hornEffectFrames) * 10 * waveProj.scale;
    
    c.beginPath();
    c.arc(waveProj.x, waveProj.y, radius, Math.PI, Math.PI * 2);
    c.stroke();
    c.restore();
    hornEffectFrames--;
  }
}

// Draw First-Person Cockpit Overlay (Windshield View)
function drawCockpit(c) {
  let dashY = GAME_HEIGHT - 165;
  let vibe = state.speed > 0 ? Math.sin(Date.now() * 0.15) * 0.7 : 0;
  
  // 1. Dashboard Base (Dark forest-green/metallic panel)
  c.fillStyle = '#1B3B2B';
  c.beginPath();
  c.moveTo(0, GAME_HEIGHT);
  c.lineTo(0, dashY + 40);
  c.quadraticCurveTo(GAME_WIDTH / 2, dashY + vibe, GAME_WIDTH, dashY + 40);
  c.lineTo(GAME_WIDTH, GAME_HEIGHT);
  c.fill();
  
  // Vibrant Yellow Rim/Border of Dashboard
  c.strokeStyle = '#FFD54F';
  c.lineWidth = 4;
  c.beginPath();
  c.moveTo(0, dashY + 40);
  c.quadraticCurveTo(GAME_WIDTH / 2, dashY + vibe, GAME_WIDTH, dashY + 40);
  c.stroke();
  
  // 2. Hanging Marigold Garland (Swinging with steering and inertia)
  c.save();
  let swing = rickshaw ? -rickshaw.angle * 1.8 : 0;
  swing += Math.sin(Date.now() * 0.003) * 0.04; // Gentle drift
  c.translate(GAME_WIDTH / 2, 35);
  c.rotate(swing);
  
  // Draw String
  c.strokeStyle = '#FFE082';
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(0, 0);
  c.lineTo(0, 105);
  c.stroke();
  
  // Draw alternating orange and yellow marigold flowers
  for (let i = 12; i <= 100; i += 12) {
    c.fillStyle = (Math.floor(i / 12) % 2 === 0) ? '#FF9900' : '#FFCC00';
    c.beginPath();
    c.arc(0, i, 5.5, 0, Math.PI * 2);
    c.fill();
    // Inner center of flower
    c.fillStyle = (Math.floor(i / 12) % 2 === 0) ? '#FFCC00' : '#FF9900';
    c.beginPath();
    c.arc(0, i, 2, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
  
  // 3. Lord Ganesha Idol (Vibrating on Dashboard)
  c.save();
  let idolX = GAME_WIDTH / 2 - 85;
  let idolY = dashY + 40;
  c.translate(idolX, idolY + vibe * 1.5);
  
  // Base Stand
  c.fillStyle = '#D7CCC8';
  c.fillRect(-16, 12, 32, 6);
  
  // Body (Saffron orange)
  c.fillStyle = '#FF9800';
  c.beginPath();
  c.arc(0, 2, 9, 0, Math.PI * 2); // Belly/Torso
  c.fill();
  // Head
  c.beginPath();
  c.arc(0, -7, 6, 0, Math.PI * 2);
  c.fill();
  // Trunk
  c.strokeStyle = '#FF9800';
  c.lineWidth = 3.5;
  c.beginPath();
  c.moveTo(0, -7);
  c.quadraticCurveTo(8, -1, 4, 6);
  c.stroke();
  // Garland on Ganesha
  c.fillStyle = '#FFEB3B';
  c.beginPath();
  c.arc(-5, 4, 2, 0, Math.PI * 2);
  c.arc(5, 4, 2, 0, Math.PI * 2);
  c.arc(0, 7, 2, 0, Math.PI * 2);
  c.fill();
  c.restore();
  
  // 4. Motorcycle-style Handlebars & Steering Column
  c.save();
  let hbX = GAME_WIDTH / 2;
  let hbY = dashY + 42;
  let steerAngle = rickshaw ? rickshaw.angle * 4.5 : 0;
  c.translate(hbX, hbY + vibe * 0.8);
  c.rotate(steerAngle);
  
  // Steering column/stem
  c.fillStyle = '#455A64';
  c.fillRect(-9, 0, 18, 60);
  
  // Chrome bars
  c.fillStyle = '#CFD8DC';
  c.fillRect(-75, -6, 150, 12);
  
  // Grips (Black rubber)
  c.fillStyle = '#111111';
  c.fillRect(-75, -8, 25, 16); // Left
  c.fillRect(50, -8, 25, 16);  // Right
  
  // Speedometer Console
  c.fillStyle = '#263238';
  c.beginPath();
  c.arc(0, 14, 22, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = '#90A4AE';
  c.lineWidth = 2.5;
  c.stroke();
  
  // Speedometer ticks
  c.strokeStyle = '#B0BEC5';
  c.lineWidth = 1;
  c.save();
  c.translate(0, 14);
  for (let a = -Math.PI * 0.8; a <= Math.PI * 0.8; a += Math.PI * 0.2) {
    c.beginPath();
    c.moveTo(Math.cos(a) * 16, Math.sin(a) * 16);
    c.lineTo(Math.cos(a) * 20, Math.sin(a) * 20);
    c.stroke();
  }
  
  // Dynamic Needle (speed representation)
  let maxNeedleAngle = Math.PI * 0.8;
  let minNeedleAngle = -Math.PI * 0.8;
  let needleAngle = minNeedleAngle + (state.speed / state.maxSpeed) * (maxNeedleAngle - minNeedleAngle);
  c.rotate(needleAngle);
  c.strokeStyle = '#FF1744'; // Bright Red Needle
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(0, 0);
  c.lineTo(0, -17);
  c.stroke();
  c.restore();
  
  // Horn Center Button
  c.fillStyle = '#00E5FF';
  c.beginPath();
  c.arc(0, -2, 5, 0, Math.PI * 2);
  c.fill();
  c.restore();
  
  // 5. Windshield frame (Roof canopy & side pillars)
  c.fillStyle = '#FFD54F'; // Yellow Roof
  c.fillRect(0, 0, GAME_WIDTH, 35);
  // Pattern on canopy top
  c.fillStyle = '#FFA726';
  c.fillRect(0, 31, GAME_WIDTH, 4);
  
  // Left Pillar
  c.fillStyle = '#2E7D32'; // Green base pillar
  c.beginPath();
  c.moveTo(0, 35);
  c.lineTo(24, 35);
  c.lineTo(12, dashY + 40);
  c.lineTo(0, dashY + 40);
  c.closePath();
  c.fill();
  
  // Right Pillar
  c.beginPath();
  c.moveTo(GAME_WIDTH, 35);
  c.lineTo(GAME_WIDTH - 24, 35);
  c.lineTo(GAME_WIDTH - 12, dashY + 40);
  c.lineTo(GAME_WIDTH, dashY + 40);
  c.closePath();
  c.fill();
  
  // 6. Side mirrors (protruding out, showing reflections of road moving up)
  // Left Mirror
  c.fillStyle = '#37474F';
  c.fillRect(6, 175, 4, 15); // stem
  c.fillStyle = '#212121'; // frame
  c.fillRect(-22, 185, 24, 34);
  c.fillStyle = '#B0BEC5'; // mirror reflection surface
  c.fillRect(-20, 187, 20, 30);
  // Draw simplified moving stripes inside mirror reflection
  c.fillStyle = '#6D3C16'; // background reflect
  c.fillRect(-20, 187, 20, 30);
  c.fillStyle = '#424242'; // road reflect
  c.fillRect(-14, 187, 8, 30);
  c.fillStyle = '#FFD54F'; // dashed line reflect
  let mirrorOffset = (roadOffset * 0.4) % 15;
  c.fillRect(-11, 187 + mirrorOffset, 2, 4);
  c.fillRect(-11, 187 + mirrorOffset + 12, 2, 4);
  
  // Right Mirror
  c.fillStyle = '#37474F';
  c.fillRect(GAME_WIDTH - 10, 175, 4, 15); // stem
  c.fillStyle = '#212121';
  c.fillRect(GAME_WIDTH - 2, 185, 24, 34);
  c.fillStyle = '#6D3C16'; // background reflect
  c.fillRect(GAME_WIDTH, 187, 20, 30);
  c.fillStyle = '#424242'; // road reflect
  c.fillRect(GAME_WIDTH + 6, 187, 8, 30);
  c.fillStyle = '#FFD54F'; // dashed line reflect
  c.fillRect(GAME_WIDTH + 9, 187 + mirrorOffset, 2, 4);
  c.fillRect(GAME_WIDTH + 9, 187 + mirrorOffset + 12, 2, 4);
}

function triggerHornEffect() {
  hornEffectFrames = 20;
}

// ==========================================
// COLLISION DETECTION (AABB)
// ==========================================
function checkCollision(a, b) {
  return (
    a.left < b.right &&
    a.right > b.left &&
    a.top < b.bottom &&
    a.bottom > b.top
  );
}

// Create screen shake on hits
function triggerScreenShake(intensity) {
  state.shakeIntensity = intensity;
  const canvasEl = document.getElementById('game-canvas');
  canvasEl.classList.add('shake');
  setTimeout(() => {
    canvasEl.classList.remove('shake');
  }, 400);
}

// Sparks particle emitter on impact
function spawnSparks(x, y, color = '#FFD54F') {
  for (let i = 0; i < 15; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1 + Math.random() * 4;
    particles.push(new Particle(
      x,
      y,
      color,
      2 + Math.random() * 2,
      Math.cos(angle) * speed,
      Math.sin(angle) * speed - 1,
      20 + Math.random() * 15,
      'spark'
    ));
  }
}

// Sparkle emitter on coin pick-up
function spawnCoinSparkles(x, y) {
  for (let i = 0; i < 8; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.5 + Math.random() * 2;
    particles.push(new Particle(
      x,
      y,
      '#FFD54F',
      2 + Math.random() * 2,
      Math.cos(angle) * speed,
      Math.sin(angle) * speed,
      15 + Math.random() * 10,
      'coin'
    ));
  }
}

// ==========================================
// GAME LOOP & STATE MANAGER
// ==========================================

function update(time) {
  const dt = time - state.lastTime;
  state.lastTime = time;

  // Handle Screen Shake damping
  if (state.shakeIntensity > 0) {
    state.shakeIntensity *= 0.9;
    if (state.shakeIntensity < 0.1) state.shakeIntensity = 0;
  }

  // Decrement driver yell speech bubble timer
  if (state.yellTimer > 0) {
    state.yellTimer--;
  }

  if (state.screen === 'playing') {
    // 1. Acceleration / Engine Physics
    // Auto-accelerate forward
    state.targetSpeed = state.maxSpeed;
    
    // Cutting Chai speed boost
    if (state.activeShield > 0) {
      state.targetSpeed = state.maxSpeed * 1.5;
      state.activeShield--;
      // Update UI bar
      const bar = document.getElementById('shield-bar');
      bar.style.width = (state.activeShield / state.activeShieldMax) * 100 + '%';
      if (state.activeShield === 0) {
        document.getElementById('shield-gauge-container').classList.add('hidden');
      }
    }

    // Smooth speed interpolation
    state.speed += (state.targetSpeed - state.speed) * 0.05;
    gameAudio.setEngineSpeed(state.speed / state.maxSpeed);

    // Track statistics
    state.distance += state.speed * 0.05; // speed scaled down to arbitrary km count
    document.getElementById('distance-val').innerText = (state.distance / 10).toFixed(1) + ' km';
    document.getElementById('speed-val').innerText = Math.round(state.speed * 10) + ' km/h';

    // Difficulty Level Scaling
    state.level = 1 + Math.floor(state.distance / 100);
    state.maxSpeed = 8 + (state.level * 0.5); // Speed up slightly over time

    // 2. Handle Player
    rickshaw.update();

    // 3. Spawn Entities based on timers
    nextSpawns.obstacle--;
    if (nextSpawns.obstacle <= 0) {
      // Choose random lane and obstacle type
      const lane = Math.floor(Math.random() * 3);
      // Potholes spawn more frequently at lower levels, trucks/cow at higher levels
      const types = ['pothole', 'taxi', 'truck', 'cow', 'bicycle', 'dog'];
      const type = types[Math.floor(Math.random() * types.length)];
      obstacles.push(new Obstacle(lane, type));
      nextSpawns.obstacle = Math.max(35, 90 - state.level * 8) + Math.random() * 50;
    }

    nextSpawns.collectible--;
    if (nextSpawns.collectible <= 0) {
      const lane = Math.floor(Math.random() * 3);
      // Mostly coins, occasional Samosa (health) or Chai (shield)
      const roll = Math.random();
      let type = 'coin';
      if (roll > 0.90) type = 'chai';
      else if (roll > 0.78) type = 'samosa';

      collectibles.push(new Collectible(lane, type));
      nextSpawns.collectible = 35 + Math.random() * 45;
    }

    nextSpawns.scenery--;
    if (nextSpawns.scenery <= 0) {
      scenery.push(new SceneryItem());
      // Spawn scenery extremely frequently for a packed, bustling street appearance
      nextSpawns.scenery = 5 + Math.random() * 5;
    }

    // Passenger Spawn Logic (Only if we don't have one active/on-board)
    if (!state.passenger && !state.destination) {
      nextSpawns.passenger--;
      if (nextSpawns.passenger <= 0) {
        state.passenger = new Passenger();
        nextSpawns.passenger = 600 + Math.random() * 400; // Reset spawn window
      }
    }

    // 4. Update Scenery & Road Decorations
    scenery.forEach(item => item.update());
    scenery = scenery.filter(item => item.y < GAME_HEIGHT + 100);

    // 5. Update Collectibles
    collectibles.forEach(item => item.update());
    
    // Collectible Collisions
    collectibles.forEach((item, index) => {
      if (checkCollision(rickshaw.getBounds(), item.getBounds())) {
        // Trigger pickup
        if (item.type === 'coin') {
          state.score += 5;
          document.getElementById('score-val').innerText = '₹ ' + state.score;
          gameAudio.playCoin();
          spawnCoinSparkles(item.x, item.y);
        } else if (item.type === 'samosa') {
          state.health = Math.min(state.maxHealth, state.health + 20);
          document.getElementById('health-bar').style.width = state.health + '%';
          gameAudio.playHeal();
          spawnCoinSparkles(item.x, item.y); // sparkle green-ish particles later
        } else if (item.type === 'chai') {
          state.activeShield = state.activeShieldMax;
          document.getElementById('shield-gauge-container').classList.remove('hidden');
          gameAudio.playPowerUp();
          spawnSparks(item.x, item.y, '#00E5FF');
        }
        collectibles.splice(index, 1);
      }
    });
    collectibles = collectibles.filter(item => item.y < GAME_HEIGHT + 50);

    // 6. Update Passenger and Destination Zone
    if (state.passenger) {
      state.passenger.update();
      
      // Pulling over close to roadside passenger to pick up
      const distY = Math.abs(rickshaw.y - state.passenger.y);
      const distX = Math.abs(rickshaw.x - state.passenger.x);
      if (distY < 50 && distX < 85 && !state.passenger.pickedUp) {
        state.passenger.pickedUp = true;
        gameAudio.playHeal();
        
        // Announce passenger on board
        const statusBox = document.getElementById('passenger-status');
        statusBox.classList.remove('hidden');
        
        // Spawn destination zone ahead
        state.destination = new DestinationZone();
      }
      
      // Filter out passenger if player misses them
      if (state.passenger.y > GAME_HEIGHT + 50 && !state.passenger.pickedUp) {
        state.passenger = null;
      }
    }

    if (state.destination) {
      state.destination.update();

      // Check drop-off zone collision
      if (checkCollision(rickshaw.getBounds(), state.destination.getBounds())) {
        // Drop-off passenger success!
        state.score += 100; // Large reward
        document.getElementById('score-val').innerText = '₹ ' + state.score;
        
        // Reset state
        state.passenger = null;
        state.destination = null;
        gameAudio.playPowerUp();
        spawnSparks(rickshaw.x, rickshaw.y - 20, '#00FF00');

        // Hide overlay HUD card
        document.getElementById('passenger-status').classList.add('hidden');
      } else if (state.destination.y > GAME_HEIGHT + 100) {
        // Destination zone missed!
        state.destination = null;
        state.passenger = null; // passenger leaves rickshaw in disappointment
        document.getElementById('passenger-status').classList.add('hidden');
      }
    }

    // 7. Update Obstacles & Traffic
    obstacles.forEach(item => item.update());
    
    // Obstacle Collisions
    obstacles.forEach((item, index) => {
      if (checkCollision(rickshaw.getBounds(), item.getBounds())) {
        // Collision!
        if (state.activeShield > 0) {
          // Shield blocks the collision, blows up the traffic car instead!
          spawnSparks(item.x, item.y, '#00E5FF');
          gameAudio.playCrash();
          obstacles.splice(index, 1);
          triggerScreenShake(8);
        } else {
          // Regular damage taken
          state.health -= item.damage;
          document.getElementById('health-bar').style.width = Math.max(0, state.health) + '%';
          
          spawnSparks(item.x, item.y, '#FF1744');
          gameAudio.playCrash();
          obstacles.splice(index, 1);
          triggerScreenShake(15);

          // Check Game Over
          if (state.health <= 0) {
            triggerGameOver();
          }
        }
      }
    });
    obstacles = obstacles.filter(item => item.y < GAME_HEIGHT + 100);

    // 8. Update Particles
    particles.forEach(p => p.update());
    particles = particles.filter(p => p.life > 0);
  }

  // Draw Game Scene
  draw();

  requestAnimationFrame(update);
}

// ==========================================
// RENDER MANAGER
// ==========================================
function draw() {
  ctx.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

  // Apply screen shake translation
  ctx.save();
  if (state.shakeIntensity > 0) {
    const shakeX = -state.shakeIntensity + Math.random() * (state.shakeIntensity * 2);
    const shakeY = -state.shakeIntensity + Math.random() * (state.shakeIntensity * 2);
    ctx.translate(shakeX, shakeY);
  }

  // 1. Draw sky background and horizon silhouettes
  drawHorizonBackground(ctx);

  // 2. Draw 3D scrolling road segments
  drawRoad3D(ctx);

  // 3. Depth-sort and render all active game elements (roadside, traffic, collectibles, player, smoke)
  let renderList = [];

  // Scenery items
  scenery.forEach(item => {
    renderList.push({ y: item.y, draw: (c) => item.draw(c) });
  });

  // Waving roadside passenger
  if (state.passenger) {
    let p = state.passenger;
    renderList.push({ y: p.y, draw: (c) => p.draw(c) });
  }

  // Destination drop-off zone
  if (state.destination) {
    let d = state.destination;
    renderList.push({ y: d.y, draw: (c) => d.draw(c) });
  }

  // Collectibles (Coins, Samosas, Chai)
  collectibles.forEach(item => {
    renderList.push({ y: item.y, draw: (c) => item.draw(c) });
  });

  // Traffic and obstacles (Cows, Trucks, Taxis, Potholes)
  obstacles.forEach(item => {
    renderList.push({ y: item.y, draw: (c) => item.draw(c) });
  });

  // Player auto-rickshaw (only visible in zoomed out / third-person follow view)
  if (rickshaw && state.cameraMode === 'zoomed') {
    renderList.push({ y: rickshaw.y, draw: (c) => rickshaw.draw(c) });
  }

  // Particle systems (Smoke and sparks)
  particles.forEach(p => {
    renderList.push({ y: p.y, draw: (c) => p.draw(c) });
  });

  // Sort from back to front (smaller Y coordinates are further away in 3D perspective)
  renderList.sort((a, b) => a.y - b.y);

  // Draw sorted items
  renderList.forEach(item => item.draw(ctx));

  // 4. Draw first-person dashboard/cockpit overlay if in windshield view
  if (state.cameraMode === 'windshield') {
    drawCockpit(ctx);
  }

  ctx.restore();
}

// ==========================================
// UI SCREEN TRANSITIONS
// ==========================================

function startGame() {
  document.getElementById('start-screen').classList.add('hidden');
  document.getElementById('how-to-play-screen').classList.add('hidden');
  document.getElementById('game-over-screen').classList.add('hidden');
  document.getElementById('game-hud').classList.remove('hidden');

  // Show touch controls on touch-enabled devices or small screens
  if (window.innerWidth < 768 || 'ontouchstart' in window) {
    document.getElementById('touch-controls').classList.remove('hidden');
  }

  // Reset Game States
  state.score = 0;
  state.distance = 0;
  state.level = 1;
  state.health = 100;
  state.activeShield = 0;
  
  document.getElementById('score-val').innerText = '₹ 0';
  document.getElementById('health-bar').style.width = '100%';
  document.getElementById('shield-gauge-container').classList.add('hidden');
  document.getElementById('passenger-status').classList.add('hidden');

  initEntities();
  
  // Start engine audio
  gameAudio.startEngine();

  state.screen = 'playing';
}

function triggerGameOver() {
  state.screen = 'gameover';
  gameAudio.stopEngine();

  // Save High Score
  if (state.score > state.highScore) {
    state.highScore = state.score;
    localStorage.setItem('autorick_highscore', state.score);
  }

  // Update Game Over screen elements
  document.getElementById('final-score').innerText = '₹ ' + state.score;
  document.getElementById('final-distance').innerText = (state.distance / 10).toFixed(1) + ' km';
  
  document.getElementById('game-hud').classList.add('hidden');
  document.getElementById('touch-controls').classList.add('hidden');
  document.getElementById('game-over-screen').classList.remove('hidden');
}

function quitToMainMenu() {
  state.screen = 'start';
  gameAudio.stopEngine();

  document.getElementById('game-hud').classList.add('hidden');
  document.getElementById('touch-controls').classList.add('hidden');
  document.getElementById('how-to-play-screen').classList.add('hidden');
  document.getElementById('game-over-screen').classList.add('hidden');
  document.getElementById('start-screen').classList.remove('hidden');
}

// Button Bindings
// Carousel Route Cards click listeners (sets city route and starts game immediately!)
document.querySelectorAll('.route-card').forEach(card => {
  card.addEventListener('click', () => {
    state.city = card.getAttribute('data-city') || 'mumbai';
    gameAudio.init(); // Play sounds on click context
    startGame();
  });
});

document.getElementById('retry-btn').addEventListener('click', startGame);

document.getElementById('how-to-play-btn').addEventListener('click', () => {
  document.getElementById('start-screen').classList.add('hidden');
  document.getElementById('how-to-play-screen').classList.remove('hidden');
  state.screen = 'how-to';
});

document.getElementById('back-to-menu-btn').addEventListener('click', () => {
  document.getElementById('how-to-play-screen').classList.add('hidden');
  document.getElementById('start-screen').classList.remove('hidden');
  state.screen = 'start';
});

document.getElementById('exit-btn').addEventListener('click', () => {
  document.getElementById('game-over-screen').classList.add('hidden');
  document.getElementById('start-screen').classList.remove('hidden');
  state.screen = 'start';
});

// Audio Toggle Button (cycles through All Audio ON -> FX Only -> Muted)
const audioBtn = document.getElementById('audio-toggle-btn');
audioBtn.addEventListener('click', () => {
  const mode = gameAudio.cycleAudioState();
  if (mode === 'ALL_ON') {
    audioBtn.innerText = "Audio: Sounds & Music ON 🔊⚡";
    audioBtn.style.background = "";
    audioBtn.style.color = "";
    audioBtn.style.borderColor = "";
  } else if (mode === 'FX_ONLY') {
    audioBtn.innerText = "Audio: Sound FX Only 🔊🪘";
    audioBtn.style.background = "rgba(13, 92, 117, 0.4)";
    audioBtn.style.color = "#FFD54F";
    audioBtn.style.borderColor = "var(--color-rickshaw-yellow)";
  } else {
    audioBtn.innerText = "Audio: Muted 🔇";
    audioBtn.style.background = "#263238";
    audioBtn.style.color = "#90A4AE";
    audioBtn.style.borderColor = "#37474F";
  }
});

// Camera View Toggle Button
const cameraBtn = document.getElementById('camera-toggle-btn');
const cameraVal = document.getElementById('camera-val');
cameraBtn.addEventListener('click', () => {
  if (state.cameraMode === 'windshield') {
    state.cameraMode = 'zoomed';
    cameraVal.innerText = '3D CAMERA';
  } else {
    state.cameraMode = 'windshield';
    cameraVal.innerText = 'WINDSHIELD';
  }
});


// Start Engine Hook
canvas.addEventListener('click', () => {
  if (state.screen === 'playing') {
    // Just click support to restore audio context if suspended
    gameAudio.init();
  }
});

// Start Main Animation Loop
state.lastTime = performance.now();
requestAnimationFrame(update);
