import type { GitHubRepoInfo, GitLabProjectInfo, RepositoryStats, GitHubUserResponse } from '~/types/GitHub';
import { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import * as Dialog from '@radix-ui/react-dialog';
import { classNames } from '~/utils/classNames';
import { getLocalStorage } from '~/lib/persistence';
import { Input } from '~/components/ui/Input';
import Cookies from 'js-cookie';
import { RepositoryDialogContext } from './RepositoryDialogContext';
import { StatsDialog } from './StatsDialog';
import { GitHubAuthDialog } from './GitHubAuthDialog';

interface RepositorySelectionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (url: string) => void;
}

interface SearchFilters {
  language?: string;
  stars?: number;
  forks?: number;
}

export function RepositorySelectionDialog({ isOpen, onClose, onSelect }: RepositorySelectionDialogProps) {
  const [selectedRepository, setSelectedRepository] = useState<GitHubRepoInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [githubRepositories, setGithubRepositories] = useState<GitHubRepoInfo[]>([]);
  const [gitlabRepositories, setGitlabRepositories] = useState<GitHubRepoInfo[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<GitHubRepoInfo[]>([]);
  const [activeTab, setActiveTab] = useState<'my-repos' | 'search' | 'url'>('my-repos');
  const [customUrl, setCustomUrl] = useState('');
  const [branches, setBranches] = useState<{ name: string; default?: boolean }[]>([]);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [filters, setFilters] = useState<SearchFilters>({});
  const [showStatsDialog, setShowStatsDialog] = useState(false);
  const [currentStats, setCurrentStats] = useState<RepositoryStats | null>(null);
  const [pendingGitUrl, setPendingGitUrl] = useState<string>('');
  const [showAuthDialog, setShowAuthDialog] = useState(false);

  // Initialize GitLab connection and fetch projects
  useEffect(() => {
    const savedConnection = getLocalStorage('gitlab_connection');

    // If no connection exists but environment variables are set, create a connection
    if (!savedConnection && import.meta.env.VITE_GITLAB_ACCESS_TOKEN) {
      const token = import.meta.env.VITE_GITLAB_ACCESS_TOKEN;

      // Fetch GitLab user info to initialize the connection
      fetch('https://gitlab.com/api/v4/user', {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error('Invalid token or unauthorized');
          }

          return response.json();
        })
        .then((data: unknown) => {
          const userData = data as {
            username: string;
            avatar_url: string;
            name?: string;
          };

          // Save connection to local storage
          const newConnection = {
            token,
            user: {
              login: userData.username,
              avatar_url: userData.avatar_url,
              name: userData.name || userData.username,
            },
            connected_at: new Date().toISOString(),
          };

          localStorage.setItem('gitlab_connection', JSON.stringify(newConnection));

          // Also save as cookies for API requests
          Cookies.set('gitlabToken', token);
          Cookies.set('gitlabUsername', userData.username);
          Cookies.set('git:gitlab.com', JSON.stringify({ username: 'oauth2', password: token }));

          // Refresh projects after connection is established
          if (isOpen && activeTab === 'my-repos') {
            fetchUserRepos('gitlab'); // You'll need to define this function similarly to fetchUserRepos
          }
        })
        .catch((error) => {
          console.error('Failed to initialize GitLab connection from environment variables:', error);
        });
    }
  }, [isOpen]);

  // Initialize GitHub connection and fetch repositories
  useEffect(() => {
    const savedConnection = getLocalStorage('github_connection');

    // If no connection exists but environment variables are set, create a connection
    if (!savedConnection && import.meta.env.VITE_GITHUB_ACCESS_TOKEN) {
      const token = import.meta.env.VITE_GITHUB_ACCESS_TOKEN;
      const tokenType = import.meta.env.VITE_GITHUB_TOKEN_TYPE === 'fine-grained' ? 'fine-grained' : 'classic';

      // Fetch GitHub user info to initialize the connection
      fetch('https://api.github.com/user', {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          Authorization: `Bearer ${token}`,
        },
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error('Invalid token or unauthorized');
          }

          return response.json();
        })
        .then((data: unknown) => {
          const userData = data as GitHubUserResponse;

          // Save connection to local storage
          const newConnection = {
            token,
            tokenType,
            user: {
              login: userData.login,
              avatar_url: userData.avatar_url,
              name: userData.name || userData.login,
            },
            connected_at: new Date().toISOString(),
          };

          localStorage.setItem('github_connection', JSON.stringify(newConnection));

          // Also save as cookies for API requests
          Cookies.set('githubToken', token);
          Cookies.set('githubUsername', userData.login);
          Cookies.set('git:github.com', JSON.stringify({ username: token, password: 'x-oauth-basic' }));

          // Refresh repositories after connection is established
          if (isOpen && activeTab === 'my-repos') {
            fetchUserRepos('github');
          }
        })
        .catch((error) => {
          console.error('Failed to initialize GitHub connection from environment variables:', error);
        });
    }
  }, [isOpen]);

  // Fetch repositories when dialog opens or tab changes
  useEffect(() => {
    if (isOpen && activeTab === 'my-repos') {
      // Fetch both GitHub and GitLab repositories when the dialog opens
      const githubConnection = getLocalStorage('github_connection');
      const gitlabConnection = getLocalStorage('gitlab_connection');

      if (githubConnection?.token) {
        fetchUserRepos('github');
      }

      if (gitlabConnection?.token) {
        fetchUserRepos('gitlab');
      }
    }
  }, [isOpen, activeTab]);

  const fetchUserRepos = async (category: 'github' | 'gitlab') => {
    const githubConnection = getLocalStorage('github_connection');
    const gitlabConnection = getLocalStorage('gitlab_connection');

    if (!gitlabConnection?.token && !githubConnection?.token) {
      toast.error('Please connect your Gitlab or Github account first');

      setIsLoading(false);

      return;
    }

    setIsLoading(true);

    try {
      let response;

      if (category === 'github') {
        response = await fetch('https://api.github.com/user/repos?sort=updated&per_page=100&type=all', {
          headers: {
            Accept: 'application/vnd.github.v3+json',
            Authorization: `Bearer ${githubConnection.token}`,
          },
        });

        if (!response.ok) {
          throw new Error('Failed to fetch GitHub repositories');
        }

        const data = await response.json();

        if (
          Array.isArray(data) &&
          data.every((item) => typeof item === 'object' && item !== null && 'full_name' in item)
        ) {
          // Add source property to each GitHub repository
          const reposWithSource = data.map((repo) => ({
            ...repo,
            source: 'github' as any,
          }));
          setGithubRepositories(reposWithSource as GitHubRepoInfo[]);
        } else {
          throw new Error('Invalid GitHub repository data format');
        }
      } else if (category === 'gitlab') {
        if (!gitlabConnection?.token) {
          toast.error('GitLab token not found. Please connect your GitLab account first.');

          setIsLoading(false);

          return;
        }

        console.log('Fetching GitLab repositories...');

        // Use a more reliable API endpoint with better parameters
        response = await fetch(
          'https://gitlab.com/api/v4/projects?membership=true&min_access_level=20&order_by=last_activity_at&per_page=100&simple=true',
          {
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${gitlabConnection.token}`,
            },
          },
        );

        if (!response.ok) {
          const errorText = await response.text();
          console.error('GitLab API error:', response.status, errorText);
          toast.error(`Failed to fetch GitLab projects: ${response.status} ${response.statusText}`);

          setIsLoading(false);

          return;
        }

        const data = (await response.json()) as any[];
        console.log('GitLab repositories data:', data.length, 'repositories found');

        if (
          Array.isArray(data) &&
          data.every((item) => typeof item === 'object' && item !== null && 'path_with_namespace' in item)
        ) {
          const normalizedData: GitHubRepoInfo[] = data.map((item: any) => ({
            id: item.id,
            name: item.name,
            full_name: item.path_with_namespace,
            html_url: item.web_url,
            description: item.description || '',
            stargazers_count: item.star_count || 0,
            forks_count: item.forks_count || 0,
            default_branch: item.default_branch || 'main', // fallback if missing
            updated_at: item.last_activity_at || new Date().toISOString(),
            language: item.language || 'Unknown',
            languages_url: `https://gitlab.com/api/v4/projects/${item.id}/languages`,

            // Add a source property to identify this as a GitLab repository
            source: 'gitlab' as any,
          }));

          setGitlabRepositories(normalizedData);
          console.log('GitLab repositories normalized and set:', normalizedData.length);
        } else {
          throw new Error('Invalid GitLab project data format');
        }
      }
    } catch (error) {
      console.error('Failed to fetch repositories:', error);
      toast.error(`Failed to fetch your ${category} repositories`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = async (query: string) => {
    setIsLoading(true);
    setSearchResults([]);

    try {
      let searchQuery = query;

      if (filters.language) {
        searchQuery += ` language:${filters.language}`;
      }

      if (filters.stars) {
        searchQuery += ` stars:>${filters.stars}`;
      }

      if (filters.forks) {
        searchQuery += ` forks:>${filters.forks}`;
      }

      const response = await fetch(
        `https://api.github.com/search/repositories?q=${encodeURIComponent(searchQuery)}&sort=stars&order=desc`,
        {
          headers: {
            Accept: 'application/vnd.github.v3+json',
          },
        },
      );

      if (!response.ok) {
        throw new Error('Failed to search repositories');
      }

      const data = await response.json();

      // Add type assertion and validation
      if (typeof data === 'object' && data !== null && 'items' in data && Array.isArray(data.items)) {
        setSearchResults(data.items as GitHubRepoInfo[]);
      } else {
        throw new Error('Invalid search results format');
      }
    } catch (error) {
      console.error('Error searching repos:', error);
      toast.error('Failed to search repositories');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchBranches = async (repo: GitHubRepoInfo | GitLabProjectInfo) => {
    setIsLoading(true);

    try {
      // Determine if this is a GitHub or GitLab repository based on the source property we added
      const isGitHub = (repo as any).source === 'github';
      const isGitLab = (repo as any).source === 'gitlab';

      const githubConnection = getLocalStorage('github_connection');
      const gitlabConnection = getLocalStorage('gitlab_connection');

      let headers: HeadersInit = {};
      let response: Response;

      if (isGitHub) {
        headers = githubConnection?.token
          ? {
              Accept: 'application/vnd.github.v3+json',
              Authorization: `Bearer ${githubConnection.token}`,
            }
          : {};

        response = await fetch(`https://api.github.com/repos/${repo.full_name}/branches`, {
          headers,
        });

        if (!response.ok) {
          throw new Error('Failed to fetch GitHub branches');
        }

        const data = await response.json();

        if (Array.isArray(data) && data.every((item) => typeof item === 'object' && 'name' in item)) {
          setBranches(
            data.map((branch) => ({
              name: branch.name,
              default: branch.name === (repo as GitHubRepoInfo).default_branch,
            })),
          );
        } else {
          throw new Error('Invalid GitHub branch data format');
        }
      } else if (isGitLab) {
        // Make sure we have a valid GitLab token
        if (!gitlabConnection?.token) {
          toast.error('GitLab token not found. Please connect your GitLab account first.');
          return;
        }

        headers = {
          Accept: 'application/json',
          Authorization: `Bearer ${gitlabConnection.token}`,
        };

        // Get the project ID from the repository object
        const projectId = repo.id;

        if (!projectId) {
          throw new Error('GitLab project ID not found');
        }

        console.log('Fetching branches for GitLab project:', projectId);

        // Fetch branches from GitLab API
        response = await fetch(`https://gitlab.com/api/v4/projects/${projectId}/repository/branches`, {
          headers,
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('GitLab API error:', response.status, errorText);
          throw new Error(`Failed to fetch GitLab branches: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        console.log('GitLab branches data:', data);

        if (Array.isArray(data) && data.length > 0) {
          // Get the default branch from the repository object
          const defaultBranch = (repo as any).default_branch || 'main';

          setBranches(
            data.map((branch) => ({
              name: branch.name,
              default: branch.name === defaultBranch,
            })),
          );

          // Set the selected branch to the default branch
          setSelectedBranch(defaultBranch);
        } else if (Array.isArray(data) && data.length === 0) {
          // Handle empty branches array (new repository)
          toast.info('No branches found for this repository. A default branch will be created when you push.');
          setBranches([{ name: 'main', default: true }]);
          setSelectedBranch('main');
        } else {
          throw new Error('Invalid GitLab branch data format');
        }
      }
    } catch (error) {
      console.error('Error fetching branches:', error);
      toast.error('Failed to fetch branches');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRepoSelect = async (repo: GitHubRepoInfo) => {
    setSelectedRepository(repo);
    await fetchBranches(repo);
  };

  const formatGitUrl = (url: string): string => {
    // Remove any tree references and ensure .git extension
    const baseUrl = url
      .replace(/\/tree\/[^/]+/, '') // Remove /tree/branch-name
      .replace(/\/$/, '') // Remove trailing slash
      .replace(/\.git$/, ''); // Remove .git if present
    return `${baseUrl}.git`;
  };

  const verifyRepository = async (repoUrl: string, repoId: string = ''): Promise<RepositoryStats | null> => {
    try {
      let branch: string | null = null;
      let cleanUrl = repoUrl;

      if (repoUrl.includes('#')) {
        const parts = repoUrl.split('#');
        cleanUrl = parts[0];
        branch = parts[1];
      }

      const isGitHub = cleanUrl.includes('github.com');
      const isGitLab = cleanUrl.includes('gitlab.com');

      const [ownerOrNamespace, repo] = cleanUrl
        .replace(/\.git$/, '')
        .split('/')
        .slice(-2);

      let headers: HeadersInit = {};
      let defaultBranch = branch || 'main';
      let treeData: any;

      if (isGitHub) {
        const connection = getLocalStorage('github_connection');

        if (connection?.token) {
          headers = {
            Accept: 'application/vnd.github.v3+json',
            Authorization: `Bearer ${connection.token}`,
          };
        } else if (import.meta.env.VITE_GITHUB_ACCESS_TOKEN) {
          headers = {
            Accept: 'application/vnd.github.v3+json',
            Authorization: `Bearer ${import.meta.env.VITE_GITHUB_ACCESS_TOKEN}`,
          };
        }

        const repoInfoResponse = await fetch(`https://api.github.com/repos/${ownerOrNamespace}/${repo}`, { headers });

        if (!repoInfoResponse.ok) {
          throw new Error(`GitHub repository fetch failed (${repoInfoResponse.status})`);
        }

        const repoInfo = (await repoInfoResponse.json()) as { default_branch?: string };

        if (!branch) {
          defaultBranch = repoInfo.default_branch || 'main';
        }

        let treeResponse = await fetch(
          `https://api.github.com/repos/${ownerOrNamespace}/${repo}/git/trees/${defaultBranch}?recursive=1`,
          { headers },
        );

        if (!treeResponse.ok) {
          treeResponse = await fetch(
            `https://api.github.com/repos/${ownerOrNamespace}/${repo}/git/trees/master?recursive=1`,
            { headers },
          );

          if (!treeResponse.ok) {
            treeResponse = await fetch(
              `https://api.github.com/repos/${ownerOrNamespace}/${repo}/git/trees/main?recursive=1`,
              { headers },
            );
          }

          if (!treeResponse.ok) {
            throw new Error('Failed to fetch GitHub repository structure.');
          }
        }

        treeData = await treeResponse.json();
      }

      if (isGitLab) {
        const connection = getLocalStorage('gitlab_connection');

        if (connection?.token) {
          headers = {
            Accept: 'application/json',
            Authorization: `Bearer ${connection.token}`,
          };
        } else if (import.meta.env.VITE_GITLAB_ACCESS_TOKEN) {
          headers = {
            Accept: 'application/json',
            Authorization: `Bearer ${import.meta.env.VITE_GITLAB_ACCESS_TOKEN}`,
          };
        }

        let fullPath: string;

        if (repoId !== '') {
          fullPath = repoId;
        } else {
          fullPath = encodeURIComponent(`${ownerOrNamespace}/${repo}`);
        }

        const repoInfoResponse = await fetch(`https://gitlab.com/api/v4/projects/${fullPath}`, { headers });

        if (!repoInfoResponse.ok) {
          throw new Error(`GitLab repository fetch failed (${repoInfoResponse.status})`);
        }

        const repoInfo = (await repoInfoResponse.json()) as { default_branch?: string; id?: string };

        if (!branch) {
          defaultBranch = repoInfo.default_branch || 'main';
        }

        const treeResponse = await fetch(
          `https://gitlab.com/api/v4/projects/${repoInfo.id}/repository/tree?recursive=true&per_page=100&ref=${defaultBranch}`,
          { headers },
        );

        if (!treeResponse.ok) {
          throw new Error('Failed to fetch GitLab repository structure.');
        }

        const files = (await treeResponse.json()) as Array<{ path: string; type: string }>;
        treeData = { tree: files.map((f: any) => ({ path: f.path, type: f.type })) };
      }

      // === Analyze files ===
      const totalSize = 0;
      let totalFiles = 0;
      const languages: { [key: string]: number } = {};
      let hasPackageJson = false;
      let hasDependencies = false;

      for (const file of treeData.tree) {
        if (file.type === 'blob' || file.type === 'file') {
          totalFiles++;

          const ext = file.path.split('.').pop()?.toLowerCase();

          if (ext) {
            languages[ext] = (languages[ext] || 0) + (file.size || 0);
          }

          if (file.path === 'package.json') {
            hasPackageJson = true;

            if (isGitHub) {
              const contentRes = await fetch(
                `https://api.github.com/repos/${ownerOrNamespace}/${repo}/contents/package.json`,
                { headers },
              );

              if (contentRes.ok) {
                const content = (await contentRes.json()) as { content: string };
                const packageJson = JSON.parse(Buffer.from(content.content, 'base64').toString());
                hasDependencies = !!(
                  packageJson.dependencies ||
                  packageJson.devDependencies ||
                  packageJson.peerDependencies
                );
              }
            }

            if (isGitLab) {
              const rawUrl = `https://gitlab.com/api/v4/projects/${`${ownerOrNamespace}/${repo}`}/repository/files/package.json/raw?ref=${defaultBranch}`;

              const contentRes = await fetch(rawUrl, { headers });

              if (contentRes.ok) {
                const text = await contentRes.text();
                const packageJson = JSON.parse(text);
                hasDependencies = !!(
                  packageJson.dependencies ||
                  packageJson.devDependencies ||
                  packageJson.peerDependencies
                );
              }
            }
          }
        }
      }

      const stats: RepositoryStats = {
        totalFiles,
        totalSize,
        languages,
        hasPackageJson,
        hasDependencies,
      };

      return stats;
    } catch (error) {
      console.error('Error verifying repository:', error);

      const errorMessage = error instanceof Error ? error.message : 'Failed to verify repository';

      if (
        errorMessage.includes('Authentication failed') ||
        errorMessage.includes('may be private') ||
        errorMessage.includes('Repository not found') ||
        errorMessage.includes('Unauthorized') ||
        errorMessage.includes('403') ||
        errorMessage.includes('404') ||
        errorMessage.includes('access permissions')
      ) {
        setIsLoading(true);
      }

      toast.error(errorMessage);

      return null;
    }
  };

  const handleImport = async () => {
    try {
      let gitUrl: string;
      let repoId: string = '';

      if (activeTab === 'url' && customUrl) {
        gitUrl = formatGitUrl(customUrl);
      } else if (selectedRepository) {
        gitUrl = formatGitUrl(selectedRepository.html_url);
        repoId = selectedRepository.id;

        if (selectedBranch) {
          gitUrl = `${gitUrl}#${selectedBranch}`;
        }
      } else {
        return;
      }

      // Verify repository before importing
      const stats = await verifyRepository(gitUrl, repoId);

      if (!stats) {
        return;
      }

      setCurrentStats(stats);
      setPendingGitUrl(gitUrl);
      setShowStatsDialog(true);
    } catch (error) {
      console.error('Error preparing repository:', error);

      // Check if it's an authentication error
      const errorMessage = error instanceof Error ? error.message : 'Failed to prepare repository. Please try again.';

      // Show the GitHub auth dialog for any authentication or permission errors
      if (
        errorMessage.includes('Authentication failed') ||
        errorMessage.includes('may be private') ||
        errorMessage.includes('Repository not found or is private') ||
        errorMessage.includes('Unauthorized') ||
        errorMessage.includes('401') ||
        errorMessage.includes('403') ||
        errorMessage.includes('404') ||
        errorMessage.includes('access permissions')
      ) {
        // Directly show the auth dialog instead of just showing a toast
        setShowAuthDialog(true);
      } else {
        toast.error(errorMessage);
      }
    }
  };

  const handleStatsConfirm = () => {
    setShowStatsDialog(false);

    if (pendingGitUrl) {
      onSelect(pendingGitUrl);
      onClose();
    }
  };

  const handleFilterChange = (key: keyof SearchFilters, value: string) => {
    let parsedValue: string | number | undefined = value;

    if (key === 'stars' || key === 'forks') {
      parsedValue = value ? parseInt(value, 10) : undefined;
    }

    setFilters((prev) => ({ ...prev, [key]: parsedValue }));
    handleSearch(searchQuery);
  };

  // Handle dialog close properly
  const handleClose = () => {
    setIsLoading(false); // Reset loading state
    setSearchQuery(''); // Reset search
    setSearchResults([]); // Reset results
    onClose();
  };

  const handleAuthDialogClose = (category: 'github' | 'gitlab') => {
    setShowAuthDialog(false);

    if (activeTab === 'my-repos') {
      fetchUserRepos(category);
    }
  };

  return (
    <RepositoryDialogContext.Provider value={{ setShowAuthDialog }}>
      <Dialog.Root
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) {
            handleClose();
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50" />
          <Dialog.Content className="fixed top-[50%] left-[50%] -translate-x-1/2 -translate-y-1/2 w-[90vw] md:w-[600px] max-h-[85vh] overflow-hidden bg-white dark:bg-[#1A1A1A] rounded-xl shadow-xl z-[51] border border-[#E5E5E5] dark:border-[#333333]">
            <div className="p-4 border-b border-[#E5E5E5] dark:border-[#333333] flex items-center justify-between">
              <Dialog.Title className="text-lg font-semibold text-bolt-elements-textPrimary dark:text-bolt-elements-textPrimary-dark">
                Import GitHub/Gitlab Repository
              </Dialog.Title>
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
                  aria-label="Close dialog"
                  type="button"
                >
                  <span className="i-ph:x block w-5 h-5" aria-hidden="true" />
                  <span className="sr-only">Close dialog</span>
                </button>
              </Dialog.Close>
            </div>

            <div className="p-4">
              <div className="flex gap-2 mb-4">
                <TabButton active={activeTab === 'my-repos'} onClick={() => setActiveTab('my-repos')}>
                  <span className="i-ph:book-bookmark" />
                  My Repos
                </TabButton>
                <TabButton active={activeTab === 'search'} onClick={() => setActiveTab('search')}>
                  <span className="i-ph:magnifying-glass" />
                  Search
                </TabButton>
                <TabButton active={activeTab === 'url'} onClick={() => setActiveTab('url')}>
                  <span className="i-ph:link" />
                  URL
                </TabButton>
              </div>

              {activeTab === 'url' ? (
                <div className="space-y-4">
                  <Input
                    type="text"
                    placeholder="Enter GitHub repository URL"
                    value={customUrl}
                    onChange={(e) => setCustomUrl(e.target.value)}
                    className="w-full"
                  />

                  <button
                    onClick={handleImport}
                    disabled={!customUrl}
                    className={classNames(
                      'w-full h-10 px-4 py-2 rounded-lg text-white transition-all duration-200 flex items-center gap-2 justify-center',
                      customUrl
                        ? 'bg-purple-500 hover:bg-purple-600'
                        : 'bg-gray-300 dark:bg-gray-700 cursor-not-allowed',
                    )}
                  >
                    Import Repository
                  </button>
                </div>
              ) : (
                <>
                  {activeTab === 'search' && (
                    <div className="space-y-4 mb-4">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="Search repositories..."
                          value={searchQuery}
                          onChange={(e) => {
                            setSearchQuery(e.target.value);
                            handleSearch(e.target.value);
                          }}
                          className="flex-1 px-4 py-2 rounded-lg bg-[#F5F5F5] dark:bg-[#252525] border border-[#E5E5E5] dark:border-[#333333] text-bolt-elements-textPrimary"
                        />
                        <button
                          onClick={() => setFilters({})}
                          className="px-3 py-2 rounded-lg bg-[#F5F5F5] dark:bg-[#252525] text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary"
                        >
                          <span className="i-ph:funnel-simple" />
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          placeholder="Filter by language..."
                          value={filters.language || ''}
                          onChange={(e) => {
                            setFilters({ ...filters, language: e.target.value });
                            handleSearch(searchQuery);
                          }}
                          className="px-3 py-1.5 text-sm rounded-lg bg-[#F5F5F5] dark:bg-[#252525] border border-[#E5E5E5] dark:border-[#333333]"
                        />
                        <input
                          type="number"
                          placeholder="Min stars..."
                          value={filters.stars || ''}
                          onChange={(e) => handleFilterChange('stars', e.target.value)}
                          className="px-3 py-1.5 text-sm rounded-lg bg-[#F5F5F5] dark:bg-[#252525] border border-[#E5E5E5] dark:border-[#333333]"
                        />
                      </div>
                      <input
                        type="number"
                        placeholder="Min forks..."
                        value={filters.forks || ''}
                        onChange={(e) => handleFilterChange('forks', e.target.value)}
                        className="px-3 py-1.5 text-sm rounded-lg bg-[#F5F5F5] dark:bg-[#252525] border border-[#E5E5E5] dark:border-[#333333]"
                      />
                    </div>
                  )}

                  <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                    {selectedRepository ? (
                      <div className="space-y-4">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setSelectedRepository(null)}
                            className="p-1.5 rounded-lg hover:bg-[#F5F5F5] dark:hover:bg-[#252525]"
                          >
                            <span className="i-ph:arrow-left w-4 h-4" />
                          </button>
                          <h3 className="font-medium">{selectedRepository.full_name}</h3>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm text-bolt-elements-textSecondary">Select Branch</label>
                          <select
                            value={selectedBranch}
                            onChange={(e) => setSelectedBranch(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg bg-bolt-elements-background-depth-2 dark:bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor dark:border-bolt-elements-borderColor-dark text-bolt-elements-textPrimary dark:text-bolt-elements-textPrimary-dark focus:outline-none focus:ring-2 focus:ring-bolt-elements-borderColor dark:focus:ring-bolt-elements-borderColor-dark"
                          >
                            {branches.map((branch) => (
                              <option
                                key={branch.name}
                                value={branch.name}
                                className="bg-bolt-elements-background-depth-2 dark:bg-bolt-elements-background-depth-3 text-bolt-elements-textPrimary dark:text-bolt-elements-textPrimary-dark"
                              >
                                {branch.name} {branch.default ? '(default)' : ''}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={handleImport}
                            className="w-full h-10 px-4 py-2 rounded-lg bg-purple-500 text-white hover:bg-purple-600 transition-all duration-200 flex items-center gap-2 justify-center"
                          >
                            Import Selected Branch
                          </button>
                        </div>
                      </div>
                    ) : (
                      <RepositoryList
                        repos={
                          activeTab === 'my-repos' ? [...githubRepositories, ...gitlabRepositories] : searchResults
                        }
                        isLoading={isLoading}
                        onSelect={handleRepoSelect}
                        activeTab={activeTab}
                      />
                    )}
                  </div>
                </>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>

        {/* GitHub Auth Dialog */}
        <GitHubAuthDialog isOpen={showAuthDialog} onClose={() => handleAuthDialogClose('github')} />
        {/* Repository Stats Dialog */}
        {currentStats && (
          <StatsDialog
            isOpen={showStatsDialog}
            onClose={() => setShowStatsDialog(false)}
            onConfirm={handleStatsConfirm}
            stats={currentStats}
            isLargeRepo={currentStats.totalSize > 50 * 1024 * 1024}
          />
        )}
      </Dialog.Root>
    </RepositoryDialogContext.Provider>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={classNames(
        'px-4 py-2 h-10 rounded-lg transition-all duration-200 flex items-center gap-2 min-w-[120px] justify-center',
        active
          ? 'bg-purple-500 text-white hover:bg-purple-600'
          : 'bg-[#F5F5F5] dark:bg-[#252525] text-bolt-elements-textPrimary dark:text-white hover:bg-[#E5E5E5] dark:hover:bg-[#333333] border border-[#E5E5E5] dark:border-[#333333]',
      )}
    >
      {children}
    </button>
  );
}

function RepositoryList({
  repos,
  isLoading,
  onSelect,
  activeTab,
}: {
  repos: GitHubRepoInfo[];
  isLoading: boolean;
  onSelect: (repo: GitHubRepoInfo) => void;
  activeTab: string;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-bolt-elements-textSecondary">
        <span className="i-ph:spinner animate-spin mr-2" />
        Loading repositories...
      </div>
    );
  }

  if (repos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-bolt-elements-textSecondary">
        <span className="i-ph:folder-simple-dashed w-12 h-12 mb-2 opacity-50" />
        <p>{activeTab === 'my-repos' ? 'No repositories found' : 'Search for repositories'}</p>
      </div>
    );
  }

  return repos.map((repo) => <RepositoryCard key={repo.full_name} repo={repo} onSelect={() => onSelect(repo)} />);
}

function RepositoryCard({ repo, onSelect }: { repo: GitHubRepoInfo; onSelect: () => void }) {
  // Determine if this is a GitHub or GitLab repository
  const isGitlab = (repo as any).source === 'gitlab';
  const isGithub = (repo as any).source === 'github';

  return (
    <div className="p-4 rounded-lg bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor hover:border-bolt-elements-borderColorActive/70 transition-colors">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {isGitlab ? (
            <span className="i-ph:gitlab-logo text-[#FC6D26]" />
          ) : (
            <span className="i-ph:github-logo text-bolt-elements-textTertiary" />
          )}
          <h3 className="font-medium text-bolt-elements-textPrimary dark:text-white">{repo.name}</h3>
          {isGitlab && (
            <span className="px-1.5 py-0.5 text-xs bg-[#FC6D26]/10 text-[#FC6D26] rounded-full">GitLab</span>
          )}
          {isGithub && (
            <span className="px-1.5 py-0.5 text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-full">
              GitHub
            </span>
          )}
        </div>
        <button
          onClick={onSelect}
          className="px-4 py-2 h-10 rounded-lg bg-purple-500 text-white hover:bg-purple-600 transition-all duration-200 flex items-center gap-2 min-w-[120px] justify-center"
        >
          <span className="i-ph:download-simple w-4 h-4" />
          Import
        </button>
      </div>

      <div className="flex items-center gap-4 text-sm text-bolt-elements-textTertiary">
        {repo.language && (
          <span className="flex items-center gap-1">
            <span className="i-ph:code" />
            {repo.language}
          </span>
        )}
        <span className="flex items-center gap-1">
          <span className="i-ph:star" />
          {repo.stargazers_count.toLocaleString()}
        </span>
        <span className="flex items-center gap-1">
          <span className="i-ph:clock" />
          {new Date(repo.updated_at).toLocaleDateString()}
        </span>
      </div>
    </div>
  );
}
