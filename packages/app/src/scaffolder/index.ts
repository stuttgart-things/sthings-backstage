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

// Registry Claim Picker field extension (claim-registry plugin)
import { RegistryClaimPickerExtension } from './RegistryClaimPickerExtension';

export const RegistryClaimPickerFieldExtension = scaffolderPlugin.provide(
  createScaffolderFieldExtension({
    name: 'RegistryClaimPicker',
    component: RegistryClaimPickerExtension,
  }),
);

// Also export the raw components if needed
export {
  ClaimMachineryPickerExtension,
  ClaimMachineryParametersExtension,
  ClaimMachineryMultiClaimExtension,
  RegistryClaimPickerExtension,
};
