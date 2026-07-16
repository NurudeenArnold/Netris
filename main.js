const COLS = 10;
const VISIBLE_ROWS = 20;
const HIDDEN_ROWS = 4;
const ROWS = VISIBLE_ROWS + HIDDEN_ROWS;
const CELL = 30;
const SPAWN_Y = HIDDEN_ROWS - 2;
const boardEl = document.getElementById('board');
const scoreEl = document.getElementById('scoreVal');
const nextEl = document.getElementById('next');
const heldEl = document.getElementById('held');

// mapping colors -> sprite indices (0..6). Ghost uses sprite index 7 (ghost class)
const COLORS = [0,1,2,3,4,5,6];

// Tetromino definitions (rotations as arrays of {x,y}) centered with a reference
const TETROMINOS = [
  {name:'I', blocks:[[[-1,0],[0,0],[1,0],[2,0]],[[1,-1],[1,0],[1,1],[1,2]],[[-1,1],[0,1],[1,1],[2,1]],[[0,-1],[0,0],[0,1],[0,2]]], color:4},
  {name:'J', blocks:[[[-1,-1],[-1,0],[0,0],[1,0]],[[0,-1],[0,0],[0,1],[1,-1]],[[-1,0],[0,0],[1,0],[1,1]],[[-1,1],[0,-1],[0,0],[0,1]]], color:5},
  {name:'L', blocks:[[[1,-1],[-1,0],[0,0],[1,0]],[[0,-1],[0,0],[0,1],[1,1]],[[-1,0],[0,0],[1,0],[-1,1]],[[-1,-1],[0,-1],[0,0],[0,1]]], color:1},
  {name:'O', blocks:[[[0,0],[1,0],[0,1],[1,1]]], color:2},
  {name:'S', blocks:[[[0,0],[1,0],[-1,1],[0,1]],[[0,-1],[0,0],[1,0],[1,1]],[[0,0],[1,0],[-1,1],[0,1]],[[0,-1],[0,0],[1,0],[1,1]]], color:3},
  {name:'T', blocks:[[[0,-1],[-1,0],[0,0],[1,0]],[[0,-1],[0,0],[1,0],[0,1]],[[-1,0],[0,0],[1,0],[0,1]],[[0,-1],[-1,0],[0,0],[0,1]]], color:6},
  {name:'Z', blocks:[[[-1,0],[0,0],[0,1],[1,1]],[[1,-1],[0,0],[1,0],[0,1]],[[-1,0],[0,0],[0,1],[1,1]],[[1,-1],[0,0],[1,0],[0,1]]], color:0}
];

let grid = [];
let gridEl;
let current = null;
let nextQueue = [];
let pieceBag = [];
let held = null;
let canHold = true;
let score = 0;
let animationFrameId = null;
let keys = {};
let lastRotate = 0;
let inputTimer = null;
// input settings
let inputPoll = 17; // input loop interval (ms)
// DAS/ARR/DCD/SDF settings (defaults provided)
let ARR = 17; // automatic repeat rate (ms between repeats) - 17ms (~1 frame)
let DAS = 117; // delayed auto shift initial delay (ms)
let DCD = 0; // delayed cut delay (ms) - pause after rotate/drop
let SDF = 35; // soft drop factor (multiplier of gravity speed)

// Default gravity values, adjustable later
let baseGravityCellsPerSecond = 2.1; // 2.1 cells per second (approx)
let baseGravityG = 0.035; // 0.035 G at 60 TPS
let baseGravityMsPerRow = 1000 / baseGravityCellsPerSecond; // 1000 ms per row at 1 cell/sec equivalent

let level = 1;
const GRAVITY_TABLE = [
  baseGravityG, 0.02102, 0.02698, 0.03526, 0.04693,
  0.06361, 0.08790, 0.12360, 0.17750, 0.25980,
  0.38800, 0.59000, 0.92000, 1.46000, 2.36000,
  3.91000, 6.61000, 11.43000, 20.00000, 20.00000
];
let gravityAccumulator = 0;
let lastFrameTime = null;
const LOCK_DELAY = 500;
const MAX_LOCK_RESETS = 15;
let lockDelayStartedAt = null;
let lockResets = 0;

let rotateInitialDelay = 300; // ms before rotate repeat starts for held rotation keys
let rotateRepeatInterval = 80; // ms between repeated rotations when holding
let rotateStates = {}; // per-key rotate hold state
let moveStates = { 'arrowleft': null, 'arrowright': null };
let movePauseUntil = 0; // timestamp until which DAS repeats are paused by DCD

function makeGrid(){
  grid = Array.from({length:ROWS}, ()=>Array(COLS).fill(null));
  boardEl.innerHTML = '';
  gridEl = document.createElement('div');
  gridEl.className = 'grid';
  for(let r=0;r<ROWS;r++){
    for(let c=0;c<COLS;c++){
      const cell = document.createElement('div');
      cell.className='cell';
      if(r < HIDDEN_ROWS) cell.classList.add('spawn-row');
      cell.dataset.r=r;cell.dataset.c=c;
      gridEl.appendChild(cell);
    }
  }
  boardEl.appendChild(gridEl);
}

function placeToGrid(r,c,val){
  grid[r][c]=val;
}

function ensureQueue() {
    while (nextQueue.length < 6)
        nextQueue.push(randomPiece());
}

function spawnPiece(resetHold = true) {
    ensureQueue();

    current = nextQueue.shift();

    current.x = 4;
    current.y = SPAWN_Y;
    current.rot = 0;

    if (resetHold) {
        canHold = true;
        updateHeldDisplay();
    }

    lockDelayStartedAt = null;
    lockResets = 0;

    updateNextDisplay();

    if (collides(current, 0, 0)) {
        gameOver();
    }
}

function randomPiece(){
  if(pieceBag.length === 0){
    pieceBag = [...TETROMINOS];
    for(let i = pieceBag.length - 1; i > 0; i--){
      const j = Math.floor(Math.random() * (i + 1));
      [pieceBag[i], pieceBag[j]] = [pieceBag[j], pieceBag[i]];
    }
  }
  const t = pieceBag.pop();
  return {tpl:t, color:t.color, rot:0, x:4, y:0};
}

function cellsOf(piece, rot=piece.rot, x=piece.x, y=piece.y){
  const shape = piece.tpl.blocks[rot%piece.tpl.blocks.length];
  return shape.map(p=>({x:p[0]+x,y:p[1]+y}));
}

function collides(piece, dx=0, dy=0, drot=null){
  const rot = drot===null?piece.rot:drot%piece.tpl.blocks.length;
  for(const b of piece.tpl.blocks[rot]){
    const x = piece.x + b[0] + dx;
    const y = piece.y + b[1] + dy;
    if(x<0 || x>=COLS || y>=ROWS) return true;
    if(y>=0 && grid[y][x]!==null) return true;
  }
  return false;
}

function lockPiece(){
  for(const p of cellsOf(current)){
    if(p.y>=0) placeToGrid(p.y,p.x,current.color);
  }
  clearLines();
  spawnPiece();
}

function clearLines(){
  let cleared=0;
  for(let r=ROWS-1;r>=0;r--){
    if(grid[r].every(cell=>cell!==null)){
      grid.splice(r,1);
      grid.unshift(Array(COLS).fill(null));
      cleared++;
      r++; // recheck same row index after splice
    }
  }
  if(cleared){
    score += [0,100,300,500,800][cleared]||(cleared*200);
    scoreEl.textContent=score;
  }
}

function rotatePiece(dir=1){
  let newRot = (current.rot + dir) % current.tpl.blocks.length;
if (newRot < 0) newRot += current.tpl.blocks.length;
  // simple wall kick: try offsets
  const kicks = [[0,0],[-1,0],[1,0],[-2,0],[2,0],[0,-1]];
  for(const k of kicks){
    if(!collides(current,k[0],k[1],newRot)){
      current.x += k[0]; current.y += k[1]; current.rot=newRot;
      resetLockDelayAfterAction();
      if(DCD>0){
        movePauseUntil = Date.now() + DCD;
        for(const key of ['arrowleft','arrowright']){
          const state = moveStates[key];
          if(state) state.lastActionAt = movePauseUntil;
        }
      }
      return;
    }
  }
}

function isGrounded(){
  return current && collides(current, 0, 1);
}

function updateGroundedLockState(){
  if(!isGrounded()){
    lockDelayStartedAt = null;
    return;
  }
  if(lockDelayStartedAt === null) lockDelayStartedAt = performance.now();
}

function resetLockDelayAfterAction(){
  if(!isGrounded()){
    lockDelayStartedAt = null;
    return;
  }
  if(lockDelayStartedAt === null){
    lockDelayStartedAt = performance.now();
  } else if(lockResets < MAX_LOCK_RESETS){
    lockDelayStartedAt = performance.now();
    lockResets++;
  }
}

function move(dx,dy, canResetLock=true){
  if(!collides(current,dx,dy)){
    current.x+=dx; current.y+=dy;
    if(canResetLock) resetLockDelayAfterAction();
    else updateGroundedLockState();
    return true;
  }
  updateGroundedLockState();
  return false;
}

function hardDrop(){
  while(move(0,1,false)){}
  lockPiece();
  if(DCD>0){
    movePauseUntil = Date.now() + DCD;
    for(const key of ['arrowleft','arrowright']){
      const state = moveStates[key];
      if(state) state.lastActionAt = movePauseUntil;
    }
  }
}

function holdPiece() {
  if (!canHold) return;

  canHold = false;

  if (!held) {
    held = current;
    spawnPiece(false);
  } else {
    const temp = current;
    current = held;
    current.x = 4;
    current.y = SPAWN_Y;
    current.rot = 0; // Spawn rotation

    held = temp;

    if (collides(current, 0, 0)) {
      gameOver();
      return;
    }
  }

  updateHeldDisplay();
  draw();
}

function gameOver() {
  alert('Game Over — score: ' + score);

  score = 0;
  scoreEl.textContent = score;

  makeGrid();

  held = null;
  nextQueue = [];
  pieceBag = [];
  current = null;

  updateHeldDisplay();
  updateNextDisplay();

  spawnPiece();
  draw();
}

function draw(){
  // clear grid view
  const cells = gridEl.children;
  for(let r=0;r<ROWS;r++){
    for(let c=0;c<COLS;c++){
      const idx = r*COLS + c;
      const el = cells[idx];
      el.innerHTML=''; el.classList.remove('filled','ghost','c0','c1','c2','c3','c4','c5','c6');
      const v = grid[r][c];
      if(v!==null){
        el.classList.add('filled','c'+v);
        const t = document.createElement('div'); t.className='tile'; el.appendChild(t);
      }
    }
  }
  // draw ghost
  const ghostY = computeGhostY();
  for(const p of cellsOf(current)){
    const gx = p.x; const gy = p.y;
    if(gy>=0 && gy<ROWS && gx>=0 && gx<COLS){
      // don't override real blocks
      // ghost cell at ghostY for piece cell offsets
    }
  }
  // place ghost cells based on current shape and ghostY
  const ghostShape = current.tpl.blocks[current.rot%current.tpl.blocks.length];
  for(const b of ghostShape){
    const gx = current.x + b[0];
    const gy = ghostY + b[1];
    if(gy>=0 && gy<ROWS && gx>=0 && gx<COLS){
      const idx = gy*COLS + gx; const el = cells[idx];
      // only add ghost if there's no locked tile underneath
      if(!el.classList.contains('filled')){
        el.classList.add('ghost');
        const t = document.createElement('div'); t.className='tile'; el.appendChild(t);
      }
    }
  }

  // draw current piece
  for(const p of cellsOf(current)){
    if(p.y>=0 && p.y<ROWS && p.x>=0 && p.x<COLS){
      const idx = p.y*COLS + p.x; const el = cells[idx];
      el.classList.add('filled','c'+current.color);
      // remove ghost if it was added
      if(el.classList.contains('ghost')) el.classList.remove('ghost');
      el.innerHTML=''; const t=document.createElement('div'); t.className='tile'; el.appendChild(t);
    }
  }
}

function computeGhostY(){
  let drop = 0;
  while(!collides(current,0,drop+1)) drop++;
  return current.y + drop;
}

function updateNextDisplay(){
  nextEl.innerHTML = '';
  for(let i=0; i<nextQueue.length; i++){
    const p = nextQueue[i];
    const container = document.createElement('div');
    container.className = 'preview-slot';
    
    const shape = p.tpl.blocks[0];
    const minY = Math.min(...shape.map(s=>s[1]));
    const minX = Math.min(...shape.map(s=>s[0]));
    const maxY = Math.max(...shape.map(s=>s[1]));
    const maxX = Math.max(...shape.map(s=>s[0]));
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    const shapeSet = new Set(shape.map(s => `${s[0]-minX},${s[1]-minY}`));
    
    const grid = document.createElement('div');
    grid.className = 'preview-grid';
    grid.style.gridTemplateColumns = `repeat(${w}, 30px)`;
    grid.style.gridAutoRows = '30px';
    
    for(let y=0; y<h; y++){
      for(let x=0; x<w; x++){
        const cell = document.createElement('div');
        cell.className = 'preview-cell';
        if(shapeSet.has(`${x},${y}`)){
          const tile = document.createElement('div');
          tile.className = 'tile';
          tile.style.backgroundPosition = `${-31*p.color}px 0`;
          cell.appendChild(tile);
        }
        grid.appendChild(cell);
      }
    }
    container.appendChild(grid);
    nextEl.appendChild(container);
  }
}

function updateHeldDisplay(){
  heldEl.innerHTML = '';
  if(!held) return;
  
  const shape = held.tpl.blocks[0];
  const minY = Math.min(...shape.map(s=>s[1]));
  const minX = Math.min(...shape.map(s=>s[0]));
  const maxY = Math.max(...shape.map(s=>s[1]));
  const maxX = Math.max(...shape.map(s=>s[0]));
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const shapeSet = new Set(shape.map(s => `${s[0]-minX},${s[1]-minY}`));
  
  const container = document.createElement('div');
  container.className = 'preview-slot';
  const grid = document.createElement('div');
  grid.className = 'preview-grid';
  grid.style.gridTemplateColumns = `repeat(${w}, 30px)`;
  grid.style.gridAutoRows = '30px';
  
  for(let y=0; y<h; y++){
    for(let x=0; x<w; x++){
      const cell = document.createElement('div');
      cell.className = 'preview-cell';
      if(shapeSet.has(`${x},${y}`)){
        const tile = document.createElement('div');
        tile.className = 'tile';
        const spriteIndex = canHold ? held.color : 8; // 9th sprite (index 8)
        tile.style.backgroundPosition = `${-31 * spriteIndex}px 0`;
        cell.appendChild(tile);
      }
      grid.appendChild(cell);
    }
  }
  container.appendChild(grid);
  heldEl.appendChild(container);
}

const TICK_RATE = 60;
const TICK_SECONDS = 1 / TICK_RATE;
let tickAccumulator = 0;

function tick(){
  if(!current) return;
  const now = performance.now();

  const gravityG = GRAVITY_TABLE[Math.min(Math.max(level, 1), GRAVITY_TABLE.length) - 1];
  let gravityPerTick = gravityG;
  if(keys['arrowdown']) gravityPerTick *= SDF;

  gravityAccumulator += gravityPerTick;

  while(gravityAccumulator >= 1){
    if(!move(0,1,false)){
      gravityAccumulator = 0;
      break;
    }
    gravityAccumulator -= 1;
  }

  updateGroundedLockState();
  if(lockDelayStartedAt !== null && now - lockDelayStartedAt >= LOCK_DELAY){
    lockPiece();
    gravityAccumulator = 0;
    draw();
    return;
  }

  draw();
}

function gameLoop(now){
  const deltaTime = Math.min((now - lastFrameTime) / 1000, 0.1);
  lastFrameTime = now;
  tickAccumulator += deltaTime;

  while(tickAccumulator >= TICK_SECONDS){
    tick();
    tickAccumulator -= TICK_SECONDS;
  }

  animationFrameId = requestAnimationFrame(gameLoop);
}

function start(){
  makeGrid();
  spawnPiece();
  lastFrameTime = performance.now();
  animationFrameId = requestAnimationFrame(gameLoop);
  // fast input loop for responsive movement/rotation while holding keys
  inputTimer = setInterval(()=>{
    if(!current) return;
    const now = Date.now();

    // lateral movement using DAS/ARR semantics
    for(const dir of ['arrowleft','arrowright']){
      if(keys[dir]){
        const state = moveStates[dir];
        if(state && now >= movePauseUntil && now - state.pressedAt >= DAS && now - state.lastActionAt >= ARR){
          move(dir === 'arrowleft' ? -1 : 1, 0);
          state.lastActionAt = now;
        }
      }
    }

    // rotation key hold behaviour: keyboard-like initial delay then repeat interval
/*     if (keys['z']) {
    if (!rotateStates['z']) rotateStates['z'] = {pressedAt: now, lastRepeatAt: now};
    const st = rotateStates['z'];
    if (now - st.pressedAt >= rotateInitialDelay) {
        if (now - st.lastRepeatAt >= rotateRepeatInterval) {
            rotatePiece(-1);
            st.lastRepeatAt = now;
        }
    }
}

const upKeys = ['arrowup','x'];
for (const k of upKeys) {
    if (keys[k]) {
        if (!rotateStates[k]) rotateStates[k] = {pressedAt: now, lastRepeatAt: now};
        const st = rotateStates[k];
        if (now - st.pressedAt >= rotateInitialDelay) {
            if (now - st.lastRepeatAt >= rotateRepeatInterval) {
                rotatePiece(1);
                st.lastRepeatAt = now;
            }
        }
    }
} */

    draw();
  }, inputPoll);
  draw();
}

document.addEventListener('keydown', (e)=>{
  if(!current) return;
  const key = e.key.toLowerCase();
  if ((key === 'z' || key === 'x' || key === 'arrowup' || key === ' ') && e.repeat) {
    e.preventDefault();
    return;
  }
  keys[key] = true;
  const now = Date.now();

  if(key === 'arrowleft' || key === 'arrowright'){
    moveStates[key] = {pressedAt: now, lastActionAt: now};
  }

  // initialize rotate state on keydown so initial delay counts from press
  if(key === 'z' || key === 'arrowup' || key === 'x'){
    rotateStates[key] = {pressedAt: now, lastRepeatAt: now};
  }

  // immediate action for responsiveness
  if(key === 'arrowleft'){ move(-1,0); draw(); e.preventDefault(); }
  else if(key === 'arrowright'){ move(1,0); draw(); e.preventDefault(); }
  else if(key === 'arrowdown'){ move(0,1); draw(); e.preventDefault(); }
  else if(e.key === ' '){ hardDrop(); draw(); e.preventDefault(); }
  else if(key === 'arrowup' || key === 'x'){ if(now - lastRotate > 50){ rotatePiece(1); lastRotate = now; } draw(); e.preventDefault(); }
  else if(key === 'z'){ if(now - lastRotate > 50){ rotatePiece(-1); lastRotate = now; } draw(); e.preventDefault(); }
  else if(key === 'shift'){ holdPiece(); e.preventDefault(); }
});

document.addEventListener('keyup', (e)=>{
  const key = e.key.toLowerCase();
  keys[key] = false;
  if(key === 'arrowleft' || key === 'arrowright'){
    moveStates[key] = null;
  }
  if(rotateStates[key]) delete rotateStates[key];
});

// initialize
start();
updateNextDisplay();
updateHeldDisplay();
