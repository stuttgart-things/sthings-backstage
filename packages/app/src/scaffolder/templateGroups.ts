import type { TemplateGroupFilter } from '@backstage/plugin-scaffolder-react';

// The Dapr worker starts templates of type worker-step itself (stuttgart-things#4226).
// They go to a group of their own at the bottom, so a person picks a request
// template first. A group without templates is not rendered, and nothing is
// left for the "Other templates" group.
const isWorkerStep: TemplateGroupFilter['filter'] = template =>
  template.spec.type === 'worker-step';

export const templateGroups: TemplateGroupFilter[] = [
  { title: 'Templates', filter: template => !isWorkerStep(template) },
  {
    title: 'Worker steps (started by the Dapr worker)',
    filter: isWorkerStep,
  },
];
