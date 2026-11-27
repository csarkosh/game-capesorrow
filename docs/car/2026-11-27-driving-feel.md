# How the car is made to feel like a car

The car began as a tidy model: a bicycle that turned as far as its grip allowed, pushed wide by what the grip could not
hold, with a rigid body and a camera fixed behind it. It went where it was pointed and nothing about it moved. This
records what open-world games do to make driving a pleasure, which of it the car now does, and the numbers to turn.

## What the big games do

The handling of the Grand Theft Auto games is well recorded, because each car is a row of numbers (`handling.meta`)
that players have read and written about for years. Their cameras are not: no follow distance, lag, lens curve or shot
logic for the cinematic view is published, so the camera here follows general practice, and its numbers are this
game's own.

**Handling.** What the record shows a car is made of ([gtamods.com, Handling.meta](https://gtamods.com/wiki/Handling.meta),
[the Handling-Tools guide](https://eddlm.github.io/Handling-Tools/guide), [gtacars.net's glossary](https://gtacars.net/gta5/glossary)):

- **Grip that peaks and then falls.** A tyre has a peak grip (`fTractionCurveMax`) and a lower grip once it slides
  (`fTractionCurveMin`); the gap between them is why a slide, once begun, goes on. A sports sedan there has 2.5 and 2.25
  ([Sultan Classic](https://gtacars.net/gta5/sultan2)).
- **A handbrake that lets the rear go.** The rear's grip falls to the sliding value, the fronts keep theirs, and the car
  turns about its nose.
- **Grip shared between the ends, and drive at one of them.** A rear that grips a little more than the front is stable;
  a driven rear loses grip under power, which holds a slide.
- **A body on soft springs.** Spring force, compression and rebound damping (rebound about twice compression on that
  sedan: 1.4 and 2.75), anti-roll bars and roll centres: the body leans in a turn, dips under the brake and bounces.
  Grand Theft Auto IV is remembered for how far its cars leaned and wallowed; V made them flatter and quicker to answer,
  and writers still argue about which was better ([Kotaku](https://kotaku.com/15-small-things-gta-iv-does-better-than-gta-v-1753859687)).
- **Steering that the code shapes.** A lock in degrees (35 to 40) is in the numbers; how the lock narrows with speed, how
  fast the wheel turns and returns, and the counter-steer a keyboard player is given are in the code and unrecorded.

**Cameras.** What is known is thin: IV's chase camera is loose, slow to come round and not tied to where the car points
(players' complaints are the record: [gtaforums](https://gtaforums.com/topic/341831-camera-is-way-to-slow-in-tracking-vehicle/));
mods add a lens that widens with speed; racing games widen the lens and shake it a little near top speed
([Operation Sports](https://www.operationsports.com/why-is-speed-so-hard-to-capture-in-racing-games/)). The general
craft of smoothing and shaking a camera is Squirrel Eiserloh's talk, [Juicing Your Cameras With Math](https://gdcvault.com/play/1023146/Math-for-Game-Programmers-Juicing).
The practice those add up to: a camera that follows with a lag, aims between the car's nose and its velocity, goes
further back and wider with speed, shakes at a hit, comes back behind the car a moment after the stick is let go, and
is pulled in at once by a wall and let out slowly. The cinematic view is a run of fixed and car-mounted shots with hard
cuts, of which the roadside camera that watches the car go by is the one everyone remembers.

## What the car does of it

| What the big games do | Here |
|---|---|
| Grip that peaks and falls | The grip falls to 0.8 as a slide grows to 3 m/s (`SLIDE_GRIP`, `SLIDE_FULL`) |
| The car's weight carries it | The velocity is the car's own: a turn of the heading leaves it where it pointed, and the tyres take the sideways part away at the grip's rate (`step.ts`) |
| A handbrake that lets the rear go | The rear keeps 0.35 of its grip, the car pivots (`HAND_PIVOT`, `YAW_FOLLOW_HAND`) and brakes at 4.5 m/s² |
| A driven rear that slides under power | The rear's hold falls by a quarter at full throttle while it slides (`POWER_SLIDE`) |
| Counter-steer for a keyboard | The front wheels turn toward where the car is going (`COUNTER_STEER`), which holds a slide small and ends one |
| A body on soft springs | Drawn only (`bodySway.ts`): roll, pitch and heave springs driven by how the car's velocity changed, underdamped, rebound twice as stiff as compression, a lurch at a hit |
| A chase camera that lags and aims at the travel | It came round to the car's yaw at 2.5 per second already; it now aims 0.55 of the way to the velocity, and goes to the nose of a car that backs |
| A lens and a distance that grow with speed | Up to 0.15 rad and 0.7 m, at the fastest the car goes |
| A shake at a hit | A roll of up to 1.3 degrees for half a second |
| Look behind | C, held |
| A cinematic view | V: roadside, wheel, nose, high, orbit and tail shots (`cineCamera.ts`) |
| Tyres that are heard | The tyre noise rises and brightens with the slide |

What it comes to at the wheel, on pavement (`client/test/car/step.test.ts` holds each of these):

- A turn the tyres hold costs no speed and leaves no slide.
- Full lock at speed puts the tail out a little and holds it there: about 9 degrees at 10 m/s, 7 at 20, 4 at 30.
- The handbrake, pulled into a turn for 0.7 s, has the car 30 to 40 degrees sideways and turned 30 to 45 degrees.
- Let go of everything and the wheels turn against the slide: the car is straight within a second and a half.
- Hold the turn and the throttle after it and the slide runs on, dying over two seconds: the long way round a corner.

## What it does not do

- **The suspension is drawn, not simulated.** The body leans over wheels that stay where the rigid car has them. A
  wheel does not travel in its arch, a kerb does not unsettle the car, and the lean changes no grip. A car that rides on
  four sprung wheels is a different simulation, and one every machine would have to compute alike.
- **No hit turns the car.** A wall met at an angle still stops it until it is steered or backed; a car that glanced off
  and spun would want the push at a corner of the car to turn its heading.
- **It has not been driven fast.** The car is held to 10 m/s until the world is drawn fast enough for 30, and the
  handling was shaped by its numbers at 10, 20 and 30 m/s. The numbers that will want a hand on the wheel at speed are
  `YAW_FOLLOW` (how readily the tail steps out), `COUNTER_STEER` (how small a slide is held and how fast it ends),
  `HANDBRAKE_GRIP` and `YAW_FOLLOW_HAND` (how far the handbrake throws the car) and `POWER_SLIDE` (how long the throttle
  holds it), all in `client/src/sim/car/tuning.ts`.
- **No air.** The car never leaves the ground.
- **The camera's numbers are this game's.** Nothing about the big games' cameras was measured; if a view feels wrong the
  numbers at the top of `chaseCamera.ts` and `cineCamera.ts` are the place.
