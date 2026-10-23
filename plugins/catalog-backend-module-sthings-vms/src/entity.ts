import {
  ANNOTATION_LOCATION,
  ANNOTATION_ORIGIN_LOCATION,
  Entity,
} from '@backstage/catalog-model';
import { VmRecord } from './types';

export const VM_ANNOTATION_PREFIX = 'vm.stuttgart-things.com';

export interface EntityDefaults {
  providerId: string;
  system: string;
  owner: string;
  lifecycle: string;
}

/** Backstage names: [a-z0-9A-Z] joined by [-_.], max 63 chars. */
export function toEntityName(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9\-_.]+/g, '-')
    .replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '')
    .slice(0, 63)
    .replace(/[^a-zA-Z0-9]+$/g, '');
}

/** Backstage tags: lowercase [a-z0-9:+#] joined by '-', max 63 chars. */
export function toTag(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9:+#]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '');
}

/**
 * Shapes a VM into a Resource entity. Name, annotations and tags match the
 * hand-maintained entities in stuttgart-things `catalog/vms/` so those can be
 * replaced without the entity refs changing.
 */
export function vmToEntity(vm: VmRecord, defaults: EntityDefaults): Entity {
  const location = `sthings-vms:${defaults.providerId}`;

  const annotations: Record<string, string> = {
    [ANNOTATION_LOCATION]: location,
    [ANNOTATION_ORIGIN_LOCATION]: location,
    ...vm.annotations,
  };
  if (vm.status) annotations[`${VM_ANNOTATION_PREFIX}/status`] = vm.status;
  if (vm.cpus !== undefined) {
    annotations[`${VM_ANNOTATION_PREFIX}/cpus`] = String(vm.cpus);
  }
  if (vm.memoryMiB !== undefined) {
    annotations[`${VM_ANNOTATION_PREFIX}/memory-mib`] = String(vm.memoryMiB);
  }
  if (vm.os) annotations[`${VM_ANNOTATION_PREFIX}/os`] = vm.os;

  const description = vmDescription(vm);

  const tags = [
    ...new Set(
      [
        vm.cloud,
        defaults.system,
        vm.template ? 'vm-template' : 'vm',
        ...vm.tags,
      ]
        .map(toTag)
        .filter(Boolean),
    ),
  ];

  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Resource',
    metadata: {
      name: toEntityName(`${vm.name}-${vm.cloud}-vm`),
      title: vm.name,
      ...(description && { description }),
      annotations,
      tags,
      ...(vm.url && {
        links: [
          { url: vm.url, title: capitalize(vm.cloud), icon: 'dashboard' },
        ],
      }),
    },
    spec: {
      type: vm.template ? 'vm-template' : 'vm',
      lifecycle: defaults.lifecycle,
      owner: defaults.owner,
      system: defaults.system,
    },
  };
}

/**
 * One line for the About card, which shows no annotations: the source's own
 * description, then OS, size, IP and status.
 * `homerun2 rke2 -- Ubuntu 26.04 LTS · 4 vCPU · 8 GiB · 10.31.103.21 · running`
 */
export function vmDescription(vm: VmRecord): string {
  const facts = [
    vm.os,
    vm.cpus !== undefined ? `${vm.cpus} vCPU` : undefined,
    vm.memoryMiB !== undefined ? formatMiB(vm.memoryMiB) : undefined,
    vm.ipv4,
    vm.status,
  ]
    .filter(Boolean)
    .join(' · ');
  return [vm.description?.trim(), facts].filter(Boolean).join(' -- ');
}

/** 8192 -> `8 GiB`, 1536 -> `1.5 GiB`, 512 -> `512 MiB`. */
export function formatMiB(mib: number): string {
  if (mib < 1024) return `${mib} MiB`;
  return `${Math.round((mib / 1024) * 10) / 10} GiB`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
