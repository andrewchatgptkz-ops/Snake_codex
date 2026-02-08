import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const GRID = {
  cols: 28,
  rows: 18,
  cell: 1,
};

const BASE_SPEED = 7;
const MAX_SPEED = 16;

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

const startBtn = document.getElementById('startBtn');
const restartBtn = document.getElementById('restartBtn');
const resumeBtn = document.getElementById('resumeBtn');
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
let speed = BASE_SPEED;
let lastTime = 0;
let accumulator = 0;
let rafId = null;
let quality = 'high';
let rendererMode = 'webgl';

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

// ── Game logic ──
const clampRandomFood = () => {
  const occupied = new Set(snake.map((segment) => `${segment.x},${segment.y}`));
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
  updateSpeed(BASE_SPEED);
  accumulator = 0;
  updateScore(0);
  gameOver = false;
  updateSnakeMeshes();
  updateFoodMesh();
};

const canMoveTo = (next) => {
  if (next.x < 0 || next.x >= GRID.cols || next.y < 0 || next.y >= GRID.rows) {
    return false;
  }
  return !snake.some((segment) => segment.x === next.x && segment.y === next.y);
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
    showOverlay(gameOverOverlay);
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
    if (newScore % 4 === 0) {
      updateSpeed(Math.min(MAX_SPEED, speed + 1));
    }
    food = clampRandomFood();
    updateFoodMesh();
    playEat();
  } else {
    snake.pop();
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

const BASE_FOV = 40;
const BOARD_ASPECT = GRID.cols / GRID.rows; // 28/18 ≈ 1.56

const handleResize = () => {
  if (!renderer || !camera) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width === 0 || height === 0) return;

  const aspect = width / height;
  camera.aspect = aspect;

  // When screen is wider than the board ratio, the board's depth
  // (near edge) gets clipped — increase vertical FOV to compensate
  if (aspect > BOARD_ASPECT) {
    camera.fov = BASE_FOV * (aspect / BOARD_ASPECT);
  } else {
    camera.fov = BASE_FOV;
  }

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

  renderer.render(scene, camera);
  rafId = requestAnimationFrame(tick);
};

const setDirection = (next) => {
  if (DIRECTIONS[next].opposite === direction) return;
  if (next === nextDirection) return;
  nextDirection = next;
  if (running) playTurn();
};

// ── Start / restart helpers ──
const startGame = () => {
  ensureAudio();
  resetGame();
  running = true;
  paused = false;
  gameOver = false;
  hideAllOverlays();
  playStart();
};

const togglePause = () => {
  if (!running) return;
  paused = !paused;
  if (paused) {
    showOverlay(pauseOverlay);
  } else {
    hideAllOverlays();
  }
};

// ── Keyboard ──
const onKeyDown = (event) => {
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
  rafId = requestAnimationFrame(tick);
};

// ── Event listeners ──
startBtn.addEventListener('click', startGame);
restartBtn.addEventListener('click', startGame);

resumeBtn.addEventListener('click', () => {
  paused = false;
  hideAllOverlays();
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
