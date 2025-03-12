import dotenv from 'dotenv';
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';

// Load environment variables
dotenv.config();

// Configuration
const PORT = process.env.NODERUNNER_PORT || 3002;
const WORKSPACE_DIR = process.env.NODERUNNER_WORKSPACE_DIR || '/app/workspace';
const API_KEY = process.env.NODERUNNER_API_KEY;
const execPromise = promisify(exec);

// Ensure workspace directory exists
if (!fs.existsSync(WORKSPACE_DIR)) {
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
  console.log(`Created workspace directory: ${WORKSPACE_DIR}`);
}

// Types
interface ExecuteCommandRequest {
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
}

interface SpawnCommandRequest {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

interface CommandResult {
  id: string;
  status: 'success' | 'error';
  stdout?: string;
  stderr?: string;
  error?: string;
  code?: number;
}

// Active processes map
const activeProcesses: Record<
  string,
  {
    process: ReturnType<typeof spawn>;
    stdout: string[];
    stderr: string[];
    status: 'running' | 'completed' | 'error';
    code?: number;
  }
> = {};

// Initialize express app
const app = express();

// Middleware
app.use(morgan('dev'));
app.use(cors());
app.use(express.json());

// Routes
// Execute a command and return the result (simple, synchronous execution)
app.post('/execute', async (req: Request, res: Response) => {
  try {
    const { command, cwd = WORKSPACE_DIR, env = {}, timeout = 30000 } = req.body as ExecuteCommandRequest;

    if (!command) {
      return res.status(400).json({ error: 'Command is required' });
    }

    // Create directory if it doesn't exist
    const workingDir = path.isAbsolute(cwd) ? cwd : path.join(WORKSPACE_DIR, cwd);
    if (!fs.existsSync(workingDir)) {
      fs.mkdirSync(workingDir, { recursive: true });
    }

    // Execute command
    console.log(`Executing command: ${command} in ${workingDir}`);
    const result = await execPromise(command, {
      cwd: workingDir,
      env: { ...process.env, ...env },
      timeout,
    });

    res.json({
      id: uuidv4(),
      status: 'success',
      stdout: result.stdout,
      stderr: result.stderr,
    });
  } catch (error: any) {
    console.error('Error executing command:', error);
    res.status(500).json({
      id: uuidv4(),
      status: 'error',
      error: error.message,
      stderr: error.stderr,
      stdout: error.stdout,
      code: error.code,
    });
  }
});

// Spawn a long-running process
app.post('/spawn', (req: Request, res: Response) => {
  try {
    const { command, args = [], cwd = WORKSPACE_DIR, env = {} } = req.body as SpawnCommandRequest;

    if (!command) {
      return res.status(400).json({ error: 'Command is required' });
    }

    // Create directory if it doesn't exist
    const workingDir = path.isAbsolute(cwd) ? cwd : path.join(WORKSPACE_DIR, cwd);
    if (!fs.existsSync(workingDir)) {
      fs.mkdirSync(workingDir, { recursive: true });
    }

    // Generate a unique ID for this process
    const processId = uuidv4();

    // Spawn the process
    console.log(`Spawning process: ${command} ${args.join(' ')} in ${workingDir}`);
    const childProcess = spawn(command, args, {
      cwd: workingDir,
      env: { ...process.env, ...env },
    });

    // Store the process and set up data collection
    activeProcesses[processId] = {
      process: childProcess,
      stdout: [],
      stderr: [],
      status: 'running',
    };

    // Handle process errors (prevent crash)
    childProcess.on('error', (error) => {
      console.error(`[${processId}] Process error:`, error);

      // Update process status
      if (activeProcesses[processId]) {
        activeProcesses[processId].status = 'error';
        activeProcesses[processId].stderr.push(`Error: ${error.message}`);
      }
    });

    // Collect stdout
    childProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(`[${processId}] stdout: ${output}`);
      activeProcesses[processId].stdout.push(output);
    });

    // Collect stderr
    childProcess.stderr.on('data', (data) => {
      const output = data.toString();
      console.log(`[${processId}] stderr: ${output}`);
      activeProcesses[processId].stderr.push(output);
    });

    // Handle process completion
    childProcess.on('close', (code) => {
      console.log(`[${processId}] Process exited with code ${code}`);
      activeProcesses[processId].status = code === 0 ? 'completed' : 'error';
      activeProcesses[processId].code = code || 0;

      // Clean up old processes after 1 hour
      setTimeout(() => {
        delete activeProcesses[processId];
      }, 3600000);
    });

    // Return process ID to client
    res.json({
      id: processId,
      status: 'running',
    });
  } catch (error: any) {
    console.error('Error spawning process:', error);
    res.status(500).json({
      status: 'error',
      error: error.message,
    });
  }
});

// Get status of a spawned process
app.get('/process/:id', (req: Request, res: Response) => {
  const processId = req.params.id;

  if (!processId || !activeProcesses[processId]) {
    return res.status(404).json({ error: 'Process not found' });
  }

  const process = activeProcesses[processId];

  res.json({
    id: processId,
    status: process.status,
    stdout: process.stdout.join(''),
    stderr: process.stderr.join(''),
    code: process.code,
  });
});

// Send input to a running process
app.post('/process/:id/input', (req: Request, res: Response) => {
  const processId = req.params.id;
  const { input } = req.body;

  if (!processId || !activeProcesses[processId]) {
    return res.status(404).json({ error: 'Process not found' });
  }

  if (!input) {
    return res.status(400).json({ error: 'Input is required' });
  }

  const process = activeProcesses[processId];

  // Check if process is still running
  if (process.status !== 'running') {
    return res.status(400).json({ error: 'Process is not running' });
  }
  // Send input to process
  if (process.process.stdin) {
    process.process.stdin.write(input + '\n');
  } else {
    return res.status(400).json({ error: 'Process stdin is not available' });
  }

  res.json({
    id: processId,
    status: 'input_sent',
  });
});

// Terminate a running process
app.delete('/process/:id', (req: Request, res: Response) => {
  const processId = req.params.id;

  if (!processId || !activeProcesses[processId]) {
    return res.status(404).json({ error: 'Process not found' });
  }

  const process = activeProcesses[processId];

  // Check if process is still running
  if (process.status !== 'running') {
    return res.status(400).json({ error: 'Process is not running' });
  }

  // Kill the process
  process.process.kill();
  process.status = 'completed';

  res.json({
    id: processId,
    status: 'terminated',
  });
});

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Node.js executor running on port ${PORT}`);
  console.log(`Workspace directory: ${WORKSPACE_DIR}`);
});
