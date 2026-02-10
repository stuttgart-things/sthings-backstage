import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { Config } from '@backstage/config';
import fetch from 'node-fetch';

export const claimRegistryDeleteAction = (options: { config: Config }) => {
  const { config } = options;

  return createTemplateAction({
    id: 'claim-registry:delete',
    description: 'Create a GitHub PR that deletes a claim from the registry',

    schema: {
      input: {
        claimData: z => z.string().describe('JSON string from RegistryClaimPicker containing the full claim object'),
        claimName: z => z.string().optional().describe('Override: the name of the claim to delete'),
        claimPath: z => z.string().optional().describe('Override: the path to the claim file in the repository'),
        claimCategory: z => z.string().optional().describe('Override: the category of the claim (e.g., infra, apps)'),
        repository: z => z.string().optional().describe('Override: the GitHub repository in owner/repo format'),
        targetBranch: z => z.string().optional().default('main').describe('The target branch for the PR'),
      },
      output: {
        pullRequestUrl: z => z.string().describe('The URL of the created pull request'),
        pullRequestNumber: z => z.number().describe('The PR number'),
      },
    },

    async handler(ctx) {
      // Parse claim data from the picker's JSON string
      let parsedClaim: { name?: string; path?: string; category?: string; repository?: string } = {};
      try {
        parsedClaim = JSON.parse(ctx.input.claimData);
      } catch {
        ctx.logger.warn('Could not parse claimData as JSON, using individual input fields');
      }

      // Individual inputs override parsed claim data
      const claimName = ctx.input.claimName || parsedClaim.name || '';
      const claimPath = ctx.input.claimPath || parsedClaim.path || '';
      const claimCategory = ctx.input.claimCategory || parsedClaim.category || '';
      const repository = ctx.input.repository || parsedClaim.repository || '';
      const branch = ctx.input.targetBranch ?? 'main';

      if (!claimName) {
        throw new Error('claimName is required — provide it via claimData JSON or claimName input');
      }
      if (!repository) {
        throw new Error('repository is required — provide it via claimData JSON or repository input');
      }

      // Resolve GitHub token from Backstage integrations config
      const githubToken =
        config.getOptionalString('integrations.github[0].token') ??
        process.env.GITHUB_TOKEN;

      if (!githubToken) {
        throw new Error(
          'GitHub token not found. Configure integrations.github[0].token or set GITHUB_TOKEN env var.',
        );
      }

      const [owner, repo] = repository.split('/');
      if (!owner || !repo) {
        throw new Error(`Invalid repository format: "${repository}". Expected "owner/repo".`);
      }

      const apiBase = `https://api.github.com/repos/${owner}/${repo}`;
      const headers = {
        Authorization: `token ${githubToken}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      };

      ctx.logger.info(`Deleting claim "${claimName}" from ${repository}`);
      ctx.logger.info(`Claim path: ${claimPath}, category: ${claimCategory}`);

      // Use AbortController for timeout
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);

      try {
        // Step 1: Get the latest commit SHA of the target branch
        ctx.logger.info(`Fetching latest commit for branch "${branch}"`);
        const refRes = await fetch(`${apiBase}/git/ref/heads/${branch}`, {
          headers,
          signal: controller.signal,
        });

        if (!refRes.ok) {
          const errText = await refRes.text();
          throw new Error(`Failed to get branch ref: ${refRes.status} ${errText}`);
        }

        const refData = (await refRes.json()) as { object: { sha: string } };
        const baseSha = refData.object.sha;
        ctx.logger.info(`Base commit SHA: ${baseSha}`);

        // Step 2: Get the base tree
        const commitRes = await fetch(`${apiBase}/git/commits/${baseSha}`, {
          headers,
          signal: controller.signal,
        });

        if (!commitRes.ok) {
          throw new Error(`Failed to get commit: ${commitRes.status}`);
        }

        const commitData = (await commitRes.json()) as { tree: { sha: string } };
        const baseTreeSha = commitData.tree.sha;

        // Step 3: Get the current tree recursively to find files to delete
        ctx.logger.info('Fetching repository tree...');
        const treeRes = await fetch(`${apiBase}/git/trees/${baseTreeSha}?recursive=1`, {
          headers,
          signal: controller.signal,
        });

        if (!treeRes.ok) {
          throw new Error(`Failed to get tree: ${treeRes.status}`);
        }

        const treeData = (await treeRes.json()) as {
          tree: Array<{ path: string; mode: string; type: string; sha: string }>;
        };

        // Determine the claim directory to remove
        // claimPath is like "claims/cli/hacky.yaml" — derive directory as "claims/{category}/{claimName}"
        const claimDir = `claims/${claimCategory}/${claimName}`;
        ctx.logger.info(`Claim directory to remove: ${claimDir}`);

        // Find all files in the claim directory
        const filesToDelete = treeData.tree.filter(
          item => item.path.startsWith(`${claimDir}/`) && item.type === 'blob',
        );

        if (filesToDelete.length === 0) {
          ctx.logger.warn(`No files found in ${claimDir}/, trying single file at ${claimPath}`);
        }

        ctx.logger.info(`Files to delete: ${filesToDelete.map(f => f.path).join(', ')}`);

        // Step 4: Fetch and update parent kustomization.yaml
        const kustomizationPath = `claims/${claimCategory}/kustomization.yaml`;
        ctx.logger.info(`Fetching parent kustomization at ${kustomizationPath}`);

        const kustomFileRes = await fetch(
          `${apiBase}/contents/${kustomizationPath}?ref=${branch}`,
          { headers, signal: controller.signal },
        );

        let updatedKustomization: string | null = null;

        if (kustomFileRes.ok) {
          const kustomData = (await kustomFileRes.json()) as {
            content: string;
            encoding: string;
          };

          const kustomContent = Buffer.from(kustomData.content, 'base64').toString('utf-8');
          ctx.logger.info(`Current kustomization.yaml:\n${kustomContent}`);

          // Remove the claim entry from resources list
          const lines = kustomContent.split('\n');
          const filteredLines = lines.filter(line => {
            const trimmed = line.trim();
            return trimmed !== `- ${claimName}` && trimmed !== `- ./${claimName}`;
          });

          updatedKustomization = filteredLines.join('\n');

          // If resources section is now empty, ensure proper YAML
          if (!filteredLines.some(l => l.trim().startsWith('- '))) {
            updatedKustomization = updatedKustomization.replace(
              /resources:\s*$/m,
              'resources: []',
            );
          }

          ctx.logger.info(`Updated kustomization.yaml:\n${updatedKustomization}`);
        } else {
          ctx.logger.warn(`Could not fetch kustomization.yaml: ${kustomFileRes.status}`);
        }

        // Step 5: Create new tree with deletions
        const treeItems: Array<{
          path: string;
          mode: string;
          type: string;
          sha: string | null;
          content?: string;
        }> = [];

        // Mark claim files for deletion (sha: null removes the file)
        for (const file of filesToDelete) {
          treeItems.push({
            path: file.path,
            mode: file.mode,
            type: 'blob',
            sha: null,
          });
        }

        // If no directory files found, try deleting the single claim file
        if (filesToDelete.length === 0 && claimPath) {
          treeItems.push({
            path: claimPath,
            mode: '100644',
            type: 'blob',
            sha: null,
          });
        }

        // Add updated kustomization.yaml
        if (updatedKustomization !== null) {
          treeItems.push({
            path: kustomizationPath,
            mode: '100644',
            type: 'blob',
            content: updatedKustomization,
          });
        }

        if (treeItems.length === 0) {
          throw new Error('No files to modify — nothing to delete');
        }

        ctx.logger.info(`Creating new tree with ${treeItems.length} changes`);

        const newTreeRes = await fetch(`${apiBase}/git/trees`, {
          method: 'POST',
          headers,
          signal: controller.signal,
          body: JSON.stringify({
            base_tree: baseTreeSha,
            tree: treeItems,
          }),
        });

        if (!newTreeRes.ok) {
          const errText = await newTreeRes.text();
          throw new Error(`Failed to create tree: ${newTreeRes.status} ${errText}`);
        }

        const newTreeData = (await newTreeRes.json()) as { sha: string };

        // Step 6: Create a commit
        const commitMessage = `Delete claim "${claimName}" from ${claimCategory}`;

        const newCommitRes = await fetch(`${apiBase}/git/commits`, {
          method: 'POST',
          headers,
          signal: controller.signal,
          body: JSON.stringify({
            message: commitMessage,
            tree: newTreeData.sha,
            parents: [baseSha],
          }),
        });

        if (!newCommitRes.ok) {
          const errText = await newCommitRes.text();
          throw new Error(`Failed to create commit: ${newCommitRes.status} ${errText}`);
        }

        const newCommitData = (await newCommitRes.json()) as { sha: string };

        // Step 7: Create a new branch for the PR
        const prBranch = `delete-claim-${claimCategory}-${claimName}`;
        ctx.logger.info(`Creating branch: ${prBranch}`);

        const createBranchRes = await fetch(`${apiBase}/git/refs`, {
          method: 'POST',
          headers,
          signal: controller.signal,
          body: JSON.stringify({
            ref: `refs/heads/${prBranch}`,
            sha: newCommitData.sha,
          }),
        });

        if (!createBranchRes.ok) {
          // Branch may already exist — try updating it
          const updateBranchRes = await fetch(`${apiBase}/git/refs/heads/${prBranch}`, {
            method: 'PATCH',
            headers,
            signal: controller.signal,
            body: JSON.stringify({
              sha: newCommitData.sha,
              force: true,
            }),
          });

          if (!updateBranchRes.ok) {
            const errText = await updateBranchRes.text();
            throw new Error(`Failed to create/update branch: ${updateBranchRes.status} ${errText}`);
          }
        }

        // Step 8: Create the pull request
        ctx.logger.info('Creating pull request...');

        const prRes = await fetch(`${apiBase}/pulls`, {
          method: 'POST',
          headers,
          signal: controller.signal,
          body: JSON.stringify({
            title: `Delete claim - ${claimName}`,
            body: [
              '## Claim Deletion via Backstage',
              '',
              `**Claim Name**: ${claimName}`,
              `**Category**: ${claimCategory}`,
              `**Repository**: ${repository}`,
              '',
              '### Changes',
              `- Removed claim directory: \`${claimDir}/\``,
              `- Updated \`${kustomizationPath}\` to remove resource entry`,
              '',
              'Created automatically via Backstage Claim Registry integration.',
            ].join('\n'),
            head: prBranch,
            base: branch,
          }),
        });

        if (!prRes.ok) {
          const errText = await prRes.text();
          throw new Error(`Failed to create PR: ${prRes.status} ${errText}`);
        }

        const prData = (await prRes.json()) as {
          html_url: string;
          number: number;
        };

        ctx.logger.info(`Pull request created: ${prData.html_url}`);

        ctx.output('pullRequestUrl', prData.html_url);
        ctx.output('pullRequestNumber', prData.number);
      } catch (err) {
        clearTimeout(timeout);
        if (err instanceof Error && err.name === 'AbortError') {
          throw new Error('Request timed out after 60 seconds');
        }
        throw err;
      } finally {
        clearTimeout(timeout);
      }
    },
  });
};
