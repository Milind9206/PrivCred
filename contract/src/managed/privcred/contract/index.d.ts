import { Contract as compactContract } from '@midnight-ntwrk/compact-runtime';

export declare class Contract<PrivateState> extends compactContract<PrivateState> {}

export declare const pureCircuits: {
  deriveAdminPublicKey(secretKey: Uint8Array): Uint8Array;
  deriveIssuerPublicKey(secretKey: Uint8Array): Uint8Array;
  deriveCandidatePublicKey(secretKey: Uint8Array): Uint8Array;
  persistentCommit(data: any, nonce: Uint8Array): Uint8Array;
};

export declare const ledger: (data: any) => any;
