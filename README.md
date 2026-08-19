# PrivCred: Privacy-Preserving Professional Credential Verification DApp

PrivCred is a decentralized application (dApp) built on the Midnight Network (Preprod). It allows candidates (job seekers or contractors) to prove they meet specific employment requirements (e.g., degree verification, active license, or clean background check) to potential employers without revealing sensitive personally identifiable information (PII) like exact grades, social security numbers, or dates of birth.

---

## 1. Privacy Boundary & Architecture

Midnight uses a dual-state model separating the public ledger (on-chain) from the private wallet state (off-chain, client-side).

| Data Layer | Location | Visibility | Purpose |
|---|---|---|---|
| **Raw Candidate Data** (degree, grades, license number, SSN) | Private state / local JSON | **Private** (never leaves candidate's machine) | Used to generate the zero-knowledge proofs. |
| **Commitment Hash** (`persistentCommit(data, nonce)`) | Public Ledger Map | **Public** (anchored by trusted issuer) | Serves as the cryptographic anchor for the ZK proof. |
| **Issuer Registry** | Public Ledger Map | **Public** | Authorizes trusted institutions to anchor credentials. |
| **Verification Outcome** (e.g., `Verified`) | Public Ledger Map | **Public** | Employer reads this on-chain to trustlessly verify compliance. |

The candidate generates a ZK proof client-side verifying:
1. They hold a credential whose commitment hash matches the on-chain value anchored by a trusted issuer.
2. The credential meets the employer's specific criteria (e.g. `degreeVerified == true` and `degreeGrade >= minGrade`).
3. The candidate secret key corresponds to the candidate public key bound to the credential.

---

## 2. Setup & Installation

### Prerequisites
- Node.js **>= 22.0.0** (required for iterator helpers on Map.values() in the Shielded Wallet SDK)
- Yarn **1.x** (classic) or npm
- Docker (to run the local proof server)

### Install Dependencies
Run the following command at the root of the project to install all monorepo dependencies:
```bash
npm install
# OR
yarn install
```

---

## 3. Compiling the Smart Contract (Compact)

Because the Compact compiler does not run natively on Windows, you must compile it using either **WSL2** or a transient **Docker container**.

### Option A: Compile using Docker (Recommended for Windows)
Run a temporary Linux container that installs the compiler and builds the contract:
```bash
docker run --rm -v "%cd%:/workspace" -w /workspace ubuntu:24.04 bash -c "
  apt-get update && apt-get install -y curl && \
  curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh && \
  export PATH=\"/root/.local/bin:\$PATH\" && \
  compact update && \
  cd contract && \
  compact compile src/privcred.compact src/managed/privcred
"
```

### Option B: Compile in WSL2 (Ubuntu)
Inside your WSL2 terminal, run:
```bash
# 1. Install Compact CLI
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
source ~/.bashrc

# 2. Update compiler to latest version
compact update

# 3. Compile the contract
cd contract
npm run compact
```

---

## 4. Run the Proving Server

The Midnight wallet requires a proof server to generate zero-knowledge proofs. Start the Preprod proof server locally via Docker:

```bash
docker run -d -p 6300:6300 midnightntwrk/proof-server:8.0.3 -- midnight-proof-server --network preprod
```

Verify that the proof server is running by opening `http://localhost:6300` in your browser.

---

## 5. Running the Interactive CLI

Copy the environment file template and configure your parameters:
```bash
cp .env.example .env
```

Start the interactive CLI:
```bash
npm run start --workspace=privcred-cli
# OR
cd privcred-cli
npm start
```

### Interactive Flow Step-by-Step

#### Step 1: Admin Dashboard
1. Choose **Admin Dashboard** -> **Derive Admin Public Key** using a 32-byte secret key (e.g. `0101010101010101010101010101010101010101010101010101010101010101`).
2. Choose **Deploy PrivCred Contract**. Enter the admin secret key. This will deploy the contract to Preprod and print the contract address.
3. Choose **Register Trusted Issuer**. Input the contract address and the Trusted Issuer's public key to authorize them.

#### Step 2: Issuer Dashboard
1. Choose **Issuer Dashboard** -> **Derive Issuer Public Key** using the issuer's secret key. Note this public key (give it to the Admin to register).
2. Choose **Issue and Anchor Credential Commitment**. Input the contract address, the Candidate's public key, and the credential values:
   - Degree Verified: `y`
   - License Active: `y`
   - Background Clean: `y`
   - Grade: `85`
   - SSN: `123-456-7890`
3. This creates a commitment hash on-chain and generates a local JSON file named `cred_<candidate_pk_prefix>.json` containing the credentials and commitment nonce. Send this file to the Candidate.

#### Step 3: Candidate Dashboard
1. Choose **Candidate Dashboard** -> **Derive Candidate Public Key** using your candidate secret key. Give this public key to the Issuer.
2. Choose **Apply for Job**. Input the contract address, the Employer's public key, the path to the credentials JSON file, and the requirements of the job.
3. The CLI will generate a ZK proof locally and submit it to Preprod on-chain.

#### Step 4: Employer Dashboard
1. Choose **Employer Dashboard** -> **Verify Candidate Application Status**.
2. Input the contract address, your Employer public key, and the Candidate's public key.
3. The CLI will query the indexer and output `Verified` if the ZK proof was successfully posted.