// see https://docs.anthropic.com/en/docs/about-claude/models
export const MAX_TOKENS = 8192;

// limits the number of model responses that can be returned in a single request
export const MAX_RESPONSE_SEGMENTS = 2;

export interface File {
  type: 'file';
  content: string;
  isBinary: boolean;
}

export interface Folder {
  type: 'folder';
}

type Dirent = File | Folder;

export type FileMap = Record<string, Dirent | undefined>;

export const IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.git/**',
  '**/*.min.js',
  '**/*.bundle.js',
  '**/*.js.map',
  '**/*.d.ts',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
];

export const TAG_PREFIX = '@prompt';
