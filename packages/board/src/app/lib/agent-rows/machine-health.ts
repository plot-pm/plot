import { machineHealth as domainMachineHealth, type HostAnswer, type MachineHealth } from '@plot-pm/domain/rules/machine-health';
import type { FleetMachine } from '../../../contract/schema.js';

export type { MachineDot, MachineHealth, MachineRow } from '@plot-pm/domain/rules/machine-health';

const HOST_NAMES: Readonly<Record<string, string>> = { github: 'GitHub', bitbucket: 'Bitbucket' };

/**
 * The host's display name: the connector's own word, capitalised where this board knows how.
 *
 * @param connector - the connector's backend word.
 */
export const hostName = (connector: string): string => HOST_NAMES[connector] ?? connector;

/**
 * The Machine section's fact — the domain's `machineHealth`, with the board's host names.
 *
 * @param reading - the payload's reading, or null or undefined where the board has not measured.
 * @param answer - `hostAnswer` of the fleet's PR age and PR error.
 */
export const machineHealth = (reading: FleetMachine | null | undefined, answer: HostAnswer = 'answered'): MachineHealth =>
  domainMachineHealth(reading, answer, hostName);
