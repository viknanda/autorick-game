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
const WORLD_SPEED_MULT = 2.4; // Multiplier to give high visual speed/action while preserving real km/h

// Game State
const state = {
  screen: 'start', // 'start', 'playing', 'how-to', 'gameover'
  city: 'mumbai', // chosen city route ('mumbai', 'delhi', 'bangalore', 'chennai', 'kolkata')
  cameraMode: 'zoomed', // 'zoomed' (3D follow) or 'windshield' (first-person)
  score: 0,
  distance: 0, // in meters
  level: 1,
  speed: 0, // current speed in pixels/frame
  maxSpeed: 2.6, // Realistic base cruising speed (trebled down)
  targetSpeed: 0,
  baseRoadSpeed: 0.8,
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
    this.type = type; // 'exhaust', 'spark', 'coin', 'petal', 'sparkle'
    this.rotation = Math.random() * Math.PI * 2;
    this.rotSpeed = (Math.random() - 0.5) * 0.15;
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.rotation += this.rotSpeed;
    this.life--;
    if (this.type === 'exhaust') {
      this.size += 0.2; // Smoke expands
    } else if (this.type === 'petal') {
      this.vx += Math.sin(Date.now() * 0.01 + this.rotation) * 0.05; // Gentle fluttering drift
      this.vy += 0.01; // Soft drift
    }
  }

  draw(c) {
    c.save();
    c.globalAlpha = Math.max(0, this.life / this.maxLife);
    
    // Project particle coordinates into 3D space
    let proj = project(this.x, this.y);
    c.translate(proj.x, proj.y);
    c.scale(proj.scale, proj.scale);
    c.rotate(this.rotation);
    
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
    } else if (this.type === 'petal') {
      // Oval flower petal (Marigold / Rose)
      c.ellipse(0, 0, this.size, this.size * 0.6, 0, 0, Math.PI * 2);
      c.fill();
    } else if (this.type === 'sparkle') {
      // 4-pointed golden sparkle star
      c.fillStyle = '#FFF176';
      c.moveTo(0, -this.size * 1.5);
      c.lineTo(this.size * 0.4, -this.size * 0.4);
      c.lineTo(this.size * 1.5, 0);
      c.lineTo(this.size * 0.4, this.size * 0.4);
      c.lineTo(0, this.size * 1.5);
      c.lineTo(-this.size * 0.4, this.size * 0.4);
      c.lineTo(-this.size * 1.5, 0);
      c.lineTo(-this.size * 0.4, -this.size * 0.4);
      c.closePath();
      c.fill();
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
    const steeringSpeed = 5.0;
    if (steerDir !== 0) {
      this.targetX += steerDir * steeringSpeed;
      // Tilt rickshaw based on direction
      this.angle = steerDir * 0.09;
    } else {
      // Return to straight angle
      this.angle *= 0.75;
    }

    // Keep rickshaw bound inside road borders
    const margin = this.width / 2 + 8;
    this.targetX = Math.max(ROAD.leftBorder + margin, Math.min(ROAD.rightBorder - margin, this.targetX));
    
    // Smooth transition to target position
    this.x += (this.targetX - this.x) * 0.3;

    // Off-road / Municipal Kerb Vibration & Friction Wear-and-Tear
    if (state.speed > 1 && (this.x <= ROAD.leftBorder + margin + 8 || this.x >= ROAD.rightBorder - margin - 8)) {
      state.health = Math.max(0, state.health - 0.05);
      document.getElementById('health-bar').style.width = state.health + '%';
      const hNum = document.getElementById('health-num');
      if (hNum) hNum.innerText = Math.max(0, Math.round(state.health)) + '%';
      if (Math.random() < 0.25) {
        spawnSparks(this.x + (this.x < ROAD_CENTER_X ? -12 : 12), this.y + 12, '#FFD54F');
      }
      if (state.health <= 0) {
        triggerGameOver();
      }
    }

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
  constructor(lane, type, initialY = -120) {
    this.lane = lane;
    this.type = type; // 'cow', 'truck', 'taxi', 'car', 'bus', 'scooter', 'pothole', 'bicycle', 'dog'
    this.x = ROAD.lanes[lane];
    this.y = initialY; // Start at specified Y position or default offscreen

    // Assorted civilian colors for passenger cars
    const carColors = ['#FAFAFA', '#C62828', '#B0BEC5', '#1976D2', '#37474F'];
    // Assorted bus colors (BEST Red, DTC Blue, BMTC Green)
    const busColors = ['#C62828', '#1565C0', '#2E7D32'];
    // Assorted helmet colors
    const helmetColors = ['#D32F2F', '#1976D2', '#FBC02D', '#37474F', '#FFFFFF'];

    // Set properties based on type (Speeds scaled to realistic city pace & city nuances)
    switch (type) {
      case 'cow':
        this.width = 55;
        this.height = 50;
        this.speed = 0; // Sacred cows are peaceful and stationary
        this.damage = 0; // Blessing instead of damage!
        break;
      case 'car':
        this.width = 44;
        this.height = 68;
        this.speed = 1.3 + Math.random() * 0.5; // Modern passenger cars cruising
        this.damage = 28; // Increased collision damage
        this.color = carColors[Math.floor(Math.random() * carColors.length)];
        this.swayed = false;
        break;
      case 'taxi':
        this.width = 44;
        this.height = 68;
        this.speed = 1.2 + Math.random() * 0.5;
        this.damage = 26; // Increased collision damage
        this.swayed = false;
        // City-specific taxi models & liveries:
        // - Mumbai: Iconic Black & Yellow (Kaali-Peeli)
        // - Kolkata: Iconic Yellow Ambassador
        // - Delhi: White/Silver CNG Sedan Cab with green eco-stripe
        // - Bangalore / Chennai: White/Silver City Cab
        if (state.city === 'mumbai') {
          this.taxiType = 'MUMBAI_KAALI_PEELI';
          this.plate = 'MH 01 BK 9024';
        } else if (state.city === 'kolkata') {
          this.taxiType = 'KOLKATA_YELLOW_AMBASSADOR';
          this.plate = 'WB 02 E 5519';
        } else if (state.city === 'delhi') {
          this.taxiType = 'DELHI_CNG_CAB';
          this.plate = 'DL 1Y A 3820';
        } else if (state.city === 'bangalore') {
          this.taxiType = 'BANGALORE_CITY_CAB';
          this.plate = 'KA 01 F 7721';
        } else { // chennai
          this.taxiType = 'CHENNAI_CITY_CAB';
          this.plate = 'TN 01 AK 6642';
        }
        break;
      case 'bus':
        this.width = 56;
        this.height = 100;
        this.speed = 0.9 + Math.random() * 0.3; // Heavy state transport city bus
        this.damage = 42; // Heavy collision damage!
        // City-specific buses:
        // - Mumbai: BEST Red Bus
        // - Delhi: DTC Blue AC / DTC Green CNG Bus
        // - Bangalore: BMTC Teal/Blue Bus
        // - Kolkata: WBTC Royal Blue/White Bus
        // - Chennai: MTC Crimson Bus
        if (state.city === 'mumbai') {
          this.busType = 'BEST';
          this.color = '#C62828'; // BEST Crimson Red
          this.roofColor = '#FFF9C4'; // Cream roof stripe
          this.routeText = 'BEST 302: DADAR / CST';
          this.plate = 'MH 01 BR 3320';
        } else if (state.city === 'delhi') {
          this.busType = 'DTC';
          this.color = Math.random() < 0.6 ? '#1565C0' : '#1B5E20'; // DTC Royal Blue AC or DTC Green CNG
          this.roofColor = '#EEEEEE';
          this.routeText = 'DTC 534: CONNAUGHT PL';
          this.plate = 'DL 1P C 8840';
        } else if (state.city === 'bangalore') {
          this.busType = 'BMTC';
          this.color = '#0288D1'; // BMTC Cyan/Blue
          this.roofColor = '#FFFFFF';
          this.routeText = 'BMTC 335E: MAJESTIC';
          this.plate = 'KA 57 F 1204';
        } else if (state.city === 'kolkata') {
          this.busType = 'WBTC';
          this.color = '#1976D2'; // WBTC Royal Blue
          this.roofColor = '#FFFFFF';
          this.routeText = 'WBTC 24A: HOWRAH';
          this.plate = 'WB 04 G 4490';
        } else { // chennai
          this.busType = 'MTC';
          this.color = '#D32F2F'; // MTC Crimson
          this.roofColor = '#FFE082';
          this.routeText = 'MTC 29C: BROADWAY';
          this.plate = 'TN 07 N 9120';
        }
        break;
      case 'scooter':
        this.width = 30;
        this.height = 48;
        this.speed = 1.1 + Math.random() * 0.5; // Nimble commuter two-wheeler
        this.damage = 16;
        this.helmetColor = helmetColors[Math.floor(Math.random() * helmetColors.length)];
        this.color = ['#29B6F6', '#EF5350', '#BDBDBD', '#FFA726'][Math.floor(Math.random() * 4)];
        this.swayed = false;
        break;
      case 'truck':
        this.width = 50;
        this.height = 96;
        this.speed = 0.8 + Math.random() * 0.4; // Slow-moving heavy cargo truck
        this.damage = 36;
        this.color = ['#D32F2F', '#1976D2', '#F57C00'][Math.floor(Math.random() * 3)];
        break;
      case 'pothole':
        this.width = 36;
        this.height = 24;
        this.speed = 0; // Ground surface crater
        this.damage = 14;
        break;
      case 'bicycle':
        this.width = 28;
        this.height = 54;
        this.speed = 0.4 + Math.random() * 0.3; // Local milkman bicycle delivery
        this.damage = 12;
        break;
      case 'dog':
        this.width = 30;
        this.height = 42;
        this.speed = 0.2 + Math.random() * 0.2; // Stray dog ambling along
        this.damage = 10;
        break;
    }
  }

  update() {
    // Move obstacle relative to road speed
    // Scaled by WORLD_SPEED_MULT for brisk, exciting visual motion
    this.y += (state.speed * WORLD_SPEED_MULT) - (this.speed * 1.0);

    // Dynamic lane change behavior (fast cars & scooters weave ahead)
    if (!this.swayed && (this.type === 'car' || this.type === 'taxi' || this.type === 'scooter')) {
      if (this.y > 100 && this.y < 360 && Math.random() < 0.006) {
        this.swayed = true;
        const shift = (Math.random() < 0.5 ? -1 : 1);
        const nextLane = Math.max(0, Math.min(2, this.lane + shift));
        if (nextLane !== this.lane) {
          this.lane = nextLane;
          this.x = ROAD.lanes[nextLane];
        }
      }
    }
  }

  draw(c) {
    c.save();
    
    // Project position in 3D perspective space
    let proj = project(this.x, this.y);
    c.translate(proj.x, proj.y);
    c.scale(proj.scale, proj.scale);

    // Ground Contact Ambient Occlusion Shadow (Firmly plants wheels/hooves on tarmac)
    c.fillStyle = 'rgba(0, 0, 0, 0.42)';
    c.beginPath();
    c.ellipse(0, this.height * 0.28, this.width * 0.52, 6, 0, 0, Math.PI * 2);
    c.fill();

    if (this.type === 'cow') {
      // --- DRAW SACRED COW (Rear-Quarter 3D standing profile with Divine Radiance) ---
      // Four standing legs extending down to meet the road
      c.fillStyle = '#C7B198'; // Leg color
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

      // 4. Tail (swaying slightly)
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

      // Divine Golden Radiance Ring (Auspicious Gau Mata Halo)
      const haloAlpha = 0.35 + Math.sin(Date.now() * 0.005) * 0.15;
      c.strokeStyle = `rgba(255, 215, 0, ${haloAlpha})`;
      c.lineWidth = 2.5;
      c.beginPath();
      c.arc(0, 0, 32, 0, Math.PI * 2);
      c.stroke();

    } else if (this.type === 'taxi') {
      // --- DRAW 3D REAR-PERSPECTIVE TAXI (CITY-SPECIFIC LIVERY) ---
      // Rear Tires
      c.fillStyle = '#1A1A1A';
      c.fillRect(-21, 14, 6, 15);
      c.fillRect(15, 14, 6, 15);

      if (this.taxiType === 'KOLKATA_YELLOW_AMBASSADOR') {
        // --- ICONIC KOLKATA AMBASSADOR YELLOW CAB ---
        // Curvy Classic Ambassador Yellow Chassis
        c.fillStyle = '#FBC02D'; // Classic Canary Yellow
        c.beginPath();
        c.roundRect(-23, -4, 46, 26, [8, 8, 8, 8]);
        c.fill();

        // Rounded Boot Lid / Rear Wings
        c.fillStyle = '#F57F17'; // Shaded yellow contour
        c.beginPath();
        c.roundRect(-21, -15, 42, 16, [6, 6, 2, 2]);
        c.fill();
        c.fillStyle = '#FBC02D';
        c.beginPath();
        c.roundRect(-19, -13, 38, 13, [4, 4, 0, 0]);
        c.fill();

        // Classic Curved Slanted Rear Windshield
        c.fillStyle = '#263238';
        c.beginPath();
        c.moveTo(-18, -14);
        c.lineTo(18, -14);
        c.lineTo(15, -28);
        c.lineTo(-15, -28);
        c.closePath();
        c.fill();

        // Glass reflection streak
        c.fillStyle = 'rgba(255, 255, 255, 0.4)';
        c.beginPath();
        c.moveTo(-8, -14); c.lineTo(-3, -14); c.lineTo(3, -28); c.lineTo(-2, -28);
        c.closePath();
        c.fill();

        // Ambassador Yellow Roof
        c.fillStyle = '#FBC02D';
        c.beginPath();
        c.roundRect(-16, -34, 32, 8, [5, 5, 2, 2]);
        c.fill();

        // Chrome Roof Luggage Carrier Rack with Luggage
        c.strokeStyle = '#ECEFF1';
        c.lineWidth = 1.5;
        c.strokeRect(-13, -39, 26, 6);
        c.fillStyle = '#6D4C41'; // Leather trunk on rack
        c.fillRect(-9, -43, 18, 5);
        c.strokeStyle = '#3E2723';
        c.lineWidth = 0.8;
        c.strokeRect(-9, -43, 18, 5);

        // Kolkata Taxi Blue-and-White Checker Beltline Stripe
        c.fillStyle = '#1565C0';
        c.fillRect(-22, 1, 44, 4);
        c.fillStyle = '#FFFFFF';
        for (let chk = -20; chk <= 18; chk += 6) {
          c.fillRect(chk, 1, 3, 4);
        }

        // Blue Stencilled "TAXI" Text
        c.fillStyle = '#0D47A1';
        c.font = 'bold 5px sans-serif';
        c.textAlign = 'center';
        c.fillText('TAXI', 0, 11);

        // Classic Ambassador Chrome Rear Bumper with Overriders
        c.fillStyle = '#CFD8DC';
        c.fillRect(-23, 17, 46, 4.5);
        c.fillStyle = '#ECEFF1';
        c.fillRect(-23, 17, 46, 1.5);
        // Chrome Overriders (vertical bumper guards)
        c.fillStyle = '#FFFFFF';
        c.fillRect(-14, 15, 3, 8);
        c.fillRect(11, 15, 3, 8);

        // Vintage Round Dual Red Taillights
        c.fillStyle = '#D50000';
        c.beginPath(); c.arc(-19, 7, 3.5, 0, Math.PI * 2); c.fill();
        c.beginPath(); c.arc(19, 7, 3.5, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#FF9100';
        c.beginPath(); c.arc(-19, 7, 1.5, 0, Math.PI * 2); c.fill();
        c.beginPath(); c.arc(19, 7, 1.5, 0, Math.PI * 2); c.fill();

        // Kolkata Commercial Number Plate (WB 02)
        c.fillStyle = '#FFEB3B';
        c.fillRect(-10, 8, 20, 5.5);
        c.strokeStyle = '#000';
        c.lineWidth = 0.5;
        c.strokeRect(-10, 8, 20, 5.5);
        c.fillStyle = '#000';
        c.font = 'bold 3.2px sans-serif';
        c.textAlign = 'center';
        c.fillText(this.plate || 'WB 02 E 5519', 0, 12);

      } else if (this.taxiType === 'MUMBAI_KAALI_PEELI') {
        // --- CLASSIC MUMBAI KAALI-PEELI TAXI ---
        // Lower Black Chassis / Bumper Base
        c.fillStyle = '#111111';
        c.beginPath();
        c.roundRect(-22, -2, 44, 26, [0, 0, 6, 6]);
        c.fill();

        // Rear Trunk / Boot Lid (Black metal with slight sheen)
        c.fillStyle = '#212121';
        c.beginPath();
        c.roundRect(-20, -14, 40, 16, [4, 4, 0, 0]);
        c.fill();

        // Slanted Rear Windshield
        c.fillStyle = '#263238';
        c.beginPath();
        c.moveTo(-18, -14); c.lineTo(18, -14); c.lineTo(15, -28); c.lineTo(-15, -28);
        c.closePath();
        c.fill();

        // Glass highlight
        c.fillStyle = 'rgba(255, 255, 255, 0.35)';
        c.beginPath();
        c.moveTo(-10, -14); c.lineTo(-4, -14); c.lineTo(2, -28); c.lineTo(-4, -28);
        c.closePath();
        c.fill();

        // Vibrant Yellow Roof & Upper Pillars (Classic Kaali-Peeli)
        c.fillStyle = '#FFD600';
        c.beginPath();
        c.roundRect(-16, -35, 32, 9, [4, 4, 2, 2]);
        c.fill();
        c.fillRect(-17, -28, 3, 14);
        c.fillRect(14, -28, 3, 14);

        // 3D Illuminated Roof TAXI Sign Box
        c.fillStyle = '#FFA000';
        c.fillRect(-9, -42, 18, 8);
        c.fillStyle = '#FFF9C4';
        c.fillRect(-8, -41, 16, 6);
        c.fillStyle = '#000000';
        c.font = 'bold 4.5px sans-serif';
        c.textAlign = 'center';
        c.fillText('TAXI', 0, -36.5);

        // Chrome Rear Bumper Bar
        c.fillStyle = '#CFD8DC';
        c.fillRect(-22, 18, 44, 4);
        c.fillStyle = '#ECEFF1';
        c.fillRect(-22, 18, 44, 1.5);

        // Glowing Dual Red Taillights
        c.fillStyle = '#FF1744'; c.fillRect(-20, 4, 7, 7);
        c.fillStyle = '#FF9100'; c.fillRect(-20, 11, 7, 3);
        c.fillStyle = '#FF1744'; c.fillRect(13, 4, 7, 7);
        c.fillStyle = '#FF9100'; c.fillRect(13, 11, 7, 3);

        // Yellow Commercial Number Plate
        c.fillStyle = '#FFEB3B';
        c.fillRect(-10, 8, 20, 6);
        c.strokeStyle = '#000';
        c.lineWidth = 0.5;
        c.strokeRect(-10, 8, 20, 6);
        c.fillStyle = '#000';
        c.font = 'bold 3.5px sans-serif';
        c.textAlign = 'center';
        c.fillText(this.plate || 'MH 01 BK 9024', 0, 12.5);

      } else {
        // --- MODERN CITY SEDAN CAB (DELHI / BANGALORE / CHENNAI) ---
        c.fillStyle = '#FAFAFA'; // White/Silver Base
        c.beginPath();
        c.roundRect(-22, -4, 44, 26, [4, 4, 6, 6]);
        c.fill();
        c.beginPath();
        c.roundRect(-20, -15, 40, 15, [4, 4, 0, 0]);
        c.fill();

        // Delhi Green CNG Stripe
        if (this.taxiType === 'DELHI_CNG_CAB') {
          c.fillStyle = '#2E7D32';
          c.fillRect(-22, 2, 44, 3.5);
          c.fillStyle = '#FFD600';
          c.fillRect(-22, 5.5, 44, 1.5);
        }

        // Slanted Rear Windshield
        c.fillStyle = '#212121';
        c.beginPath();
        c.moveTo(-18, -15); c.lineTo(18, -15); c.lineTo(15, -30); c.lineTo(-15, -30);
        c.closePath();
        c.fill();

        // Roof Taxi Sign
        c.fillStyle = '#FAFAFA';
        c.beginPath(); c.roundRect(-16, -34, 32, 6, [3, 3, 0, 0]); c.fill();
        c.fillStyle = '#FFC107';
        c.fillRect(-8, -40, 16, 7);
        c.fillStyle = '#000';
        c.font = 'bold 4px sans-serif';
        c.textAlign = 'center';
        c.fillText('TAXI', 0, -35);

        // Modern Taillights
        c.fillStyle = '#D50000'; c.fillRect(-21, 0, 8, 7);
        c.fillStyle = '#FF9100'; c.fillRect(-21, 7, 8, 2.5);
        c.fillStyle = '#D50000'; c.fillRect(13, 0, 8, 7);
        c.fillStyle = '#FF9100'; c.fillRect(13, 7, 8, 2.5);

        // Commercial Plate
        c.fillStyle = '#FFEB3B';
        c.fillRect(-10, 9, 20, 5.5);
        c.strokeStyle = '#000';
        c.lineWidth = 0.5;
        c.strokeRect(-10, 9, 20, 5.5);
        c.fillStyle = '#000';
        c.font = 'bold 3.2px sans-serif';
        c.textAlign = 'center';
        c.fillText(this.plate || 'DL 1Y A 3820', 0, 13);
      }

      // Black rubber mudflaps
      c.fillStyle = '#111';
      c.fillRect(-21, 24, 6, 5);
      c.fillRect(15, 24, 6, 5);

    } else if (this.type === 'car') {
      // --- DRAW 3D REAR-PERSPECTIVE PASSENGER CAR (Hatchback/Sedan) ---
      // Rear Tires
      c.fillStyle = '#1A1A1A';
      c.fillRect(-21, 12, 6, 16);
      c.fillRect(15, 12, 6, 16);

      // Main Lower Rear Body (Assorted Colors: White, Red, Silver, Blue, Grey)
      c.fillStyle = this.color;
      c.beginPath();
      c.roundRect(-22, -4, 44, 26, [4, 4, 6, 6]);
      c.fill();

      // Tailgate / Boot upper section
      c.beginPath();
      c.roundRect(-20, -15, 40, 15, [4, 4, 0, 0]);
      c.fill();

      // Slanted Rear Windshield
      c.fillStyle = '#212121';
      c.beginPath();
      c.moveTo(-18, -15);
      c.lineTo(18, -15);
      c.lineTo(15, -30);
      c.lineTo(-15, -30);
      c.closePath();
      c.fill();

      // Glass highlight
      c.fillStyle = 'rgba(255, 255, 255, 0.4)';
      c.beginPath();
      c.moveTo(-8, -15);
      c.lineTo(-3, -15);
      c.lineTo(3, -30);
      c.lineTo(-2, -30);
      c.closePath();
      c.fill();

      // Rear glass wiper
      c.strokeStyle = '#000';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(0, -16);
      c.lineTo(8, -22);
      c.stroke();

      // Roof & Roof Spoiler
      c.fillStyle = this.color;
      c.beginPath();
      c.roundRect(-16, -34, 32, 6, [3, 3, 0, 0]);
      c.fill();

      // 3rd Brake Light (High mount)
      c.fillStyle = '#D50000';
      c.fillRect(-4, -32, 8, 1.8);

      // Modern Sculpted Wrap-Around Taillights
      // Left Lamp
      c.fillStyle = '#D50000';
      c.beginPath();
      c.roundRect(-21, 0, 8, 7, [2, 0, 0, 2]);
      c.fill();
      c.fillStyle = '#FF9100';
      c.fillRect(-21, 7, 8, 2.5);
      // Right Lamp
      c.fillStyle = '#D50000';
      c.beginPath();
      c.roundRect(13, 0, 8, 7, [0, 2, 2, 0]);
      c.fill();
      c.fillStyle = '#FF9100';
      c.fillRect(13, 7, 8, 2.5);

      // Chrome Brand Emblem
      c.fillStyle = '#ECEFF1';
      c.beginPath();
      c.arc(0, 3, 2.5, 0, Math.PI * 2);
      c.fill();

      // White Private Registration Plate
      c.fillStyle = '#FFFFFF';
      c.fillRect(-10, 9, 20, 5.5);
      c.strokeStyle = '#000';
      c.lineWidth = 0.5;
      c.strokeRect(-10, 9, 20, 5.5);
      c.fillStyle = '#000';
      c.font = 'bold 3.5px sans-serif';
      c.textAlign = 'center';
      c.fillText('MH 02 CZ 4410', 0, 13);

      // Lower bumper diffuser
      c.fillStyle = '#212121';
      c.fillRect(-18, 18, 36, 4);

    } else if (this.type === 'bus') {
      // --- DRAW 3D REAR-PERSPECTIVE CITY BUS (BEST / DTC / BMTC / WBTC / MTC) ---
      // Heavy Rear Dual Tires
      c.fillStyle = '#1A1A1A';
      c.fillRect(-26, 26, 7, 18);
      c.fillRect(19, 26, 7, 18);

      // Tall Boxy Body Structure (BEST Red / DTC Blue / BMTC Cyan / WBTC Blue)
      c.fillStyle = this.color || '#C62828';
      c.beginPath();
      c.roundRect(-27, -48, 54, 80, [6, 6, 2, 2]);
      c.fill();

      // Roof Cap (White / Cream)
      c.fillStyle = this.roofColor || '#EEEEEE';
      c.beginPath();
      c.roundRect(-26, -52, 52, 7, [4, 4, 0, 0]);
      c.fill();

      // Top Illuminated Route & Destination LED Matrix Board
      c.fillStyle = '#111111';
      c.fillRect(-24, -45, 48, 10);
      c.fillStyle = '#FFD54F'; // Amber LED text
      c.font = 'bold 4.2px monospace';
      c.textAlign = 'center';
      c.fillText(this.routeText || 'ROUTE 302: DADAR', 0, -38);

      // Large Rear Passenger Window
      c.fillStyle = '#263238';
      c.fillRect(-23, -32, 46, 20);
      c.strokeStyle = '#37474F';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(0, -32); c.lineTo(0, -12);
      c.stroke();

      // Passenger silhouettes inside bus
      c.fillStyle = 'rgba(0, 0, 0, 0.6)';
      c.beginPath();
      c.arc(-14, -20, 4, 0, Math.PI * 2);
      c.arc(-5, -20, 4, 0, Math.PI * 2);
      c.arc(7, -20, 4, 0, Math.PI * 2);
      c.arc(16, -20, 4, 0, Math.PI * 2);
      c.fill();

      // Safety text / Emergency exit
      c.fillStyle = '#D50000';
      c.font = 'bold 4px sans-serif';
      c.textAlign = 'center';
      c.fillText('EMERGENCY EXIT', 0, -7);

      // Engine cooling louvers/vents
      c.fillStyle = '#212121';
      c.fillRect(-20, 0, 40, 10);
      c.strokeStyle = '#424242';
      c.lineWidth = 1;
      for (let ly = 2; ly <= 8; ly += 2.5) {
        c.beginPath();
        c.moveTo(-18, ly); c.lineTo(18, ly);
        c.stroke();
      }

      // Triple Stacked Rear Taillights (Red / Amber / White)
      c.fillStyle = '#D50000'; c.fillRect(-25, 4, 4, 4);
      c.fillStyle = '#FF9100'; c.fillRect(-25, 9, 4, 3);
      c.fillStyle = '#EEEEEE'; c.fillRect(-25, 13, 4, 3);
      c.fillStyle = '#D50000'; c.fillRect(21, 4, 4, 4);
      c.fillStyle = '#FF9100'; c.fillRect(21, 9, 4, 3);
      c.fillStyle = '#EEEEEE'; c.fillRect(21, 13, 4, 3);

      // Heavy Bumper with Yellow & Black Diagonal Hazard Stripes
      c.fillStyle = '#FFD600';
      c.fillRect(-27, 20, 54, 8);
      c.strokeStyle = '#111';
      c.lineWidth = 2;
      for (let bx = -24; bx <= 24; bx += 8) {
        c.beginPath();
        c.moveTo(bx - 3, 20);
        c.lineTo(bx + 3, 28);
        c.stroke();
      }

      // License Plate
      c.fillStyle = '#FFEB3B';
      c.fillRect(-12, 13, 24, 5.5);
      c.fillStyle = '#000';
      c.font = 'bold 3.2px sans-serif';
      c.textAlign = 'center';
      c.fillText(this.plate || 'MH 01 L 5590', 0, 17);

      // Oversized Mudflaps with Red Reflectors
      c.fillStyle = '#111';
      c.fillRect(-26, 28, 9, 10);
      c.fillRect(17, 28, 9, 10);
      c.fillStyle = '#FF1744';
      c.fillRect(-24, 33, 5, 2.5);
      c.fillRect(19, 33, 5, 2.5);

    } else if (this.type === 'scooter') {
      // --- DRAW 3D REAR-PERSPECTIVE MOTORBIKE / SCOOTER ---
      // Rear Tire
      c.fillStyle = '#111';
      c.fillRect(-4, 8, 8, 18);

      // Chassis & Mudguard
      c.fillStyle = this.color;
      c.beginPath();
      c.roundRect(-9, -2, 18, 14, [4, 4, 0, 0]);
      c.fill();

      // Taillight
      c.fillStyle = '#FF1744';
      c.fillRect(-5, 0, 10, 4);

      // License Plate
      c.fillStyle = '#FFEB3B';
      c.fillRect(-6, 5, 12, 4);
      c.fillStyle = '#000';
      c.font = 'bold 2.5px sans-serif';
      c.textAlign = 'center';
      c.fillText('MH 04 88', 0, 8);

      // Exhaust Pipe on Right
      c.fillStyle = '#CFD8DC';
      c.fillRect(6, 12, 3, 10);

      // Rider Torso (Back profile)
      c.fillStyle = '#37474F'; // Jacket/shirt
      c.beginPath();
      c.roundRect(-10, -22, 20, 20, [6, 6, 2, 2]);
      c.fill();

      // Rider Arms extending to Handlebars
      c.strokeStyle = '#37474F';
      c.lineWidth = 3.5;
      c.beginPath();
      c.moveTo(-8, -18); c.lineTo(-14, -14);
      c.moveTo(8, -18); c.lineTo(14, -14);
      c.stroke();

      // Handlebars and Side Mirrors
      c.fillStyle = '#CFD8DC';
      c.fillRect(-15, -16, 30, 2);
      // Mirrors
      c.fillStyle = '#ECEFF1';
      c.fillRect(-16, -20, 3, 4);
      c.fillRect(13, -20, 3, 4);

      // Rider Helmet (Head from back)
      c.fillStyle = this.helmetColor;
      c.beginPath();
      c.arc(0, -28, 7.5, 0, Math.PI * 2);
      c.fill();
      // Helmet dark visor band
      c.fillStyle = '#111';
      c.fillRect(-6, -29, 12, 3);

    } else if (this.type === 'truck') {
      // --- DRAW 3D REAR-PERSPECTIVE TRUCK ("HORN OK PLEASE") ---
      c.fillStyle = '#1A1A1A';
      c.fillRect(-26, 20, 6, 18);
      c.fillRect(20, 20, 6, 18);

      // Heavy Wooden Cargo Box (Traditional painted frame)
      c.fillStyle = '#D32F2F'; // Red frame
      c.fillRect(-24, -40, 48, 62);
      c.fillStyle = '#FFEB3B'; // Bright yellow inner cargo panel
      c.fillRect(-21, -36, 42, 54);

      // "HORN OK PLEASE" painted across the yellow back panel
      c.fillStyle = '#000000';
      c.font = 'bold 8.5px sans-serif';
      c.textAlign = 'center';
      c.fillText('HORN', 0, -22);
      c.fillText('OK', 0, -10);
      c.fillText('PLEASE', 0, 2);

      // Traditional subtext "DEKHO MAGAR PYAAR SE"
      c.fillStyle = '#D32F2F';
      c.font = 'bold 3.5px sans-serif';
      c.fillText('DEKHO MAGAR PYAAR SE', 0, 11);

      // Hanging Nazar Battu / Black Tassels on bottom corners
      c.strokeStyle = '#111';
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(-22, 22); c.lineTo(-24, 30);
      c.moveTo(22, 22); c.lineTo(24, 30);
      c.stroke();
      c.fillStyle = '#000';
      c.beginPath();
      c.arc(-24, 30, 2, 0, Math.PI * 2);
      c.arc(24, 30, 2, 0, Math.PI * 2);
      c.fill();

      // Bumper Hazard Stripes
      c.fillStyle = '#FFFF00';
      c.fillRect(-24, 16, 48, 8);
      c.strokeStyle = '#000000';
      c.lineWidth = 2;
      for (let sx = -20; sx <= 20; sx += 8) {
        c.beginPath();
        c.moveTo(sx - 3, 16);
        c.lineTo(sx + 3, 24);
        c.stroke();
      }

      // Yellow license plate
      c.fillStyle = '#FFEB3B';
      c.fillRect(-10, 8, 20, 5);
      c.fillStyle = '#000';
      c.font = 'bold 3.5px sans-serif';
      c.fillText('MH 02 BG 4821', 0, 12);

    } else if (this.type === 'bicycle') {
      // --- DRAW 3D REAR-PERSPECTIVE DOODHWALA BICYCLE ---
      // Rear tire
      c.fillStyle = '#111';
      c.fillRect(-2, 2, 4, 18);

      // Rear mudguard
      c.fillStyle = '#78909C';
      c.fillRect(-2.5, -4, 5, 8);

      // Luggage carrier frame
      c.strokeStyle = '#546E7A';
      c.lineWidth = 2;
      c.strokeRect(-8, -8, 16, 6);

      // Two Large Stainless Steel Milk Canisters hanging on left & right
      c.fillStyle = '#ECEFF1'; // Silver stainless steel
      c.beginPath();
      c.roundRect(-14, -6, 8, 15, 2);
      c.roundRect(6, -6, 8, 15, 2);
      c.fill();
      c.strokeStyle = '#B0BEC5';
      c.lineWidth = 1;
      c.strokeRect(-14, -6, 8, 15);
      c.strokeRect(6, -6, 8, 15);
      // Canister Lids & Handles
      c.fillStyle = '#37474F';
      c.fillRect(-13, -8, 6, 2);
      c.fillRect(7, -8, 6, 2);

      // Rider Torso (Kurta)
      c.fillStyle = '#1E88E5'; // Blue kurta
      c.beginPath();
      c.roundRect(-7, -24, 14, 18, [4, 4, 0, 0]);
      c.fill();

      // Rider Head with Nehru Cap / Turban
      c.fillStyle = '#FFCC80';
      c.beginPath();
      c.arc(0, -29, 5, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#ECEFF1'; // White cap
      c.fillRect(-4, -34, 8, 4);

    } else if (this.type === 'dog') {
      // --- DRAW STRAY DOG (Trotting Profile) ---
      let walkCycle = Math.sin(Date.now() * 0.015);
      c.strokeStyle = '#C68E17';
      c.lineWidth = 3;
      
      c.beginPath();
      c.moveTo(-6, 2); c.lineTo(-9 + walkCycle * 4, 16);
      c.moveTo(-3, 2); c.lineTo(-1 - walkCycle * 4, 16);
      c.moveTo(4, 2); c.lineTo(2 + walkCycle * 4, 16);
      c.moveTo(7, 2); c.lineTo(9 - walkCycle * 4, 16);
      c.stroke();

      // Body
      c.fillStyle = '#D2B48C';
      c.beginPath();
      c.ellipse(0, -2, 12, 8, Math.PI / 16, 0, Math.PI * 2);
      c.fill();

      // Head
      c.beginPath();
      c.ellipse(-10, -10, 7, 7, 0, 0, Math.PI * 2);
      c.fill();

      // Wagging tail
      c.save();
      c.translate(10, -6);
      c.rotate(Math.sin(Date.now() * 0.22) * 0.4);
      c.strokeStyle = '#D2B48C';
      c.lineWidth = 3.5;
      c.beginPath();
      c.arc(0, 0, 8, Math.PI, Math.PI * 1.7);
      c.stroke();
      c.restore();

    } else if (this.type === 'pothole') {
      // --- DRAW POTHOLE (Road surface crater) ---
      c.fillStyle = '#1C2833';
      c.beginPath();
      c.ellipse(0, 0, 18, 10, 0, 0, Math.PI * 2);
      c.fill();

      c.strokeStyle = '#34495E';
      c.lineWidth = 2;
      c.stroke();

      c.strokeStyle = '#273746';
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(-18, 0); c.lineTo(-24, -2);
      c.moveTo(18, 0); c.lineTo(24, 3);
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
    this.y += state.speed * WORLD_SPEED_MULT;
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
      this.y += state.speed * WORLD_SPEED_MULT;
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
    this.y += state.speed * WORLD_SPEED_MULT;
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
    this.y += state.speed * WORLD_SPEED_MULT;
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
  // Pre-seed traffic ahead on the road so lively Indian traffic is visible from the very first second
  obstacles = [
    new Obstacle(0, 'bus', 60),      // Red city bus ahead in left lane
    new Obstacle(1, 'taxi', 180),    // Kaali-Peeli taxi in center lane
    new Obstacle(2, 'scooter', 300), // Commuter scooter in right lane
    new Obstacle(1, 'cow', -60),     // Sacred cow standing ahead
    new Obstacle(0, 'car', -180),    // Modern passenger car approaching
    new Obstacle(2, 'bicycle', -290) // Doodhwala delivery bicycle
  ];
  collectibles = [];
  particles = [];
  scenery = [];
  state.passenger = null;
  state.destination = null;

  // Pre-fill some scenery along the highway
  for (let y = 80; y < GAME_HEIGHT; y += 90) {
    scenery.push(new SceneryItem(y));
  }

  nextSpawns = {
    obstacle: 25,
    collectible: 20,
    scenery: 10,
    passenger: 300
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

// 3D Perspective Road segments loop (High Clarity & Indian Street Realism)
function drawRoad3D(c) {
  // Fill the ground area below the horizon with realistic paver sidewalk tone
  c.fillStyle = '#8D7B68'; // Dusty roadside earth tone
  c.fillRect(0, HORIZON_Y, GAME_WIDTH, GAME_HEIGHT - HORIZON_Y);

  let startZ = - (roadOffset % SEGMENT_LENGTH);
  let segmentIndex = Math.floor(roadOffset / SEGMENT_LENGTH);
  
  // Loop segments starting from behind the camera (z = startZ - 120) to cover bottom of screen
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
    
    // Segment alternating index
    let activeIdx = segmentIndex + Math.floor(z / SEGMENT_LENGTH);
    let isEven = (activeIdx % 2 === 0);
    
    // 1. Interlocking Paver Sidewalks (Indian Footpath Tiles)
    c.fillStyle = isEven ? '#A08875' : '#B29B88';
    c.fillRect(0, p2_left.y, GAME_WIDTH, p1_left.y - p2_left.y + 1);
    
    // Sidewalk curb-edge dust verge
    let p1_vergL = project(ROAD.leftBorder - 18, y1);
    let p2_vergL = project(ROAD.leftBorder - 18, y2);
    let p1_vergR = project(ROAD.rightBorder + 18, y1);
    let p2_vergR = project(ROAD.rightBorder + 18, y2);
    c.fillStyle = isEven ? '#7D6A58' : '#887563';
    c.fillRect(0, p2_vergL.y, p1_vergL.x, p1_vergL.y - p2_vergL.y + 1);
    c.fillRect(p1_vergR.x, p2_vergR.y, GAME_WIDTH - p1_vergR.x, p1_vergR.y - p2_vergR.y + 1);

    // 2. High-Contrast Asphalt Road Center (Charcoal Bitumen Tarmac)
    c.fillStyle = isEven ? '#24272A' : '#2A2E32';
    c.beginPath();
    c.moveTo(p1_left.x, p1_left.y);
    c.lineTo(p2_left.x, p2_left.y);
    c.lineTo(p2_right.x, p2_right.y);
    c.lineTo(p1_right.x, p1_right.y);
    c.fill();
    
    // 3. Indian Municipal Alternating Yellow & Black Kerbstones (Curb Blocks with 3D Bevel)
    let curbColor = isEven ? '#FFD600' : '#1A1A1A'; // Classic Mumbai/Delhi municipal curbs
    c.fillStyle = curbColor;
    
    // Left Curb Stone
    let p1_curbL = project(ROAD.leftBorder - 10, y1);
    let p2_curbL = project(ROAD.leftBorder - 10, y2);
    c.beginPath();
    c.moveTo(p1_curbL.x, p1_curbL.y);
    c.lineTo(p2_curbL.x, p2_curbL.y);
    c.lineTo(p2_left.x, p2_left.y);
    c.lineTo(p1_left.x, p1_left.y);
    c.fill();
    
    // Right Curb Stone
    let p1_curbR = project(ROAD.rightBorder + 10, y1);
    let p2_curbR = project(ROAD.rightBorder + 10, y2);
    c.beginPath();
    c.moveTo(p1_right.x, p1_right.y);
    c.lineTo(p2_right.x, p2_right.y);
    c.lineTo(p2_curbR.x, p2_curbR.y);
    c.lineTo(p1_curbR.x, p1_curbR.y);
    c.fill();

    // Curb 3D Top-Edge Highlight
    c.fillStyle = isEven ? '#FFF176' : '#424242';
    let p1_edgeL = project(ROAD.leftBorder - 2, y1);
    let p2_edgeL = project(ROAD.leftBorder - 2, y2);
    c.beginPath();
    c.moveTo(p1_edgeL.x, p1_edgeL.y);
    c.lineTo(p2_edgeL.x, p2_edgeL.y);
    c.lineTo(p2_left.x, p2_left.y);
    c.lineTo(p1_left.x, p1_left.y);
    c.fill();
    
    // 4. Solid White Edge Lines (Tar border boundary)
    c.fillStyle = '#ECEFF1';
    let p1_edg1 = project(ROAD.leftBorder + 3, y1);
    let p2_edg1 = project(ROAD.leftBorder + 3, y2);
    let p1_edg2 = project(ROAD.rightBorder - 3, y1);
    let p2_edg2 = project(ROAD.rightBorder - 3, y2);
    let edgeW1 = 2.0 * p1_left.scale;
    let edgeW2 = 2.0 * p2_left.scale;

    c.beginPath();
    c.moveTo(p1_edg1.x, p1_edg1.y); c.lineTo(p2_edg1.x, p2_edg1.y);
    c.lineTo(p2_edg1.x + edgeW2, p2_edg1.y); c.lineTo(p1_edg1.x + edgeW1, p1_edg1.y);
    c.fill();

    c.beginPath();
    c.moveTo(p1_edg2.x, p1_edg2.y); c.lineTo(p2_edg2.x, p2_edg2.y);
    c.lineTo(p2_edg2.x - edgeW2, p2_edg2.y); c.lineTo(p1_edg2.x - edgeW1, p1_edg2.y);
    c.fill();
    
    // 5. Dashed Yellow Lane Lines & Cat's Eyes Road Studs
    if (isEven) {
      c.fillStyle = '#FFD54F'; // Vibrant Indian Yellow Lane Paint
      let laneW = ROAD.width / 3;
      
      let p1_ln1 = project(ROAD.leftBorder + laneW, y1);
      let p2_ln1 = project(ROAD.leftBorder + laneW, y2);
      let p1_ln2 = project(ROAD.leftBorder + laneW * 2, y1);
      let p2_ln2 = project(ROAD.leftBorder + laneW * 2, y2);
      
      let sw1 = 3.2 * p1_left.scale;
      let sw2 = 3.2 * p2_left.scale;
      
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

      // Retroreflective Road Studs ("Cat's Eyes" along lane dividers)
      let studSize = Math.max(1.2, 3.0 * p1_left.scale);
      c.fillStyle = '#FFFDE7';
      c.beginPath();
      c.arc(p1_ln1.x, p1_ln1.y, studSize, 0, Math.PI * 2);
      c.arc(p1_ln2.x, p1_ln2.y, studSize, 0, Math.PI * 2);
      c.fill();
      // Amber reflector highlight
      c.fillStyle = '#FFA000';
      c.beginPath();
      c.arc(p1_ln1.x, p1_ln1.y, studSize * 0.5, 0, Math.PI * 2);
      c.arc(p1_ln2.x, p1_ln2.y, studSize * 0.5, 0, Math.PI * 2);
      c.fill();
    }
  }

  // Taper asphalt road to horizon vanishing center point
  let lastZ = 1800;
  let y_last = PLAYER_Y - lastZ;
  let p_last_L = project(ROAD.leftBorder, y_last);
  let p_last_R = project(ROAD.rightBorder, y_last);
  let p_horizon = project(ROAD_CENTER_X, PLAYER_Y - 5000);
  
  c.fillStyle = '#24272A';
  c.beginPath();
  c.moveTo(p_last_L.x, p_last_L.y);
  c.lineTo(p_horizon.x, HORIZON_Y);
  c.lineTo(p_last_R.x, p_last_R.y);
  c.closePath();
  c.fill();

  // Smooth atmospheric perspective haze gradient near horizon
  let hazeGrad = c.createLinearGradient(0, HORIZON_Y, 0, HORIZON_Y + 110);
  let hazeColor = '#FF8A80'; // fallback
  if (state.city === 'delhi') hazeColor = '#FFCC80';
  else if (state.city === 'mumbai') hazeColor = '#FF80AB';
  else if (state.city === 'bangalore') hazeColor = '#E040FB';
  else if (state.city === 'chennai') hazeColor = '#FFD54F';
  else hazeColor = '#80DEEA'; // kolkata
  
  hazeGrad.addColorStop(0, hazeColor);
  hazeGrad.addColorStop(0.2, hazeColor);
  hazeGrad.addColorStop(1, 'transparent');
  c.fillStyle = hazeGrad;
  c.fillRect(0, HORIZON_Y, GAME_WIDTH, 110);
  
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

  // Honking alerts nearby traffic and clears the road path
  obstacles.forEach(item => {
    const distY = rickshaw ? (rickshaw.y - item.y) : 0;
    const distX = rickshaw ? Math.abs(rickshaw.x - item.x) : 0;
    if (distY > 0 && distY < 240 && distX < 70) {
      if (item.type === 'dog' || item.type === 'bicycle') {
        // Nudges towards roadside curb safely
        item.x += (item.x < ROAD_CENTER_X ? -18 : 18);
      } else if (item.type === 'car' || item.type === 'taxi' || item.type === 'scooter') {
        // Accelerates forward to ease traffic flow
        item.speed += 0.5;
      } else if (item.type === 'cow') {
        // Peaceful floral sparkle
        spawnBlessingPetals(item.x, item.y);
      }
    }
  });
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

// Sacred flower petals & divine sparkles on Cow's Blessing
function spawnBlessingPetals(x, y) {
  const petalColors = ['#FF9800', '#FFEB3B', '#FF5722', '#E91E63', '#FFF176'];
  for (let i = 0; i < 22; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.0 + Math.random() * 3.5;
    const color = petalColors[Math.floor(Math.random() * petalColors.length)];
    particles.push(new Particle(
      x + (Math.random() - 0.5) * 30,
      y + (Math.random() - 0.5) * 20,
      color,
      3.5 + Math.random() * 3,
      Math.cos(angle) * speed,
      Math.sin(angle) * speed - 1.8, // Float upwards
      45 + Math.random() * 30,
      'petal'
    ));
  }
  for (let i = 0; i < 12; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.8 + Math.random() * 2.5;
    particles.push(new Particle(
      x,
      y,
      '#FFF9C4',
      2.5 + Math.random() * 2,
      Math.cos(angle) * speed,
      Math.sin(angle) * speed - 1.2,
      35 + Math.random() * 20,
      'sparkle'
    ));
  }
}

// Sacred Cow Blessing Toast Notification Helper
let blessingToastTimeout = null;
function showBlessingBanner(text) {
  const toast = document.getElementById('blessing-toast');
  const msg = document.getElementById('blessing-msg');
  if (toast && msg) {
    msg.innerText = text;
    toast.classList.remove('hidden');
    if (blessingToastTimeout) clearTimeout(blessingToastTimeout);
    blessingToastTimeout = setTimeout(() => {
      toast.classList.add('hidden');
    }, 2800);
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
    // 1. Acceleration / Engine Physics (Calibrated to Authentic Indian City Speeds)
    state.targetSpeed = state.maxSpeed;
    
    // Cutting Chai speed boost
    if (state.activeShield > 0) {
      state.targetSpeed = state.maxSpeed * 1.55; // Reaches ~48-52 km/h top boost
      state.activeShield--;
      // Update UI bar
      const bar = document.getElementById('shield-bar');
      bar.style.width = (state.activeShield / state.activeShieldMax) * 100 + '%';
      if (state.activeShield === 0) {
        document.getElementById('shield-gauge-container').classList.add('hidden');
      }
    }

    // Smooth speed interpolation
    state.speed += (state.targetSpeed - state.speed) * 0.04;
    gameAudio.setEngineSpeed(state.speed / state.maxSpeed);

    // Continuous 3D Road Scroll Animation (Brisk, exciting visual motion)
    roadOffset += state.speed * 4.2;

    // Track statistics (Real-world calibrated numbers)
    state.distance += state.speed * 0.03;
    document.getElementById('distance-val').innerText = (state.distance / 10).toFixed(1) + ' km';
    // Calibrated speedometer: cruising ~28-34 km/h, boost ~48-52 km/h
    document.getElementById('speed-val').innerText = Math.round(state.speed * 12) + ' km/h';

    // Difficulty Level Scaling
    state.level = 1 + Math.floor(state.distance / 100);
    state.maxSpeed = 2.6 + (state.level * 0.12); // Subtle realistic progression

    // 2. Handle Player
    rickshaw.update();

    // 3. Spawn Entities (Rich Traffic Variety & Rare Potholes)
    nextSpawns.obstacle--;
    if (nextSpawns.obstacle <= 0) {
      const lane = Math.floor(Math.random() * 3);
      // Weighted selection for rich traffic variety with reduced potholes:
      const rand = Math.random();
      let type;
      if (rand < 0.18) type = 'car';        // 18% Private Cars
      else if (rand < 0.36) type = 'taxi';  // 18% Kaali-Peeli Taxis
      else if (rand < 0.52) type = 'scooter';// 16% Two-wheelers
      else if (rand < 0.66) type = 'truck'; // 14% Cargo Trucks
      else if (rand < 0.78) type = 'bus';   // 12% City Buses
      else if (rand < 0.88) type = 'cow';   // 10% Sacred Cows (Blessings!)
      else if (rand < 0.94) type = 'bicycle';// 6% Doodhwala Cyclists
      else if (rand < 0.97) type = 'dog';   // 3% Stray Dogs
      else type = 'pothole';                // Only 3% Potholes!

      obstacles.push(new Obstacle(lane, type, -120));
      nextSpawns.obstacle = Math.max(14, 28 - state.level * 2) + Math.random() * 16;
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
      nextSpawns.collectible = 25 + Math.random() * 35;
    }

    nextSpawns.scenery--;
    if (nextSpawns.scenery <= 0) {
      scenery.push(new SceneryItem());
      // Spawn scenery extremely frequently for a packed, bustling street appearance
      nextSpawns.scenery = 4 + Math.random() * 4;
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
          state.health = Math.min(state.maxHealth, state.health + 10);
          document.getElementById('health-bar').style.width = state.health + '%';
          const hNum = document.getElementById('health-num');
          if (hNum) hNum.innerText = Math.round(state.health) + '%';
          gameAudio.playHeal();
          spawnCoinSparkles(item.x, item.y);
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
        state.passenger = null;
        document.getElementById('passenger-status').classList.add('hidden');
      }
    }

    // 7. Update Obstacles & Traffic
    obstacles.forEach(item => item.update());
    
    // Obstacle Collisions & Sacred Cow Blessings
    obstacles.forEach((item, index) => {
      if (checkCollision(rickshaw.getBounds(), item.getBounds())) {
        if (item.type === 'cow') {
          // --- SACRED COW BLESSING (Gau Mata's Auspicious Grace) ---
          // Restores +15 HP, grants bonus rupees, showers marigold petals & plays temple chime!
          state.health = Math.min(state.maxHealth, state.health + 15);
          state.score += 50;
          document.getElementById('health-bar').style.width = state.health + '%';
          const hNum = document.getElementById('health-num');
          if (hNum) hNum.innerText = Math.round(state.health) + '%';
          document.getElementById('score-val').innerText = '₹ ' + state.score;
          
          gameAudio.playTempleBell();
          spawnBlessingPetals(item.x, item.y);
          showBlessingBanner("Gau Mata's Blessing! 🙏 +Health & +₹50");
          
          obstacles.splice(index, 1);
        } else if (state.activeShield > 0) {
          // Shield blocks the collision, blows up the traffic obstacle instead!
          spawnSparks(item.x, item.y, '#00E5FF');
          gameAudio.playCrash();
          obstacles.splice(index, 1);
          triggerScreenShake(8);
        } else {
          // Regular vehicular / road hazard damage taken
          state.health -= item.damage;
          document.getElementById('health-bar').style.width = Math.max(0, state.health) + '%';
          const hNum = document.getElementById('health-num');
          if (hNum) hNum.innerText = Math.max(0, Math.round(state.health)) + '%';
          
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

  // Traffic and obstacles (Cows, Cars, Taxis, Buses, Scooters, Trucks, Potholes)
  obstacles.forEach(item => {
    renderList.push({ y: item.y, draw: (c) => item.draw(c) });
  });

  // Player auto-rickshaw (only visible in zoomed out / third-person follow view)
  if (rickshaw && state.cameraMode === 'zoomed') {
    renderList.push({ y: rickshaw.y, draw: (c) => rickshaw.draw(c) });
  }

  // Particle systems (Smoke, sparks, petals)
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
  const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  if (window.innerWidth < 768 || isTouchDevice) {
    document.getElementById('touch-controls').classList.remove('hidden');
  }

  // Reset Game States
  state.score = 0;
  state.distance = 0;
  state.level = 1;
  state.speed = 0;
  state.maxSpeed = 2.6;
  state.targetSpeed = 0;
  state.health = 100;
  state.activeShield = 0;
  roadOffset = 0;
  
  document.getElementById('score-val').innerText = '₹ 0';
  document.getElementById('distance-val').innerText = '0.0 km';
  document.getElementById('speed-val').innerText = '0 km/h';
  document.getElementById('health-bar').style.width = '100%';
  const hNum = document.getElementById('health-num');
  if (hNum) hNum.innerText = '100%';
  document.getElementById('shield-gauge-container').classList.add('hidden');
  document.getElementById('passenger-status').classList.add('hidden');
  document.getElementById('blessing-toast').classList.add('hidden');

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

// Carousel Route Cards click listeners (native browser click listener guarantees user gesture activation token)
document.querySelectorAll('.route-card').forEach(card => {
  card.addEventListener('click', () => {
    state.city = card.getAttribute('data-city') || 'mumbai';
    gameAudio.init(); // Play sounds on click context (100% unlocked by native click gesture)
    startGame();
  });
});

// HUD Exit Button
document.getElementById('hud-exit-btn').addEventListener('click', quitToMainMenu);

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

function syncAudioButtonUI() {
  const btn = document.getElementById('audio-toggle-btn');
  const audio = (typeof window !== 'undefined' && window.gameAudio) 
    ? window.gameAudio 
    : (typeof gameAudio !== 'undefined' ? gameAudio : null);

  if (!btn) return;

  const mode = audio && typeof audio.getAudioStateMode === 'function' 
    ? audio.getAudioStateMode() 
    : 'ALL_ON';

  btn.classList.remove('mode-all', 'mode-fx', 'mode-muted');

  if (mode === 'ALL_ON') {
    btn.classList.add('mode-all');
    btn.innerText = "Audio: Sounds & Music ON 🔊⚡";
  } else if (mode === 'FX_ONLY') {
    btn.classList.add('mode-fx');
    btn.innerText = "Audio: Sound FX Only 🔊🪘";
  } else {
    btn.classList.add('mode-muted');
    btn.innerText = "Audio: Muted 🔇";
  }
}

if (audioBtn) {
  audioBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const audio = (typeof window !== 'undefined' && window.gameAudio) 
      ? window.gameAudio 
      : (typeof gameAudio !== 'undefined' ? gameAudio : null);
    if (audio && typeof audio.cycleAudioState === 'function') {
      audio.cycleAudioState();
    }
    syncAudioButtonUI();
  });
}

// Synchronize audio button immediately on script load
syncAudioButtonUI();
// Also synchronize when DOM is fully loaded and ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', syncAudioButtonUI);
} else {
  syncAudioButtonUI();
}

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
