import { PHASE_HELP, type PhaseName } from './tenders.ts';

/** The eight stages every tender moves through, in order. (Cancelled can happen at any point and is not a stage.) */
export const STAGES = ['Published', 'Clarifications', 'Bidding', 'Opening', 'Evaluation', 'Awarded', 'Standstill', 'Final'] as const satisfies readonly PhaseName[];

export type StageName = (typeof STAGES)[number];

export const STAGE_TEXT: Record<StageName, string> = {
  Published: PHASE_HELP.Published,
  Clarifications: PHASE_HELP.Clarifications,
  Bidding: PHASE_HELP.Bidding,
  Opening: PHASE_HELP.Opening,
  Evaluation: PHASE_HELP.Evaluation,
  Awarded: PHASE_HELP.Awarded,
  Standstill: PHASE_HELP.Standstill,
  Final: PHASE_HELP.Final,
};

/** Zero-based stage index for a phase name, or null for Cancelled. */
export function stageIndex(phase: PhaseName): number | null {
  const i = (STAGES as readonly string[]).indexOf(phase);
  return i < 0 ? null : i;
}
