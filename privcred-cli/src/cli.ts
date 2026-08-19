import readline from 'node:readline';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pino } from 'pino';
import pretty from 'pino-pretty';
import {
  buildHeadlessWallet,
  assembleProviders,
  deploy,
  registerIssuer,
  removeIssuer,
  anchorCredential,
  applyAndVerify,
  deriveAdminPk,
  deriveIssuerPk,
  deriveCandidatePk,
  computeCredentialCommitment,
  getContractLedgerData,
  setApiLogger,
} from './api.js';
import { PreprodConfig } from './config.js';
import { toHex, fromHex } from '@midnight-ntwrk/midnight-js-utils';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ----------------------------------------------------------------------------
// Setup Logger
// ----------------------------------------------------------------------------
const stream = (pretty as any)({
  colorize: true,
  ignore: 'pid,hostname',
  translateTime: 'SYS:standard',
});
const logger = pino({ level: 'info' }, stream);
setApiLogger(logger);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const question = (query: string): Promise<string> => {
  return new Promise((resolve) => rl.question(query, resolve));
};

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
const getOrGenerateSeed = async (): Promise<string> => {
  const customSeed = await question('Enter a 32-byte hex seed (press Enter to generate a new random seed): ');
  if (customSeed.trim()) {
    if (customSeed.length !== 64 || !/^[0-9a-fA-F]+$/.test(customSeed)) {
      throw new Error('Seed must be a 64-character hex string (32 bytes)');
    }
    return customSeed.trim();
  }
  const randomSeed = crypto.randomBytes(32).toString('hex');
  console.log(`\nGenerated random wallet seed (save this!): \x1b[36m${randomSeed}\x1b[0m\n`);
  return randomSeed;
};

const parseSecretKey = (input: string): Uint8Array => {
  const clean = input.trim();
  if (clean.length !== 64 || !/^[0-9a-fA-F]+$/.test(clean)) {
    throw new Error('Secret key must be a 64-character hex string (32 bytes)');
  }
  return fromHex(clean);
};

const parsePublicKey = (input: string): Uint8Array => {
  const clean = input.trim();
  if (clean.length !== 64 || !/^[0-9a-fA-F]+$/.test(clean)) {
    throw new Error('Public key must be a 64-character hex string (32 bytes)');
  }
  return fromHex(clean);
};

// ----------------------------------------------------------------------------
// CLI Modes
// ----------------------------------------------------------------------------
const showMainMenu = () => {
  console.log('\n======================================');
  console.log('       PRIVCRED INTERACTIVE CLI       ');
  console.log('======================================');
  console.log('1. Admin Dashboard');
  console.log('2. Issuer Dashboard');
  console.log('3. Candidate Dashboard');
  console.log('4. Employer Dashboard');
  console.log('5. View Contract Ledger Data');
  console.log('6. Exit');
  console.log('======================================');
};

const handleAdmin = async () => {
  console.log('\n--- Admin Dashboard ---');
  console.log('1. Derive Admin Public Key');
  console.log('2. Deploy PrivCred Contract');
  console.log('3. Register Trusted Issuer');
  console.log('4. Remove Trusted Issuer');
  console.log('5. Back to Main Menu');
  const choice = await question('Select an option (1-5): ');

  const config = new PreprodConfig();

  try {
    switch (choice.trim()) {
      case '1': {
        const skHex = await question('Enter admin secret key (32-byte hex): ');
        const sk = parseSecretKey(skHex);
        const pk = deriveAdminPk(sk);
        console.log(`\nDerived Admin Public Key: \x1b[32m${toHex(pk)}\x1b[0m\n`);
        break;
      }
      case '2': {
        const skHex = await question('Enter admin secret key (32-byte hex): ');
        const sk = parseSecretKey(skHex);
        const seed = await getOrGenerateSeed();
        console.log('Initializing wallet and funding checks (this may take a minute)...');
        const walletCtx = await buildHeadlessWallet(config, seed);
        const providers = await assembleProviders(config, walletCtx);
        console.log(`\nWallet unshielded address: ${walletCtx.unshieldedAddress}`);
        console.log('Deploying contract...');
        const contract = await deploy(providers, sk);
        console.log(`\nContract successfully deployed!`);
        console.log(`Address: \x1b[32m${contract.deployTxData.public.contractAddress}\x1b[0m\n`);
        break;
      }
      case '3': {
        const contractAddress = await question('Enter PrivCred contract address: ');
        const skHex = await question('Enter admin secret key (32-byte hex): ');
        const sk = parseSecretKey(skHex);
        const issuerPkHex = await question('Enter Trusted Issuer public key (32-byte hex): ');
        const issuerPk = parsePublicKey(issuerPkHex);
        const seed = await getOrGenerateSeed();

        console.log('Initializing wallet...');
        const walletCtx = await buildHeadlessWallet(config, seed);
        const providers = await assembleProviders(config, walletCtx);
        await registerIssuer(providers, contractAddress.trim(), sk, issuerPk);
        console.log('\n\x1b[32mIssuer successfully registered!\x1b[0m\n');
        break;
      }
      case '4': {
        const contractAddress = await question('Enter PrivCred contract address: ');
        const skHex = await question('Enter admin secret key (32-byte hex): ');
        const sk = parseSecretKey(skHex);
        const issuerPkHex = await question('Enter Trusted Issuer public key (32-byte hex): ');
        const issuerPk = parsePublicKey(issuerPkHex);
        const seed = await getOrGenerateSeed();

        console.log('Initializing wallet...');
        const walletCtx = await buildHeadlessWallet(config, seed);
        const providers = await assembleProviders(config, walletCtx);
        await removeIssuer(providers, contractAddress.trim(), sk, issuerPk);
        console.log('\n\x1b[32mIssuer successfully removed!\x1b[0m\n');
        break;
      }
      default:
        break;
    }
  } catch (error: any) {
    console.error(`\x1b[31mError: ${error.message}\x1b[0m`);
  }
};

const handleIssuer = async () => {
  console.log('\n--- Issuer Dashboard ---');
  console.log('1. Derive Issuer Public Key');
  console.log('2. Issue and Anchor Credential Commitment');
  console.log('3. Back to Main Menu');
  const choice = await question('Select an option (1-3): ');

  const config = new PreprodConfig();

  try {
    switch (choice.trim()) {
      case '1': {
        const skHex = await question('Enter issuer secret key (32-byte hex): ');
        const sk = parseSecretKey(skHex);
        const pk = deriveIssuerPk(sk);
        console.log(`\nDerived Issuer Public Key: \x1b[32m${toHex(pk)}\x1b[0m\n`);
        break;
      }
      case '2': {
        const contractAddress = await question('Enter PrivCred contract address: ');
        const skHex = await question('Enter issuer secret key (32-byte hex): ');
        const sk = parseSecretKey(skHex);
        const candidatePkHex = await question('Enter Candidate public key (32-byte hex): ');
        const candidatePk = parsePublicKey(candidatePkHex);

        console.log('\n--- Enter Credential Details ---');
        const degree = (await question('Degree Verified? (y/n): ')).toLowerCase() === 'y';
        const license = (await question('Professional License Active? (y/n): ')).toLowerCase() === 'y';
        const background = (await question('Clean Background Check? (y/n): ')).toLowerCase() === 'y';
        const gradeInput = await question('Degree/Performance Grade (integer e.g., GPA * 100 or test score): ');
        const grade = BigInt(gradeInput.trim() || '0');
        const ssn = await question('Candidate SSN or National ID (sensitive): ');
        
        // Compute SSN Hash
        const ssnHash = crypto.createHash('sha256').update(ssn).digest();
        const nonce = crypto.randomBytes(32);

        const credentialData = {
          candidatePk,
          degreeVerified: degree,
          licenseActive: license,
          backgroundClean: background,
          degreeGrade: grade,
          ssnHash: new Uint8Array(ssnHash),
        };

        console.log('Computing credential commitment off-chain...');
        const commitment = computeCredentialCommitment(credentialData, nonce);
        console.log(`Commitment generated: ${toHex(commitment)}`);

        const seed = await getOrGenerateSeed();
        console.log('Initializing wallet...');
        const walletCtx = await buildHeadlessWallet(config, seed);
        const providers = await assembleProviders(config, walletCtx);

        await anchorCredential(providers, contractAddress.trim(), sk, candidatePk, commitment);
        
        // Write the package JSON for the candidate
        const pkg = {
          credentialData: {
            candidatePk: toHex(candidatePk),
            degreeVerified: degree,
            licenseActive: license,
            backgroundClean: background,
            degreeGrade: grade.toString(),
            ssnHash: toHex(ssnHash),
          },
          credentialNonce: toHex(nonce),
          commitment: toHex(commitment),
        };
        const pkgPath = path.resolve(process.cwd(), `cred_${toHex(candidatePk).slice(0, 8)}.json`);
        await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2), 'utf-8');

        console.log(`\n\x1b[32mCredential commitment successfully anchored on-chain!\x1b[0m`);
        console.log(`Credential file generated: \x1b[36m${pkgPath}\x1b[0m`);
        console.log('Provide this file to the Candidate so they can selectively prove it.\n');
        break;
      }
      default:
        break;
    }
  } catch (error: any) {
    console.error(`\x1b[31mError: ${error.message}\x1b[0m`);
  }
};

const handleCandidate = async () => {
  console.log('\n--- Candidate Dashboard ---');
  console.log('1. Derive Candidate Public Key');
  console.log('2. Apply for Job (Selective Disclosure Proof)');
  console.log('3. Back to Main Menu');
  const choice = await question('Select an option (1-3): ');

  const config = new PreprodConfig();

  try {
    switch (choice.trim()) {
      case '1': {
        const skHex = await question('Enter candidate secret key (32-byte hex): ');
        const sk = parseSecretKey(skHex);
        const pk = deriveCandidatePk(sk);
        console.log(`\nDerived Candidate Public Key: \x1b[32m${toHex(pk)}\x1b[0m\n`);
        break;
      }
      case '2': {
        const contractAddress = await question('Enter PrivCred contract address: ');
        const skHex = await question('Enter candidate secret key (32-byte hex): ');
        const sk = parseSecretKey(skHex);
        const employerPkHex = await question('Enter Employer public key (32-byte hex): ');
        const employerPk = parsePublicKey(employerPkHex);
        
        const pkgPath = await question('Enter path to your credential JSON file: ');
        const pkgRaw = await fs.readFile(pkgPath.trim(), 'utf-8');
        const pkg = JSON.parse(pkgRaw);

        // Load credential fields
        const credentialData = {
          candidatePk: fromHex(pkg.credentialData.candidatePk),
          degreeVerified: pkg.credentialData.degreeVerified,
          licenseActive: pkg.credentialData.licenseActive,
          backgroundClean: pkg.credentialData.backgroundClean,
          degreeGrade: BigInt(pkg.credentialData.degreeGrade),
          ssnHash: fromHex(pkg.credentialData.ssnHash),
        };
        const credentialNonce = fromHex(pkg.credentialNonce);

        console.log('\n--- Enter Job Application Requirements ---');
        const reqDegree = (await question('Require Degree? (y/n): ')).toLowerCase() === 'y';
        const reqLicense = (await question('Require Professional License? (y/n): ')).toLowerCase() === 'y';
        const reqBackground = (await question('Require Clean Background Check? (y/n): ')).toLowerCase() === 'y';
        const minGradeInput = await question('Minimum Grade required (e.g. GPA * 100 or test score): ');
        const minGrade = BigInt(minGradeInput.trim() || '0');

        const requirements = {
          requireDegree: reqDegree,
          requireLicense: reqLicense,
          requireBackground: reqBackground,
          minGrade,
        };

        const seed = await getOrGenerateSeed();
        console.log('Initializing wallet & preparing ZK proving engine...');
        const walletCtx = await buildHeadlessWallet(config, seed);
        const providers = await assembleProviders(config, walletCtx);

        console.log('Submitting verification proof to Preprod (ZKP generated locally)...');
        await applyAndVerify(
          providers,
          contractAddress.trim(),
          sk,
          employerPk,
          credentialData,
          credentialNonce,
          requirements
        );

        console.log('\n\x1b[32mProof successfully verified on-chain! Application status set to Verified.\x1b[0m\n');
        break;
      }
      default:
        break;
    }
  } catch (error: any) {
    console.error(`\x1b[31mError: ${error.message}\x1b[0m`);
  }
};

const handleEmployer = async () => {
  console.log('\n--- Employer Dashboard ---');
  console.log('1. Verify Candidate Application Status');
  console.log('2. Back to Main Menu');
  const choice = await question('Select an option (1-2): ');

  const config = new PreprodConfig();

  try {
    if (choice.trim() === '1') {
      const contractAddress = await question('Enter PrivCred contract address: ');
      const employerPkHex = await question('Enter your Employer public key (32-byte hex): ');
      const employerPk = parsePublicKey(employerPkHex);
      const candidatePkHex = await question('Enter Candidate public key (32-byte hex): ');
      const candidatePk = parsePublicKey(candidatePkHex);

      console.log('Fetching ledger verification data from indexer...');
      const ledger = await getContractLedgerData(config.indexer, contractAddress.trim());
      if (!ledger) {
        console.log('\x1b[31mCould not fetch contract state. Ensure contract address is correct.\x1b[0m');
        return;
      }

      // Read state
      const empMap = ledger.applications.lookup(employerPk);
      if (!empMap || !empMap.member(candidatePk)) {
        console.log('\nVerification Status: \x1b[33mNot Applied / Unverified\x1b[0m');
        console.log('The candidate has not verified their credentials for your public key.\n');
      } else {
        const statusVal = empMap.lookup(candidatePk);
        // Map enum index to string (0 = Applied, 1 = Verified, 2 = Rejected)
        const statusStr = statusVal === 1n || statusVal === 1 ? 'Verified' : statusVal === 2n || statusVal === 2 ? 'Rejected' : 'Applied';
        const color = statusStr === 'Verified' ? '\x1b[32m' : '\x1b[31m';
        console.log(`\nVerification Status: ${color}${statusStr}\x1b[0m`);
        console.log(`This candidate has proved in zero-knowledge that they meet your requirements.\n`);
      }
    }
  } catch (error: any) {
    console.error(`\x1b[31mError: ${error.message}\x1b[0m`);
  }
};

const handleViewLedger = async () => {
  const contractAddress = await question('Enter PrivCred contract address: ');
  const config = new PreprodConfig();
  console.log('Fetching contract ledger state...');
  try {
    const state = await getContractLedgerData(config.indexer, contractAddress.trim());
    if (!state) {
      console.log('\x1b[31mContract not found or no state available.\x1b[0m');
      return;
    }
    console.log('\n======================================');
    console.log(`Contract: ${contractAddress.trim()}`);
    console.log(`Admin PK: ${state.admin}`);
    console.log('======================================');
    console.log(`Issuers (Map count): ${state.issuers.size}`);
    console.log(`Credential Commitments (Map count): ${state.credentialCommitments.size}`);
    console.log(`Applications (Map count): ${state.applications.size}`);
    console.log('======================================\n');
  } catch (error: any) {
    console.error(`\x1b[31mError: ${error.message}\x1b[0m`);
  }
};

// ----------------------------------------------------------------------------
// Main Loop
// ----------------------------------------------------------------------------
const main = async () => {
  let exit = false;
  while (!exit) {
    showMainMenu();
    const choice = await question('Select an option (1-6): ');
    switch (choice.trim()) {
      case '1':
        await handleAdmin();
        break;
      case '2':
        await handleIssuer();
        break;
      case '3':
        await handleCandidate();
        break;
      case '4':
        await handleEmployer();
        break;
      case '5':
        await handleViewLedger();
        break;
      case '6':
        exit = true;
        break;
      default:
        console.log('Invalid choice. Select 1-6.');
        break;
    }
  }
  rl.close();
  console.log('Goodbye!');
};

main();
