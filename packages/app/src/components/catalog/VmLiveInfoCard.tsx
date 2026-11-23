import { useCallback, useEffect, useState } from 'react';
import { Entity } from '@backstage/catalog-model';
import {
  InfoCard,
  Progress,
  StructuredMetadataTable,
} from '@backstage/core-components';
import {
  discoveryApiRef,
  fetchApiRef,
  useApi,
} from '@backstage/core-plugin-api';
import { useEntity } from '@backstage/plugin-catalog-react';
import { IconButton, Tooltip, Typography } from '@material-ui/core';
import RefreshIcon from '@material-ui/icons/Refresh';
import { KEEP_LABELS } from './keepLabels';

/** What /api/vm-info answers (plugins/catalog-backend-module-sthings-vms, live.ts). */
export interface VmLiveInfo {
  cloud: string;
  status?: string;
  uptimeSeconds?: number;
  ipAddresses: string[];
  host?: string;
  cpu?: { count?: number; usagePercent?: number };
  memory?: { totalMiB?: number; usedMiB?: number };
  fetchedAt: string;
}

/**
 * Only VMs the sthings-vms provider created can be asked live: hand-written
 * and Terraform VM entities have no source to ask.
 */
export function hasLiveVmInfo(entity: Entity): boolean {
  const location =
    entity.metadata.annotations?.['backstage.io/managed-by-location'] ?? '';
  return entity.spec?.type === 'vm' && location.startsWith('sthings-vms:');
}

/** 93784 -> `1d 2h 3m`; under a minute -> `<1m`. */
export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [d && `${d}d`, (d || h) && `${h}h`, `${m}m`].filter(Boolean);
  return seconds < 60 ? '<1m' : parts.join(' ');
}

function mib(n: number): string {
  return n < 1024 ? `${n} MiB` : `${Math.round((n / 1024) * 10) / 10} GiB`;
}

/** Rows in reading order; absent values are left out, not shown empty. */
export function liveRows(info: VmLiveInfo): Record<string, string> {
  const rows: Record<string, string> = {};
  if (info.status) rows.Status = info.status;
  if (info.uptimeSeconds !== undefined) {
    rows.Uptime = formatUptime(info.uptimeSeconds);
  }
  if (info.ipAddresses.length)
    rows['IP addresses'] = info.ipAddresses.join(', ');
  if (info.host) rows.Host = info.host;
  const { cpu, memory } = info;
  if (cpu?.count !== undefined || cpu?.usagePercent !== undefined) {
    rows.CPU = [
      cpu.usagePercent !== undefined && `${cpu.usagePercent} %`,
      cpu.count !== undefined && `of ${cpu.count} vCPU`,
    ]
      .filter(Boolean)
      .join(' ');
  }
  if (memory?.totalMiB !== undefined || memory?.usedMiB !== undefined) {
    rows.Memory =
      memory.usedMiB !== undefined && memory.totalMiB !== undefined
        ? `${mib(memory.usedMiB)} of ${mib(memory.totalMiB)}`
        : mib((memory.usedMiB ?? memory.totalMiB)!);
  }
  rows['As of'] = new Date(info.fetchedAt).toLocaleTimeString();
  return rows;
}

/**
 * Live state of a VM, asked from its hypervisor through the vm-info backend
 * plugin (#244). The "VM" card next to it shows the catalog snapshot from the
 * last provider run.
 */
export function VmLiveInfoCard() {
  const { entity } = useEntity();
  const discoveryApi = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);
  const [state, setState] = useState<{
    loading: boolean;
    info?: VmLiveInfo;
    error?: string;
  }>({ loading: true });

  const namespace = entity.metadata.namespace ?? 'default';
  const name = entity.metadata.name;

  const load = useCallback(async () => {
    setState(s => ({ ...s, loading: true }));
    try {
      const base = await discoveryApi.getBaseUrl('vm-info');
      const res = await fetchApi.fetch(
        `${base}/entity/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
      );
      const body = await res.json().catch(() => undefined);
      if (!res.ok) {
        throw new Error(
          body?.error?.message ?? `${res.status} ${res.statusText}`,
        );
      }
      setState({ loading: false, info: body as VmLiveInfo });
    } catch (e) {
      setState({ loading: false, error: (e as Error).message });
    }
  }, [discoveryApi, fetchApi, namespace, name]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = (
    <Tooltip title="Ask the hypervisor again">
      <span>
        <IconButton
          aria-label="Refresh"
          size="small"
          onClick={load}
          disabled={state.loading}
        >
          <RefreshIcon />
        </IconButton>
      </span>
    </Tooltip>
  );

  return (
    <InfoCard
      title="Live"
      subheader="From the hypervisor, now"
      action={refresh}
    >
      {state.loading && !state.info && <Progress />}
      {state.error && (
        <Typography variant="body2" color="error">
          Live state not available: {state.error}
        </Typography>
      )}
      {state.info && !state.error && (
        <StructuredMetadataTable
          metadata={liveRows(state.info)}
          options={KEEP_LABELS}
        />
      )}
    </InfoCard>
  );
}
