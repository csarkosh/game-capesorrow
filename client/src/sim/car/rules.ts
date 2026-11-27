/**
 * The car in the game's rules: who sits where and how they get in and out, the driver's commands, the car with no driver,
 * and the car as a wall for walkers. `carMove` is the engine's `Rules.move`: it runs on every machine, the host, a client's
 * prediction and its replay of unacknowledged commands. `carHostStep` and `carPressed` run on the host alone.
 *
 * A player getting in or out is held (`carHeld`): the engine keeps it where it is. The seat is taken the moment the player
 * presses, and the player is put in it when it is seated.
 *
 * Simulation code: `+ - * /`, `abs`, `min`, `max`, `sqrt` only. Players are reached by id, from the cars' seats, and no collection is walked.
 */
import { PLAYER_HALF } from "@csarkosh/engine/sim/constants";
import { MoveButton, type InputCommand, type Vec3 } from "@csarkosh/engine/sim/core";
import type { Forest } from "@csarkosh/engine/sim/forest";
import type { PlayerCore, SimState, SimWorld } from "@csarkosh/engine/sim/tick";
import { waterLevelAt } from "@csarkosh/engine/sim/waters";
import { constrainRails, RAIL_JOIN } from "../town/decks.js";
import { HULL_RADIUS } from "../town/hull.js";
import { constrainTrestle } from "../town/railDeck.js";
import { constrainCircle, pushOut, STRIDE, type TownSolids } from "../town/solid.js";
import { driveCar } from "./body.js";
import { boardSeat, doorPlace, seatPlace, slowForDoors } from "./seats.js";
import { carStart, groundCar } from "./start.js";
import { CAR_LENGTH, CAR_WIDTH, ENTER_TICKS, INTERACT_BIT, LAMP_BIT, LEAVE_TICKS, OWED_MAX, WADE } from "./tuning.js";
import { ENTERING, FOOT, LEAVING, SEATED, type Car, type CarControls, type Ride } from "./types.js";

const abs = Math.abs;
const min = Math.min;

/** A player with a place in a car, or none. */
export type Rider = PlayerCore & { ride: Ride };
/** What a state holds of the cars. */
export type CarState = { cars: Car[] };
export type RiderWorld = SimWorld<Rider> & { forest: Forest; state: SimState<Rider> & CarState };

/** A ride that is no ride: on foot. */
export function newRide(): Ride {
  return { car: 0, seat: 0, phase: FOOT, ticks: 0 };
}

/** Whether a player is held still: getting in or getting out. */
export function carHeld(p: Rider): boolean {
  return p.ride.phase === ENTERING || p.ride.phase === LEAVING;
}

const STILL: CarControls = { throttle: 0, turn: 0, handbrake: true };
const SPOT = { x: 0, y: 0, z: 0 };
const DOOR = { x: 0, z: 0 };
const VEL = { x: 0, y: 0, z: 0 };
const CAR_BOX: TownSolids = { ids: [0], rects: new Float64Array(STRIDE), x0: 0, z0: 0, cols: 0, rows: 0, start: new Int32Array(1), list: new Int32Array(0) };

function carOf(world: RiderWorld, id: number): Car | undefined {
  const cars = world.state.cars;
  for (let i = 0; i < cars.length; i++) if ((cars[i] as Car).id === id) return cars[i];
  return undefined;
}

function heightAt(world: RiderWorld, x: number, z: number): number {
  return world.ground === null ? 0 : world.ground.heightAt(x, z);
}

/** Puts a player at the seat, at rest and grounded. */
function seatIn(car: Car, seat: number, p: Rider): void {
  seatPlace(car, seat, SPOT);
  p.pos = { x: SPOT.x, y: SPOT.y, z: SPOT.z };
  p.vel = { x: 0, y: 0, z: 0 };
  p.grounded = true;
}

/** Places every rider of the car who is in a seat, seated or getting out, at their seat: one getting out rides with the car until it is out. */
function seatRiders(world: RiderWorld, car: Car): void {
  for (let seat = 0; seat < 4; seat++) {
    const id = car.seats[seat] as number;
    if (id === 0) continue;
    const p = world.state.players.get(id);
    if (p !== undefined && (p.ride.phase === SEATED || p.ride.phase === LEAVING) && p.ride.car === car.id && p.ride.seat === seat) seatIn(car, seat, p);
  }
}

/**
 * The engine's move, for a seated player: the driver's commands drive the car, and every seated player is placed at their seat.
 * A standing command (one with the sequence number of the last command taken: the host has none fresh from the driver this
 * tick) steps the car on its last controls, or on the brake once `OWED_MAX` such steps are owed, and adds one to `car.owed`.
 * The fresh command that comes later is then not stepped again: it sets the controls and pays one back. So a driver's N
 * commands step the car N times, however the ticks fell, and a driver gone silent is braked to rest.
 * Answers false for a player not seated, so the engine walks them.
 */
export function carMove(world: RiderWorld, p: Rider, cmd: InputCommand): boolean {
  if (p.ride.phase !== SEATED) return false;
  const car = carOf(world, p.ride.car);
  if (car === undefined) {
    p.ride = newRide();
    return false;
  }
  if (p.ride.seat === 0) {
    if (cmd.seq === p.lastProcessedInput) {
      driveCar(world, car, car.owed < OWED_MAX ? car.controls : STILL);
      car.owed = min(car.owed + 1, OWED_MAX);
    } else if (car.owed > 0) {
      // Stepped in advance, on a tick that had no command: the controls are taken and the step is not.
      car.owed--;
      car.controls = { throttle: cmd.moveZ, turn: cmd.moveX, handbrake: (cmd.buttons & MoveButton.Jump) !== 0 };
    } else {
      driveCar(world, car, { throttle: cmd.moveZ, turn: cmd.moveX, handbrake: (cmd.buttons & MoveButton.Jump) !== 0 });
    }
    seatRiders(world, car);
  }
  seatIn(car, p.ride.seat, p);
  return true;
}

/** Whether a walker's hull can stand at (x, z) beside a car at height `carY`: on ground within `RAIL_JOIN` of it (decks are part of the ground), clear of every building, prop and car and every rail, in no more than wading depth of water. */
function standFree(world: RiderWorld, x: number, z: number, carY: number): boolean {
  const seed = world.forest.seed;
  if (abs(heightAt(world, x, z) - carY) > RAIL_JOIN) return false;
  SPOT.x = x;
  SPOT.y = heightAt(world, x, z) + PLAYER_HALF.y;
  SPOT.z = z;
  VEL.x = 0;
  VEL.y = 0;
  VEL.z = 0;
  if (constrainCircle(seed, SPOT, VEL, HULL_RADIUS)) return false;
  if (constrainRails(seed, SPOT, VEL) || constrainTrestle(seed, SPOT, VEL)) return false;
  const cars = world.state.cars;
  for (let i = 0; i < cars.length; i++) {
    carBox(cars[i] as Car);
    if (pushOut(CAR_BOX, 0, SPOT, VEL, HULL_RADIUS)) return false;
  }
  const level = waterLevelAt(world, x, z);
  if (level !== null && level - heightAt(world, x, z) > WADE) return false;
  return true;
}

/** Fills the one rectangle the cars are pushed out of with this car's footprint. */
function carBox(car: Car): void {
  const r = CAR_BOX.rects;
  r[0] = car.x;
  r[1] = car.z;
  r[2] = car.hx;
  r[3] = car.hz;
  r[4] = CAR_LENGTH / 2;
  r[5] = CAR_WIDTH / 2;
}

/** The seat's own door, else the door across, whichever stands a walker free: the door's place in `DOOR`, or false. */
function freeDoor(world: RiderWorld, car: Car, seat: number): boolean {
  for (let k = 0; k < 2; k++) {
    doorPlace(car, k === 0 ? seat : seat ^ 1, DOOR);
    if (standFree(world, DOOR.x, DOOR.z, car.y)) return true;
  }
  return false;
}

/**
 * A press, on the host. The lamp bit from a seated driver flips the car's lamps. The interact bit from a player on foot at a
 * door takes the seat at once, so two players on one tick cannot share it, and the player starts getting in, if the car is under `LEAVE_SPEED` and the player's feet are within `DOOR_HEIGHT` of its wheels' plane. From a seated
 * player in a car under `LEAVE_SPEED` it starts getting out, if the seat's door or the one across is free: if neither is, nothing changes.
 */
export function carPressed(world: RiderWorld, p: Rider, bits: number): void {
  if ((bits & LAMP_BIT) !== 0 && p.ride.phase === SEATED && p.ride.seat === 0) {
    const car = carOf(world, p.ride.car);
    if (car !== undefined) car.lights = !car.lights;
  }
  if ((bits & INTERACT_BIT) === 0) return;
  if (p.ride.phase === FOOT) {
    const cars = world.state.cars;
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i] as Car;
      const seat = boardSeat(car, p.pos);
      if (seat < 0) continue;
      car.seats[seat] = p.id;
      if (seat === 0) car.owed = 0;
      p.ride = { car: car.id, seat, phase: ENTERING, ticks: ENTER_TICKS };
      return;
    }
  } else if (p.ride.phase === SEATED) {
    const car = carOf(world, p.ride.car);
    if (car === undefined || !slowForDoors(car)) return;
    if (!freeDoor(world, car, p.ride.seat)) return;
    p.ride = { car: car.id, seat: p.ride.seat, phase: LEAVING, ticks: LEAVE_TICKS };
  }
}

/**
 * The host's step, after every player has moved, for each car: a seat whose player has left the game is emptied; a player
 * getting in or out counts down, and is seated, or put on foot at a free door if the car is under `LEAVE_SPEED` (else it stays seated); a car with no seated driver is held at rest
 * (the handbrake, no throttle); and every seated rider is put at their seat.
 */
export function carHostStep(world: RiderWorld): void {
  const cars = world.state.cars;
  for (let i = 0; i < cars.length; i++) {
    const car = cars[i] as Car;
    for (let seat = 0; seat < 4; seat++) {
      const id = car.seats[seat] as number;
      if (id === 0) continue;
      const p = world.state.players.get(id);
      if (p === undefined) {
        car.seats[seat] = 0;
        if (seat === 0) car.owed = 0;
        continue;
      }
      if (p.ride.phase === ENTERING) {
        p.ride.ticks--;
        if (p.ride.ticks <= 0) {
          p.ride.ticks = 0;
          p.ride.phase = SEATED;
        }
      } else if (p.ride.phase === LEAVING) {
        p.ride.ticks--;
        if (p.ride.ticks <= 0) {
          if (slowForDoors(car) && freeDoor(world, car, seat)) {
            p.pos = { x: DOOR.x, y: heightAt(world, DOOR.x, DOOR.z) + PLAYER_HALF.y, z: DOOR.z };
            p.vel = { x: 0, y: 0, z: 0 };
            p.grounded = true;
            p.ride = newRide();
            car.seats[seat] = 0;
            if (seat === 0) car.owed = 0;
          } else {
            // The car is moving again, or there is nowhere to stand: still in the seat.
            p.ride.ticks = 0;
            p.ride.phase = SEATED;
          }
        }
      }
    }
    const driver = car.seats[0] === 0 ? undefined : world.state.players.get(car.seats[0] as number);
    if (driver === undefined || driver.ride.phase !== SEATED) {
      car.owed = 0;
      driveCar(world, car, STILL);
    }
    seatRiders(world, car);
  }
}

/** Pushes a walker's hull out of every car's rectangle (the footprint, turned by its heading). */
export function constrainByCars(world: RiderWorld, pos: Vec3, vel: Vec3): void {
  const cars = world.state.cars;
  for (let i = 0; i < cars.length; i++) {
    carBox(cars[i] as Car);
    pushOut(CAR_BOX, 0, pos, vel, HULL_RADIUS);
  }
}

/** Puts a car back where it starts, at rest, with its riders set on foot beside it. */
export function returnCar(world: RiderWorld, id: number): void {
  const car = carOf(world, id);
  if (car === undefined) return;
  const at = carStart(world.forest.seed);
  car.x = at.x;
  car.z = at.z;
  car.hx = at.hx;
  car.hz = at.hz;
  car.speed = 0;
  car.slip = 0;
  car.steer = 0;
  car.controls = { throttle: 0, turn: 0, handbrake: false };
  car.lights = false;
  car.owed = 0;
  groundCar(world.ground, car);
  // The doors a rider has been put out at already: no two riders are put at one door (where the curb side is blocked, the passenger is not stood on the driver).
  let taken = 0;
  for (let seat = 0; seat < 4; seat++) {
    const pid = car.seats[seat] as number;
    car.seats[seat] = 0;
    if (pid === 0) continue;
    const p = world.state.players.get(pid);
    if (p === undefined) continue;
    // The seat's own door, then the others' that no rider stands at, and the seat's own whether it is free or not if none is.
    let found = false;
    for (let k = 0; k < 4 && !found; k++) {
      const door = seat ^ k;
      if ((taken & (1 << door)) !== 0) continue;
      doorPlace(car, door, DOOR);
      found = standFree(world, DOOR.x, DOOR.z, car.y);
      if (found) taken |= 1 << door;
    }
    if (!found) doorPlace(car, seat, DOOR);
    p.pos = { x: DOOR.x, y: heightAt(world, DOOR.x, DOOR.z) + PLAYER_HALF.y, z: DOOR.z };
    p.vel = { x: 0, y: 0, z: 0 };
    p.grounded = true;
    p.ride = newRide();
  }
}
