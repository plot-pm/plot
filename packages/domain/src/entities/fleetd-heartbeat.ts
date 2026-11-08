import { z } from 'zod';

/**
 * The version word a heartbeat carries.
 *
 * A LITERAL, so an unrecognised value fails the parse rather than the reader.
 */
export const FLEETD_HEARTBEAT_VERSION = 1;

/** The loops whose last completed pass the heartbeat reports. */
export const FLEETD_LOOPS = ['tick', 'scan', 'pr-reader', 'issue-reader'] as const;

// plot-state: classification — the four loops are peers; none follows another and each may be absent.
export const FleetdLoopSchema = z.enum(FLEETD_LOOPS);
export type FleetdLoop = z.infer<typeof FleetdLoopSchema>;

/** How fleetd was started: by the init system, or by hand. */
export const FLEETD_SUPERVISORS = ['launchd', 'systemd', 'none'] as const;

// plot-state: classification — how a process was started; a process starts one way and never moves between them.
export const FleetdSupervisedSchema = z.enum(FLEETD_SUPERVISORS);
export type FleetdSupervised = z.infer<typeof FleetdSupervisedSchema>;

/** One loop's observer fields. */
export const FleetdLoopPassSchema = z
  .object({
    /** When the loop last completed a pass, epoch milliseconds; null before its first. */
    lastPassAt: z.number().nonnegative().nullable(),
  })
  .strict();
export type FleetdLoopPass = z.infer<typeof FleetdLoopPassSchema>;

/**
 * What fleetd says about itself every `HEARTBEAT_MS`, whether or not anything
 * changed and whether or not the repository has a git host.
 *
 * `pid` and `startedAt` repeat `fleetd-start.json`, so a reader can tell that
 * both files describe one process. A loop that fleetd does not run is absent
 * from {@link loops}, and a reader judges only the loops present.
 */
export const FleetdHeartbeatSchema = z
  .object({
    /** The format, so an older or newer file is unparseable rather than misread. */
    version: z.literal(FLEETD_HEARTBEAT_VERSION),
    /** The process id that wrote this heartbeat. */
    pid: z.number().int().positive(),
    /** When this process started, epoch milliseconds. */
    startedAt: z.number().nonnegative(),
    /** When this heartbeat was written, epoch milliseconds. */
    beatAt: z.number().nonnegative(),
    /** The generation of the `RepoSnapshot` fleetd holds. */
    generation: z.number().int().nonnegative(),
    /** The channel protocol number fleetd speaks; absent while no channel contract exists. */
    protocol: z.number().int().positive().optional(),
    /** The `at` of the last bridge fleetd wrote, epoch milliseconds; null before its first. */
    bridgeAt: z.number().nonnegative().nullable(),
    /** Whether an init system started this process, read from its environment. */
    supervised: FleetdSupervisedSchema,
    /** How many file watches fleetd wants armed. */
    watchesWanted: z.number().int().nonnegative(),
    /** How many of those are armed. */
    watchesArmed: z.number().int().nonnegative(),
    /** When a watch event last arrived, epoch milliseconds; null if none has. */
    lastEventAt: z.number().nonnegative().nullable(),
    /** When the safety-net read last ran, epoch milliseconds; null if it has not. */
    lastSafetyNetAt: z.number().nonnegative().nullable(),
    /** Each running loop's last completed pass. */
    loops: z.object({
      tick: FleetdLoopPassSchema.optional(),
      scan: FleetdLoopPassSchema.optional(),
      'pr-reader': FleetdLoopPassSchema.optional(),
      'issue-reader': FleetdLoopPassSchema.optional(),
    }).strict(),
  })
  .strict();

export type FleetdHeartbeat = z.infer<typeof FleetdHeartbeatSchema>;

/**
 * Parses a heartbeat file's whole contents, or null where it is not one.
 *
 * AN UNREADABLE HEARTBEAT IS NO HEARTBEAT, NEVER A FAILURE: a torn write, an
 * unrecognised `version` and a changed shape all read as absent.
 *
 * @param text - the file's contents.
 * @returns the heartbeat, or null where it is absent or unrecognised.
 */
export const decodeFleetdHeartbeat = (text: string): FleetdHeartbeat | null => {
  if (text.trim() === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const result = FleetdHeartbeatSchema.safeParse(parsed);
  return result.success ? result.data : null;
};

/**
 * Renders a heartbeat for writing.
 *
 * @param heartbeat - what fleetd says about itself.
 * @returns the file's contents.
 */
export const encodeFleetdHeartbeat = (heartbeat: FleetdHeartbeat): string => `${JSON.stringify(heartbeat)}\n`;
