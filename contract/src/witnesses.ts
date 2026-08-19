export type CredentialData = {
  candidatePk: Uint8Array;
  degreeVerified: boolean;
  licenseActive: boolean;
  backgroundClean: boolean;
  degreeGrade: bigint;
  ssnHash: Uint8Array;
};

export type PrivCredPrivateState = {
  adminSecretKey?: Uint8Array;
  issuerSecretKey?: Uint8Array;
  candidateSecretKey?: Uint8Array;
  credentialData?: CredentialData;
  credentialNonce?: Uint8Array;
};

export const witnesses = {
  adminSecret: (context: any) => {
    if (!context.privateState.adminSecretKey) throw new Error('adminSecretKey not initialized in private state');
    return [context.privateState, context.privateState.adminSecretKey];
  },
  issuerSecret: (context: any) => {
    if (!context.privateState.issuerSecretKey) throw new Error('issuerSecretKey not initialized in private state');
    return [context.privateState, context.privateState.issuerSecretKey];
  },
  candidateSecret: (context: any) => {
    if (!context.privateState.candidateSecretKey) throw new Error('candidateSecretKey not initialized in private state');
    return [context.privateState, context.privateState.candidateSecretKey];
  },
  getCredentialData: (context: any) => {
    if (!context.privateState.credentialData) throw new Error('credentialData not initialized in private state');
    return [context.privateState, context.privateState.credentialData];
  },
  getCredentialNonce: (context: any) => {
    if (!context.privateState.credentialNonce) throw new Error('credentialNonce not initialized in private state');
    return [context.privateState, context.privateState.credentialNonce];
  }
};
