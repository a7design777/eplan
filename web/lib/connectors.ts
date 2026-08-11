import type { ConnectorType } from '../../src/types';

export const ALL_CONNECTORS: ConnectorType[] = ['ccs', 'chademo', 'type2', 'tesla', 'schuko'];

export const CONNECTOR_LABELS: Record<ConnectorType, string> = {
  ccs: 'CCS',
  chademo: 'CHAdeMO',
  type2: 'Type 2',
  tesla: 'Tesla',
  schuko: 'Розетка 220 В',
};
