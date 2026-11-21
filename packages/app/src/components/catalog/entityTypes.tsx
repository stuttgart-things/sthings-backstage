import type { ReactElement } from 'react';
import StorageIcon from '@material-ui/icons/Storage';
import WebIcon from '@material-ui/icons/Web';
import ExtensionIcon from '@material-ui/icons/Extension';
import MenuBookIcon from '@material-ui/icons/MenuBook';
import SettingsIcon from '@material-ui/icons/Settings';
import CodeIcon from '@material-ui/icons/Code';
import ComputerIcon from '@material-ui/icons/Computer';
import LayersIcon from '@material-ui/icons/Layers';
import CloudIcon from '@material-ui/icons/Cloud';
import ShoppingCartIcon from '@material-ui/icons/ShoppingCart';
import DescriptionIcon from '@material-ui/icons/Description';

type TypeInfo = {
  /** Shown instead of the raw spec.type. */
  label: string;
  icon: () => ReactElement;
  /** Chip colour; types without one get the neutral default. */
  color?: string;
};

/**
 * Display names for `spec.type` values (#246). The catalog keeps the
 * machine-friendly values (`vm`, `vm-template`, ...); the UI shows these
 * labels. A type missing here is shown as it is.
 */
const TYPES: Record<string, TypeInfo> = {
  vm: {
    label: 'Virtual Machine',
    icon: () => <ComputerIcon fontSize="small" />,
    color: '#2563eb',
  },
  'vm-template': {
    label: 'VM-Template',
    icon: () => <LayersIcon fontSize="small" />,
    color: '#7c3aed',
  },
  'kubernetes-cluster': {
    label: 'Kubernetes Cluster',
    icon: () => <CloudIcon fontSize="small" />,
    color: '#0D9488',
  },
  'machinery-order': {
    label: 'Machinery Order',
    icon: () => <ShoppingCartIcon fontSize="small" />,
    color: '#ea580c',
  },
  service: { label: 'Service', icon: () => <StorageIcon fontSize="small" /> },
  website: { label: 'Website', icon: () => <WebIcon fontSize="small" /> },
  library: { label: 'Library', icon: () => <ExtensionIcon fontSize="small" /> },
  documentation: {
    label: 'Documentation',
    icon: () => <MenuBookIcon fontSize="small" />,
  },
  resource: {
    label: 'Resource',
    icon: () => <SettingsIcon fontSize="small" />,
  },
  openapi: {
    label: 'OpenAPI',
    icon: () => <DescriptionIcon fontSize="small" />,
  },
  database: { label: 'Database', icon: () => <StorageIcon fontSize="small" /> },
};

export const DEFAULT_TYPE_COLOR = '#6b7280';

/** Display name for a spec.type; unknown types are returned unchanged. */
export function typeLabel(type: string): string {
  return TYPES[type.toLocaleLowerCase('en-US')]?.label ?? type;
}

export function typeIcon(type: string): ReactElement {
  const info = TYPES[type.toLocaleLowerCase('en-US')];
  return info ? info.icon() : <CodeIcon fontSize="small" />;
}

export function typeColor(type: string): string {
  return TYPES[type.toLocaleLowerCase('en-US')]?.color ?? DEFAULT_TYPE_COLOR;
}
