import React, { useState } from 'react';
import { json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { env } from '~/utils/env';

/**
 * Page to test environment variables and service connectivity
 */
export default function TestEnv() {
  const [refreshCount, setRefreshCount] = useState(0);
  const [pingResults, setPingResults] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const handleRefresh = () => {
    setRefreshCount((prev) => prev + 1);
  };

  const handleTestConnections = async () => {
    setLoading(true);
    const results: Record<string, string> = {};

    try {
      // Test fileserver connection
      const fsResponse = await fetch(`${env.fileServerUrl}/health`, {
        headers: {
          'X-API-Key': env.fileServerApiKey,
        },
      });
      results.fileserver = fsResponse.ok ? 'OK' : `Error: ${fsResponse.status}`;
    } catch (err) {
      results.fileserver = `Error: ${(err as Error).message}`;
    }

    try {
      // Test noderunner connection
      const nrResponse = await fetch(`${env.nodeRunnerUrl}/health`, {
        headers: {
          'X-API-Key': env.nodeRunnerApiKey,
        },
      });
      results.noderunner = nrResponse.ok ? 'OK' : `Error: ${nrResponse.status}`;
    } catch (err) {
      results.noderunner = `Error: ${(err as Error).message}`;
    }

    setPingResults(results);
    setLoading(false);
  };

  return (
    <div className="p-4 bg-gray-50 min-h-screen">
      <h1 className="text-2xl font-bold mb-6">Environment Configuration Test</h1>

      <div className="bg-white p-6 rounded-lg shadow-md mb-8">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">Environment Variables</h2>
          <button onClick={handleRefresh} className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
            Refresh
          </button>
        </div>

        <div className="text-sm text-gray-500 mb-4">Refresh count: {refreshCount}</div>

        <div className="mb-4">
          <h3 className="font-semibold mb-2">Docker Status</h3>
          <div className="flex items-center">
            <div className={`w-4 h-4 rounded-full mr-2 ${env.runningInDocker ? 'bg-green-500' : 'bg-red-500'}`}></div>
            <span>{env.runningInDocker ? 'Running in Docker' : 'Not running in Docker'}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="font-semibold mb-2">File Server</h3>
            <div className="space-y-2 text-sm">
              <div>
                <span className="font-mono">URL:</span> {env.fileServerUrl}
              </div>
              <div>
                <span className="font-mono">API Key:</span>{' '}
                <span className="font-mono bg-gray-100 p-1 rounded">
                  {env.fileServerApiKey ? '✓ Set' : '✗ Not set'}
                </span>
              </div>
            </div>
          </div>

          <div>
            <h3 className="font-semibold mb-2">Node Runner</h3>
            <div className="space-y-2 text-sm">
              <div>
                <span className="font-mono">URL:</span> {env.nodeRunnerUrl}
              </div>
              <div>
                <span className="font-mono">API Key:</span>{' '}
                <span className="font-mono bg-gray-100 p-1 rounded">
                  {env.nodeRunnerApiKey ? '✓ Set' : '✗ Not set'}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6">
          <button
            onClick={handleTestConnections}
            disabled={loading}
            className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:bg-gray-400"
          >
            {loading ? 'Testing...' : 'Test Connections'}
          </button>

          {Object.keys(pingResults).length > 0 && (
            <div className="mt-4">
              <h3 className="font-semibold mb-2">Connection Results</h3>
              <div className="space-y-2 text-sm">
                <div>
                  <span className="font-mono">File Server:</span>{' '}
                  <span
                    className={`font-mono p-1 rounded ${pingResults.fileserver === 'OK' ? 'bg-green-100' : 'bg-red-100'}`}
                  >
                    {pingResults.fileserver}
                  </span>
                </div>
                <div>
                  <span className="font-mono">Node Runner:</span>{' '}
                  <span
                    className={`font-mono p-1 rounded ${pingResults.noderunner === 'OK' ? 'bg-green-100' : 'bg-red-100'}`}
                  >
                    {pingResults.noderunner}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white p-6 rounded-lg shadow-md">
        <h2 className="text-xl font-bold mb-4">Raw Environment Values</h2>
        <pre className="bg-gray-100 p-4 rounded overflow-auto text-xs">{JSON.stringify(import.meta.env, null, 2)}</pre>
      </div>

      <div className="mt-8 text-sm text-gray-500">
        <p>This page displays the current environment configuration.</p>
        <p>
          If you see the Docker environment variables set correctly, it means your application is using the Docker
          services.
        </p>
      </div>
    </div>
  );
}
