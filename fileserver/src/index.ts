import dotenv from 'dotenv';
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import fs from 'fs';
import path from 'path';
import chokidar from 'chokidar';

// Load environment variables
dotenv.config();

// Types
interface FileInfo {
  name: string;
  isDirectory: boolean;
  size: number;
  modifiedTime: Date;
}

interface FileChangeEvent {
  type: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';
  path: string;
  timestamp: number;
}

interface WriteFileRequest {
  path: string;
  content: string;
  encoding?: BufferEncoding;
}

interface CreateDirectoryRequest {
  path: string;
  recursive?: boolean;
}

// Configuration
const PORT = process.env.FILESERVER_PORT || 3001;
const ROOT_DIR = process.env.FILESERVER_ROOT_DIR || '/app/workspace';
const API_KEY = process.env.FILESERVER_API_KEY;

// Create workspace directory if it doesn't exist
if (!fs.existsSync(ROOT_DIR)) {
  fs.mkdirSync(ROOT_DIR, { recursive: true });
  console.log(`Created workspace directory: ${ROOT_DIR}`);
}

// Initialize express app
const app = express();

// Middleware
app.use(morgan('dev'));
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// File change tracking
const fileChanges: FileChangeEvent[] = [];
const watcher = chokidar.watch(ROOT_DIR, {
  ignored: /(^|[\/\\])\../, // ignore dotfiles
  persistent: true,
  ignoreInitial: true,
});

watcher
  .on('add', (filePath: string) => {
    const relativePath = path.relative(ROOT_DIR, filePath);
    fileChanges.push({ type: 'add', path: relativePath, timestamp: Date.now() });
    console.log(`File ${relativePath} has been added`);
  })
  .on('change', (filePath: string) => {
    const relativePath = path.relative(ROOT_DIR, filePath);
    fileChanges.push({ type: 'change', path: relativePath, timestamp: Date.now() });
    console.log(`File ${relativePath} has been changed`);
  })
  .on('unlink', (filePath: string) => {
    const relativePath = path.relative(ROOT_DIR, filePath);
    fileChanges.push({ type: 'unlink', path: relativePath, timestamp: Date.now() });
    console.log(`File ${relativePath} has been removed`);
  })
  .on('addDir', (dirPath: string) => {
    const relativePath = path.relative(ROOT_DIR, dirPath);
    fileChanges.push({ type: 'addDir', path: relativePath, timestamp: Date.now() });
    console.log(`Directory ${relativePath} has been added`);
  })
  .on('unlinkDir', (dirPath: string) => {
    const relativePath = path.relative(ROOT_DIR, dirPath);
    fileChanges.push({ type: 'unlinkDir', path: relativePath, timestamp: Date.now() });
    console.log(`Directory ${relativePath} has been removed`);
  });

// Routes
// Read file
app.get('/files', async (req: Request, res: Response) => {
  try {
    const filePath = req.query.path as string;
    if (!filePath) {
      return res.status(400).json({ error: 'Path parameter is required' });
    }

    const fullPath = path.join(ROOT_DIR, filePath);

    // Check if file exists
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Check if path is a directory
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      const files = fs.readdirSync(fullPath);
      const fileDetails: FileInfo[] = files.map((file) => {
        const fileStat = fs.statSync(path.join(fullPath, file));
        return {
          name: file,
          isDirectory: fileStat.isDirectory(),
          size: fileStat.size,
          modifiedTime: fileStat.mtime,
        };
      });
      return res.json(fileDetails);
    }

    // Read and send file content
    const content = fs.readFileSync(fullPath);
    res.send(content);
  } catch (error) {
    console.error('Error reading file:', error);
    res.status(500).json({ error: 'Failed to read file' });
  }
});

// Write file
app.post('/files', async (req: Request, res: Response) => {
  try {
    const { path: filePath, content, encoding = 'utf8' } = req.body as WriteFileRequest;

    if (!filePath) {
      return res.status(400).json({ error: 'Path parameter is required' });
    }

    const fullPath = path.join(ROOT_DIR, filePath);
    const dirPath = path.dirname(fullPath);

    // Create directory if it doesn't exist
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    // Write file
    fs.writeFileSync(fullPath, content, { encoding });

    res.json({ success: true });
  } catch (error) {
    console.error('Error writing file:', error);
    res.status(500).json({ error: 'Failed to write file' });
  }
});

// Delete file
app.delete('/files', async (req: Request, res: Response) => {
  try {
    const filePath = req.query.path as string;

    if (!filePath) {
      return res.status(400).json({ error: 'Path parameter is required' });
    }

    const fullPath = path.join(ROOT_DIR, filePath);

    // Check if file exists
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const stat = fs.statSync(fullPath);

    // Remove file or directory
    if (stat.isDirectory()) {
      fs.rmSync(fullPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(fullPath);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// Create directory
app.post('/directories', async (req: Request, res: Response) => {
  try {
    const { path: dirPath, recursive = true } = req.body as CreateDirectoryRequest;

    if (!dirPath) {
      return res.status(400).json({ error: 'Path parameter is required' });
    }

    const fullPath = path.join(ROOT_DIR, dirPath);

    // Create directory
    fs.mkdirSync(fullPath, { recursive });

    res.json({ success: true });
  } catch (error) {
    console.error('Error creating directory:', error);
    res.status(500).json({ error: 'Failed to create directory' });
  }
});

// Get file changes
app.get('/changes', (req: Request, res: Response) => {
  const since = parseInt(req.query.since as string) || 0;
  const changes = fileChanges.filter((change) => change.timestamp > since);
  res.json(changes);
});

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

// Start server
app.listen(PORT, () => {
  console.log(`File server running on port ${PORT}`);
  console.log(`Serving files from ${ROOT_DIR}`);
});
