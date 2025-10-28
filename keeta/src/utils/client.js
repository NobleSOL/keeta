// src/utils/client.js
import * as KeetaNet from '@keetanetwork/keetanet-client';
import { CONFIG, seedFromHexEnv, cacheDecimals, getCachedDecimals } from './constants.js';

let opsClient = null;
let treasuryAccount = null;
let opsAccount = null;

/**
 * Initialize and return a singleton UserClient for operations
 */
export async function getOpsClient() {
  if (!opsClient) {
    const opsSeed = seedFromHexEnv('OPS_SEED');
    opsAccount = KeetaNet.lib.Account.fromSeed(opsSeed, 0);
    opsClient = KeetaNet.UserClient.fromNetwork(CONFIG.NETWORK, opsAccount);
    console.log('✅ Ops client initialized:', opsAccount.publicKeyString.get());
  }
  return opsClient;
}

/**
 * Get the treasury account (for fee collection)
 */
export function getTreasuryAccount() {
  if (!treasuryAccount) {
    const treasurySeed = seedFromHexEnv('TREASURY_SEED');
    treasuryAccount = KeetaNet.lib.Account.fromSeed(treasurySeed, 0);
    console.log('✅ Treasury account loaded:', treasuryAccount.publicKeyString.get());
  }
  return treasuryAccount;
}

/**
 * Get the ops account
 */
export function getOpsAccount() {
  if (!opsAccount) {
    const opsSeed = seedFromHexEnv('OPS_SEED');
    opsAccount = KeetaNet.lib.Account.fromSeed(opsSeed, 0);
  }
  return opsAccount;
}

/**
 * Fetch token decimals from on-chain metadata
 */
export async function fetchTokenDecimals(tokenAddress) {
  // Check cache first
  const cached = getCachedDecimals(tokenAddress);
  if (cached !== undefined) return cached;

  try {
    const client = await getOpsClient();
    const tokenAccount = KeetaNet.lib.Account.fromPublicKeyString(tokenAddress);
    const info = await client.getAccountInfo(tokenAccount);
    
    if (info?.info?.metadata) {
      const metaObj = JSON.parse(
        Buffer.from(info.info.metadata, 'base64').toString()
      );
      const decimals = Number(metaObj.decimalPlaces || 9);
      cacheDecimals(tokenAddress, decimals);
      return decimals;
    }
  } catch (err) {
    console.warn(`⚠️ Could not fetch decimals for ${tokenAddress}:`, err.message);
  }
  
  // Default to 9 (KTA standard)
  cacheDecimals(tokenAddress, 9);
  return 9;
}

/**
 * Get all balances for an account
 */
export async function getBalances(accountOrAddress) {
  const client = await getOpsClient();
  
  let account;
  if (typeof accountOrAddress === 'string') {
    account = KeetaNet.lib.Account.fromPublicKeyString(accountOrAddress);
  } else {
    account = accountOrAddress;
  }
  
  const rawBalances = await client.allBalances({ account });
  
  return rawBalances.map((b) => ({
    token: b.token.publicKeyString?.toString() ?? b.token.toString(),
    balance: BigInt(b.balance ?? 0n),
  }));
}

/**
 * Get specific token balance for an account
 */
export async function getTokenBalance(accountAddress, tokenAddress) {
  const balances = await getBalances(accountAddress);
  const balance = balances.find((b) => b.token === tokenAddress);
  return balance?.balance ?? 0n;
}

/**
 * Create a new storage account for a pool
 */
export async function createStorageAccount(name, description) {
  const client = await getOpsClient();
  const ops = getOpsAccount();
  const treasury = getTreasuryAccount();
  
  const builder = client.initBuilder();
  
  // Generate new storage account
  const pending = builder.generateIdentifier(
    KeetaNet.lib.Account.AccountKeyAlgorithm.STORAGE
  );
  await builder.computeBlocks();
  
  const storageAccount = pending.account;
  const marketId = storageAccount.publicKeyString.toString();
  
  // Check if ops and treasury are the same account
  const opsAddress = ops.publicKeyString.get();
  const treasuryAddress = treasury.publicKeyString.get();
  const sameAccount = opsAddress === treasuryAddress;

  if (sameAccount) {
    // When ops and treasury are same: use defaults for tokens, grant OWNER to ops
    builder.setInfo(
      {
        name,
        description,
        metadata: '',
        defaultPermission: new KeetaNet.lib.Permissions([
          'ACCESS',
          'STORAGE_CAN_HOLD',
          'STORAGE_DEPOSIT',
        ]),
      },
      { account: storageAccount }
    );

    // Grant OWNER to ops account (overrides default for this account)
    builder.updatePermissions(
      ops,
      new KeetaNet.lib.Permissions([
        'OWNER',
        'SEND_ON_BEHALF',
      ]),
      undefined,
      undefined,
      { account: storageAccount }
    );
  } else {
    // When different accounts: set defaults and grant specific permissions
    builder.setInfo(
      {
        name,
        description,
        metadata: '',
        defaultPermission: new KeetaNet.lib.Permissions([
          'ACCESS',
          'STORAGE_CAN_HOLD',
          'STORAGE_DEPOSIT',
        ]),
      },
      { account: storageAccount }
    );

    // Grant permissions to ops account
    builder.updatePermissions(
      ops,
      new KeetaNet.lib.Permissions([
        'OWNER',
        'SEND_ON_BEHALF',
        'STORAGE_DEPOSIT',
      ]),
      undefined,
      undefined,
      { account: storageAccount }
    );

    // Grant permissions to treasury for fee collection
    builder.updatePermissions(
      treasury,
      new KeetaNet.lib.Permissions([
        'ACCESS',
        'STORAGE_CAN_HOLD',
      ]),
      undefined,
      undefined,
      { account: storageAccount }
    );
  }
  
  await client.publishBuilder(builder);
  
  return marketId;
}

/**
 * Create a new token account (for LP tokens)
 */
export async function createTokenAccount(symbol, name, decimals = 9, initialSupply = 0n) {
  const client = await getOpsClient();
  const ops = getOpsAccount();

  const builder = client.initBuilder();

  // Generate new token account
  const pending = builder.generateIdentifier(
    KeetaNet.lib.Account.AccountKeyAlgorithm.STORAGE
  );
  await builder.computeBlocks();

  const tokenAccount = pending.account;
  const tokenAddress = tokenAccount.publicKeyString.toString();

  // Create token metadata
  const metadata = {
    name,
    symbol,
    decimalPlaces: decimals,
    description: name,
  };

  // Set token info with metadata
  builder.setInfo(
    {
      name: symbol,
      description: name,
      metadata: Buffer.from(JSON.stringify(metadata)).toString('base64'),
      defaultPermission: new KeetaNet.lib.Permissions([
        'ACCESS',
        'STORAGE_CAN_HOLD',
        'STORAGE_DEPOSIT',
      ]),
    },
    { account: tokenAccount }
  );

  // Grant OWNER permissions to ops account
  builder.updatePermissions(
    ops,
    new KeetaNet.lib.Permissions([
      'OWNER',
      'SEND_ON_BEHALF',
    ]),
    undefined,
    undefined,
    { account: tokenAccount }
  );

  await client.publishBuilder(builder);

  console.log(`✅ Token created: ${symbol} at ${tokenAddress}`);

  return tokenAddress;
}

/**
 * Helper to create Account objects from addresses
 */
export function accountFromAddress(address) {
  return KeetaNet.lib.Account.fromPublicKeyString(address);
}

export { KeetaNet };
