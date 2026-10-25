import { botGoal, BOT_TUNING, planarDistance } from '../shared/bot/brain.mjs';
import { facingYaw } from './passRules.mjs';

const MAX_TETHER = 12;
const NORMAL_SPEED = 5.5;
const BOOST_SPEED = 9;
const ACCELERATION = 16;

function vec(player) {
  return { x: player.position.x, y: player.position.y, z: player.position.z };
}

function moveToward(current, target, amount) {
  const dx = target.x - current.x;
  const dy = target.y - current.y;
  const dz = target.z - current.z;
  const distance = Math.hypot(dx, dy, dz);
  if (distance <= amount || distance < 0.0001) return { ...target };
  return { x: current.x + dx / distance * amount, y: current.y + dy / distance * amount, z: current.z + dz / distance * amount };
}

export function createBotPlayer(Player, role, position) {
  const player = new Player();
  player.playerId = 'bot';
  player.role = role;
  player.connected = true;
  player.bot = true;
  player.position.x = position.x;
  player.position.y = position.y;
  player.position.z = position.z;
  player.velocity.x = 0;
  player.velocity.y = 0;
  player.velocity.z = 0;
  player.rematchVote = true;
  return player;
}

export class BotPilot {
  constructor(room) {
    this.room = room;
    this.sessionId = 'bot';
    this.trail = [];
    this.capturedFor = 0;
    this.holdLootSince = 0;
    this.lastYankAt = 0;
    this.carryCrumbIndex = -1;
    this.wasHoldingLoot = false;
  }

  freeze(bot) {
    bot.velocity.x = 0;
    bot.velocity.y = 0;
    bot.velocity.z = 0;
    bot.boost = 'off';
    bot.movement = 'idle';
    bot.selfPowered = true;
    bot.tetherPull = 0;
  }

  targetForCarry(exit) {
    if (!exit || !this.trail.length) return exit;
    if (this.carryCrumbIndex < 0 || this.carryCrumbIndex >= this.trail.length) {
      this.carryCrumbIndex = this.trail.length - 1;
    }
    let closest = 0;
    let closestDistance = Infinity;
    for (let i = 0; i < this.trail.length; i++) {
      const d = planarDistance(this.trail[i], exit);
      if (d < closestDistance) {
        closest = i;
        closestDistance = d;
      }
    }
    if (this.carryCrumbIndex <= closest) return exit;
    return this.trail[this.carryCrumbIndex] ?? exit;
  }

  releaseOldLoot(bot) {
    const held = [...this.room.state.objects.values()].find((object) => object.holderId === this.sessionId && object.id !== 'prototype');
    if (!held) {
      this.holdLootSince = 0;
      return;
    }
    if (!this.holdLootSince) this.holdLootSince = Date.now();
    if (Date.now() - this.holdLootSince >= 4000) {
      this.room.releaseObject(this.sessionId, { objectId: held.id, velocity: { x: 0, y: 0, z: 0 } });
      this.holdLootSince = 0;
    }
  }

  tick(dt) {
    dt = Math.max(0, Math.min(0.1, dt));
    const bot = this.room.state.players.get(this.sessionId);
    if (!bot || bot.captured) return;
    const leader = [...this.room.state.players.values()].find((player) => player.playerId !== this.sessionId);
    if (!leader || !leader.connected) {
      this.freeze(bot);
      return;
    }

    const leaderPosition = vec(leader);
    const last = this.trail.at(-1);
    if (!last || planarDistance(last, leaderPosition) > 0.6) {
      this.trail.push(leaderPosition);
      if (this.trail.length > 200) this.trail.shift();
    }
    if (leader.captured) this.capturedFor += Math.max(0, dt);
    else this.capturedFor = 0;

    const leaderForward = {
      x: Math.sin(facingYaw(leader.orientation.yaw)),
      z: Math.cos(facingYaw(leader.orientation.yaw)),
    };
    const leaderHolding = [...this.room.state.objects.values()].some((object) => object.heldBy === leader.role);
    const selfHoldingLoot = this.room.state.objects.get('prototype')?.heldBy === bot.role;
    if (selfHoldingLoot && !this.wasHoldingLoot) this.carryCrumbIndex = -1;
    this.wasHoldingLoot = selfHoldingLoot;
    const threats = this.room.state.mission.securityActive
      ? [...this.room.state.security.patrols].map((patrol) => ({ x: patrol.x, y: patrol.y, z: patrol.z }))
      : [];
    const goal = botGoal({
      self: vec(bot),
      leader: leaderPosition,
      leaderForward,
      leaderHolding,
      selfHoldingLoot,
      exit: this.room.world.extraction,
      leaderCaptured: leader.captured === true,
      capturedFor: this.capturedFor,
      threats,
    });

    this.releaseOldLoot(bot);
    if (goal.mode === 'rescue') {
      if (planarDistance(bot.position, leader.position) <= 11) {
        this.freeze(bot);
        const now = Date.now();
        if (now - this.lastYankAt >= 1200) {
          this.lastYankAt = now;
          this.room.botYank();
        }
      } else {
        this.move(bot, goal.point, dt);
        this.clampTether(bot, leader);
      }
      return;
    }
    if (goal.mode === 'hold') {
      this.decelerate(bot, dt);
      return;
    }

    let target = goal.point;
    if (goal.mode === 'carry') {
      target = this.targetForCarry(goal.point ?? this.room.world.extraction);
      if (planarDistance(bot.position, this.room.world.extraction) <= BOT_TUNING.exitArrive) target = this.room.world.extraction;
      if (this.carryCrumbIndex > 0 && planarDistance(bot.position, this.trail[this.carryCrumbIndex]) <= 0.8) this.carryCrumbIndex -= 1;
    }
    if (!target) {
      this.decelerate(bot, dt);
      return;
    }
    this.move(bot, target, dt);
    this.clampTether(bot, leader);
  }

  decelerate(bot, dt) {
    const current = { x: bot.velocity.x, y: bot.velocity.y, z: bot.velocity.z };
    const next = moveToward(current, { x: 0, y: 0, z: 0 }, ACCELERATION * dt);
    bot.velocity.x = next.x; bot.velocity.y = next.y; bot.velocity.z = next.z;
    bot.position.x += bot.velocity.x * dt;
    bot.position.y += bot.velocity.y * dt;
    bot.position.z += bot.velocity.z * dt;
    bot.movement = 'idle';
    bot.boost = 'off';
    bot.selfPowered = true;
    bot.tetherPull = 0;
  }

  move(bot, target, dt) {
    const distance = Math.hypot(target.x - bot.position.x, target.y - bot.position.y, target.z - bot.position.z);
    const speed = distance > 7 ? BOOST_SPEED : NORMAL_SPEED;
    const direction = distance > 0.0001
      ? { x: (target.x - bot.position.x) / distance, y: (target.y - bot.position.y) / distance, z: (target.z - bot.position.z) / distance }
      : { x: 0, y: 0, z: 0 };
    const travelSpeed = dt > 0 ? Math.min(speed, distance / dt) : 0;
    const desired = { x: direction.x * travelSpeed, y: direction.y * travelSpeed, z: direction.z * travelSpeed };
    const current = { x: bot.velocity.x, y: bot.velocity.y, z: bot.velocity.z };
    const next = moveToward(current, desired, ACCELERATION * dt);
    bot.velocity.x = next.x; bot.velocity.y = next.y; bot.velocity.z = next.z;
    bot.position.x += bot.velocity.x * dt;
    bot.position.y += bot.velocity.y * dt;
    bot.position.z += bot.velocity.z * dt;
    const planarSpeed = Math.hypot(bot.velocity.x, bot.velocity.z);
    bot.movement = planarSpeed > 0.1 ? (speed > NORMAL_SPEED ? 'boosting' : 'cruising') : 'idle';
    bot.boost = speed > NORMAL_SPEED ? 'active' : 'off';
    bot.selfPowered = true;
    bot.tetherPull = 0;
    if (planarSpeed > 0.05) bot.orientation.yaw = Math.atan2(bot.velocity.x, bot.velocity.z) + Math.PI;
  }

  clampTether(bot, leader) {
    const dx = bot.position.x - leader.position.x;
    const dz = bot.position.z - leader.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= MAX_TETHER) return;
    bot.position.x = leader.position.x + dx / distance * MAX_TETHER;
    bot.position.z = leader.position.z + dz / distance * MAX_TETHER;
  }
}
