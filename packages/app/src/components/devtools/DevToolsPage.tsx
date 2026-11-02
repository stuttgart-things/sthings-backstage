import {
  ConfigContent,
  DevToolsLayout,
  ExternalDependenciesContent,
  InfoContent,
  ScheduledTasksContent,
} from '@backstage/plugin-devtools';
import { UnprocessedEntitiesContent } from '@backstage/plugin-catalog-unprocessed-entities';

/**
 * Platform admin page at /devtools. The route and the sidebar entry require
 * devtools.administer, and the backends check their own permissions -- the
 * permission policy grants all of them to the platform groups only.
 */
export const PlatformDevToolsPage = () => (
  <DevToolsLayout title="Platform DevTools">
    <DevToolsLayout.Route path="info" title="Info">
      <InfoContent />
    </DevToolsLayout.Route>
    <DevToolsLayout.Route
      path="unprocessed-entities"
      title="Unprocessed Entities"
    >
      <UnprocessedEntitiesContent />
    </DevToolsLayout.Route>
    <DevToolsLayout.Route path="scheduled-tasks" title="Scheduled Tasks">
      <ScheduledTasksContent />
    </DevToolsLayout.Route>
    <DevToolsLayout.Route path="config" title="Config">
      <ConfigContent />
    </DevToolsLayout.Route>
    <DevToolsLayout.Route
      path="external-dependencies"
      title="External Dependencies"
    >
      <ExternalDependenciesContent />
    </DevToolsLayout.Route>
  </DevToolsLayout>
);
