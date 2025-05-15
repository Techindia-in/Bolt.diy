import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'react-toastify';
import { logStore } from '~/lib/stores/logs';
import { classNames } from '~/utils/classNames';
import Cookies from 'js-cookie';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '~/components/ui/Collapsible';
import { Button } from '~/components/ui/Button';

interface GitLabUserResponse {
  id: number;
  username: string;
  name: string;
  avatar_url: string;
  web_url: string;
  created_at: string;
  bio: string;
  public_repos: number;
  followers: number;
  following: number;
}

interface GitLabProjectInfo {
  id: number;
  name: string;
  path_with_namespace: string;
  description: string;
  http_url_to_repo: string;
  star_count: number;
  forks_count: number;
  updated_at: string;
  default_branch: string;
  visibility: string;
}

interface GitLabGroupInfo {
  id: number;
  name: string;
  web_url: string;
  avatar_url: string;
}

interface GitLabEvent {
  id: number;
  action_name: string;
  project_id: number;
  project: {
    name: string;
    path_with_namespace: string;
  };
  created_at: string;
}

interface GitLabStats {
  projects: GitLabProjectInfo[];
  recentActivity: GitLabEvent[];
  totalSnippets: number;
  publicProjects: number;
  privateProjects: number;
  stars: number;
  forks: number;
  followers: number;
  snippets: number;
  groups: GitLabGroupInfo[];
  lastUpdated: string;
  languages: { [language: string]: number };
}

interface GitLabConnection {
  user: GitLabUserResponse | null;
  token: string;
  tokenType: 'personal-access-token' | 'oauth';
  stats?: GitLabStats;
  rateLimit?: {
    limit: number;
    remaining: number;
    reset: number;
  };
}

// Add the GitLab logo SVG component
const GitLabLogo = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5">
    <path
      fill="currentColor"
      d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94z"
    />
  </svg>
);

export default function GitLabConnection() {
  const [connection, setConnection] = useState<GitLabConnection>({
    user: null,
    token: '',
    tokenType: 'personal-access-token',
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isFetchingStats, setIsFetchingStats] = useState(false);
  const [isStatsExpanded, setIsStatsExpanded] = useState(false);
  const tokenTypeRef = React.useRef<'personal-access-token' | 'oauth'>('personal-access-token');
  const [gitlabUrl, setGitlabUrl] = useState('https://gitlab.com');

  const fetchGitLabUser = async (token: string) => {
    try {
      // Use server-side API endpoint or direct GitLab API call
      const response = await fetch(`${gitlabUrl}/api/v4/user`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        console.error('Error fetching GitLab user. Status:', response.status);
        throw new Error(`Error: ${response.status}`);
      }

      // Get rate limit information from headers if available
      const rateLimit = {
        limit: parseInt(response.headers.get('ratelimit-limit') || '0'),
        remaining: parseInt(response.headers.get('ratelimit-remaining') || '0'),
        reset: parseInt(response.headers.get('ratelimit-reset') || '0'),
      };

      const user: GitLabUserResponse = await response.json();

      // Validate that we received a user object
      if (!user || !user.username) {
        console.error('Invalid user data received:', user);
        throw new Error('Invalid user data received');
      }

      // Use the response data
      setConnection((prev) => ({
        ...prev,
        user,
        token,
        tokenType: tokenTypeRef.current,
        rateLimit,
      }));

      // Set cookies for client-side access
      Cookies.set('gitlabUsername', user.username);
      Cookies.set('gitlabToken', token);
      Cookies.set('git:gitlab.com', JSON.stringify({ username: user.username, password: token }));
      Cookies.set('gitlabUrl', gitlabUrl);

      // Store connection details in localStorage
      localStorage.setItem(
        'gitlab_connection',
        JSON.stringify({
          user,
          token,
          tokenType: tokenTypeRef.current,
          gitlabUrl,
        }),
      );

      logStore.logInfo('Connected to GitLab', {
        type: 'system',
        message: `Connected to GitLab as ${user.username}`,
      });

      // Fetch additional GitLab stats
      fetchGitLabStats(token);
    } catch (error) {
      console.error('Failed to fetch GitLab user:', error);
      logStore.logError(`GitLab authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`, {
        type: 'system',
        message: 'GitLab authentication failed',
      });

      toast.error(`Authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error; // Rethrow to allow handling in the calling function
    }
  };

  const fetchGitLabStats = async (token: string) => {
    setIsFetchingStats(true);
    console.log('Fetching GitLab stats...');

    try {
      // First, fetch user data to ensure token is valid
      const userResponse = await fetch(`${gitlabUrl}/api/v4/user`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!userResponse.ok) {
        if (userResponse.status === 401) {
          toast.error('Your GitLab token has expired. Please reconnect your account.');
          handleDisconnect();

          return;
        }

        throw new Error(`Failed to fetch user data: ${userResponse.statusText}`);
      }

      const userData = (await userResponse.json()) as GitLabUserResponse;

      // Initialize language statistics object
      const languageStats: { [language: string]: number } = {};

      // Fetch user's projects with improved error handling
      let allProjects: GitLabProjectInfo[] = [];
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const projectsResponse = await fetch(
          `${gitlabUrl}/api/v4/projects?membership=true&min_access_level=20&per_page=100&page=${page}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );

        if (!projectsResponse.ok) {
          throw new Error(`Failed to fetch projects: ${projectsResponse.statusText}`);
        }

        const projects = (await projectsResponse.json()) as any[];
        allProjects = [...allProjects, ...projects];

        hasMore = projects.length === 100;
        page++;
      }

      // Fetch language statistics for the most active projects (limit to top 5 to avoid rate limiting)
      const topProjects = [...allProjects]
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        .slice(0, 5);

      console.log('Fetching language statistics for top projects...');

      // Fetch language data for each project
      for (const project of topProjects) {
        try {
          const languageResponse = await fetch(`${gitlabUrl}/api/v4/projects/${project.id}/languages`, {
            headers: { Authorization: `Bearer ${token}` },
          });

          if (languageResponse.ok) {
            const projectLanguages = (await languageResponse.json()) as Record<string, number>;

            // Add to overall language stats
            for (const [language, percentage] of Object.entries(projectLanguages)) {
              languageStats[language] = (languageStats[language] || 0) + percentage;
            }
          }
        } catch (error) {
          console.warn(`Failed to fetch languages for project ${project.name}:`, error);

          // Continue with other projects even if one fails
        }
      }

      // Normalize language percentages
      const totalLanguagePoints = Object.values(languageStats).reduce((sum, val) => sum + val, 0);

      if (totalLanguagePoints > 0) {
        for (const language in languageStats) {
          languageStats[language] = Math.round((languageStats[language] / totalLanguagePoints) * 100);
        }
      }

      console.log('Language statistics:', languageStats);

      const projectStats = calculateProjectStats(allProjects);

      const eventsResponse = await fetch(`${gitlabUrl}/api/v4/events?per_page=10`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!eventsResponse.ok) {
        throw new Error(`Failed to fetch events: ${eventsResponse.statusText}`);
      }

      const events = (await eventsResponse.json()) as any[];
      const recentActivity = events.slice(0, 5).map((event) => ({
        id: event.id,
        action_name: event.action_name,
        project_id: event.project_id,
        project: event.project,
        created_at: event.created_at,
      }));

      const totalStars = allProjects.reduce((sum, p) => sum + (p.star_count || 0), 0);
      const totalForks = allProjects.reduce((sum, p) => sum + (p.forks_count || 0), 0);
      const privateProjects = allProjects.filter((p) => p.visibility === 'private').length;

      const groupsResponse = await fetch(`${gitlabUrl}/api/v4/groups?min_access_level=10`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      let groups: GitLabGroupInfo[] = [];

      if (groupsResponse.ok) {
        groups = (await groupsResponse.json()) as GitLabGroupInfo[];
      }

      const snippetsResponse = await fetch(`${gitlabUrl}/api/v4/snippets`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      let snippetsCount = 0;

      if (snippetsResponse.ok) {
        const snippets = (await snippetsResponse.json()) as any[];
        snippetsCount = snippets.length;
      }

      const stats: GitLabStats = {
        projects: projectStats.projects,
        recentActivity,
        totalSnippets: snippetsCount,
        publicProjects: allProjects.filter((p) => p.visibility === 'public').length,
        privateProjects,
        stars: totalStars,
        forks: totalForks,
        followers: userData.followers || 0,
        snippets: snippetsCount,
        groups,
        lastUpdated: new Date().toISOString(),

        // Add language statistics
        languages: languageStats,
      };

      const currentConnection = JSON.parse(localStorage.getItem('gitlab_connection') || '{}');
      const currentUser = currentConnection.user || connection.user;

      const updatedConnection: GitLabConnection = {
        user: currentUser,
        token,
        tokenType: connection.tokenType,
        stats,
        rateLimit: connection.rateLimit,
      };

      localStorage.setItem('gitlab_connection', JSON.stringify({ ...updatedConnection, gitlabUrl }));
      setConnection(updatedConnection);
      toast.success('GitLab stats refreshed');
    } catch (error) {
      console.error('Error fetching GitLab stats:', error);
      toast.error(`Failed to fetch GitLab stats: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsFetchingStats(false);
    }
  };

  const calculateProjectStats = (projects: any[]) => {
    const projectStats = {
      projects: projects.map((project: any) => {
        const mappedProject = {
          id: project.id,
          name: project.name,
          path_with_namespace: project.path_with_namespace,
          description: project.description,
          http_url_to_repo: project.http_url_to_repo,
          star_count: project.star_count,
          forks_count: project.forks_count,
          default_branch: project.default_branch,
          updated_at: project.updated_at,
          visibility: project.visibility,
        };

        return mappedProject;
      }),
      languages: {} as Record<string, number>,
    };

    return projectStats;
  };

  useEffect(() => {
    const loadSavedConnection = async () => {
      setIsLoading(true);

      const savedConnection = localStorage.getItem('gitlab_connection');

      if (savedConnection) {
        try {
          const parsed = JSON.parse(savedConnection);

          parsed.tokenType = 'personal-access-token';

          // Set GitLab URL from saved connection
          if (parsed.gitlabUrl) {
            setGitlabUrl(parsed.gitlabUrl);
          }

          // Update the ref with the parsed token type
          tokenTypeRef.current = parsed.tokenType;

          // Set the connection
          setConnection(parsed);

          // If we have a token but no stats or incomplete stats, fetch them
          if (
            parsed.user &&
            parsed.token &&
            (!parsed.stats || !parsed.stats.projects || parsed.stats.projects.length === 0)
          ) {
            await fetchGitLabStats(parsed.token);
          }
        } catch (error) {
          console.error('Error parsing saved GitLab connection:', error);
          localStorage.removeItem('gitlab_connection');
        }
      } else {
        // Check for environment variable token
        const envToken = import.meta.env.VITE_GITLAB_ACCESS_TOKEN;
        const envGitlabUrl = import.meta.env.VITE_GITLAB_URL || 'https://gitlab.com';

        setGitlabUrl(envGitlabUrl);

        if (envToken) {
          // Check if token type is specified in environment variables
          const envTokenType = import.meta.env.VITE_GITLAB_TOKEN_TYPE;

          const tokenType =
            envTokenType === 'personal-access-token' || envTokenType === 'oauth'
              ? (envTokenType as 'personal-access-token' | 'oauth')
              : 'personal-access-token';

          // Update both the state and the ref
          tokenTypeRef.current = tokenType;
          setConnection((prev) => ({
            ...prev,
            tokenType,
          }));

          try {
            // Fetch user data with the environment token
            await fetchGitLabUser(envToken);
          } catch (error) {
            console.error('Failed to connect with environment token:', error);
          }
        }
      }

      setIsLoading(false);
    };

    loadSavedConnection();
  }, []);

  // Ensure cookies are updated when connection changes
  useEffect(() => {
    if (!connection) {
      return;
    }

    const token = connection.token;
    const data = connection.user;

    if (token) {
      Cookies.set('gitlabToken', token);
      Cookies.set('git:gitlab.com', JSON.stringify({ username: data?.username || '', password: token }));
    }

    if (data) {
      Cookies.set('gitlabUsername', data.username);
    }

    Cookies.set('gitlabUrl', gitlabUrl);
  }, [connection, gitlabUrl]);

  if (isLoading || isConnecting || isFetchingStats) {
    return <LoadingSpinner />;
  }

  const handleConnect = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsConnecting(true);

    try {
      // Update the ref with the current state value before connecting
      tokenTypeRef.current = connection.tokenType;

      /*
       * Save token type to localStorage even before connecting
       * This ensures the token type is persisted even if connection fails
       */
      localStorage.setItem(
        'gitlab_connection',
        JSON.stringify({
          user: null,
          token: connection.token,
          tokenType: connection.tokenType,
          gitlabUrl,
        }),
      );

      // Attempt to fetch the user info which validates the token
      await fetchGitLabUser(connection.token);

      toast.success('Connected to GitLab successfully');
    } catch (error) {
      console.error('Failed to connect to GitLab:', error);

      // Reset connection state on failure
      setConnection({ user: null, token: connection.token, tokenType: connection.tokenType });

      toast.error(`Failed to connect to GitLab: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = () => {
    localStorage.removeItem('gitlab_connection');

    // Remove all GitLab-related cookies
    Cookies.remove('gitlabToken');
    Cookies.remove('gitlabUsername');
    Cookies.remove('git:gitlab.com');
    Cookies.remove('gitlabUrl');

    // Reset the token type ref
    tokenTypeRef.current = 'personal-access-token';
    setConnection({ user: null, token: '', tokenType: 'personal-access-token' });
    toast.success('Disconnected from GitLab');
  };

  return (
    <motion.div
      className="bg-bolt-elements-background dark:bg-bolt-elements-background border border-bolt-elements-borderColor dark:border-bolt-elements-borderColor rounded-lg"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
    >
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitLabLogo />
            <h3 className="text-base font-medium text-bolt-elements-textPrimary dark:text-bolt-elements-textPrimary">
              GitLab Connection
            </h3>
          </div>
        </div>

        {!connection.user && (
          <div className="text-xs text-bolt-elements-textSecondary bg-bolt-elements-background-depth-1 dark:bg-bolt-elements-background-depth-1 p-3 rounded-lg mb-4">
            <p className="flex items-center gap-1 mb-1">
              <span className="i-ph:lightbulb w-3.5 h-3.5 text-bolt-elements-icon-success dark:text-bolt-elements-icon-success" />
              <span className="font-medium">Tip:</span> You can also set the{' '}
              <code className="px-1 py-0.5 bg-bolt-elements-background-depth-2 dark:bg-bolt-elements-background-depth-2 rounded">
                VITE_GITLAB_ACCESS_TOKEN
              </code>{' '}
              environment variable to connect automatically.
            </p>
            <p>
              For self-hosted GitLab instances, also set{' '}
              <code className="px-1 py-0.5 bg-bolt-elements-background-depth-2 dark:bg-bolt-elements-background-depth-2 rounded">
                VITE_GITLAB_URL=https://your-gitlab-instance.com
              </code>
            </p>
          </div>
        )}
        <div className="grid grid-cols-1 gap-4">
          <div>
            <label className="block text-sm text-bolt-elements-textSecondary dark:text-bolt-elements-textSecondary mb-2">
              GitLab URL
            </label>
            <input
              type="text"
              value={gitlabUrl}
              onChange={(e) => setGitlabUrl(e.target.value)}
              disabled={isConnecting || !!connection.user}
              placeholder="https://gitlab.com"
              className={classNames(
                'w-full px-3 py-2 rounded-lg text-sm',
                'bg-[#F8F8F8] dark:bg-[#1A1A1A]',
                'border border-[#E5E5E5] dark:border-[#333333]',
                'text-bolt-elements-textPrimary placeholder-bolt-elements-textTertiary',
                'focus:outline-none focus:ring-1 focus:ring-bolt-elements-borderColorActive',
                'disabled:opacity-50',
              )}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-bolt-elements-textSecondary dark:text-bolt-elements-textSecondary mb-2">
                Access Token
              </label>
              <input
                type="password"
                value={connection.token}
                onChange={(e) => setConnection((prev) => ({ ...prev, token: e.target.value }))}
                disabled={isConnecting || !!connection.user}
                placeholder="Enter your GitLab access token"
                className={classNames(
                  'w-full px-3 py-2 rounded-lg text-sm',
                  'bg-[#F8F8F8] dark:bg-[#1A1A1A]',
                  'border border-[#E5E5E5] dark:border-[#333333]',
                  'text-bolt-elements-textPrimary placeholder-bolt-elements-textTertiary',
                  'focus:outline-none focus:ring-1 focus:ring-bolt-elements-borderColorActive',
                  'disabled:opacity-50',
                )}
              />
              <div className="mt-2 text-sm text-bolt-elements-textSecondary">
                <a
                  href={`${gitlabUrl}/-/profile/personal_access_tokens`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-bolt-elements-borderColorActive hover:underline inline-flex items-center gap-1"
                >
                  Get your token
                  <div className="i-ph:arrow-square-out w-4 h-4" />
                </a>
                <span className="mx-2">•</span>
                <span>Required scopes: api, read_repository</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between">
          {!connection.user ? (
            <button
              onClick={handleConnect}
              disabled={isConnecting || !connection.token}
              className={classNames(
                'px-4 py-2 rounded-lg text-sm flex items-center gap-2',
                'bg-[#FC6D26] text-white',
                'hover:bg-[#E24329] hover:text-white',
                'disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200',
                'transform active:scale-95',
              )}
            >
              {isConnecting ? (
                <>
                  <div className="i-ph:spinner-gap animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <div className="i-ph:plug-charging w-4 h-4" />
                  Connect
                </>
              )}
            </button>
          ) : (
            <>
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-4">
                  <button
                    onClick={handleDisconnect}
                    className={classNames(
                      'px-4 py-2 rounded-lg text-sm flex items-center gap-2',
                      'bg-red-500 text-white',
                      'hover:bg-red-600',
                    )}
                  >
                    <div className="i-ph:plug w-4 h-4" />
                    Disconnect
                  </button>
                  <span className="text-sm text-bolt-elements-textSecondary flex items-center gap-1">
                    <div className="i-ph:check-circle w-4 h-4 text-green-500" />
                    Connected to GitLab
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => window.open(`${gitlabUrl}/dashboard`, '_blank', 'noopener,noreferrer')}
                    className="flex items-center gap-2 hover:bg-bolt-elements-item-backgroundActive/10 hover:text-bolt-elements-textPrimary dark:hover:text-bolt-elements-textPrimary transition-colors"
                  >
                    <div className="i-ph:layout-dashboard w-4 h-4" />
                    Dashboard
                  </Button>
                  <Button
                    onClick={() => {
                      fetchGitLabStats(connection.token);
                    }}
                    disabled={isFetchingStats}
                    variant="outline"
                    className="flex items-center gap-2 hover:bg-bolt-elements-item-backgroundActive/10 hover:text-bolt-elements-textPrimary dark:hover:text-bolt-elements-textPrimary transition-colors"
                  >
                    {isFetchingStats ? (
                      <>
                        <div className="i-ph:spinner-gap w-4 h-4 animate-spin" />
                        Refreshing...
                      </>
                    ) : (
                      <>
                        <div className="i-ph:arrows-clockwise w-4 h-4" />
                        Refresh Stats
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>

        {connection.user && connection.stats && (
          <div className="mt-6 border-t border-bolt-elements-borderColor dark:border-bolt-elements-borderColor pt-6">
            <div className="flex items-center gap-4 p-4 bg-bolt-elements-background-depth-1 dark:bg-bolt-elements-background-depth-1 rounded-lg mb-4">
              <img
                src={connection.user.avatar_url}
                alt={connection.user.username}
                className="w-12 h-12 rounded-full border-2 border-bolt-elements-item-contentAccent dark:border-bolt-elements-item-contentAccent"
              />
              <div>
                <h4 className="text-sm font-medium text-bolt-elements-textPrimary dark:text-bolt-elements-textPrimary">
                  {connection.user.name || connection.user.username}
                </h4>
                <p className="text-sm text-bolt-elements-textSecondary dark:text-bolt-elements-textSecondary">
                  {connection.user.username}
                </p>
              </div>
            </div>

            <Collapsible open={isStatsExpanded} onOpenChange={setIsStatsExpanded}>
              <CollapsibleTrigger asChild>
                <div className="flex items-center justify-between p-4 rounded-lg bg-bolt-elements-background dark:bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor dark:border-bolt-elements-borderColor hover:border-bolt-elements-borderColorActive/70 dark:hover:border-bolt-elements-borderColorActive/70 transition-all duration-200">
                  <div className="flex items-center gap-2">
                    <div className="i-ph:chart-bar w-4 h-4 text-bolt-elements-item-contentAccent" />
                    <span className="text-sm font-medium text-bolt-elements-textPrimary">GitLab Stats</span>
                  </div>
                  <div
                    className={classNames(
                      'i-ph:caret-down w-4 h-4 transform transition-transform duration-200 text-bolt-elements-textSecondary',
                      isStatsExpanded ? 'rotate-180' : '',
                    )}
                  />
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent className="overflow-hidden">
                <div className="space-y-4 mt-4">
                  {/* Languages Section */}
                  <div className="mb-6">
                    <h4 className="text-sm font-medium text-bolt-elements-textPrimary mb-3">Top Languages</h4>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(connection.stats.languages || {})
                        .sort(([, a], [, b]) => b - a)
                        .slice(0, 5)
                        .map(([language]) => (
                          <span
                            key={language}
                            className="px-3 py-1 text-xs rounded-full bg-bolt-elements-sidebar-buttonBackgroundDefault text-bolt-elements-sidebar-buttonText"
                          >
                            {language}
                          </span>
                        ))}
                      {Object.keys(connection.stats.languages || {}).length === 0 && (
                        <span className="text-xs text-bolt-elements-textSecondary">No language data available</span>
                      )}
                    </div>
                  </div>

                  {/* Additional Stats */}
                  <div className="grid grid-cols-4 gap-4 mb-6">
                    {[
                      {
                        label: 'Member Since',
                        value: new Date(connection.user.created_at).toLocaleDateString(),
                      },
                      {
                        label: 'Snippets',
                        value: connection.stats.totalSnippets || 0,
                      },
                      {
                        label: 'Groups',
                        value: connection.stats.groups ? connection.stats.groups.length : 0,
                      },
                      {
                        label: 'Languages',
                        value: Object.keys(connection.stats.languages || {}).length,
                      },
                    ].map((stat, index) => (
                      <div
                        key={index}
                        className="flex flex-col p-3 rounded-lg bg-bolt-elements-background-depth-2 dark:bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor dark:border-bolt-elements-borderColor"
                      >
                        <span className="text-xs text-bolt-elements-textSecondary">{stat.label}</span>
                        <span className="text-lg font-medium text-bolt-elements-textPrimary">{stat.value}</span>
                      </div>
                    ))}
                  </div>

                  {/* Repository Stats */}
                  <div className="mt-4">
                    <div className="space-y-4">
                      <div>
                        <h5 className="text-sm font-medium text-bolt-elements-textPrimary mb-2">Repository Stats</h5>
                        <div className="grid grid-cols-2 gap-4">
                          {[
                            {
                              label: 'Public Repos',
                              value: connection.stats.publicProjects,
                            },
                            {
                              label: 'Private Repos',
                              value: connection.stats.privateProjects,
                            },
                          ].map((stat, index) => (
                            <div
                              key={index}
                              className="flex flex-col p-3 rounded-lg bg-bolt-elements-background-depth-2 dark:bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor dark:border-bolt-elements-borderColor"
                            >
                              <span className="text-xs text-bolt-elements-textSecondary">{stat.label}</span>
                              <span className="text-lg font-medium text-bolt-elements-textPrimary">{stat.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div>
                        <h5 className="text-sm font-medium text-bolt-elements-textPrimary mb-2">Contribution Stats</h5>
                        <div className="grid grid-cols-3 gap-4">
                          {[
                            {
                              label: 'Stars',
                              value: connection.stats.stars || 0,
                              icon: 'i-ph:star',
                              iconColor: 'text-bolt-elements-icon-warning',
                            },
                            {
                              label: 'Forks',
                              value: connection.stats.forks || 0,
                              icon: 'i-ph:git-fork',
                              iconColor: 'text-bolt-elements-icon-info',
                            },
                            {
                              label: 'Followers',
                              value: connection.stats.followers || 0,
                              icon: 'i-ph:users',
                              iconColor: 'text-bolt-elements-icon-success',
                            },
                          ].map((stat, index) => (
                            <div
                              key={index}
                              className="flex flex-col p-3 rounded-lg bg-bolt-elements-background-depth-2 dark:bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor dark:border-bolt-elements-borderColor"
                            >
                              <span className="text-xs text-bolt-elements-textSecondary">{stat.label}</span>
                              <span className="text-lg font-medium text-bolt-elements-textPrimary flex items-center gap-1">
                                <div className={`${stat.icon} w-4 h-4 ${stat.iconColor}`} />
                                {stat.value}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="pt-2 border-t border-bolt-elements-borderColor">
                        <span className="text-xs text-bolt-elements-textSecondary">
                          Last updated: {new Date(connection.stats.lastUpdated).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Repositories Section */}
                  <div className="space-y-4">
                    <h4 className="text-sm font-medium text-bolt-elements-textPrimary">Recent Repositories</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {connection.stats.projects.map((repo) => {
                        return (
                          <a
                            key={repo.name}
                            href={repo.http_url_to_repo}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="group block p-4 rounded-lg bg-bolt-elements-background-depth-1 dark:bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor dark:border-bolt-elements-borderColor hover:border-bolt-elements-borderColorActive dark:hover:border-bolt-elements-borderColorActive transition-all duration-200"
                          >
                            <div className="space-y-3">
                              <div className="flex items-start justify-between">
                                <div className="flex items-center gap-2">
                                  <div className="i-ph:git-repository w-4 h-4 text-bolt-elements-icon-info dark:text-bolt-elements-icon-info" />
                                  <h5 className="text-sm font-medium text-bolt-elements-textPrimary group-hover:text-bolt-elements-item-contentAccent transition-colors">
                                    {repo.name}
                                  </h5>
                                </div>
                                <div className="flex items-center gap-3 text-xs text-bolt-elements-textSecondary">
                                  <span className="flex items-center gap-1" title="Stars">
                                    <div className="i-ph:star w-3.5 h-3.5 text-bolt-elements-icon-warning" />
                                    {repo.star_count.toLocaleString()}
                                  </span>
                                  {/*<span className="flex items-center gap-1" title="Forks">*/}
                                  {/*  <div className="i-ph:git-fork w-3.5 h-3.5 text-bolt-elements-icon-info" />*/}
                                  {/*  {repo.forks_count.toLocaleString()}*/}
                                  {/*</span>*/}
                                </div>
                              </div>

                              {repo.description && (
                                <p className="text-xs text-bolt-elements-textSecondary line-clamp-2">
                                  {repo.description}
                                </p>
                              )}

                              <div className="flex items-center gap-3 text-xs text-bolt-elements-textSecondary">
                                <span className="flex items-center gap-1" title="Default Branch">
                                  <div className="i-ph:git-branch w-3.5 h-3.5" />
                                  {repo.default_branch}
                                </span>
                                <span className="flex items-center gap-1" title="Last Updated">
                                  <div className="i-ph:clock w-3.5 h-3.5" />
                                  {new Date(repo.updated_at).toLocaleDateString(undefined, {
                                    year: 'numeric',
                                    month: 'short',
                                    day: 'numeric',
                                  })}
                                </span>
                                <span className="flex items-center gap-1 ml-auto group-hover:text-bolt-elements-item-contentAccent transition-colors">
                                  <div className="i-ph:arrow-square-out w-3.5 h-3.5" />
                                  View
                                </span>
                              </div>
                            </div>
                          </a>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center p-4">
      <div className="flex items-center gap-2">
        <div className="i-ph:spinner-gap-bold animate-spin w-4 h-4" />
        <span className="text-bolt-elements-textSecondary">Loading...</span>
      </div>
    </div>
  );
}
