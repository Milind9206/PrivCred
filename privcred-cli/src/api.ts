import { type ContractAddress, ContractState } from '@midnight-ntwrk/compact-runtime';
import { PrivCred, type PrivCredPrivateState, type CredentialData, witnesses } from '@privcred/contract';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { unshieldedToken } from '@midnight-ntwrk/ledger-v8';
import { deployContract, submitCallTxAsync, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { type FinalizedTxData, type MidnightProvider, type WalletProvider } from '@midnight-ntwrk/midnight-js-types';
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { HDWallet, Roles, generateRandomSeed } from '@midnight-ntwrk/wallet-sdk-hd';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import {
  createKeystore,
  InMemoryTransactionHistoryStorage,
  PublicKey,
  UnshieldedWallet,
  type UnshieldedKeystore,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { type Logger } from 'pino';
import * as Rx from 'rxjs';
import { WebSocket } from 'ws';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { assertIsContractAddress, toHex, fromHex } from '@midnight-ntwrk/midnight-js-utils';
import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { Buffer } from 'buffer';
import {
  MidnightBech32m,
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from '@midnight-ntwrk/wallet-sdk-address-format';
import { contractConfig, type Config } from './config.js';

let logger: Logger;
export const setApiLogger = (pinoLogger: Logger) => {
  logger = pinoLogger;
};

// Bind WebSocket to global for GraphQL client in Node.js
globalThis.WebSocket = WebSocket as any;

export const privcredCompiledContract = CompiledContract.make<any, any>('privcred', PrivCred.Contract as any).pipe(
  CompiledContract.withWitnesses(witnesses as any),
  CompiledContract.withCompiledFileAssets(contractConfig.zkConfigPath),
) as any;

export type PrivCredContract = PrivCred.Contract<PrivCredPrivateState>;
export type DeployedPrivCredContract = any;

export interface WalletContext {
  wallet: WalletFacade;
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
  unshieldedKeystore: UnshieldedKeystore;
  walletProvider: WalletProvider & MidnightProvider;
  seedHex: string;
  unshieldedAddress: string;
}

// ----------------------------------------------------------------------------
// API Call Functions
// ----------------------------------------------------------------------------

export const getContractLedgerData = async (
  indexerHttpUrl: string,
  contractAddress: string
): Promise<{ issuers: any; credentialCommitments: any; applications: any; admin: string } | null> => {
  assertIsContractAddress(contractAddress);
  try {
    const res = await fetch(indexerHttpUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: `query LATEST_CONTRACT_STATE($address: HexEncoded!) {
          contractAction(address: $address) { state }
        }`,
        variables: { address: contractAddress },
      }),
    });
    if (!res.ok) throw new Error(`Indexer HTTP error: ${res.status}`);
    const payload = await res.json();
    if (payload.errors?.length) throw new Error(payload.errors.map((e: any) => e.message).join('; '));
    const action = payload.data?.contractAction ?? null;
    if (!action) return null;

    const contractState = ContractState.deserialize(fromHex(action.state));
    const ledgerState = PrivCred.ledger(contractState.data);

    return {
      issuers: ledgerState.issuers,
      credentialCommitments: ledgerState.credentialCommitments,
      applications: ledgerState.applications,
      admin: toHex(ledgerState.contractAdmin),
    };
  } catch (error) {
    logger.error(error, 'Error fetching contract ledger state');
    return null;
  }
};

export const deploy = async (
  providers: any,
  adminSecretKey: Uint8Array
): Promise<DeployedPrivCredContract> => {
  logger.info('Deriving Admin Public Key...');
  // Call pure circuit off-chain to derive the admin public key
  const adminPk = PrivCred.pureCircuits.deriveAdminPublicKey(adminSecretKey);
  logger.info(`Admin Public Key derived: ${toHex(adminPk)}`);

  logger.info('Deploying PrivCred contract...');
  const initialPrivateState: PrivCredPrivateState = {
    adminSecretKey,
  };

  const privcredContract = await (deployContract as any)(providers, {
    compiledContract: privcredCompiledContract,
    privateStateId: 'privcredPrivateState',
    initialPrivateState,
    args: [adminPk],
  });

  logger.info(`Deployed contract successfully at: ${privcredContract.deployTxData.public.contractAddress}`);
  return privcredContract;
};

export const registerIssuer = async (
  providers: any,
  contractAddress: string,
  adminSecretKey: Uint8Array,
  issuerPk: Uint8Array
): Promise<FinalizedTxData> => {
  logger.info(`Registering issuer ${toHex(issuerPk)} on-chain...`);
  
  // Update in-memory/Level private state provider
  await providers.privateStateProvider.set('privcredPrivateState', {
    adminSecretKey,
  });

  const contract = await (findDeployedContract as any)(providers, {
    contractAddress,
    compiledContract: privcredCompiledContract,
    privateStateId: 'privcredPrivateState',
    initialPrivateState: { adminSecretKey },
  });

  const tx = await contract.callTx.registerIssuer(issuerPk);
  logger.info(`Issuer registered in transaction: ${tx.public.txId}`);
  return tx.public;
};

export const removeIssuer = async (
  providers: any,
  contractAddress: string,
  adminSecretKey: Uint8Array,
  issuerPk: Uint8Array
): Promise<FinalizedTxData> => {
  logger.info(`Removing issuer ${toHex(issuerPk)} on-chain...`);

  await providers.privateStateProvider.set('privcredPrivateState', {
    adminSecretKey,
  });

  const contract = await (findDeployedContract as any)(providers, {
    contractAddress,
    compiledContract: privcredCompiledContract,
    privateStateId: 'privcredPrivateState',
    initialPrivateState: { adminSecretKey },
  });

  const tx = await contract.callTx.removeIssuer(issuerPk);
  logger.info(`Issuer removed in transaction: ${tx.public.txId}`);
  return tx.public;
};

export const anchorCredential = async (
  providers: any,
  contractAddress: string,
  issuerSecretKey: Uint8Array,
  candidatePk: Uint8Array,
  commitment: Uint8Array
): Promise<FinalizedTxData> => {
  logger.info(`Anchoring credential commitment for candidate ${toHex(candidatePk)}...`);

  await providers.privateStateProvider.set('privcredPrivateState', {
    issuerSecretKey,
  });

  const contract = await (findDeployedContract as any)(providers, {
    contractAddress,
    compiledContract: privcredCompiledContract,
    privateStateId: 'privcredPrivateState',
    initialPrivateState: { issuerSecretKey },
  });

  const tx = await contract.callTx.anchorCredential(candidatePk, commitment);
  logger.info(`Credential commitment anchored in transaction: ${tx.public.txId}`);
  return tx.public;
};

export const applyAndVerify = async (
  providers: any,
  contractAddress: string,
  candidateSecretKey: Uint8Array,
  employerPk: Uint8Array,
  credentialData: CredentialData,
  credentialNonce: Uint8Array,
  requirements: {
    requireDegree: boolean;
    requireLicense: boolean;
    requireBackground: boolean;
    minGrade: bigint;
  }
): Promise<FinalizedTxData> => {
  logger.info(`Generating ZK proof and applying to employer ${toHex(employerPk)}...`);

  const initialPrivateState: PrivCredPrivateState = {
    candidateSecretKey,
    credentialData,
    credentialNonce,
  };

  await providers.privateStateProvider.set('privcredPrivateState', initialPrivateState);

  const contract = await (findDeployedContract as any)(providers, {
    contractAddress,
    compiledContract: privcredCompiledContract,
    privateStateId: 'privcredPrivateState',
    initialPrivateState,
  });

  const tx = await contract.callTx.applyAndVerify(employerPk, requirements);
  logger.info(`Verification transaction successfully submitted: ${tx.public.txId}`);
  return tx.public;
};

// ----------------------------------------------------------------------------
// Key Derivation and Hashing Helpers (Pure Circuits run off-chain)
// ----------------------------------------------------------------------------

export const deriveAdminPk = (secretKey: Uint8Array): Uint8Array => {
  return PrivCred.pureCircuits.deriveAdminPublicKey(secretKey);
};

export const deriveIssuerPk = (secretKey: Uint8Array): Uint8Array => {
  return PrivCred.pureCircuits.deriveIssuerPublicKey(secretKey);
};

export const deriveCandidatePk = (secretKey: Uint8Array): Uint8Array => {
  return PrivCred.pureCircuits.deriveCandidatePublicKey(secretKey);
};

export const computeCredentialCommitment = (
  credentialData: CredentialData,
  nonce: Uint8Array
): Uint8Array => {
  return PrivCred.pureCircuits.persistentCommit(credentialData, nonce);
};

// ----------------------------------------------------------------------------
// Headless Wallet and Providers Assembly
// ----------------------------------------------------------------------------

const signTransactionIntents = (
  tx: { intents?: Map<number, any> },
  signFn: (payload: Uint8Array) => ledger.Signature,
  proofMarker: 'proof' | 'pre-proof',
  unshieldedKeystore: UnshieldedKeystore
): void => {
  if (!tx.intents || tx.intents.size === 0) return;

  for (const segment of tx.intents.keys()) {
    const intent = tx.intents.get(segment);
    if (!intent) continue;

    const cloned = ledger.Intent.deserialize<ledger.SignatureEnabled, ledger.Proofish, ledger.PreBinding>(
      'signature',
      proofMarker,
      'pre-binding',
      intent.serialize(),
    );

    const sigData = cloned.signatureData(segment);
    const signature = signFn(sigData);

    if (cloned.fallibleUnshieldedOffer) {
      const sigs = cloned.fallibleUnshieldedOffer.inputs.map(
        (_: ledger.UtxoSpend, i: number) => cloned.fallibleUnshieldedOffer!.signatures.at(i) ?? signature,
      );
      cloned.fallibleUnshieldedOffer = cloned.fallibleUnshieldedOffer.addSignatures(sigs);
    }

    if (cloned.guaranteedUnshieldedOffer) {
      const sigs = cloned.guaranteedUnshieldedOffer.inputs.map(
        (_: ledger.UtxoSpend, i: number) => cloned.guaranteedUnshieldedOffer!.signatures.at(i) ?? signature,
      );
      cloned.guaranteedUnshieldedOffer = cloned.guaranteedUnshieldedOffer.addSignatures(sigs);
    }

    tx.intents.set(segment, cloned);
  }
};

export const createWalletAndMidnightProvider = async (
  wallet: WalletFacade,
  shieldedSecretKeys: ledger.ZswapSecretKeys,
  dustSecretKey: ledger.DustSecretKey,
  unshieldedKeystore: UnshieldedKeystore
): Promise<WalletProvider & MidnightProvider> => {
  const state = await Rx.firstValueFrom(wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  return {
    getCoinPublicKey() {
      return state.shielded.coinPublicKey.toHexString();
    },
    getEncryptionPublicKey() {
      return state.shielded.encryptionPublicKey.toHexString();
    },
    async balanceTx(tx, ttl?) {
      const recipe = await wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys, dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );

      const signFn = (payload: Uint8Array) => unshieldedKeystore.signData(payload);
      signTransactionIntents(recipe.baseTransaction, signFn, 'proof', unshieldedKeystore);
      if (recipe.balancingTransaction) {
        signTransactionIntents(recipe.balancingTransaction, signFn, 'pre-proof', unshieldedKeystore);
      }

      return wallet.finalizeRecipe(recipe);
    },
    submitTx(tx) {
      return wallet.submitTransaction(tx) as any;
    },
  };
};

export const registerForDustGeneration = async (
  wallet: WalletFacade,
  unshieldedKeystore: UnshieldedKeystore
): Promise<void> => {
  const state = await Rx.firstValueFrom(wallet.state().pipe(Rx.filter((s) => s.isSynced)));

  if (state.dust.availableCoins.length > 0) {
    const dustBal = state.dust.balance(new Date());
    logger.info(`Dust tokens already available (${dustBal.toLocaleString()} DUST)`);
    return;
  }

  const nightUtxos = state.unshielded.availableCoins.filter(
    (coin: any) => coin.meta?.registeredForDustGeneration !== true,
  );
  if (nightUtxos.length === 0) {
    logger.info('Waiting for DUST to accrue (all unshielded UTXOs already registered)...');
    await Rx.firstValueFrom(
      wallet.state().pipe(
        Rx.throttleTime(5_000),
        Rx.filter((s) => s.isSynced),
        Rx.filter((s) => s.dust.balance(new Date()) > 0n),
      )
    );
    return;
  }

  logger.info(`Registering ${nightUtxos.length} NIGHT UTXO(s) for dust generation...`);
  const recipe = await wallet.registerNightUtxosForDustGeneration(
    nightUtxos,
    unshieldedKeystore.getPublicKey(),
    (payload) => unshieldedKeystore.signData(payload),
  );
  const finalized = await wallet.finalizeRecipe(recipe);
  await wallet.submitTransaction(finalized);

  logger.info('Waiting for DUST to generate...');
  await Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(5_000),
      Rx.filter((s) => s.isSynced),
      Rx.filter((s) => s.dust.balance(new Date()) > 0n),
    )
  );
  logger.info('DUST accrued successfully.');
};

export const buildHeadlessWallet = async (config: Config, seedHex: string): Promise<WalletContext> => {
  const seed = Buffer.from(seedHex, 'hex');
  const hdWallet = HDWallet.fromSeed(seed);
  if (hdWallet.type !== 'seedOk') throw new Error('Invalid seed');

  const derivationResult = hdWallet.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);

  if (derivationResult.type !== 'keysDerived') throw new Error('Key derivation failed');
  hdWallet.hdWallet.clear();

  const keys = derivationResult.keys;
  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(keys[Roles.NightExternal], getNetworkId());

  const walletConfig = {
    networkId: getNetworkId(),
    indexerClientConnection: {
      indexerHttpUrl: config.indexer,
      indexerWsUrl: config.indexerWS,
    },
    provingServerUrl: new URL(config.proofServer),
    relayURL: new URL(config.node.replace(/^http(s)?/, 'ws$1')),
    costParameters: {
      additionalFeeOverhead: 300_000_000_000_000n,
      feeBlocksMargin: 5,
    },
    txHistoryStorage: new InMemoryTransactionHistoryStorage(),
  };

  const wallet = await WalletFacade.init({
    configuration: walletConfig,
    shielded: (cfg) => ShieldedWallet(cfg).startWithSecretKeys(shieldedSecretKeys),
    unshielded: (cfg) => UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
    dust: (cfg) =>
      DustWallet(cfg).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust),
  });

  await wallet.start(shieldedSecretKeys, dustSecretKey);

  logger.info('Syncing wallet with network...');
  await Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(5_000),
      Rx.filter((state) => state.isSynced),
    )
  );

  logger.info('Ensuring DUST is available...');
  await registerForDustGeneration(wallet, unshieldedKeystore);

  const walletProvider = await createWalletAndMidnightProvider(
    wallet,
    shieldedSecretKeys,
    dustSecretKey,
    unshieldedKeystore
  );

  const state = await Rx.firstValueFrom(wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  const unshieldedAddress = unshieldedKeystore.getBech32Address().toString();

  return {
    wallet,
    shieldedSecretKeys,
    dustSecretKey,
    unshieldedKeystore,
    walletProvider,
    seedHex,
    unshieldedAddress,
  };
};

export const assembleProviders = async (
  config: Config,
  walletContext: WalletContext
) => {
  const zkConfigProvider = new NodeZkConfigProvider(contractConfig.zkConfigPath);
  const proofProvider = httpClientProofProvider(config.proofServer, zkConfigProvider);
  const privateStateProvider = levelPrivateStateProvider({
    privateStateStoreName: contractConfig.privateStateStoreName,
    walletProvider: walletContext.walletProvider,
  } as any);

  return {
    zkConfigProvider,
    publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWS),
    proofProvider,
    privateStateProvider,
    walletProvider: walletContext.walletProvider,
    midnightProvider: walletContext.walletProvider,
  };
};
