import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const GRID = {
  cols: 28,
  rows: 18,
  cell: 1,
};

const DIFFICULTIES = {
  easy:   { baseSpeed: 5,  maxSpeed: 12, accelEvery: 5, bonusThreshold: 3, bonusMoveEvery: 4, bonusLifetime: 7, wallThreshold: 10, wallInterval: [18, 25], wallWarning: 2000 },
  medium: { baseSpeed: 7,  maxSpeed: 16, accelEvery: 4, bonusThreshold: 5, bonusMoveEvery: 3, bonusLifetime: 5, wallThreshold: 7,  wallInterval: [12, 18], wallWarning: 1500 },
  hard:   { baseSpeed: 10, maxSpeed: 20, accelEvery: 3, bonusThreshold: 7, bonusMoveEvery: 2, bonusLifetime: 4, wallThreshold: 5,  wallInterval: [8, 14],  wallWarning: 1000 },
};
let difficulty = 'medium';
let diff = DIFFICULTIES.medium;

const DIRECTIONS = {
  up: { dx: 0, dy: -1, opposite: 'down' },
  down: { dx: 0, dy: 1, opposite: 'up' },
  left: { dx: -1, dy: 0, opposite: 'right' },
  right: { dx: 1, dy: 0, opposite: 'left' },
};

// ── DOM elements ──
const canvas = document.getElementById('gameCanvas');
const scoreValue = document.getElementById('scoreValue');
const bestValue = document.getElementById('bestValue');
const speedValue = document.getElementById('speedValue');
const finalScore = document.getElementById('finalScore');

const startOverlay = document.getElementById('startOverlay');
const gameOverOverlay = document.getElementById('gameOverOverlay');
const pauseOverlay = document.getElementById('pauseOverlay');
const settingsPanel = document.getElementById('settingsPanel');

const titleMenu = document.getElementById('titleMenu');
const gameOverMenu = document.getElementById('gameOverMenu');
const pauseMenu = document.getElementById('pauseMenu');
const soundBtn = document.getElementById('soundBtn');
const settingsBtn = document.getElementById('settingsBtn');
const rendererSelect = document.getElementById('rendererSelect');
const qualityBtn = document.getElementById('qualityBtn');
const touchButtons = Array.from(document.querySelectorAll('.dpad'));

// ── Game state ──
let snake = [];
let food = { x: 0, y: 0 };
let direction = 'right';
let nextDirection = 'right';
let running = false;
let paused = false;
let gameOver = false;
let score = 0;
let best = 0;
let speed = DIFFICULTIES.medium.baseSpeed;
let lastTime = 0;
let accumulator = 0;
let rafId = null;
let quality = 'high';
let rendererMode = 'webgl';
let activeMenu = 'title';
let menuFocus = 1;

let audioCtx = null;
let masterGain = null;
let soundEnabled = true;

let renderer;
let scene;
let camera;
let boardGroup;
let snakeGroup;
let foodMesh;
let shadowPlane;
let resizeObserver;

// ── Bonus (moving target) state ──
let bonus = null;
let bonusSpawnTimer = 0;
let bonusMesh = null;

// ── Walls state ──
let walls = [];
let wallSpawnTimer = 0;
let shakeIntensity = 0;
let shakeTime = 0;
let wallGroup;
let warningGroup;
let wallGeometry;
let warningGeometry;

const MATERIALS = {
  board: new THREE.MeshStandardMaterial({
    color: '#f2e9d8',
    roughness: 0.9,
    metalness: 0.0,
  }),
  paper: new THREE.MeshStandardMaterial({
    color: '#f8efe0',
    roughness: 0.95,
    metalness: 0.0,
  }),
  snake: new THREE.MeshStandardMaterial({
    color: '#e2b07a',
    roughness: 0.7,
    metalness: 0.05,
  }),
  snakeHead: new THREE.MeshStandardMaterial({
    color: '#d79c6a',
    roughness: 0.65,
    metalness: 0.05,
  }),
  berry: new THREE.MeshStandardMaterial({
    color: '#d06045',
    roughness: 0.5,
    metalness: 0.1,
  }),
  leaf: new THREE.MeshStandardMaterial({
    color: '#7d9b58',
    roughness: 0.6,
    metalness: 0.1,
  }),
  bonus: new THREE.MeshStandardMaterial({
    color: '#4fc3c9',
    roughness: 0.4,
    metalness: 0.2,
    transparent: true,
  }),
  wall: new THREE.MeshStandardMaterial({
    color: '#8a7e72',
    roughness: 0.85,
    metalness: 0.05,
  }),
  warning: new THREE.MeshBasicMaterial({
    color: '#000000',
    transparent: true,
    opacity: 0.25,
  }),
};

// ── Overlay helpers ──
const hideAllOverlays = () => {
  startOverlay.classList.add('hidden');
  gameOverOverlay.classList.add('hidden');
  pauseOverlay.classList.add('hidden');
};

const showOverlay = (overlay) => {
  hideAllOverlays();
  overlay.classList.remove('hidden');
};

// ── Audio ──
const ensureAudio = () => {
  if (audioCtx) return;
  const AudioContextImpl = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextImpl) return;
  audioCtx = new AudioContextImpl();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.08;
  masterGain.connect(audioCtx.destination);
};

const playTone = (frequency, duration, type) => {
  if (!soundEnabled) return;
  ensureAudio();
  if (!audioCtx || !masterGain) return;
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  const oscillator = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  gain.gain.value = 0;
  oscillator.connect(gain);
  gain.connect(masterGain);
  const now = audioCtx.currentTime;
  gain.gain.linearRampToValueAtTime(0.12, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.02);
};

const playStart = () => playTone(440, 0.18, 'triangle');
const playEat = () => playTone(690, 0.12, 'square');
const playTurn = () => playTone(320, 0.05, 'sine');
const playOver = () => playTone(180, 0.4, 'sawtooth');
const playBonus = () => playTone(520, 0.25, 'sine');
const playWallLand = () => playTone(80, 0.35, 'sawtooth');

// ── Game logic ──
const clampRandomFood = () => {
  const occupied = new Set(snake.map((segment) => `${segment.x},${segment.y}`));
  for (const w of walls) {
    for (const c of w.cells) occupied.add(`${c.x},${c.y}`);
  }
  while (true) {
    const x = Math.floor(Math.random() * GRID.cols);
    const y = Math.floor(Math.random() * GRID.rows);
    if (!occupied.has(`${x},${y}`)) {
      return { x, y };
    }
  }
};

const createInitialSnake = () => {
  const startX = Math.floor(GRID.cols / 2);
  const startY = Math.floor(GRID.rows / 2);
  return Array.from({ length: 5 }, (_, index) => ({
    x: startX - index,
    y: startY,
  }));
};

const setBest = (value) => {
  best = value;
  bestValue.textContent = String(best);
  localStorage.setItem('paperSnakeBest', String(best));
};

const updateScore = (value) => {
  score = value;
  scoreValue.textContent = String(score);
};

const updateSpeed = (value) => {
  speed = value;
  speedValue.textContent = `${speed}x`;
};

const resetGame = () => {
  snake = createInitialSnake();
  direction = 'right';
  nextDirection = 'right';
  food = clampRandomFood();
  updateSpeed(diff.baseSpeed);
  accumulator = 0;
  updateScore(0);
  gameOver = false;
  bonus = null;
  bonusSpawnTimer = Math.round(diff.baseSpeed * (8 + Math.random() * 7));
  // Clear walls
  for (const w of walls) {
    w.meshes.forEach((m) => wallGroup?.remove(m));
    w.warningMeshes.forEach((m) => warningGroup?.remove(m));
  }
  walls = [];
  wallSpawnTimer = 0;
  shakeIntensity = 0;
  if (camera) camera.position.set(0, 14, 22);
  updateSnakeMeshes();
  updateFoodMesh();
  if (bonusMesh) bonusMesh.visible = false;
};

const canMoveTo = (next) => {
  if (next.x < 0 || next.x >= GRID.cols || next.y < 0 || next.y >= GRID.rows) {
    return false;
  }
  if (snake.some((segment) => segment.x === next.x && segment.y === next.y)) {
    return false;
  }
  for (const w of walls) {
    if (w.state !== 'landed') continue;
    if (w.cells.some((c) => c.x === next.x && c.y === next.y)) return false;
  }
  return true;
};

const updateGame = () => {
  direction = nextDirection;
  const head = snake[0];
  const nextHead = {
    x: head.x + DIRECTIONS[direction].dx,
    y: head.y + DIRECTIONS[direction].dy,
  };

  if (!canMoveTo(nextHead)) {
    running = false;
    gameOver = true;
    finalScore.textContent = String(score);
    activeMenu = 'gameover';
    menuFocus = 0;
    showOverlay(gameOverOverlay);
    updateMenuFocus();
    playOver();
    return;
  }

  snake.unshift(nextHead);

  if (nextHead.x === food.x && nextHead.y === food.y) {
    const newScore = score + 1;
    updateScore(newScore);
    if (newScore > best) {
      setBest(newScore);
    }
    if (newScore % diff.accelEvery === 0) {
      updateSpeed(Math.min(diff.maxSpeed, speed + 1));
    }
    food = clampRandomFood();
    updateFoodMesh();
    playEat();
  } else {
    snake.pop();
  }

  // Bonus collision
  if (bonus && nextHead.x === bonus.x && nextHead.y === bonus.y) {
    updateSpeed(Math.max(diff.baseSpeed, speed - 2));
    bonus = null;
    bonusSpawnTimer = Math.round(speed * (8 + Math.random() * 7));
    if (bonusMesh) bonusMesh.visible = false;
    playBonus();
  }

  updateBonus();

  // Wall spawn
  wallSpawnTimer--;
  if (wallSpawnTimer <= 0 && score >= diff.wallThreshold) {
    spawnWall();
    const [lo, hi] = diff.wallInterval;
    wallSpawnTimer = Math.round(speed * (lo + Math.random() * (hi - lo)));
  }

  updateSnakeMeshes();
};

// ── Three.js scene ──
const createPaperTexture = () => {
  const size = 256;
  const canvasTex = document.createElement('canvas');
  canvasTex.width = size;
  canvasTex.height = size;
  const ctx = canvasTex.getContext('2d');
  ctx.fillStyle = '#f8efe0';
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 4000; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const alpha = Math.random() * 0.05;
    ctx.fillStyle = `rgba(120, 92, 70, ${alpha})`;
    ctx.fillRect(x, y, 1, 1);
  }

  for (let i = 0; i < 180; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const radius = Math.random() * 20 + 10;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, 'rgba(255,255,255,0.25)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvasTex);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 2);
  return texture;
};

const setupScene = () => {
  scene = new THREE.Scene();
  scene.background = new THREE.Color('#f3e7d7');
  scene.fog = new THREE.Fog('#f3e7d7', 30, 60);

  const paperTexture = createPaperTexture();
  MATERIALS.board.map = paperTexture;
  MATERIALS.paper.map = paperTexture;
  MATERIALS.board.needsUpdate = true;
  MATERIALS.paper.needsUpdate = true;

  camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.set(0, 14, 22);
  camera.lookAt(0, 0, 0);

  const ambient = new THREE.AmbientLight('#ffe7c9', 0.9);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight('#fff2dc', 1.1);
  keyLight.position.set(6, 12, 8);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024);
  keyLight.shadow.camera.near = 2;
  keyLight.shadow.camera.far = 30;
  keyLight.shadow.camera.left = -16;
  keyLight.shadow.camera.right = 16;
  keyLight.shadow.camera.top = 16;
  keyLight.shadow.camera.bottom = -16;
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight('#ffd9b8', 0.5);
  fillLight.position.set(-8, 6, -6);
  scene.add(fillLight);

  boardGroup = new THREE.Group();

  const boardGeometry = new THREE.BoxGeometry(GRID.cols, 0.4, GRID.rows);
  const boardMesh = new THREE.Mesh(boardGeometry, MATERIALS.board);
  boardMesh.receiveShadow = true;
  boardMesh.position.y = -0.4;
  boardGroup.add(boardMesh);

  const paperGeometry = new THREE.BoxGeometry(GRID.cols - 0.6, 0.2, GRID.rows - 0.6);
  const paperMesh = new THREE.Mesh(paperGeometry, MATERIALS.paper);
  paperMesh.receiveShadow = true;
  paperMesh.position.y = -0.2;
  boardGroup.add(paperMesh);

  shadowPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(GRID.cols + 4, GRID.rows + 4),
    new THREE.ShadowMaterial({ opacity: 0.25 })
  );
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.y = -0.41;
  shadowPlane.receiveShadow = true;
  boardGroup.add(shadowPlane);

  scene.add(boardGroup);

  snakeGroup = new THREE.Group();
  scene.add(snakeGroup);

  const berryGeometry = new THREE.SphereGeometry(0.4, 32, 32);
  foodMesh = new THREE.Mesh(berryGeometry, MATERIALS.berry);
  foodMesh.castShadow = true;

  const leafGeometry = new THREE.ConeGeometry(0.18, 0.5, 16);
  const leafMesh = new THREE.Mesh(leafGeometry, MATERIALS.leaf);
  leafMesh.rotation.z = Math.PI * 0.2;
  leafMesh.position.y = 0.35;
  foodMesh.add(leafMesh);

  scene.add(foodMesh);

  const bonusGeometry = new THREE.IcosahedronGeometry(0.4, 0);
  bonusMesh = new THREE.Mesh(bonusGeometry, MATERIALS.bonus);
  bonusMesh.castShadow = true;
  bonusMesh.visible = false;
  scene.add(bonusMesh);

  wallGroup = new THREE.Group();
  scene.add(wallGroup);
  warningGroup = new THREE.Group();
  scene.add(warningGroup);
  wallGeometry = new RoundedBoxGeometry(0.95, 0.6, 0.95, 4, 0.1);
  warningGeometry = new THREE.PlaneGeometry(0.9, 0.9);
};

const buildRenderer = async () => {
  if (renderer) {
    renderer.dispose();
  }

  if (rendererMode === 'webgpu' && navigator.gpu) {
    try {
      const module = await import('three/examples/jsm/renderers/webgpu/WebGPURenderer.js');
      const WebGPURenderer = module.default ?? module.WebGPURenderer;
      renderer = new WebGPURenderer({ antialias: true, canvas });
    } catch (error) {
      rendererMode = 'webgl';
      rendererSelect.value = 'webgl';
      renderer = new THREE.WebGLRenderer({ antialias: true, canvas });
    }
  } else {
    renderer = new THREE.WebGLRenderer({ antialias: true, canvas });
  }

  renderer.setClearColor('#f3e7d7', 1);
  renderer.setPixelRatio(quality === 'high' ? window.devicePixelRatio : Math.min(1.5, window.devicePixelRatio));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  if (!scene) {
    setupScene();
  }

  handleResize();
};

const handleResize = () => {
  if (!renderer || !camera) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width === 0 || height === 0) return;

  const aspect = width / height;
  camera.aspect = aspect;

  // Compute minimum vertical FOV so all 4 board corners fit in view
  camera.updateMatrixWorld(true);
  const viewMatrix = camera.matrixWorldInverse;

  const pad = 0.8;
  const hw = GRID.cols / 2 + pad;
  const hd = GRID.rows / 2 + pad;

  const corners = [
    new THREE.Vector3(-hw, 0, -hd),
    new THREE.Vector3( hw, 0, -hd),
    new THREE.Vector3(-hw, 0,  hd),
    new THREE.Vector3( hw, 0,  hd),
  ];

  let maxVertTan = 0;
  let maxHorizTan = 0;

  for (const c of corners) {
    const v = c.clone().applyMatrix4(viewMatrix);
    const depth = -v.z;
    if (depth <= 0) continue;
    maxVertTan  = Math.max(maxVertTan,  Math.abs(v.y) / depth);
    maxHorizTan = Math.max(maxHorizTan, Math.abs(v.x) / depth);
  }

  const fovVert  = 2 * Math.atan(maxVertTan);
  const fovHoriz = 2 * Math.atan(maxHorizTan / aspect);
  camera.fov = THREE.MathUtils.radToDeg(Math.max(fovVert, fovHoriz)) * 1.05;

  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
};

const updateSnakeMeshes = () => {
  while (snakeGroup.children.length < snake.length) {
    const geometry = new RoundedBoxGeometry(0.9, 0.45, 0.9, 6, 0.18);
    const material = snakeGroup.children.length === 0 ? MATERIALS.snakeHead : MATERIALS.snake;
    const segment = new THREE.Mesh(geometry, material);
    segment.castShadow = true;
    segment.receiveShadow = true;
    snakeGroup.add(segment);
  }

  snakeGroup.children.forEach((segment, index) => {
    if (index >= snake.length) {
      segment.visible = false;
      return;
    }
    const part = snake[index];
    segment.visible = true;
    segment.position.set(
      part.x - GRID.cols / 2 + 0.5,
      0.25 + Math.sin((part.x + part.y) * 0.4) * 0.02,
      part.y - GRID.rows / 2 + 0.5
    );
    segment.material = index === 0 ? MATERIALS.snakeHead : MATERIALS.snake;
  });
};

const updateFoodMesh = () => {
  foodMesh.position.set(
    food.x - GRID.cols / 2 + 0.5,
    0.55,
    food.y - GRID.rows / 2 + 0.5
  );
};

// ── Bonus helpers ──
const updateBonusMesh = () => {
  if (!bonusMesh) return;
  if (!bonus) {
    bonusMesh.visible = false;
    return;
  }
  bonusMesh.visible = true;
  bonusMesh.position.set(
    bonus.x - GRID.cols / 2 + 0.5,
    0.55,
    bonus.y - GRID.rows / 2 + 0.5
  );
};

const spawnBonus = () => {
  const head = snake[0];
  const lifetime = diff.bonusLifetime;
  const maxTicks = Math.round(speed * lifetime);
  const minDist = 4;
  const maxDist = Math.max(minDist + 1, Math.floor(speed * lifetime / 3));

  const occupied = new Set(snake.map((s) => `${s.x},${s.y}`));
  occupied.add(`${food.x},${food.y}`);
  for (const w of walls) {
    for (const c of w.cells) occupied.add(`${c.x},${c.y}`);
  }

  const candidates = [];
  for (let x = 0; x < GRID.cols; x++) {
    for (let y = 0; y < GRID.rows; y++) {
      const dist = Math.abs(x - head.x) + Math.abs(y - head.y);
      if (dist >= minDist && dist <= maxDist && !occupied.has(`${x},${y}`)) {
        candidates.push({ x, y });
      }
    }
  }

  if (candidates.length === 0) return;

  const pos = candidates[Math.floor(Math.random() * candidates.length)];
  const dirs = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];
  const dir = dirs[Math.floor(Math.random() * dirs.length)];

  bonus = {
    x: pos.x,
    y: pos.y,
    dx: dir.dx,
    dy: dir.dy,
    ticksAlive: 0,
    maxTicks,
    moveCounter: 0,
  };

  updateBonusMesh();
};

const pickBonusDirection = () => {
  const dirs = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];
  for (let i = dirs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
  }
  for (const d of dirs) {
    const nx = bonus.x + d.dx;
    const ny = bonus.y + d.dy;
    if (nx >= 0 && nx < GRID.cols && ny >= 0 && ny < GRID.rows) {
      if (!snake.some((s) => s.x === nx && s.y === ny)) return d;
    }
  }
  return dirs[0];
};

const updateBonus = () => {
  if (!bonus) {
    bonusSpawnTimer--;
    if (bonusSpawnTimer <= 0 && score >= diff.bonusThreshold) {
      spawnBonus();
    }
    return;
  }

  bonus.ticksAlive++;

  if (bonus.ticksAlive >= bonus.maxTicks) {
    bonus = null;
    bonusSpawnTimer = Math.round(speed * (8 + Math.random() * 7));
    updateBonusMesh();
    return;
  }

  bonus.moveCounter++;
  if (bonus.moveCounter >= diff.bonusMoveEvery) {
    bonus.moveCounter = 0;
    const nx = bonus.x + bonus.dx;
    const ny = bonus.y + bonus.dy;
    const blocked =
      nx < 0 ||
      nx >= GRID.cols ||
      ny < 0 ||
      ny >= GRID.rows ||
      snake.some((s) => s.x === nx && s.y === ny);

    if (blocked) {
      const newDir = pickBonusDirection();
      bonus.dx = newDir.dx;
      bonus.dy = newDir.dy;
    } else {
      bonus.x = nx;
      bonus.y = ny;
    }
    updateBonusMesh();
  }
};

// ── Wall helpers ──
const spawnWall = () => {
  if (walls.filter((w) => w.state === 'landed').length >= 5) return;

  const head = snake[0];
  const dir = DIRECTIONS[direction];
  const dist = 5 + Math.floor(Math.random() * 4);
  const cx = head.x + dir.dx * dist;
  const cy = head.y + dir.dy * dist;

  // Perpendicular to snake direction
  const px = dir.dy !== 0 ? 1 : 0;
  const py = dir.dx !== 0 ? 1 : 0;

  const cells = [
    { x: cx - px, y: cy - py },
    { x: cx, y: cy },
    { x: cx + px, y: cy + py },
  ];

  // Bounds check — keep 2 cells from edge
  for (const c of cells) {
    if (c.x < 2 || c.x >= GRID.cols - 2 || c.y < 2 || c.y >= GRID.rows - 2) return;
  }

  // Overlap check
  const occupied = new Set(snake.map((s) => `${s.x},${s.y}`));
  occupied.add(`${food.x},${food.y}`);
  if (bonus) occupied.add(`${bonus.x},${bonus.y}`);
  for (const c of cells) {
    if (occupied.has(`${c.x},${c.y}`)) return;
  }

  // Proximity to other walls (min 2 cells apart)
  for (const w of walls) {
    for (const wc of w.cells) {
      for (const c of cells) {
        if (Math.abs(c.x - wc.x) <= 2 && Math.abs(c.y - wc.y) <= 2) return;
      }
    }
  }

  // Create 3D meshes
  const meshes = cells.map((c) => {
    const mesh = new THREE.Mesh(wallGeometry, MATERIALS.wall);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(c.x - GRID.cols / 2 + 0.5, 8, c.y - GRID.rows / 2 + 0.5);
    mesh.visible = false;
    wallGroup.add(mesh);
    return mesh;
  });

  const warningMeshes = cells.map((c) => {
    const mesh = new THREE.Mesh(warningGeometry, MATERIALS.warning.clone());
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(c.x - GRID.cols / 2 + 0.5, -0.19, c.y - GRID.rows / 2 + 0.5);
    warningGroup.add(mesh);
    return mesh;
  });

  walls.push({
    cells,
    state: 'warning',
    timer: 0,
    warningDuration: diff.wallWarning,
    meshes,
    warningMeshes,
  });
};

const tick = (time) => {
  const dt = time - lastTime;
  lastTime = time;
  accumulator += dt;

  const stepMs = 1000 / speed;
  while (accumulator >= stepMs) {
    accumulator -= stepMs;
    if (running && !paused) {
      updateGame();
    }
  }

  if (foodMesh) {
    foodMesh.position.y = 0.55 + Math.sin(time * 0.004) * 0.05;
  }

  if (bonusMesh && bonus) {
    const progress = bonus.ticksAlive / bonus.maxTicks;
    let opacity;
    if (progress < 0.6) {
      opacity = 0.7 + 0.3 * Math.sin(time * 0.003);
    } else {
      const blinkSpeed = 0.006 + (progress - 0.6) * 0.04;
      opacity = 0.3 + 0.7 * Math.abs(Math.sin(time * blinkSpeed));
    }
    bonusMesh.material.opacity = opacity;
    bonusMesh.position.y = 0.55 + Math.sin(time * 0.005) * 0.08;
    bonusMesh.rotation.y = time * 0.002;
  }

  // Wall animations
  const FALL_DURATION = 300;
  for (const w of walls) {
    w.timer += dt;

    if (w.state === 'warning') {
      const blink = Math.sin(w.timer * 0.008) > 0;
      w.warningMeshes.forEach((m) => {
        m.visible = blink;
        m.material.opacity = 0.15 + 0.15 * Math.sin(w.timer * 0.006);
      });
      if (w.timer >= w.warningDuration) {
        w.state = 'falling';
        w.timer = 0;
        w.warningMeshes.forEach((m) => { m.visible = false; });
        w.meshes.forEach((m) => { m.visible = true; });
      }
    }

    if (w.state === 'falling') {
      const p = Math.min(1, w.timer / FALL_DURATION);
      const ease = 1 - Math.pow(1 - p, 3);
      const y = 8 * (1 - ease) + 0.3 * ease;
      w.meshes.forEach((m) => { m.position.y = y; });
      if (p >= 1) {
        w.state = 'landed';
        w.meshes.forEach((m) => { m.position.y = 0.3; });
        w.warningMeshes.forEach((m) => warningGroup.remove(m));
        shakeIntensity = 0.15;
        shakeTime = 0;
        playWallLand();
      }
    }
  }

  // Camera shake
  if (shakeIntensity > 0.001) {
    const t = shakeTime / 1000;
    const decay = Math.exp(-t * 8);
    const oY = shakeIntensity * Math.sin(t * 30) * decay;
    const oX = shakeIntensity * Math.sin(t * 23) * decay * 0.5;
    camera.position.set(oX, 14 + oY, 22);
    shakeTime += dt;
    if (decay < 0.01) {
      shakeIntensity = 0;
      camera.position.set(0, 14, 22);
    }
  }

  renderer.render(scene, camera);
  rafId = requestAnimationFrame(tick);
};

const setDirection = (next) => {
  if (DIRECTIONS[next].opposite === direction) return;
  if (next === nextDirection) return;
  nextDirection = next;
  if (running) playTurn();
};

// ── Menu navigation ──
const getActiveMenuEl = () => {
  if (activeMenu === 'title') return titleMenu;
  if (activeMenu === 'gameover') return gameOverMenu;
  if (activeMenu === 'pause') return pauseMenu;
  return null;
};

const updateMenuFocus = () => {
  const el = getActiveMenuEl();
  if (!el) return;
  const items = el.querySelectorAll('.menu-item');
  items.forEach((item, i) => item.classList.toggle('active', i === menuFocus));
};

const menuNavigate = (delta) => {
  const el = getActiveMenuEl();
  if (!el) return;
  const count = el.querySelectorAll('.menu-item').length;
  menuFocus = (menuFocus + delta + count) % count;
  updateMenuFocus();
};

const goToMainMenu = () => {
  running = false;
  paused = false;
  gameOver = false;
  activeMenu = 'title';
  menuFocus = ['easy', 'medium', 'hard'].indexOf(difficulty);
  if (menuFocus < 0) menuFocus = 1;
  showOverlay(startOverlay);
  updateMenuFocus();
  resetGame();
};

const menuConfirm = () => {
  const el = getActiveMenuEl();
  if (!el) return;
  const items = el.querySelectorAll('.menu-item');
  const item = items[menuFocus];
  if (!item) return;

  if (activeMenu === 'title') {
    difficulty = item.dataset.difficulty;
    diff = DIFFICULTIES[difficulty];
    startGame();
  } else if (activeMenu === 'gameover') {
    if (item.dataset.action === 'restart') startGame();
    else goToMainMenu();
  } else if (activeMenu === 'pause') {
    if (item.dataset.action === 'resume') {
      paused = false;
      activeMenu = null;
      hideAllOverlays();
    } else {
      goToMainMenu();
    }
  }
};

// ── Start / restart helpers ──
const startGame = () => {
  ensureAudio();
  diff = DIFFICULTIES[difficulty];
  resetGame();
  running = true;
  paused = false;
  gameOver = false;
  activeMenu = null;
  hideAllOverlays();
  playStart();
};

const togglePause = () => {
  if (!running) return;
  paused = !paused;
  if (paused) {
    activeMenu = 'pause';
    menuFocus = 0;
    showOverlay(pauseOverlay);
    updateMenuFocus();
  } else {
    activeMenu = null;
    hideAllOverlays();
  }
};

// ── Keyboard ──
const onKeyDown = (event) => {
  if (activeMenu) {
    if (event.key === 'ArrowUp' || event.key === 'w' || event.key === 'W') {
      event.preventDefault();
      menuNavigate(-1);
    } else if (event.key === 'ArrowDown' || event.key === 's' || event.key === 'S') {
      event.preventDefault();
      menuNavigate(1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      menuConfirm();
    } else if (event.key === ' ' && activeMenu === 'pause') {
      event.preventDefault();
      paused = false;
      activeMenu = null;
      hideAllOverlays();
    }
    return;
  }

  if (event.key === 'ArrowUp' || event.key === 'w' || event.key === 'W') {
    setDirection('up');
  } else if (event.key === 'ArrowDown' || event.key === 's' || event.key === 'S') {
    setDirection('down');
  } else if (event.key === 'ArrowLeft' || event.key === 'a' || event.key === 'A') {
    setDirection('left');
  } else if (event.key === 'ArrowRight' || event.key === 'd' || event.key === 'D') {
    setDirection('right');
  } else if (event.key === ' ') {
    event.preventDefault();
    togglePause();
  }
};

// ── Init ──
const init = async () => {
  const storedBest = Number(localStorage.getItem('paperSnakeBest'));
  if (!Number.isNaN(storedBest)) {
    best = storedBest;
    bestValue.textContent = String(best);
  }

  await buildRenderer();
  resetGame();
  updateMenuFocus();
  rafId = requestAnimationFrame(tick);
};

// ── Event listeners ──
document.querySelectorAll('.menu-item').forEach((item) => {
  item.addEventListener('click', () => {
    const el = getActiveMenuEl();
    if (!el) return;
    const items = el.querySelectorAll('.menu-item');
    menuFocus = Array.from(items).indexOf(item);
    updateMenuFocus();
    menuConfirm();
  });
});

soundBtn.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  soundBtn.textContent = soundEnabled ? '🔊' : '🔇';
});

settingsBtn.addEventListener('click', () => {
  settingsPanel.classList.toggle('hidden');
});

rendererSelect.addEventListener('change', async (event) => {
  rendererMode = event.target.value;
  await buildRenderer();
});

qualityBtn.addEventListener('click', async () => {
  quality = quality === 'high' ? 'medium' : 'high';
  qualityBtn.textContent = quality === 'high' ? 'Высокое' : 'Среднее';
  await buildRenderer();
});

touchButtons.forEach((button) => {
  button.addEventListener('click', () => {
    setDirection(button.dataset.dir);
  });
});

window.addEventListener('keydown', onKeyDown);

resizeObserver = new ResizeObserver(() => {
  handleResize();
});
resizeObserver.observe(canvas);

init();
