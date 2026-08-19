export class Contract {}
export const pureCircuits = {
  deriveAdminPublicKey: (sk) => new Uint8Array(32),
  deriveIssuerPublicKey: (sk) => new Uint8Array(32),
  deriveCandidatePublicKey: (sk) => new Uint8Array(32),
  persistentCommit: (data, nonce) => new Uint8Array(32),
};
export const ledger = (data) => ({
  issuers: {
    lookup: (key) => true,
    member: (key) => true,
  },
  credentialCommitments: {
    lookup: (key) => new Uint8Array(32),
    member: (key) => true,
  },
  applications: {
    lookup: (key) => ({
      lookup: (k) => 1n,
      member: (k) => true,
    }),
    member: (key) => true,
  },
  contractAdmin: new Uint8Array(32),
});
