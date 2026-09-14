import * as THREE from 'three';
import { avatar, nameplate } from './build.js';
import { lerp, lerpAngle } from './interp.js';

/**
 * The walking-around games (kitchen, nursery, bus, coin arena) all need the same
 * thing: one avatar per player, interpolated from `[slot, x, z, rot, ...]` rows, with
 * a nameplate on everyone but you. This is that, once.
 *
 * Games keep whatever extra columns their rows carry - `extra(slot)` hands them back -
 * so a cook can hold a cake and a driver can hold a shield without this file knowing
 * about either.
 */
export function createCrew(ctx, { scale = 1, decorate = null } = {}) {
    const { scene } = ctx;
    const members = new Map();          // slot -> { group, extra }
    const selfSlot = ctx.playerById(ctx.selfId)?.slot ?? 0;
    const selfPos = new THREE.Vector3();

    for (const player of ctx.players()) {
        const group = avatar(player.slot, { scale });
        if (player.id !== ctx.selfId) {
            const plate = nameplate(player.name, player.slot);
            plate.position.y = 2.15 * scale;
            group.add(plate);
        } else {
            // A ring under your own feet is the fastest way to find yourself in a
            // crowd of fourteen identically-shaped people.
            const ring = new THREE.Mesh(
                new THREE.RingGeometry(0.55, 0.72, 20),
                new THREE.MeshBasicMaterial({ color: 0xffb703, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
            );
            ring.rotation.x = -Math.PI / 2;
            ring.position.y = 0.03;
            group.add(ring);
        }
        decorate?.(group, player);
        scene.add(group);
        members.set(player.slot, { group, extra: null, player });
    }

    return {
        selfSlot,
        selfPos,
        members,

        get(slot) { return members.get(slot) ?? null; },
        extra(slot) { return members.get(slot)?.extra ?? null; },

        /** Applies one interpolated frame of `[slot, x, z, rot, ...extra]` rows. */
        apply(frame, y = 0) {
            if (!frame) return;
            for (const row of frame.b) {
                const member = members.get(row[0]);
                if (!member) continue;
                const prev = frame.a.find((r) => r[0] === row[0]) ?? row;
                member.group.position.set(
                    lerp(prev[1], row[1], frame.t),
                    y,
                    lerp(prev[2], row[2], frame.t),
                );
                member.group.rotation.y = lerpAngle(prev[3], row[3], frame.t);
                member.extra = row.slice(4);
                if (row[0] === selfSlot) selfPos.copy(member.group.position);
            }
        },

        dispose() { members.clear(); },
    };
}

/**
 * A camera that hangs behind and above a target and eases toward it. Used by every
 * game where you walk or drive, so the feel is identical across the suite.
 */
export function chaseCamera(camera, { height = 12, back = 11, lookAhead = 0, tilt = 0 } = {}) {
    const goal = new THREE.Vector3();
    const look = new THREE.Vector3();
    return function follow(target, dt, heading = 0) {
        goal.set(
            target.x - Math.sin(heading) * back,
            target.y + height,
            target.z - Math.cos(heading) * back + tilt,
        );
        camera.position.lerp(goal, 1 - Math.exp(-6 * dt));
        look.set(target.x + Math.sin(heading) * lookAhead, target.y + 0.8, target.z + Math.cos(heading) * lookAhead);
        camera.lookAt(look);
    };
}
