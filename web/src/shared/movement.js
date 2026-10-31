// Deterministic first-person character motor shared by client prediction, the authoritative server and bots.
import { BTN, MOVE } from './constants.js';
import { clamp, lerp, moveTowards } from './math.js';

export function createMotorState(x = 0, y = 0, z = 0, yaw = 0) {
  return {
    x, y, z,
    vx: 0, vy: 0, vz: 0,
    yaw, pitch: 0,
    crouch: 0,          // 0..1 blend
    crouching: false,
    grounded: true,
    sprinting: false,
    coyote: 0,
    jumpBuffer: 0,
    stride: 0,
  };
}

export function copyMotorState(src, dst = {}) {
  dst.x = src.x; dst.y = src.y; dst.z = src.z;
  dst.vx = src.vx; dst.vy = src.vy; dst.vz = src.vz;
  dst.yaw = src.yaw; dst.pitch = src.pitch;
  dst.crouch = src.crouch; dst.crouching = src.crouching;
  dst.grounded = src.grounded; dst.sprinting = src.sprinting;
  dst.coyote = src.coyote; dst.jumpBuffer = src.jumpBuffer; dst.stride = src.stride;
  return dst;
}

export function heightOf(state) {
  return lerp(MOVE.standHeight, MOVE.crouchHeight, state.crouch);
}

export function eyeHeightOf(state) {
  return lerp(MOVE.standEye, MOVE.crouchEye, state.crouch);
}

const scratch = [];

function overlapsBody(world, x, y, z, height) {
  const r = MOVE.radius;
  return world.overlaps(x - r, y, z - r, x + r, y + height, z + r);
}

/**
 * Advances the motor by one command. Mutates state. Returns an event code:
 * 0 none, 1 footstep, 2 landed (hard), 3 jumped. Noise radius is written to state.noise.
 * @param {object} cmd { dt, mx, mz, yaw, pitch, buttons }
 * @param {number} aimSpeedMul movement multiplier while aiming (weapon-dependent)
 */
export function simulateMotor(state, cmd, world, aimSpeedMul = 0.65) {
  const dt = clamp(cmd.dt || 0, 0, 0.05);
  state.noise = 0;
  if (dt <= 0) return 0;
  const buttons = cmd.buttons | 0;
  const aiming = (buttons & BTN.AIM) !== 0;
  state.yaw = cmd.yaw;
  state.pitch = clamp(cmd.pitch, -1.5, 1.5);

  // --- crouch with ceiling check ------------------------------------------------------------
  let wantsCrouch = (buttons & BTN.CROUCH) !== 0;
  if (!wantsCrouch && state.crouching && overlapsBody(world, state.x, state.y + 0.05, state.z, MOVE.standHeight - 0.05)) {
    wantsCrouch = true;
  }
  state.crouching = wantsCrouch;
  state.crouch = moveTowards(state.crouch, wantsCrouch ? 1 : 0, MOVE.crouchRate * dt);

  // --- desired horizontal velocity ----------------------------------------------------------
  let mx = clamp(cmd.mx || 0, -1, 1);
  let mz = clamp(cmd.mz || 0, -1, 1);
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; }
  let sprinting = (buttons & BTN.SPRINT) !== 0 && mz > 0.5 && !wantsCrouch && !aiming;
  if (!state.grounded) sprinting = sprinting && state.sprinting;
  state.sprinting = sprinting;
  let speed = wantsCrouch ? MOVE.crouchSpeed : sprinting ? MOVE.sprintSpeed : MOVE.walkSpeed;
  if (aiming) speed *= aimSpeedMul;
  if (mz < -0.1) speed *= MOVE.backMul;

  const sy = Math.sin(state.yaw), cy = Math.cos(state.yaw);
  // forward = (-sin, 0, -cos), right = (cos, 0, -sin)
  const wishX = (cy * mx - sy * mz) * speed;
  const wishZ = (-sy * mx - cy * mz) * speed;
  const hasWish = wishX * wishX + wishZ * wishZ > 0.01;

  if (state.grounded) {
    const rate = (hasWish ? MOVE.groundAccel : MOVE.groundDecel) * dt;
    const dvx = wishX - state.vx, dvz = wishZ - state.vz;
    const dl = Math.hypot(dvx, dvz);
    if (dl <= rate) { state.vx = wishX; state.vz = wishZ; } else { state.vx += (dvx / dl) * rate; state.vz += (dvz / dl) * rate; }
  } else if (hasWish) {
    const rate = MOVE.airAccel * dt;
    const tx = lerp(state.vx, wishX, 0.5), tz = lerp(state.vz, wishZ, 0.5);
    const dvx = tx - state.vx, dvz = tz - state.vz;
    const dl = Math.hypot(dvx, dvz);
    if (dl <= rate) { state.vx = tx; state.vz = tz; } else { state.vx += (dvx / dl) * rate; state.vz += (dvz / dl) * rate; }
  }

  // --- jump (coyote time + buffer) ----------------------------------------------------------
  state.jumpBuffer = (buttons & BTN.JUMP) ? MOVE.jumpBuffer : Math.max(0, state.jumpBuffer - dt);
  state.coyote = state.grounded ? MOVE.coyoteTime : Math.max(0, state.coyote - dt);
  let event = 0;
  if (state.jumpBuffer > 0 && state.coyote > 0 && !state.crouching) {
    state.vy = MOVE.jumpVelocity;
    state.jumpBuffer = 0;
    state.coyote = 0;
    state.grounded = false;
    event = 3;
  }

  // --- gravity --------------------------------------------------------------------------------
  const wasGrounded = state.grounded;
  const fallSpeed = state.vy;
  state.vy -= MOVE.gravity * dt;
  if (state.vy < -55) state.vy = -55;

  const height = heightOf(state);
  const startX = state.x, startZ = state.z;

  // --- horizontal movement with step-up ----------------------------------------------------------
  moveHorizontal(state, world, state.vx * dt, 0, height, wasGrounded);
  moveHorizontal(state, world, 0, state.vz * dt, height, wasGrounded);

  // --- vertical movement ------------------------------------------------------------------------
  const dy = state.vy * dt;
  state.grounded = false;
  if (dy !== 0) {
    const r = MOVE.radius;
    const ny = state.y + dy;
    if (ny <= 0) {
      state.y = 0;
      if (state.vy < 0) { state.vy = 0; state.grounded = true; }
    } else {
      world.collect(state.x - r, Math.min(state.y, ny), state.z - r, state.x + r, Math.max(state.y, ny) + height, state.z + r, scratch);
      let y = ny;
      if (dy < 0) {
        for (const b of scratch) {
          if (b.max[1] <= state.y + 0.001 && b.max[1] > y) { y = b.max[1]; }
        }
        if (y > ny) { state.vy = 0; state.grounded = true; }
      } else {
        for (const b of scratch) {
          if (b.min[1] >= state.y + height - 0.001 && b.min[1] - height < y) { y = b.min[1] - height - 0.001; state.vy = 0; }
        }
      }
      state.y = y;
    }
  }

  // Ground probe so walking off small ledges and down stairs stays smooth.
  if (!state.grounded && wasGrounded && state.vy <= 0 && event !== 3) {
    const below = probeGround(world, state, height);
    if (below >= 0 && state.y - below <= MOVE.stepHeight) {
      state.y = below;
      state.vy = 0;
      state.grounded = true;
    }
  } else if (!state.grounded && state.vy <= 0) {
    const below = probeGround(world, state, height);
    if (below >= 0 && state.y - below < 0.02) { state.y = below; state.grounded = true; state.vy = 0; }
  }

  if (state.grounded && !wasGrounded && fallSpeed < -6) {
    event = 2;
    state.noise = MOVE.noiseSprint;
  }

  // --- footsteps ---------------------------------------------------------------------------------
  if (state.grounded) {
    const moved = Math.hypot(state.x - startX, state.z - startZ);
    state.stride += moved;
    const stride = state.crouching ? MOVE.strideCrouch : sprinting ? MOVE.strideSprint : MOVE.strideWalk;
    if (state.stride >= stride) {
      state.stride = 0;
      if (event === 0) event = 1;
      state.noise = Math.max(state.noise, state.crouching ? MOVE.noiseCrouch : sprinting ? MOVE.noiseSprint : aiming ? MOVE.noiseWalk * 0.6 : MOVE.noiseWalk);
    }
  }

  return event;
}

function probeGround(world, state, height) {
  const r = MOVE.radius * 0.9;
  let best = state.y <= MOVE.stepHeight ? 0 : -1;
  world.collect(state.x - r, state.y - MOVE.stepHeight - 0.05, state.z - r, state.x + r, state.y + 0.01, state.z + r, scratch);
  for (const b of scratch) {
    if (b.max[1] <= state.y + 0.01 && b.max[1] > best) best = b.max[1];
  }
  void height;
  return best;
}

function moveHorizontal(state, world, dx, dz, height, allowStep) {
  if (dx === 0 && dz === 0) return;
  const r = MOVE.radius;
  const nx = state.x + dx, nz = state.z + dz;
  world.collect(nx - r, state.y + 0.001, nz - r, nx + r, state.y + height, nz + r, scratch);
  if (scratch.length === 0) {
    state.x = nx; state.z = nz;
    return;
  }

  // Step up onto low obstacles (stairs, curbs) if there is head room.
  if (allowStep) {
    let top = 0;
    for (const b of scratch) top = Math.max(top, b.max[1]);
    const rise = top - state.y;
    if (rise > 0 && rise <= MOVE.stepHeight && !world.overlaps(nx - r, top + 0.001, nz - r, nx + r, top + height, nz + r)) {
      state.x = nx; state.z = nz; state.y = top;
      return;
    }
  }

  // Blocked: slide to contact on this axis.
  if (dx !== 0) {
    let limit = nx;
    for (const b of scratch) {
      if (dx > 0) limit = Math.min(limit, b.min[0] - r - 0.001);
      else limit = Math.max(limit, b.max[0] + r + 0.001);
    }
    state.x = dx > 0 ? Math.max(state.x, limit) : Math.min(state.x, limit);
    state.vx = 0;
  } else {
    let limit = nz;
    for (const b of scratch) {
      if (dz > 0) limit = Math.min(limit, b.min[2] - r - 0.001);
      else limit = Math.max(limit, b.max[2] + r + 0.001);
    }
    state.z = dz > 0 ? Math.max(state.z, limit) : Math.min(state.z, limit);
    state.vz = 0;
  }
}
