# WebSocket Protocol

Transport: a single raw WebSocket per client. Every frame is a JSON object with a
`t` discriminator. Constants live in `shared/protocol.js` and are imported by both
sides, so this document describes payloads rather than re-listing names.

```
ws://<host>/ws          (wss:// behind TLS — the client picks the scheme from location.protocol)
```

---

## Handshake

```
client ──▶  { t:'hello',  name:'Huud', version:1 }
server ──▶  { t:'welcome', id:'p_7f3a', version:1, games:[ {id,title,blurb,emoji,mode,maxPlayers} ... ] }
```

A `hello` with a mismatched `version` is answered with
`{ t:'error', code:'bad_version' }` and the socket is closed — an old cached client
is the single most likely failure on a family device, and a clear message beats a
silent desync.

## Rooms

```
client ──▶  { t:'create' }                    open a room, become host
client ──▶  { t:'join', code:'WXYZ' }         join an existing one
server ──▶  { t:'room', code, hostId, phase, gameId, players:[PlayerView] }
```

`PlayerView`:

```js
{ id:'p_7f3a', name:'Huud', slot:0, ready:true, connected:true, score:0, latency:42 }
```

`room` is re-broadcast to everyone on any roster change (join, leave, rename, ready,
host migration). It is the only message that carries the full roster; everything
during play refers to players by `id` alone.

Errors: `no_room` (bad code), `room_full` (14 already seated), `not_host`
(a non-host sent `pick` / `start` / `restart`), `bad_phase` (action does not apply
to the current phase).

## Starting a round

```
host   ──▶  { t:'pick', gameId:'mango-target' }
server ──▶  { t:'picked', gameId:'mango-target' }          everyone previews it
host   ──▶  { t:'start' }
server ──▶  { t:'room', phase:'countdown', ... }
server ──▶  { t:'start', gameId, seed:918273, full:{ ... } }
                                                            ~3.2s later
server ──▶  { t:'room', phase:'playing', ... }
```

`seed` lets clients generate identical cosmetic randomness (tree placement, crowd
idle offsets) without the server having to send it. It is **never** used for anything
that affects scoring — that stays server-side.

`full` is the game's `fullState()`: the complete initial world, sent once. Late
joiners receive the same `start` frame mid-round with the world as it stands.

## During play

```
client ──▶  { t:'input',  ax:0.7, ay:-0.2, b:1 }           ≤20Hz, intent only
client ──▶  { t:'action', a:'throw', dx:0.3, dy:0.8, p:0.7, n:17 }
server ──▶  { t:'state',  k:412, ... }                     per tick, game-specific
server ──▶  { t:'event',  e:'hit', by:'p_7f3a', v:50 }     one-shot
server ──▶  { t:'scores', b:[ {i:'p_7f3a', s:340}, ... ] }  2Hz
```

**`t` and `n` are reserved.** A game payload must never use either as a field name -
`t` is the message-type discriminator and `n` is the action sequence number. The
client's `net.input()` and `net.action()` spread the payload first and set `t`/`n`
last so a collision cannot silently rewrite the message type, but a game that names a
field `t` will still lose that field. Name it something else.

`n` on an action is a per-client sequence number. The server keeps the last seen `n`
per player and drops anything not greater, which makes a replayed frame after a
reconnect harmless.

`state` payloads are game-defined and deliberately terse. The common shape for
movement games is:

```js
{ t:'state', k:412, p:[ [slot, x, z, rot, extra], ... ] }
```

— one flat array per player, numbers rounded to 2 decimals by `r2()`. 14 players cost
about 420 bytes a tick this way.

## Ending

```
server ──▶  { t:'end', reason:'time', results:[ {id,name,slot,score,place} ... ] }
server ──▶  { t:'room', phase:'results', ... }
host   ──▶  { t:'restart' }        same game again
host   ──▶  { t:'pick', gameId }   back to the lobby picker
```

## Keepalive and latency

```
client ──▶  { t:'ping', c:1737052800123 }      every 2s
server ──▶  { t:'pong', c:1737052800123, s:1737052800130 }
```

Round-trip is halved for the latency dot and reported in the next `room` broadcast.
The server also sends WebSocket-level pings every 25s and drops a socket that misses
two, which is what actually catches a phone that went to sleep in a pocket.

## Limits

| Limit | Value | Enforced in |
|---|---|---|
| Players per room | 14 | `room.js` |
| Frame size | 4 KB | `player.js` |
| Frames per second per socket | 90 | `player.js` |
| Name length | 14 chars | `room.js` |
| Chat length | 140 chars | `room.js` |
| Idle room reaped after | 10 min | `rooms.js` |

Exceeding the frame rate earns one `{ t:'error', code:'rate_limit' }` and then a
disconnect, because at that point it is either a bug or a script.
