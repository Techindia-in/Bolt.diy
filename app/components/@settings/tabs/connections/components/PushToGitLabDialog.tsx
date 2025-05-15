import * as Dialog from '@radix-ui/react-dialog';
import { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import { motion } from 'framer-motion';
import { getLocalStorage } from '~/lib/persistence';
import { classNames } from '~/utils/classNames';
import type { GitLabUserResponse } from '~/types/GitLab';
import { logStore } from '~/lib/stores/logs';
import { workbenchStore } from '~/lib/stores/workbench';
import { extractRelativePath } from '~/utils/diff';
import { formatSize } from '~/utils/formatSize';
import type { FileMap, File } from '~/lib/stores/files';
import { usePreviewStore } from '~/lib/stores/previews';

interface PushToGitLabDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onPush: (
    projectName: string,
    username?: string,
    token?: string,
    isPrivate?: boolean,
    branchName?: string,
    commitMessage?: string,
  ) => Promise<string>;
}

interface GitLabRepo {
  id: string;
  name: string;
  path_with_namespace: string;
  web_url: string;
  description: string;
  star_count: number;
  forks_count: number;
  default_branch: string;
  last_activity_at: string;
  visibility: string;
}

export function PushToGitLabDialog({ isOpen, onClose, onPush }: PushToGitLabDialogProps) {
  const [projectName, setProjectName] = useState('');
  const [branchName, setBranchName] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [user, setUser] = useState<GitLabUserResponse | null>(null);
  const [recentProjects, setRecentProjects] = useState<GitLabRepo[]>([]);
  const [isFetchingProjects, setIsFetchingProjects] = useState(false);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [createdProjectUrl, setCreatedProjectUrl] = useState('');
  const [pushedFiles, setPushedFiles] = useState<{ path: string; size: number }[]>([]);
  const [commitMessage, setCommitMessage] = useState('Initial commit');

  // Load GitLab connection on mount
  useEffect(() => {
    if (isOpen) {
      const connection = getLocalStorage('gitlab_connection');

      if (connection?.user && connection?.token) {
        setUser(connection.user);

        // Only fetch if we have both user and token
        if (connection.token.trim()) {
          fetchRecentProjects(connection.token);
        }
      }
    }
  }, [isOpen]);

  const fetchRecentProjects = async (token: string) => {
    if (!token) {
      logStore.logError('No GitLab token available');
      toast.error('GitLab authentication required');

      return;
    }

    try {
      setIsFetchingProjects(true);

      const response = await fetch(
        'https://gitlab.com/api/v4/projects?membership=true&min_access_level=20&order_by=last_activity_at&per_page=5&simple=true',
        {
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token.trim()}`,
          },
        },
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));

        if (response.status === 401) {
          toast.error('GitLab token expired or invalid. Please reconnect your account.');

          // Clear invalid token
          const connection = getLocalStorage('gitlab_connection');

          if (connection) {
            localStorage.removeItem('gitlab_connection');
            setUser(null);
          }
        } else {
          logStore.logError('Failed to fetch GitLab projects', {
            status: response.status,
            statusText: response.statusText,
            error: errorData,
          });
          toast.error(`Failed to fetch projects: ${response.statusText}`);
        }

        setIsFetchingProjects(false);

        return;
      }

      const rawProjects = await response.json();

      // Basic validation of shape (you can enhance this if needed)
      const projects: GitLabRepo[] = Array.isArray(rawProjects)
        ? rawProjects.map((proj) => ({
            id: proj.id ?? 0,
            name: proj.name ?? '',
            path_with_namespace: proj.path_with_namespace ?? '',
            web_url: proj.web_url ?? '',
            description: proj.description ?? '',
            star_count: proj.star_count ?? 0,
            forks_count: proj.forks_count ?? 0,
            default_branch: proj.default_branch ?? 'main',
            last_activity_at: proj.last_activity_at ?? '',
            visibility: proj.visibility ?? 'private',
          }))
        : [];

      setRecentProjects(projects);
    } catch (error) {
      logStore.logError('Failed to fetch GitLab projects', { error });
      toast.error('Failed to fetch recent projects');
    } finally {
      setIsFetchingProjects(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const connection = getLocalStorage('gitlab_connection');

    if (!connection?.token || !connection?.user) {
      toast.error('Please connect your GitLab account in Settings > Connections first');
      return;
    }

    if (!projectName.trim()) {
      toast.error('Project name is required');
      return;
    }

    if (!branchName.trim()) {
      toast.error('Branch name is required');
      return;
    }

    if (!commitMessage.trim()) {
      toast.error('Commit message is required');
      return;
    }

    setIsLoading(true);

    try {
      // Check if project exists first
      try {
        const encodedProjectName = encodeURIComponent(projectName);
        const response = await fetch(
          `https://gitlab.com/api/v4/projects/${connection.user.username}%2F${encodedProjectName}`,
          {
            headers: {
              Accept: 'application/json',
              'Private-Token': connection.token,
            },
          },
        );

        if (response.ok) {
          // Project exists
          const existingProject = (await response.json()) as any;

          let confirmMessage = `Project "${projectName}" already exists. Do you want to update it? This will add or modify files in the project.`;

          // Add visibility change warning if needed
          const currentVisibility = existingProject.visibility;
          const newVisibility = isPrivate ? 'private' : 'public';

          if (currentVisibility !== newVisibility) {
            const visibilityChange = isPrivate
              ? 'This will also change the project visibility from public to private.'
              : 'This will also change the project visibility from private to public.';

            confirmMessage += `\n\n${visibilityChange}`;
          }

          const confirmOverwrite = window.confirm(confirmMessage);

          if (!confirmOverwrite) {
            setIsLoading(false);
            return;
          }
        }
      } catch (error) {
        // 404 means project doesn't exist, which is fine for new projects
        console.log('Project does not exist yet, will create a new one', error);
      }

      const projectUrl = await onPush(
        projectName,
        connection.user.username,
        connection.token,
        isPrivate,
        branchName,
        commitMessage,
      );
      setCreatedProjectUrl(projectUrl);

      // Get list of pushed files
      const files = workbenchStore.files.get();
      const filesList = Object.entries(files as FileMap)
        .filter(([, dirent]) => dirent?.type === 'file' && !dirent.isBinary)
        .map(([path, dirent]) => ({
          path: extractRelativePath(path),
          size: new TextEncoder().encode((dirent as File).content || '').length,
        }));

      setPushedFiles(filesList);

      // Force refresh of previews after push
      const previewStore = usePreviewStore();
      previewStore.refreshAllPreviews();

      setShowSuccessDialog(true);
    } catch (error) {
      console.error('Error pushing to GitLab:', error);
      toast.error('Failed to push to GitLab. Please check your project name and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setProjectName('');
    setBranchName('');
    setIsPrivate(false);
    setShowSuccessDialog(false);
    setCreatedProjectUrl('');
    onClose();
  };

  // Success Dialog
  if (showSuccessDialog) {
    return (
      <Dialog.Root open={isOpen} onOpenChange={(open) => !open && handleClose()}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999]" />
          <div className="fixed inset-0 flex items-center justify-center z-[9999]">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="w-[90vw] md:w-[600px] max-h-[85vh] overflow-y-auto"
            >
              <Dialog.Content className="bg-white dark:bg-[#1E1E1E] rounded-lg border border-[#E5E5E5] dark:border-[#333333] shadow-xl">
                <div className="p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-green-500">
                      <div className="i-ph:check-circle w-5 h-5" />
                      <Dialog.Title className="text-lg font-medium text-green-700 dark:text-green-400">
                        Successfully pushed to GitLab
                      </Dialog.Title>
                    </div>
                    <Dialog.Close
                      onClick={handleClose}
                      className={classNames(
                        'p-2 rounded-md',
                        'text-bolt-elements-textTertiary hover:text-bolt-elements-textSecondary',
                        'dark:text-bolt-elements-textTertiary-dark dark:hover:text-bolt-elements-textPrimary-dark',
                        'hover:bg-bolt-elements-background-depth-2 dark:hover:bg-bolt-elements-background-depth-3',
                        'focus:outline-none focus:ring-2 focus:ring-bolt-elements-borderColor dark:focus:ring-bolt-elements-borderColor-dark',
                      )}
                    >
                      <div className="i-ph:x w-5 h-5" />
                    </Dialog.Close>
                  </div>

                  <div className="bg-bolt-elements-background-depth-2 dark:bg-bolt-elements-background-depth-3 rounded-lg p-3 text-left">
                    <Dialog.Description className="text-xs text-bolt-elements-textSecondary dark:text-bolt-elements-textSecondary-dark mb-2">
                      Project URL
                    </Dialog.Description>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-sm bg-bolt-elements-background dark:bg-bolt-elements-background-dark px-3 py-2 rounded border border-bolt-elements-borderColor dark:border-bolt-elements-borderColor-dark text-bolt-elements-textPrimary dark:text-bolt-elements-textPrimary-dark font-mono">
                        {createdProjectUrl}
                      </code>
                      <motion.button
                        onClick={() => {
                          navigator.clipboard.writeText(createdProjectUrl);
                          toast.success('URL copied to clipboard');
                        }}
                        className="p-2 text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary dark:text-bolt-elements-textSecondary-dark dark:hover:text-bolt-elements-textPrimary-dark"
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                      >
                        <div className="i-ph:copy w-4 h-4" />
                      </motion.button>
                    </div>
                  </div>

                  <div className="bg-bolt-elements-background-depth-2 dark:bg-bolt-elements-background-depth-3 rounded-lg p-3">
                    <Dialog.Description className="text-xs text-bolt-elements-textSecondary dark:text-bolt-elements-textSecondary-dark mb-2">
                      Pushed Files ({pushedFiles.length})
                    </Dialog.Description>
                    <div className="max-h-[200px] overflow-y-auto custom-scrollbar">
                      {pushedFiles.map((file) => (
                        <div
                          key={file.path}
                          className="flex items-center justify-between py-1 text-sm text-bolt-elements-textPrimary dark:text-bolt-elements-textPrimary-dark"
                        >
                          <span className="font-mono truncate flex-1">{file.path}</span>
                          <span className="text-xs text-bolt-elements-textSecondary dark:text-bolt-elements-textSecondary-dark ml-2">
                            {formatSize(file.size)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <motion.a
                      href={createdProjectUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-2 rounded-lg bg-orange-600 text-white hover:bg-orange-700 text-sm inline-flex items-center gap-2"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      <div className="i-ph:gitlab-logo w-4 h-4" />
                      View Project
                    </motion.a>
                    <motion.button
                      onClick={() => {
                        navigator.clipboard.writeText(createdProjectUrl);
                        toast.success('URL copied to clipboard');
                      }}
                      className="px-4 py-2 rounded-lg bg-[#F5F5F5] dark:bg-[#1A1A1A] text-gray-600 dark:text-gray-400 hover:bg-[#E5E5E5] dark:hover:bg-[#252525] text-sm inline-flex items-center gap-2"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      <div className="i-ph:copy w-4 h-4" />
                      Copy URL
                    </motion.button>
                    <motion.button
                      onClick={handleClose}
                      className="px-4 py-2 rounded-lg bg-[#F5F5F5] dark:bg-[#1A1A1A] text-gray-600 dark:text-gray-400 hover:bg-[#E5E5E5] dark:hover:bg-[#252525] text-sm"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      Close
                    </motion.button>
                  </div>
                </div>
              </Dialog.Content>
            </motion.div>
          </div>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  if (!user) {
    return (
      <Dialog.Root open={isOpen} onOpenChange={(open) => !open && handleClose()}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999]" />
          <div className="fixed inset-0 flex items-center justify-center z-[9999]">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="w-[90vw] md:w-[500px]"
            >
              <Dialog.Content className="bg-white dark:bg-[#0A0A0A] rounded-lg p-6 border border-[#E5E5E5] dark:border-[#1A1A1A] shadow-xl">
                <div className="text-center space-y-4">
                  <motion.div
                    initial={{ scale: 0.8 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.1 }}
                    className="mx-auto w-12 h-12 rounded-xl bg-bolt-elements-background-depth-3 flex items-center justify-center text-orange-600"
                  >
                    <div className="i-ph:gitlab-logo w-6 h-6" />
                  </motion.div>
                  <Dialog.Title className="text-lg font-medium text-gray-900 dark:text-white">
                    GitLab Connection Required
                  </Dialog.Title>
                  <Dialog.Description className="text-sm text-gray-600 dark:text-gray-400">
                    Please connect your GitLab account in Settings {'>'} Connections to push your code to GitLab.
                  </Dialog.Description>
                  <motion.button
                    className="px-4 py-2 rounded-lg bg-orange-600 text-white text-sm hover:bg-orange-700 inline-flex items-center gap-2"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleClose}
                  >
                    <div className="i-ph:x-circle" />
                    Close
                  </motion.button>
                </div>
              </Dialog.Content>
            </motion.div>
          </div>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999]" />
        <div className="fixed inset-0 flex items-center justify-center z-[9999]">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="w-[90vw] md:w-[500px]"
          >
            <Dialog.Content className="bg-white dark:bg-[#0A0A0A] rounded-lg border border-[#E5E5E5] dark:border-[#1A1A1A] shadow-xl">
              <div className="p-6">
                <div className="flex items-center gap-4 mb-6">
                  <motion.div
                    initial={{ scale: 0.8 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.1 }}
                    className="w-10 h-10 rounded-xl bg-bolt-elements-background-depth-3 flex items-center justify-center text-orange-600"
                  >
                    <div className="i-ph:git-branch w-5 h-5" />
                  </motion.div>
                  <div>
                    <Dialog.Title className="text-lg font-medium text-gray-900 dark:text-white">
                      Push to GitLab
                    </Dialog.Title>
                    <Dialog.Description className="text-sm text-gray-600 dark:text-gray-400">
                      Push your code to a new or existing GitLab project
                    </Dialog.Description>
                  </div>
                  <Dialog.Close asChild>
                    <button
                      onClick={handleClose}
                      className={classNames(
                        'p-2 rounded-lg transition-all duration-200 ease-in-out bg-transparent',
                        'text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary',
                        'dark:text-bolt-elements-textTertiary-dark dark:hover:text-bolt-elements-textPrimary-dark',
                        'hover:bg-bolt-elements-background-depth-2 dark:hover:bg-bolt-elements-background-depth-3',
                        'focus:outline-none focus:ring-2 focus:ring-bolt-elements-borderColor dark:focus:ring-bolt-elements-borderColor-dark',
                      )}
                    >
                      <span className="i-ph:x block w-5 h-5" aria-hidden="true" />
                      <span className="sr-only">Close dialog</span>
                    </button>
                  </Dialog.Close>
                </div>

                <div className="flex items-center gap-3 mb-6 p-3 bg-bolt-elements-background-depth-2 dark:bg-bolt-elements-background-depth-3 rounded-lg">
                  <img src={user.avatar_url} alt={user.username} className="w-10 h-10 rounded-full" />
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{user.name || user.username}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">@{user.username}</p>
                  </div>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <label htmlFor="projectName" className="text-sm text-gray-600 dark:text-gray-400">
                      Project Name
                    </label>
                    <input
                      id="projectName"
                      type="text"
                      value={projectName}
                      onChange={(e) => setProjectName(e.target.value)}
                      placeholder="my-awesome-project"
                      className="w-full px-4 py-2 rounded-lg bg-bolt-elements-background-depth-2 dark:bg-bolt-elements-background-depth-3 border border-[#E5E5E5] dark:border-[#1A1A1A] text-gray-900 dark:text-white placeholder-gray-400"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="branchName" className="text-sm text-gray-600 dark:text-gray-400">
                      Branch Name
                    </label>
                    <input
                      id="branchName"
                      type="text"
                      value={branchName}
                      onChange={(e) => setBranchName(e.target.value)}
                      placeholder="main"
                      className="w-full px-4 py-2 rounded-lg bg-bolt-elements-background-depth-2 dark:bg-bolt-elements-background-depth-3 border border-[#E5E5E5] dark:border-[#1A1A1A] text-gray-900 dark:text-white placeholder-gray-400"
                      required
                    />
                  </div>

                  {recentProjects.length > 0 && (
                    <div className="space-y-2">
                      <label className="text-sm text-gray-600 dark:text-gray-400">Recent Projects</label>
                      <div className="space-y-2">
                        {recentProjects.map((project) => {
                          return (
                            <motion.button
                              key={project.path_with_namespace}
                              type="button"
                              onClick={() => setProjectName(project.name)}
                              className="w-full p-3 text-left rounded-lg bg-bolt-elements-background-depth-2 dark:bg-bolt-elements-background-depth-3 hover:bg-bolt-elements-background-depth-3 dark:hover:bg-bolt-elements-background-depth-4 transition-colors group"
                              whileHover={{ scale: 1.01 }}
                              whileTap={{ scale: 0.99 }}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <div className="i-ph:git-repository w-4 h-4 text-orange-600" />
                                  <span className="text-sm font-medium text-gray-900 dark:text-white group-hover:text-orange-600">
                                    {project.name}
                                  </span>
                                </div>
                                {project.visibility === 'private' && (
                                  <span className="text-xs px-2 py-1 rounded-full bg-orange-600/10 text-orange-600">
                                    Private
                                  </span>
                                )}
                              </div>
                              {project.description && (
                                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
                                  {project.description}
                                </p>
                              )}
                              <div className="mt-2 flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
                                <span className="flex items-center gap-1">
                                  <div className="i-ph:star w-3 h-3" />
                                  {project.star_count.toLocaleString()}
                                </span>
                                <span className="flex items-center gap-1">
                                  <div className="i-ph:git-fork w-3 h-3" />
                                  {project.forks_count.toLocaleString()}
                                </span>
                                <span className="flex items-center gap-1">
                                  <div className="i-ph:clock w-3 h-3" />
                                  {new Date(project.last_activity_at).toLocaleDateString()}
                                </span>
                              </div>
                            </motion.button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {isFetchingProjects && (
                    <div className="flex items-center justify-center py-4 text-gray-500 dark:text-gray-400">
                      <div className="i-ph:spinner-gap-bold animate-spin w-4 h-4 mr-2" />
                      Loading projects...
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="private"
                      checked={isPrivate}
                      onChange={(e) => setIsPrivate(e.target.checked)}
                      className="rounded border-[#E5E5E5] dark:border-[#1A1A1A] text-orange-600 focus:ring-orange-600 dark:bg-[#0A0A0A]"
                    />
                    <label htmlFor="private" className="text-sm text-gray-600 dark:text-gray-400">
                      Make project private
                    </label>
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="commitMessage" className="text-sm text-gray-600 dark:text-gray-400">
                      Commit Message
                    </label>
                    <input
                      id="commitMessage"
                      type="text"
                      value={commitMessage}
                      onChange={(e) => setCommitMessage(e.target.value)}
                      placeholder="Initial commit"
                      className="w-full px-4 py-2 rounded-lg bg-bolt-elements-background-depth-2 dark:bg-bolt-elements-background-depth-3 border border-[#E5E5E5] dark:border-[#1A1A1A] text-gray-900 dark:text-white placeholder-gray-400"
                      required
                    />
                  </div>

                  <div className="pt-4 flex gap-2">
                    <motion.button
                      type="button"
                      onClick={handleClose}
                      className="px-4 py-2 rounded-lg bg-[#F5F5F5] dark:bg-[#1A1A1A] text-gray-600 dark:text-gray-400 hover:bg-[#E5E5E5] dark:hover:bg-[#252525] text-sm"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      Cancel
                    </motion.button>
                    <motion.button
                      type="submit"
                      disabled={isLoading}
                      className={classNames(
                        'flex-1 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 text-sm inline-flex items-center justify-center gap-2',
                        isLoading ? 'opacity-50 cursor-not-allowed' : '',
                      )}
                      whileHover={!isLoading ? { scale: 1.02 } : {}}
                      whileTap={!isLoading ? { scale: 0.98 } : {}}
                    >
                      {isLoading ? (
                        <>
                          <div className="i-ph:spinner-gap-bold animate-spin w-4 h-4" />
                          Pushing...
                        </>
                      ) : (
                        <>
                          <div className="i-ph:git-branch w-4 h-4" />
                          Push to GitLab
                        </>
                      )}
                    </motion.button>
                  </div>
                </form>
              </div>
            </Dialog.Content>
          </motion.div>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
