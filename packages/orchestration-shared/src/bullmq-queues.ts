// BullMQ queue inventory
// See docs/specs/03-orchestration.md §2
export const BULLMQ_QUEUES = [
  'llm',
  'probe',
  'experiment',
  'optimization',
  'release',
  'export',
] as const;

export type BullmqQueue = (typeof BULLMQ_QUEUES)[number];
