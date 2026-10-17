// What the parts of the view share: the spinner, which lines of a list too long for the screen show, and what n does
import type { Need } from '../model';
import type { Ui } from './index';

const SPINNER = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
export const spin = (ui: Ui) => SPINNER[ui.tick % SPINNER.length];

// Which of `total` lines come first when only `rows` fit: from `from`, moved just enough that `focus` is in view, never past the end
export function scrollWindow(total: number, rows: number, focus: number, from = 0): number {
  let first = Math.min(Math.max(from, 0), Math.max(0, total - rows));
  if (focus < first) first = focus;
  if (focus >= first + rows) first = focus - rows + 1;
  return Math.max(0, Math.min(first, total - rows));
}

// What n does about a need, as the banner and the footer say it
export function actionOf(need: Need): string {
  return { approve: 'approve', merge: 'decide', answer: 'answer', failed: 'details', stuck: 'details' }[need.kind];
}
