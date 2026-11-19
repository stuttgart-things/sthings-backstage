/**
 * StructuredMetadataTable runs every key through lodash startCase by default,
 * which turns "vCPU" into "V CPU" and "IPv4" into "I Pv 4" (#249). The cards
 * already pass readable labels, so show them as they are.
 */
export const KEEP_LABELS = { titleFormat: (key: string) => key };
