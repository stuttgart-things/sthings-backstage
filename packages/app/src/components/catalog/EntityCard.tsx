import {
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Typography,
  Box,
} from '@material-ui/core';
import { makeStyles, Theme } from '@material-ui/core/styles';
import { Entity } from '@backstage/catalog-model';
import { useEntityPresentation } from '@backstage/plugin-catalog-react';
import { useNavigate } from 'react-router-dom';
import StorageIcon from '@material-ui/icons/Storage';
import WebIcon from '@material-ui/icons/Web';
import ExtensionIcon from '@material-ui/icons/Extension';
import MenuBookIcon from '@material-ui/icons/MenuBook';
import SettingsIcon from '@material-ui/icons/Settings';
import CodeIcon from '@material-ui/icons/Code';

const MAX_TAGS = 3;

const lifecycleColors: Record<string, { bg: string; color: string }> = {
  production: { bg: 'rgba(22,163,74,0.12)', color: '#16a34a' },
  staging: { bg: 'rgba(217,119,6,0.12)', color: '#d97706' },
  experimental: { bg: 'rgba(124,58,237,0.12)', color: '#7c3aed' },
  deprecated: { bg: 'rgba(220,38,38,0.12)', color: '#dc2626' },
  development: { bg: 'rgba(37,99,235,0.12)', color: '#2563eb' },
};

const tagColors: Record<string, { bg: string; color: string }> = {
  infrastructure: { bg: 'rgba(124,58,237,0.10)', color: '#7c3aed' },
  infra: { bg: 'rgba(124,58,237,0.10)', color: '#7c3aed' },
  backend: { bg: 'rgba(37,99,235,0.10)', color: '#2563eb' },
  frontend: { bg: 'rgba(13,148,136,0.10)', color: '#0D9488' },
  'ci/cd': { bg: 'rgba(234,88,12,0.10)', color: '#ea580c' },
  cicd: { bg: 'rgba(234,88,12,0.10)', color: '#ea580c' },
  kubernetes: { bg: 'rgba(37,99,235,0.10)', color: '#2563eb' },
  dagger: { bg: 'rgba(234,88,12,0.10)', color: '#ea580c' },
};

const typeIcons: Record<string, React.ReactElement> = {
  service: <StorageIcon fontSize="small" />,
  website: <WebIcon fontSize="small" />,
  library: <ExtensionIcon fontSize="small" />,
  documentation: <MenuBookIcon fontSize="small" />,
  resource: <SettingsIcon fontSize="small" />,
};

const useStyles = makeStyles((theme: Theme) => ({
  card: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    position: 'relative' as const,
    overflow: 'visible',
  },
  actionArea: {
    flexGrow: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'stretch',
  },
  content: {
    flexGrow: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(1.5),
    padding: theme.spacing(2.5),
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(1.5),
  },
  iconWrapper: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: theme.palette.type === 'dark'
      ? 'rgba(157,143,232,0.12)'
      : 'rgba(59,48,132,0.08)',
    color: theme.palette.primary.main,
    flexShrink: 0,
    marginTop: 2,
  },
  titleGroup: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontWeight: 700,
    fontSize: '1.05rem',
    lineHeight: 1.3,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  namespace: {
    fontSize: '0.75rem',
    color: theme.palette.text.secondary,
    marginTop: 2,
  },
  description: {
    fontSize: '0.85rem',
    color: theme.palette.text.secondary,
    lineHeight: 1.5,
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical' as const,
    overflow: 'hidden',
    minHeight: '2.55em',
  },
  metaRow: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    flexWrap: 'wrap' as const,
  },
  lifecycleBadge: {
    fontSize: '0.7rem',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    padding: '2px 10px',
    borderRadius: 20,
    lineHeight: 1.8,
    whiteSpace: 'nowrap' as const,
  },
  typeBadge: {
    fontSize: '0.72rem',
    fontWeight: 600,
    color: theme.palette.text.secondary,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  owner: {
    fontSize: '0.78rem',
    color: theme.palette.text.secondary,
    marginLeft: 'auto',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: 160,
  },
  tagsRow: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    flexWrap: 'wrap' as const,
    marginTop: 'auto',
  },
  tag: {
    height: 24,
    fontSize: '0.72rem',
    fontWeight: 500,
  },
  overflowTag: {
    height: 24,
    fontSize: '0.72rem',
    fontWeight: 600,
    backgroundColor: theme.palette.type === 'dark'
      ? 'rgba(255,255,255,0.08)'
      : 'rgba(0,0,0,0.06)',
    color: theme.palette.text.secondary,
  },
}));

function getEntityRoute(entity: Entity): string {
  const namespace = entity.metadata.namespace || 'default';
  const kind = entity.kind.toLowerCase();
  const name = entity.metadata.name;
  return `/catalog/${namespace}/${kind}/${name}`;
}

export function EntityCard({ entity }: { entity: Entity }) {
  const classes = useStyles();
  const navigate = useNavigate();
  const { primaryTitle } = useEntityPresentation(entity);

  const kind = entity.kind.toLowerCase();
  const type = (entity.spec?.type as string) || kind;
  const lifecycle = (entity.spec?.lifecycle as string) || '';
  const owner = (entity.spec?.owner as string) || '';
  const description = entity.metadata.description || '';
  const tags = entity.metadata.tags || [];
  const system = (entity.spec?.system as string) || '';

  const visibleTags = tags.slice(0, MAX_TAGS);
  const overflowCount = tags.length - MAX_TAGS;

  const lcStyle = lifecycleColors[lifecycle.toLowerCase()] || {
    bg: 'rgba(107,114,128,0.10)',
    color: '#6b7280',
  };

  const icon = typeIcons[type.toLowerCase()] || <CodeIcon fontSize="small" />;

  const ownerShort = owner.replace(/^(group:|user:)?(default\/)?/i, '');

  return (
    <Card className={classes.card} variant="outlined">
      <CardActionArea
        className={classes.actionArea}
        onClick={() => navigate(getEntityRoute(entity))}
      >
        <CardContent className={classes.content}>
          {/* Header: icon + name */}
          <Box className={classes.header}>
            <Box className={classes.iconWrapper}>{icon}</Box>
            <Box className={classes.titleGroup}>
              <Typography className={classes.name}>
                {primaryTitle}
              </Typography>
              {system && (
                <Typography className={classes.namespace}>
                  {system}
                </Typography>
              )}
            </Box>
          </Box>

          {/* Description */}
          <Typography className={classes.description}>
            {description || 'No description available'}
          </Typography>

          {/* Meta row: lifecycle + type + owner */}
          <Box className={classes.metaRow}>
            {lifecycle && (
              <span
                className={classes.lifecycleBadge}
                style={{ backgroundColor: lcStyle.bg, color: lcStyle.color }}
              >
                {lifecycle}
              </span>
            )}
            <span className={classes.typeBadge}>
              {icon}
              {type}
            </span>
            {ownerShort && (
              <Typography className={classes.owner} title={owner}>
                {ownerShort}
              </Typography>
            )}
          </Box>

          {/* Tags */}
          {tags.length > 0 && (
            <Box className={classes.tagsRow}>
              {visibleTags.map(tag => {
                const tc = tagColors[tag.toLowerCase()];
                return (
                  <Chip
                    key={tag}
                    label={tag}
                    size="small"
                    className={classes.tag}
                    style={
                      tc
                        ? { backgroundColor: tc.bg, color: tc.color }
                        : undefined
                    }
                  />
                );
              })}
              {overflowCount > 0 && (
                <Chip
                  label={`+${overflowCount}`}
                  size="small"
                  className={classes.overflowTag}
                />
              )}
            </Box>
          )}
        </CardContent>
      </CardActionArea>
    </Card>
  );
}
