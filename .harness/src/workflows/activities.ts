import { proxyActivities } from '@temporalio/workflow';
import type * as activities from '../activities';

// How Temporal runs the activities: how long they may take, and how often it retries them.

// An agent run takes minutes. It heartbeats every 10 seconds, so when the worker dies, Temporal
// notices after 1 minute (heartbeatTimeout) instead of 45, and runs it again on the next worker.
export const { runAgent, loadsSkill } = proxyActivities<typeof activities>({
  startToCloseTimeout: '45 minutes',
  heartbeatTimeout: '1 minute',
  retry: { maximumAttempts: 3, initialInterval: '30 seconds' },
});

// Everything else: files, git and the tests
export const {
  listTickets,
  readyTickets,
  blockedTickets,
  progressLeft,
  setFeedback,
  runTests,
  changesSince,
  resetTo,
  headCommit,
  currentBranch,
  checkoutProblem,
  ticketDone,
  addWorktree,
  removeWorktree,
  requireCommitted,
  branchDiffs,
  mergeBranch,
  listSkillLoadedEvalCases,
  listEvalsTasks,
  describeSetup,
  prepareRun,
  acceptRun,
  failingHiddenTests,
  gradeInput,
  removeCopy,
  writeRun,
  writeReport,
  describeSkillSetup,
  writeSkillReport,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '20 minutes',
  heartbeatTimeout: '1 minute',
  retry: { maximumAttempts: 3 },
});
