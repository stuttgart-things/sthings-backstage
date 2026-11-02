import { scaffolderPlugin } from '@backstage/plugin-scaffolder';
import { createScaffolderFieldExtension } from '@backstage/plugin-scaffolder-react';
import { ClaimMachineryPickerExtension } from './ClaimMachineryPickerExtension';
import { ClaimMachineryParametersExtension } from './ClaimMachineryParametersExtension';
import { ClaimMachineryMultiClaimExtension } from './ClaimMachineryMultiClaimExtension';

// Export the field extension components for use with scaffolderPlugin.provide()
export const ClaimMachineryPickerFieldExtension = scaffolderPlugin.provide(
  createScaffolderFieldExtension({
    name: 'ClaimMachineryPicker',
    component: ClaimMachineryPickerExtension,
  }),
);

export const ClaimMachineryParametersFieldExtension = scaffolderPlugin.provide(
  createScaffolderFieldExtension({
    name: 'ClaimMachineryParameters',
    component: ClaimMachineryParametersExtension,
  }),
);

// Multi-claim field extension (pick multiple templates + parameters)
export const ClaimMachineryMultiClaimFieldExtension = scaffolderPlugin.provide(
  createScaffolderFieldExtension({
    name: 'ClaimMachineryMultiClaim',
    component: ClaimMachineryMultiClaimExtension,
  }),
);

// Machinery Claim Picker: ordered XRs from the live inventory (stuttgart-things/machinery)
import { MachineryClaimPickerExtension } from './MachineryClaimPickerExtension';

export const MachineryClaimPickerFieldExtension = scaffolderPlugin.provide(
  createScaffolderFieldExtension({
    name: 'MachineryClaimPicker',
    component: MachineryClaimPickerExtension,
  }),
);

// Order owner: "for whom?" -- the signed-in user or one of their groups
import { OrderOwnerPickerExtension } from './OrderOwnerPickerExtension';

export const OrderOwnerPickerFieldExtension = scaffolderPlugin.provide(
  createScaffolderFieldExtension({
    name: 'OrderOwnerPicker',
    component: OrderOwnerPickerExtension,
  }),
);

// Custom template card (clickable body + prominent CTA)
export { TemplateCard } from './TemplateCard';

// Template groups on /create: worker steps last
export { templateGroups } from './templateGroups';

// Also export the raw components if needed
export {
  ClaimMachineryPickerExtension,
  ClaimMachineryParametersExtension,
  ClaimMachineryMultiClaimExtension,
  MachineryClaimPickerExtension,
  OrderOwnerPickerExtension,
};
