export type BlockType =
  | "instruction"
  | "reflection"
  | "voice"
  | "visualization"
  | "steps"
  | "action_plan"
  | "sketch"
  | "sensory"
  | "report"
  | "timer"
  | "evaluation"
  | "container";

export type BlockDescriptor = {
  id: string;
  type: BlockType;
  title?: string;
  subtitle?: string;
  prompt?: string;
  details?: string[];
  steps?: string[];
  minutes?: number;
  emphasis?: "voice" | "write" | "plan" | "observe";
  props?: Record<string, any>;
  children?: BlockDescriptor[];
  next?: string | null;
};

export type BlockLayout = {
  start_block_id: string;
  blocks: BlockDescriptor[];
};

// Not a route component; prevent Expo Router warnings.
export default {};
