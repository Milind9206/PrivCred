import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const contractConfig = {
  privateStateStoreName: 'privcred-private-state',
  zkConfigPath: path.resolve(__dirname, '..', '..', 'contract', 'src', 'managed', 'privcred'),
};

export interface Config {
  readonly logDir: string;
  readonly indexer: string;
  readonly indexerWS: string;
  readonly node: string;
  readonly proofServer: string;
}

export class PreprodConfig implements Config {
  logDir = path.resolve(__dirname, '..', 'logs', 'preprod', `${new Date().toISOString().replace(/:/g, '-')}.log`);
  indexer = process.env.PREPROD_INDEXER_URL || 'https://indexer.preprod.midnight.network/api/v3/graphql';
  indexerWS = process.env.PREPROD_INDEXER_WS_URL || 'wss://indexer.preprod.midnight.network/api/v3/graphql/ws';
  node = process.env.PREPROD_RPC_URL || 'https://rpc.preprod.midnight.network';
  proofServer = process.env.PREPROD_PROOF_SERVER_URL || 'http://127.0.0.1:6300';
  constructor() { setNetworkId('preprod'); }
}
