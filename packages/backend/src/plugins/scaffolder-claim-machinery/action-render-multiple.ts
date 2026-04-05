import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { Config } from '@backstage/config';
import fetch from 'node-fetch';
import https from 'https';

interface ClaimEntry {
  template: string;
  parameters?: Record<string, any>;
  nameOverride?: string;
}

export const claimMachineryRenderMultipleAction = (options: { config: Config }) => {
  const { config } = options;

  return createTemplateAction({
    id: 'claim-machinery:render-multiple',
    description:
      'Render multiple Claim Machinery templates and create a GitHub PR with the combined manifests',

    schema: {
      input: {
        claims: z =>
          z.union([
            z
              .array(
                z.object({
                  template: z.string().describe('The template name to render'),
                  parameters: z.record(z.any()).optional().describe('Template parameters'),
                  nameOverride: z.string().optional().describe('Override for the name parameter'),
                }),
              )
              .min(1),
            z.string().describe('JSON-stringified array of claim entries'),
          ]).describe('Array of claim entries to render (or JSON string)'),
        repository: z =>
          z.string().describe('GitHub repository in owner/repo format'),
        targetBranch: z =>
          z.string().optional().default('main').describe('Target branch for the PR'),
        claimCategory: z =>
          z.string().optional().default('infra').describe('Category folder under claims/'),
        prTitle: z =>
          z.string().optional().describe('Custom PR title'),
        generateCatalogInfo: z =>
          z.boolean().optional().default(false).describe('Generate a catalog-info.yaml per claim for Backstage catalog registration'),
        catalogOwner: z =>
          z.string().optional().default('platform-team').describe('Owner for catalog-info.yaml spec.owner'),
        generateKustomization: z =>
          z.boolean().optional().default(false).describe('Generate a per-claim kustomization.yaml referencing the rendered manifest'),
      },
      output: {
        manifest: z => z.string().describe('The combined rendered manifest content'),
        pullRequestUrl: z => z.string().describe('URL of the created pull request'),
        pullRequestNumber: z => z.number().describe('The PR number'),
        branchName: z => z.string().describe('The name of the created branch'),
      },
    },

    async handler(ctx) {
      const rawClaims = ctx.input.claims;
      const claims: ClaimEntry[] = typeof rawClaims === 'string'
        ? JSON.parse(rawClaims)
        : (rawClaims as ClaimEntry[]);
      const repository = ctx.input.repository as string;
      const targetBranch = (ctx.input.targetBranch as string) ?? 'main';
      const claimCategory = (ctx.input.claimCategory as string) ?? 'infra';
      const customPrTitle = ctx.input.prTitle as string | undefined;
      const generateCatalogInfo = (ctx.input.generateCatalogInfo as boolean) ?? false;
      const catalogOwner = (ctx.input.catalogOwner as string) ?? 'platform-team';
      const generateKustomization = (ctx.input.generateKustomization as boolean) ?? false;

      const baseUrl =
        config.getOptionalString('claimMachinery.apiUrl') ??
        'https://claim-api.dev-infra-pre.sthings-vsphere.labul.sva.de';

      const githubToken =
        config.getOptionalConfigArray('integrations.github')?.[0]?.getOptionalString('token') ??
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

      ctx.logger.info(
        `Rendering ${claims.length} claim(s) and creating PR in ${repository}`,
      );

      // Step 1: Render all claim templates via the API
      const renderedManifests: string[] = [];
      const claimNames: string[] = [];
      const claimTemplateNames: string[] = [];
      const agent = baseUrl.startsWith('https')
        ? new https.Agent({ rejectUnauthorized: false })
        : undefined;

      for (const claim of claims) {
        const parameters = {
          ...claim.parameters,
          ...(claim.nameOverride ? { name: claim.nameOverride } : {}),
        };

        const url = `${baseUrl}/api/v1/claim-templates/${claim.template}/order`;
        ctx.logger.info(`POST ${url} (template: ${claim.template})`);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000);

        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({ parameters }),
            signal: controller.signal,
            ...(agent && { agent }),
          });

          clearTimeout(timeout);

          if (!res.ok) {
            const errorText = await res.text();
            throw new Error(
              `API returned ${res.status} for template "${claim.template}": ${errorText}`,
            );
          }

          const contentType = res.headers.get('content-type');
          if (!contentType?.includes('application/json')) {
            const responseText = await res.text();
            throw new Error(
              `Expected JSON for "${claim.template}" but got ${contentType}: ${responseText.substring(0, 200)}`,
            );
          }

          const response = (await res.json()) as { rendered: string };
          renderedManifests.push(response.rendered);

          const name =
            claim.nameOverride ?? claim.parameters?.name ?? claim.template;
          claimNames.push(name);
          claimTemplateNames.push(claim.template);

          ctx.logger.info(`Rendered template "${claim.template}" as "${name}"`);
        } catch (err) {
          clearTimeout(timeout);
          if (err instanceof Error && err.name === 'AbortError') {
            throw new Error(
              `Request timed out for template "${claim.template}" after 60 seconds`,
            );
          }
          throw err;
        }
      }

      // Step 2: Combine manifests into multi-document YAML
      const combinedManifest = renderedManifests.join('\n---\n');
      ctx.logger.info(
        `Combined ${renderedManifests.length} manifest(s) (${combinedManifest.length} bytes)`,
      );

      // Step 3: Create GitHub PR with the combined manifest
      const apiBase = `https://api.github.com/repos/${owner}/${repo}`;
      const headers = {
        Authorization: `token ${githubToken}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      };

      const ghController = new AbortController();
      const ghTimeout = setTimeout(() => ghController.abort(), 60000);

      try {
        // Get latest commit SHA of target branch
        ctx.logger.info(`Fetching latest commit for branch "${targetBranch}"`);
        const refRes = await fetch(`${apiBase}/git/ref/heads/${targetBranch}`, {
          headers,
          signal: ghController.signal,
        });

        if (!refRes.ok) {
          const errText = await refRes.text();
          throw new Error(`Failed to get branch ref: ${refRes.status} ${errText}`);
        }

        const refData = (await refRes.json()) as { object: { sha: string } };
        const baseSha = refData.object.sha;

        // Get the base tree
        const commitRes = await fetch(`${apiBase}/git/commits/${baseSha}`, {
          headers,
          signal: ghController.signal,
        });

        if (!commitRes.ok) {
          throw new Error(`Failed to get commit: ${commitRes.status}`);
        }

        const commitData = (await commitRes.json()) as { tree: { sha: string } };
        const baseTreeSha = commitData.tree.sha;

        // Get the current tree recursively to check for existing kustomization
        ctx.logger.info('Fetching repository tree...');
        const treeRes = await fetch(
          `${apiBase}/git/trees/${baseTreeSha}?recursive=1`,
          { headers, signal: ghController.signal },
        );

        if (!treeRes.ok) {
          throw new Error(`Failed to get tree: ${treeRes.status}`);
        }

        const treeData = (await treeRes.json()) as {
          tree: Array<{ path: string; mode: string; type: string; sha: string }>;
        };

        // Build tree items for the new claims
        const treeItems: Array<{
          path: string;
          mode: string;
          type: string;
          content: string;
        }> = [];

        // Add each claim manifest + optional catalog-info + optional kustomization
        for (let i = 0; i < claimNames.length; i++) {
          const claimName = claimNames[i];
          const templateName = claimTemplateNames[i];
          const manifest = renderedManifests[i];
          const claimDir = `claims/${claimCategory}/${claimName}`;

          // Rendered manifest — use template name as filename (matching existing convention)
          const manifestPath = `${claimDir}/${templateName}.yaml`;
          treeItems.push({
            path: manifestPath,
            mode: '100644',
            type: 'blob',
            content: manifest,
          });
          ctx.logger.info(`Adding manifest: ${manifestPath}`);

          // Per-claim kustomization.yaml
          if (generateKustomization) {
            const claimKustomPath = `${claimDir}/kustomization.yaml`;
            const claimKustomContent = [
              '---',
              'apiVersion: kustomize.config.k8s.io/v1beta1',
              'kind: Kustomization',
              'resources:',
              `  - ${templateName}.yaml`,
              '',
            ].join('\n');

            treeItems.push({
              path: claimKustomPath,
              mode: '100644',
              type: 'blob',
              content: claimKustomContent,
            });
            ctx.logger.info(`Adding kustomization: ${claimKustomPath}`);
          }

          // Per-claim catalog-info.yaml
          if (generateCatalogInfo) {
            const catalogPath = `${claimDir}/catalog-info.yaml`;
            const catalogContent = [
              '---',
              'apiVersion: backstage.io/v1alpha1',
              'kind: Component',
              'metadata:',
              `  name: ${claimName}`,
              `  description: Crossplane claim (${templateName}) - ${claimName}`,
              '  annotations:',
              `    github.com/project-slug: ${repository}`,
              `    backstage.io/source-location: url:https://github.com/${repository}/tree/main/${claimDir}`,
              `    claim-machinery/template: ${templateName}`,
              `    claim-machinery/category: ${claimCategory}`,
              '  tags:',
              '    - crossplane',
              '    - claim',
              `    - ${templateName}`,
              `    - ${claimCategory}`,
              'spec:',
              '  type: crossplane-claim',
              '  lifecycle: production',
              `  owner: ${catalogOwner}`,
              '',
            ].join('\n');

            treeItems.push({
              path: catalogPath,
              mode: '100644',
              type: 'blob',
              content: catalogContent,
            });
            ctx.logger.info(`Adding catalog-info: ${catalogPath}`);
          }
        }

        // Fetch and update (or create) parent kustomization.yaml
        const kustomizationPath = `claims/${claimCategory}/kustomization.yaml`;
        const existingKustom = treeData.tree.find(
          item => item.path === kustomizationPath,
        );

        let kustomContent: string;

        if (existingKustom) {
          ctx.logger.info(`Updating existing kustomization at ${kustomizationPath}`);
          const kustomFileRes = await fetch(
            `${apiBase}/contents/${kustomizationPath}?ref=${targetBranch}`,
            { headers, signal: ghController.signal },
          );

          if (kustomFileRes.ok) {
            const kustomData = (await kustomFileRes.json()) as {
              content: string;
            };
            kustomContent = Buffer.from(kustomData.content, 'base64').toString(
              'utf-8',
            );
          } else {
            kustomContent = 'apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\nresources:\n';
          }
        } else {
          kustomContent = 'apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\nresources:\n';
        }

        // Handle "resources: []" -> convert to list format
        kustomContent = kustomContent.replace(/resources:\s*\[\]/, 'resources:');

        // Add new claim entries to resources
        for (const claimName of claimNames) {
          const entry = `- ${claimName}`;
          if (!kustomContent.includes(entry)) {
            kustomContent = kustomContent.trimEnd() + `\n  ${entry}\n`;
          }
        }

        treeItems.push({
          path: kustomizationPath,
          mode: '100644',
          type: 'blob',
          content: kustomContent,
        });

        // Create new tree
        ctx.logger.info(`Creating new tree with ${treeItems.length} files`);
        const newTreeRes = await fetch(`${apiBase}/git/trees`, {
          method: 'POST',
          headers,
          signal: ghController.signal,
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

        // Create commit
        const commitMessage = `Add ${claimNames.length} claim(s): ${claimNames.join(', ')}`;
        const newCommitRes = await fetch(`${apiBase}/git/commits`, {
          method: 'POST',
          headers,
          signal: ghController.signal,
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

        // Create branch
        const timestamp = Date.now();
        const prBranch = `create-claims-${claimCategory}-${timestamp}`;
        ctx.logger.info(`Creating branch: ${prBranch}`);

        const createBranchRes = await fetch(`${apiBase}/git/refs`, {
          method: 'POST',
          headers,
          signal: ghController.signal,
          body: JSON.stringify({
            ref: `refs/heads/${prBranch}`,
            sha: newCommitData.sha,
          }),
        });

        if (!createBranchRes.ok) {
          const updateBranchRes = await fetch(
            `${apiBase}/git/refs/heads/${prBranch}`,
            {
              method: 'PATCH',
              headers,
              signal: ghController.signal,
              body: JSON.stringify({ sha: newCommitData.sha, force: true }),
            },
          );

          if (!updateBranchRes.ok) {
            const errText = await updateBranchRes.text();
            throw new Error(
              `Failed to create/update branch: ${updateBranchRes.status} ${errText}`,
            );
          }
        }

        // Create PR
        const title =
          customPrTitle ??
          `Create ${claimNames.length} resource claim(s) - ${claimNames.join(', ')}`;

        const prBodyFiles = claimNames.flatMap((name, i) => {
          const files = [`- \`claims/${claimCategory}/${name}/${claimTemplateNames[i]}.yaml\``];
          if (generateKustomization) files.push(`- \`claims/${claimCategory}/${name}/kustomization.yaml\``);
          if (generateCatalogInfo) files.push(`- \`claims/${claimCategory}/${name}/catalog-info.yaml\``);
          return files;
        });

        ctx.logger.info('Creating pull request...');
        const prRes = await fetch(`${apiBase}/pulls`, {
          method: 'POST',
          headers,
          signal: ghController.signal,
          body: JSON.stringify({
            title,
            body: [
              '## Resource Claims via Backstage',
              '',
              `**Category**: ${claimCategory}`,
              `**Repository**: ${repository}`,
              `**Claims**: ${claimNames.length}`,
              '',
              '### Claims Created',
              ...claimNames.map(
                (name, i) =>
                  `- **${name}** (template: \`${claims[i].template}\`)`,
              ),
              '',
              '### Files Added',
              ...prBodyFiles,
              `- Updated \`${kustomizationPath}\``,
              '',
              'Created automatically via Backstage Claim Machinery integration.',
            ].join('\n'),
            head: prBranch,
            base: targetBranch,
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

        ctx.output('manifest', combinedManifest);
        ctx.output('pullRequestUrl', prData.html_url);
        ctx.output('pullRequestNumber', prData.number);
        ctx.output('branchName', prBranch);
      } catch (err) {
        clearTimeout(ghTimeout);
        if (err instanceof Error && err.name === 'AbortError') {
          throw new Error('GitHub API request timed out after 60 seconds');
        }
        throw err;
      } finally {
        clearTimeout(ghTimeout);
      }
    },
  });
};
