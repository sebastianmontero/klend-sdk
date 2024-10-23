import {
  AccountInfo,
  Connection,
  GetProgramAccountsResponse,
  Keypair,
  ParsedAccountData,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  KaminoVault,
  KaminoVaultClient,
  KaminoVaultConfig,
  kaminoVaultId,
  ReserveAllocationConfig,
  ReserveOverview,
  VaultHolder,
  VaultHoldings,
  VaultHoldingsWithUSDValue,
} from './vault';
import {
  AddAssetToMarketParams,
  CreateKaminoMarketParams,
  createReserveIxs,
  DEFAULT_RECENT_SLOT_DURATION_MS,
  ENV,
  getReserveOracleConfigs,
  initLendingMarket,
  InitLendingMarketAccounts,
  InitLendingMarketArgs,
  KaminoReserve,
  LendingMarket,
  lendingMarketAuthPda,
  MarketWithAddress,
  parseForChangesReserveConfigAndGetIxs,
  parseOracleType,
  PubkeyHashMap,
  Reserve,
  ReserveWithAddress,
  sameLengthArrayEquals,
  ScopeOracleConfig,
  updateEntireReserveConfigIx,
  updateLendingMarket,
  UpdateLendingMarketAccounts,
  UpdateLendingMarketArgs,
  updateLendingMarketOwner,
  UpdateLendingMarketOwnerAccounts,
} from '../lib';
import { PROGRAM_ID } from '../idl_codegen/programId';
import { Scope, TokenMetadatas, U16_MAX } from '@kamino-finance/scope-sdk';
import BN from 'bn.js';
import { ElevationGroup, ReserveConfig, UpdateLendingMarketMode } from '../idl_codegen/types';
import Decimal from 'decimal.js';
import * as anchor from '@coral-xyz/anchor';
import { VaultState } from '../idl_codegen_kamino_vault/accounts';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Data } from '@kamino-finance/kliquidity-sdk';
import bs58 from 'bs58';
import { getProgramAccounts } from '../utils/rpc';
import { VaultConfigFieldKind } from '../idl_codegen_kamino_vault/types';

/**
 * KaminoManager is a class that provides a high-level interface to interact with the Kamino Lend and Kamino Vault programs, in order to create and manage a market, as well as vaults
 */
export class KaminoManager {
  private readonly _connection: Connection;
  private readonly _kaminoVaultProgramId: PublicKey;
  private readonly _kaminoLendProgramId: PublicKey;
  private readonly _vaultClient: KaminoVaultClient;
  recentSlotDurationMs: number;

  constructor(
    connection: Connection,
    kaminoLendProgramId?: PublicKey,
    kaminoVaultProgramId?: PublicKey,
    recentSlotDurationMs?: number
  ) {
    this._connection = connection;
    this._kaminoVaultProgramId = kaminoVaultProgramId ? kaminoVaultProgramId : kaminoVaultId;
    this._kaminoLendProgramId = kaminoLendProgramId ? kaminoLendProgramId : PROGRAM_ID;
    this.recentSlotDurationMs = recentSlotDurationMs ? recentSlotDurationMs : DEFAULT_RECENT_SLOT_DURATION_MS;
    this._vaultClient = new KaminoVaultClient(
      connection,
      this._kaminoVaultProgramId,
      this._kaminoLendProgramId,
      this.recentSlotDurationMs
    );
  }

  getConnection() {
    return this._connection;
  }

  getProgramID() {
    return this._kaminoVaultProgramId;
  }

  /**
   * This is a function that helps quickly setting up a reserve for an asset with a default config. The config can be modified later on.
   * @param params.admin - the admin of the market
   * @returns market keypair - keypair used for market account creation -> to be signed with when executing the transaction
   * @returns ixns - an array of ixns for creating and initializing the market account
   */
  async createMarketIxs(
    params: CreateKaminoMarketParams
  ): Promise<{ market: Keypair; ixns: TransactionInstruction[] }> {
    const marketAccount = Keypair.generate();
    const size = LendingMarket.layout.span + 8;
    const [lendingMarketAuthority, _] = lendingMarketAuthPda(marketAccount.publicKey, this._kaminoLendProgramId);
    const createMarketIxns: TransactionInstruction[] = [];

    createMarketIxns.push(
      SystemProgram.createAccount({
        fromPubkey: params.admin,
        newAccountPubkey: marketAccount.publicKey,
        lamports: await this._connection.getMinimumBalanceForRentExemption(size),
        space: size,
        programId: this._kaminoLendProgramId,
      })
    );

    const accounts: InitLendingMarketAccounts = {
      lendingMarketOwner: params.admin,
      lendingMarket: marketAccount.publicKey,
      lendingMarketAuthority: lendingMarketAuthority,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    };

    const args: InitLendingMarketArgs = {
      quoteCurrency: Array(32).fill(0),
    };

    createMarketIxns.push(initLendingMarket(args, accounts, this._kaminoLendProgramId));

    return { market: marketAccount, ixns: createMarketIxns };
  }

  /**
   * This is a function that helps quickly setting up a reserve for an asset with a default config. The config can be modified later on.
   * @param params.admin - the admin of the reserve
   * @param params.marketAddress - the market to create a reserve for, only the market admin can create a reserve for the market
   * @param params.assetConfig - an object that helps generate a default reserve config with some inputs which have to be configured before calling this function
   * @returns reserve - keypair used for reserve creation -> to be signed with when executing the transaction
   * @returns txnIxns - an array of arrays of ixns -> first array for reserve creation, second for updating it with correct params
   */
  async addAssetToMarketIxs(
    params: AddAssetToMarketParams
  ): Promise<{ reserve: Keypair; txnIxns: TransactionInstruction[][] }> {
    const market = await LendingMarket.fetch(this._connection, params.marketAddress, this._kaminoLendProgramId);
    if (!market) {
      throw new Error('Market not found');
    }
    const marketWithAddress: MarketWithAddress = { address: params.marketAddress, state: market };

    const reserveAccount = Keypair.generate();

    const createReserveInstructions = await createReserveIxs(
      this._connection,
      params.admin,
      params.marketAddress,
      params.assetConfig.mint,
      reserveAccount.publicKey,
      this._kaminoLendProgramId
    );

    const updateReserveInstructions = await this.updateReserveIxs(
      marketWithAddress,
      reserveAccount.publicKey,
      params.assetConfig.getReserveConfig(),
      undefined,
      true
    );

    const txnIxns: TransactionInstruction[][] = [];
    txnIxns.push(createReserveInstructions);
    txnIxns.push(updateReserveInstructions);

    return { reserve: reserveAccount, txnIxns };
  }

  /**
   * This method will create a vault with a given config. The config can be changed later on, but it is recommended to set it up correctly from the start
   * @param vaultConfig - the config object used to create a vault
   * @returns vault - keypair, should be used to sign the transaction which creates the vault account
   * @returns ixns - an array of instructions to create the vault
   */
  async createVaultIxs(vaultConfig: KaminoVaultConfig): Promise<{ vault: Keypair; ixns: TransactionInstruction[] }> {
    return this._vaultClient.createVaultIxs(vaultConfig);
  }

  /**
   * This method updates the vault reserve allocation cofnig for an exiting vault reserve, or adds a new reserve to the vault if it does not exist.
   * @param vault - vault to be updated
   * @param reserveAllocationConfig - new reserve allocation config
   * @returns - a list of instructions
   */
  async updateVaultReserveAllocationIxs(
    vault: KaminoVault,
    reserveAllocationConfig: ReserveAllocationConfig
  ): Promise<TransactionInstruction> {
    return this._vaultClient.updateReserveAllocationIxs(vault, reserveAllocationConfig);
  }

  // async closeVault(vault: KaminoVault): Promise<TransactionInstruction> {
  //   return this._vaultClient.closeVaultIx(vault);
  // }

  /**
   * This method retruns the reserve config for a given reserve
   * @param reserve - reserve to get the config for
   * @returns - the reserve config
   */
  async getReserveConfig(reserve: PublicKey): Promise<ReserveConfig> {
    const reserveState = await Reserve.fetch(this._connection, reserve);
    if (!reserveState) {
      throw new Error('Reserve not found');
    }
    return reserveState.config;
  }

  /**
   * This function enables the update of the scope oracle configuration. In order to get a list of scope prices, getScopeOracleConfigs can be used
   * @param market - lending market which owns the reserve
   * @param reserve - reserve which to be updated
   * @param scopeOracleConfig - new scope oracle config
   * @param scopeTwapConfig - new scope twap config
   * @param maxAgeBufferSeconds - buffer to be added to onchain max_age - if oracle price is older than that, txns interacting with the reserve will fail
   * @returns - an array of instructions used update the oracle configuration
   */
  async updateReserveScopeOracleConfigurationIxs(
    market: MarketWithAddress,
    reserve: ReserveWithAddress,
    scopeOracleConfig: ScopeOracleConfig,
    scopeTwapConfig?: ScopeOracleConfig,
    maxAgeBufferSeconds: number = 20
  ): Promise<TransactionInstruction[]> {
    const reserveConfig = reserve.state.config;

    let scopeTwapId = U16_MAX;
    if (scopeTwapConfig) {
      scopeTwapId = scopeTwapConfig.oracleId;

      // if(scopeTwapConfig.twapSourceId !== scopeOracleConfig.oracleId) {
      //   throw new Error('Twap source id must match oracle id');
      // }
    }

    const { scopeConfiguration } = getReserveOracleConfigs({
      scopePriceConfigAddress: scopeOracleConfig.scopePriceConfigAddress,
      scopeChain: [scopeOracleConfig.oracleId],
      scopeTwapChain: [scopeTwapId],
    });

    const newReserveConfig = new ReserveConfig({
      ...reserveConfig,
      tokenInfo: {
        ...reserveConfig.tokenInfo,
        scopeConfiguration: scopeConfiguration,
        // TODO: Decide if we want to keep this maxAge override for twap & price
        maxAgeTwapSeconds: scopeTwapConfig
          ? new BN(scopeTwapConfig.max_age + maxAgeBufferSeconds)
          : reserveConfig.tokenInfo.maxAgeTwapSeconds,
        maxAgePriceSeconds: new BN(scopeOracleConfig.max_age + maxAgeBufferSeconds),
      },
    });

    return this.updateReserveIxs(market, reserve.address, newReserveConfig, reserve.state);
  }

  /**
   * This function updates the given reserve with a new config. It can either update the entire reserve config or just update fields which differ between given reserve and existing reserve
   * @param marketWithAddress - the market that owns the reserve to be updated
   * @param reserve - the reserve to be updated
   * @param config - the new reserve configuration to be used for the update
   * @param reserveStateOverride - the reserve state, useful to provide, if already fetched outside this method, in order to avoid an extra rpc call to fetch it. Make sure the reserveConfig has not been updated since fetching the reserveState that you pass in.
   * @param updateEntireConfig - when set to false, it will only update fields that are different between @param config and reserveState.config, set to true it will always update entire reserve config. An entire reserveConfig update might be too large for a multisig transaction
   * @returns - an array of multiple update ixns. If there are many fields that are being updated without the updateEntireConfig=true, multiple transactions might be required to fit all ixns.
   */
  async updateReserveIxs(
    marketWithAddress: MarketWithAddress,
    reserve: PublicKey,
    config: ReserveConfig,
    reserveStateOverride?: Reserve,
    updateEntireConfig: boolean = false
  ): Promise<TransactionInstruction[]> {
    const reserveState = reserveStateOverride
      ? reserveStateOverride
      : (await Reserve.fetch(this._connection, reserve, this._kaminoLendProgramId))!;
    const ixns: TransactionInstruction[] = [];

    if (!reserveState || updateEntireConfig) {
      ixns.push(updateEntireReserveConfigIx(marketWithAddress, reserve, config, this._kaminoLendProgramId));
    } else {
      ixns.push(
        ...parseForChangesReserveConfigAndGetIxs(
          marketWithAddress,
          reserveState,
          reserve,
          config,
          this._kaminoLendProgramId
        )
      );
    }

    return ixns;
  }

  /**
   * This function creates instructions to deposit into a vault. It will also create ATA creation instructions for the vault shares that the user receives in return
   * @param user - user to deposit
   * @param vault - vault to deposit into
   * @param tokenAmount - token amount to be deposited, in decimals (will be converted in lamports)
   * @returns - an array of instructions to be used to be executed
   */
  async depositToVaultIxs(
    user: PublicKey,
    vault: KaminoVault,
    tokenAmount: Decimal
  ): Promise<TransactionInstruction[]> {
    return this._vaultClient.depositIxs(user, vault, tokenAmount);
  }

  async updateVaultConfigIx(
    vault: KaminoVault,
    mode: VaultConfigFieldKind,
    value: string
  ): Promise<TransactionInstruction> {
    return this._vaultClient.updateVaultConfigIx(vault, mode, value);
  }

  /**
   * This function creates the instruction for the `pendingAdmin` of the vault to accept to become the owner of the vault (step 2/2 of the ownership transfer)
   * @param vault - vault to change the ownership for
   * @returns - an instruction to be used to be executed
   */
  async acceptVaultOwnershipIx(vault: KaminoVault): Promise<TransactionInstruction> {
    return this._vaultClient.acceptVaultOwnershipIx(vault);
  }

  /**
   * This function creates the instruction for the admin to give up a part of the pending fees (which will be accounted as part of the vault)
   * @param vault - vault to give up pending fees for
   * @param maxAmountToGiveUp - the maximum amount of fees to give up, in tokens
   * @returns - an instruction to be used to be executed
   */
  async giveUpPendingFeesIx(vault: KaminoVault, maxAmountToGiveUp: Decimal): Promise<TransactionInstruction> {
    return this._vaultClient.giveUpPendingFeesIx(vault, maxAmountToGiveUp);
  }

  /**
   * This function will return the missing ATA creation instructions, as well as one or multiple withdraw instructions, based on how many reserves it's needed to withdraw from. This might have to be split in multiple transactions
   * @param user - user to withdraw
   * @param vault - vault to withdraw from
   * @param shareAmount - share amount to withdraw, in order to withdraw everything, any value > user share amount
   * @param slot - current slot, used to estimate the interest earned in the different reserves with allocation from the vault
   * @returns an array of instructions to be executed
   */
  async withdrawFromVaultIxs(
    user: PublicKey,
    vault: KaminoVault,
    shareAmount: Decimal,
    slot: number
  ): Promise<TransactionInstruction[]> {
    return this._vaultClient.withdrawIxs(user, vault, shareAmount, slot);
  }

  /**
   * This method withdraws all the pending fees from the vault to the owner's token ATA
   * @param vault - vault for which the admin withdraws the pending fees
   * @param slot - current slot, used to estimate the interest earned in the different reserves with allocation from the vault
   * @returns - list of instructions to withdraw all pending fees
   */
  async withdrawPendingFeesIxs(vault: KaminoVault, slot: number): Promise<TransactionInstruction[]> {
    return this._vaultClient.withdrawPendingFeesIxs(vault, slot);
  }

  /**
   * This method calculates the token per share value. This will always change based on interest earned from the vault, but calculating it requires a bunch of rpc requests. Caching this for a short duration would be optimal
   * @param vault - vault to calculate tokensPerShare for
   * @param slot - current slot, used to estimate the interest earned in the different reserves with allocation from the vault
   * @returns - token per share value
   */
  async getTokensPerShareSingleVault(vault: KaminoVault, slot: number): Promise<Decimal> {
    return this._vaultClient.getTokensPerShareSingleVault(vault, slot);
  }

  /**
   * This method calculates the price of one vault share(kToken)
   * @param vault - vault to calculate sharePrice for
   * @param slot - current slot, used to estimate the interest earned in the different reserves with allocation from the vault
   * @param tokenPrice - the price of the vault token (e.g. SOL) in USD
   * @returns - share value in USD
   */
  async getSharePriceInUSD(vault: KaminoVault, slot: number, tokenPrice: Decimal): Promise<Decimal> {
    const tokensPerShare = await this.getTokensPerShareSingleVault(vault, slot);
    return tokensPerShare.mul(tokenPrice);
  }

  /**
   * This method returns the user shares balance for a given vault
   * @param user - user to calculate the shares balance for
   * @param vault - vault to calculate shares balance for
   * @returns - user share balance in decimal (not lamports)
   */
  async getUserSharesBalanceSingleVault(user: PublicKey, vault: KaminoVault): Promise<Decimal> {
    return this._vaultClient.getUserSharesBalanceSingleVault(user, vault);
  }

  /**
   * This method returns the user shares balance for all existing vaults
   * @param user - user to calculate the shares balance for
   * @param vaultsOverride - the kamino vaults if already fetched, in order to reduce rpc calls
   * @returns - hash map with keyh as vault address and value as user share balance in decimal (not lamports)
   */
  async getUserSharesBalanceAllVaults(
    user: PublicKey,
    vaultsOverride: KaminoVault[]
  ): Promise<PubkeyHashMap<PublicKey, Decimal>> {
    return this._vaultClient.getUserSharesBalanceAllVaults(user, vaultsOverride);
  }

  /**
   * @returns - the KaminoVault client
   */
  getKaminoVaultClient(): KaminoVaultClient {
    return this._vaultClient;
  }

  /**
   * Get all vaults
   * @param useOptimisedRPCCall - if set to true, it will use the optimized getProgramAccounts RPC call, which is more efficient but doesn't work in web environments
   * @returns an array of all vaults
   */
  async getAllVaults(useOptimisedRPCCall: boolean = true): Promise<KaminoVault[]> {
    return this._vaultClient.getAllVaults(useOptimisedRPCCall);
  }

  /**
   * Get all vaults for owner
   * @param owner the pubkey of the vaults owner
   * @param useOptimisedRPCCall - if set to true, it will use the optimized getProgramAccounts RPC call, which is more efficient but doesn't work in web environments
   * @returns an array of all vaults owned by a given pubkey
   */
  async getAllVaultsForOwner(owner: PublicKey, useOptimisedRPCCall: boolean = true): Promise<KaminoVault[]> {
    const filters = [
      {
        dataSize: VaultState.layout.span + 8,
      },
      {
        memcmp: {
          offset: 0,
          bytes: bs58.encode(VaultState.discriminator),
        },
      },
      {
        memcmp: {
          offset: 8,
          bytes: owner.toBase58(),
        },
      },
    ];

    let kaminoVaults: GetProgramAccountsResponse = [];

    if (useOptimisedRPCCall) {
      kaminoVaults = await getProgramAccounts(this._connection, this._kaminoVaultProgramId, {
        commitment: this._connection.commitment ?? 'processed',
        filters,
      });
    } else {
      kaminoVaults = await this._connection.getProgramAccounts(this._kaminoVaultProgramId, { filters });
    }

    return kaminoVaults.map((kaminoVault) => {
      if (kaminoVault.account === null) {
        throw new Error(`kaminoVault with pubkey ${kaminoVault.pubkey.toString()} does not exist`);
      }

      const kaminoVaultAccount = VaultState.decode(kaminoVault.account.data);
      if (!kaminoVaultAccount) {
        throw Error(`kaminoVault with pubkey ${kaminoVault.pubkey.toString()} could not be decoded`);
      }

      return new KaminoVault(kaminoVault.pubkey, kaminoVaultAccount, this._kaminoVaultProgramId);
    });
  }

  /**
   * Get all token accounts that hold shares for a specific share mint
   * @param shareMint
   * @returns an array of all holders tokenAccounts pubkeys and their account info
   */
  async getShareTokenAccounts(
    shareMint: PublicKey
  ): Promise<{ pubkey: PublicKey; account: AccountInfo<Buffer | ParsedAccountData> }[]> {
    //how to get all token accounts for specific mint: https://spl.solana.com/token#finding-all-token-accounts-for-a-specific-mint
    //get it from the hardcoded token program and create a filter with the actual mint address
    //datasize:165 filter selects all token accounts, memcmp filter selects based on the mint address withing each token account
    return this._connection.getParsedProgramAccounts(TOKEN_PROGRAM_ID, {
      filters: [{ dataSize: 165 }, { memcmp: { offset: 0, bytes: shareMint.toBase58() } }],
    });
  }

  /**
   * Get all token accounts that hold shares for a specific vault; if you already have the vault state use it in the param so you don't have to fetch it again
   * @param vault
   * @returns an array of all holders tokenAccounts pubkeys and their account info
   */
  async getVaultTokenAccounts(
    vault: KaminoVault
  ): Promise<{ pubkey: PublicKey; account: AccountInfo<Buffer | ParsedAccountData> }[]> {
    const vaultState = await vault.getState(this._connection);
    return this.getShareTokenAccounts(vaultState.sharesMint);
  }

  /**
   * Get all vault token holders
   * @param vault
   * @returns an array of all vault holders with their pubkeys and amounts
   */
  getVaultHolders = async (vault: KaminoVault): Promise<VaultHolder[]> => {
    await vault.getState(this._connection);
    const tokenAccounts = await this.getVaultTokenAccounts(vault);
    const result: VaultHolder[] = [];
    for (const tokenAccount of tokenAccounts) {
      const accountData = tokenAccount.account.data as Data;
      result.push({
        holderPubkey: new PublicKey(accountData.parsed.info.owner),
        amount: new Decimal(accountData.parsed.info.tokenAmount.uiAmountString),
      });
    }
    return result;
  };

  /**
   * This will return an VaultHoldings object which contains the amount available (uninvested) in vault, total amount invested in reseves and a breakdown of the amount invested in each reserve
   * @param vault - the kamino vault to get available liquidity to withdraw for
   * @param slot - current slot
   * @param vaultReserves - optional parameter; a hashmap from each reserve pubkey to the reserve state. If provided the function will be significantly faster as it will not have to fetch the reserves
   * @returns an VaultHoldings object
   */
  async getVaultHoldings(
    vault: VaultState,
    slot: number,
    vaultReserves?: PubkeyHashMap<PublicKey, KaminoReserve>
  ): Promise<VaultHoldings> {
    return this._vaultClient.getVaultHoldings(vault, slot, vaultReserves);
  }

  /**
   * This will return an VaultHoldingsWithUSDValue object which contains an holdings field representing the amount available (uninvested) in vault, total amount invested in reseves and a breakdown of the amount invested in each reserve and additional fields for the total USD value of the available and invested amounts
   * @param vault - the kamino vault to get available liquidity to withdraw for
   * @param slot - current slot
   * @param vaultReserves - optional parameter; a hashmap from each reserve pubkey to the reserve state. If provided the function will be significantly faster as it will not have to fetch the reserves
   * @param price - the price of the token in the vault (e.g. USDC)
   * @returns an VaultHoldingsWithUSDValue object with details about the tokens available and invested in the vault, denominated in tokens and USD
   */
  async getVaultHoldingsWithPrice(
    vault: VaultState,
    slot: number,
    price: Decimal,
    vaultReserves?: PubkeyHashMap<PublicKey, KaminoReserve>
  ): Promise<VaultHoldingsWithUSDValue> {
    return this._vaultClient.getVaultHoldingsWithPrice(vault, slot, price, vaultReserves);
  }

  /**
   * This will return an overview of each reserve that is part of the vault allocation
   * @param vault - the kamino vault to get available liquidity to withdraw for
   * @param slot - current slot
   * @param vaultReserves - optional parameter; a hashmap from each reserve pubkey to the reserve state. If provided the function will be significantly faster as it will not have to fetch the reserves
   * @returns a hashmap from vault reserve pubkey to ReserveOverview object
   */
  async getVaultReservesDetails(
    vault: VaultState,
    slot: number,
    vaultReserves?: PubkeyHashMap<PublicKey, KaminoReserve>
  ): Promise<PubkeyHashMap<PublicKey, ReserveOverview>> {
    return this._vaultClient.getVaultReservesDetails(vault, slot, vaultReserves);
  }

  /**
   * This will return the APY of the vault under the assumption that all the available tokens in the vault are all the time invested in the reserves
   * @param vault - the kamino vault to get APY for
   * @param slot - current slot
   * @param vaultReserves - optional parameter; a hashmap from each reserve pubkey to the reserve state. If provided the function will be significantly faster as it will not have to fetch the reserves
   * @returns APY for the vault
   */
  async getVaultTheoreticalAPY(
    vault: VaultState,
    slot: number,
    vaultReserves?: PubkeyHashMap<PublicKey, KaminoReserve>
  ): Promise<Decimal> {
    return this._vaultClient.getVaultTheoreticalAPY(vault, slot, vaultReserves);
  }

  /**
   * Retrive the total amount of tokenes earned by the vault since its inception after deducting the management and performance fees
   * @param vaultState the kamino vault state to get total net yield for
   * @returns a decimal representing the net number of tokens earned by the vault since its inception after deducting the management and performance fees
   */
  async getVaultTotalNetYield(vaultState: VaultState) {
    return this._vaultClient.getVaultTotalNetYield(vaultState);
  }

  /**
   * This will load the onchain state for all the reserves that the vault has allocations for
   * @param vaultState - the vault state to load reserves for
   * @returns a hashmap from each reserve pubkey to the reserve state
   */
  async loadVaultReserves(vaultState: VaultState): Promise<PubkeyHashMap<PublicKey, KaminoReserve>> {
    return this._vaultClient.loadVaultReserves(vaultState);
  }

  /**
   * This will get the list of all reserve pubkeys that the vault has allocations for
   * @param vaultState - the vault state to load reserves for
   * @returns a hashmap from each reserve pubkey to the reserve state
   */
  getAllVaultReserves(vault: VaultState): PublicKey[] {
    return this._vaultClient.getAllVaultReserves(vault);
  }

  /**
   * This will load the onchain state for all the reserves that the vault has allocations for
   * @param vaultState - the vault state to load reserves for
   * @returns a hashmap from each reserve pubkey to the reserve state
   */
  getVaultReserves(vault: VaultState): PublicKey[] {
    return this._vaultClient.getVaultReserves(vault);
  }

  /**
   * This will trigger invest by balancing, based on weights, the reserve allocations of the vault. It can either withdraw or deposit into reserves to balance them. This is a function that should be cranked
   * @param kaminoVault - vault to invest from
   * @returns - an array of invest instructions for each invest action required for the vault reserves
   */
  async investAllReserves(payer: PublicKey, kaminoVault: KaminoVault): Promise<TransactionInstruction[]> {
    return this._vaultClient.investAllReservesIxs(payer, kaminoVault);
  }

  /**
   * This will trigger invest by balancing, based on weights, the reserve allocation of the vault. It can either withdraw or deposit into the given reserve to balance it
   * @param kaminoVault - vault to invest from
   * @param reserve - reserve to invest into or disinvest from
   * @returns - an array of invest instructions for each invest action required for the vault reserves
   */
  async investSingleReserve(
    payer: PublicKey,
    kaminoVault: KaminoVault,
    reserveWithAddress: ReserveWithAddress
  ): Promise<TransactionInstruction> {
    return this._vaultClient.investSingleReserveIxs(payer, kaminoVault, reserveWithAddress);
  }

  /**
   * This retruns an array of scope oracle configs to be used to set the scope price and twap oracles for a reserve
   * @param feed - scope feed to fetch prices from
   * @param cluster - cluster to fetch from, this should be left unchanged unless working on devnet or locally
   * @returns - an array of scope oracle configs
   */
  async getScopeOracleConfigs(
    feed: string = 'hubble',
    cluster: ENV = 'mainnet-beta'
  ): Promise<Array<ScopeOracleConfig>> {
    const scopeOracleConfigs: Array<ScopeOracleConfig> = [];

    const scope = new Scope(cluster, this._connection);
    const oracleMappings = await scope.getOracleMappings({ feed: feed });
    const [, feedConfig] = await scope.getFeedConfiguration({ feed: feed });
    const tokenMetadatas = await TokenMetadatas.fetch(this._connection, feedConfig.tokensMetadata);
    const decoder = new TextDecoder('utf-8');

    console.log('feedConfig.tokensMetadata', feedConfig.tokensMetadata);

    if (tokenMetadatas === null) {
      throw new Error('TokenMetadatas not found');
    }

    for (let index = 0; index < oracleMappings.priceInfoAccounts.length; index++) {
      if (!oracleMappings.priceInfoAccounts[index].equals(PublicKey.default)) {
        const name = decoder.decode(Uint8Array.from(tokenMetadatas.metadatasArray[index].name)).replace(/\0/g, '');
        const oracleType = parseOracleType(oracleMappings.priceTypes[index]);

        scopeOracleConfigs.push({
          scopePriceConfigAddress: feedConfig.oraclePrices,
          name: name,
          oracleType: oracleType,
          oracleId: index,
          oracleAccount: oracleMappings.priceInfoAccounts[index],
          twapEnabled: oracleMappings.twapEnabled[index] === 1,
          twapSourceId: oracleMappings.twapSource[index],
          max_age: tokenMetadatas.metadatasArray[index].maxAgePriceSlots.toNumber(),
        });
      }
    }

    return scopeOracleConfigs;
  }

  /**
   * This retruns an array of instructions to be used to update the lending market configurations
   * @param marketWithAddress - the market address and market state object
   * @param newMarket - the lending market state with the new configuration - to be build we new config options from the previous state
   * @returns - an array of instructions
   */
  updateLendingMarketIxs(marketWithAddress: MarketWithAddress, newMarket: LendingMarket): TransactionInstruction[] {
    return parseForChangesMarketConfigAndGetIxs(marketWithAddress, newMarket, this._kaminoLendProgramId);
  }

  /**
   * This retruns an instruction to be used to update the market owner. This can only be executed by the current lendingMarketOwnerCached
   * @param marketWithAddress - the market address and market state object
   * @param newMarket - the lending market state with the new configuration - to be build we new config options from the previous state
   * @returns - an array of instructions
   */
  updateLendingMarketOwnerIxs(marketWithAddress: MarketWithAddress): TransactionInstruction {
    const accounts: UpdateLendingMarketOwnerAccounts = {
      lendingMarketOwnerCached: marketWithAddress.state.lendingMarketOwnerCached,
      lendingMarket: marketWithAddress.address,
    };

    return updateLendingMarketOwner(accounts, this._kaminoLendProgramId);
  }
} // KaminoManager

function parseForChangesMarketConfigAndGetIxs(
  marketWithAddress: MarketWithAddress,
  newMarket: LendingMarket,
  programId: PublicKey
): TransactionInstruction[] {
  const market = marketWithAddress.state;
  const updateLendingMarketIxnsArgs: { mode: number; value: Buffer }[] = [];
  for (const key in market.toJSON()) {
    if (key === 'lendingMarketOwner') {
      if (!market.lendingMarketOwner.equals(newMarket.lendingMarketOwner)) {
        updateLendingMarketIxnsArgs.push({
          mode: UpdateLendingMarketMode.UpdateOwner.discriminator,
          value: updateMarketConfigEncodedValue(
            UpdateLendingMarketMode.UpdateOwner.discriminator,
            newMarket.lendingMarketOwner
          ),
        });
      }
    } else if (key === 'lendingMarketOwnerCached') {
      if (!market.lendingMarketOwnerCached.equals(newMarket.lendingMarketOwnerCached)) {
        updateLendingMarketIxnsArgs.push({
          mode: UpdateLendingMarketMode.UpdateOwner.discriminator,
          value: updateMarketConfigEncodedValue(
            UpdateLendingMarketMode.UpdateOwner.discriminator,
            newMarket.lendingMarketOwnerCached
          ),
        });
      }
    } else if (key === 'referralFeeBps') {
      if (market.referralFeeBps !== newMarket.referralFeeBps) {
        updateLendingMarketIxnsArgs.push({
          mode: UpdateLendingMarketMode.UpdateReferralFeeBps.discriminator,
          value: updateMarketConfigEncodedValue(
            UpdateLendingMarketMode.UpdateReferralFeeBps.discriminator,
            newMarket.referralFeeBps
          ),
        });
      }
    } else if (key === 'emergencyMode') {
      if (market.emergencyMode !== newMarket.emergencyMode) {
        updateLendingMarketIxnsArgs.push({
          mode: UpdateLendingMarketMode.UpdateEmergencyMode.discriminator,
          value: updateMarketConfigEncodedValue(
            UpdateLendingMarketMode.UpdateEmergencyMode.discriminator,
            newMarket.emergencyMode
          ),
        });
      }
    } else if (key === 'autodeleverageEnabled') {
      if (market.autodeleverageEnabled !== newMarket.autodeleverageEnabled) {
        updateLendingMarketIxnsArgs.push({
          mode: UpdateLendingMarketMode.UpdateAutodeleverageEnabled.discriminator,
          value: updateMarketConfigEncodedValue(
            UpdateLendingMarketMode.UpdateAutodeleverageEnabled.discriminator,
            newMarket.autodeleverageEnabled
          ),
        });
      }
    } else if (key === 'borrowDisabled') {
      if (market.borrowDisabled !== newMarket.borrowDisabled) {
        updateLendingMarketIxnsArgs.push({
          mode: UpdateLendingMarketMode.UpdateBorrowingDisabled.discriminator,
          value: updateMarketConfigEncodedValue(
            UpdateLendingMarketMode.UpdateBorrowingDisabled.discriminator,
            newMarket.borrowDisabled
          ),
        });
      }
    } else if (key === 'priceRefreshTriggerToMaxAgePct') {
      if (market.priceRefreshTriggerToMaxAgePct !== newMarket.priceRefreshTriggerToMaxAgePct) {
        updateLendingMarketIxnsArgs.push({
          mode: UpdateLendingMarketMode.UpdatePriceRefreshTriggerToMaxAgePct.discriminator,
          value: updateMarketConfigEncodedValue(
            UpdateLendingMarketMode.UpdatePriceRefreshTriggerToMaxAgePct.discriminator,
            newMarket.priceRefreshTriggerToMaxAgePct
          ),
        });
      }
    } else if (key === 'liquidationMaxDebtCloseFactorPct') {
      if (market.liquidationMaxDebtCloseFactorPct !== newMarket.liquidationMaxDebtCloseFactorPct) {
        updateLendingMarketIxnsArgs.push({
          mode: UpdateLendingMarketMode.UpdateLiquidationCloseFactor.discriminator,
          value: updateMarketConfigEncodedValue(
            UpdateLendingMarketMode.UpdateLiquidationCloseFactor.discriminator,
            newMarket.liquidationMaxDebtCloseFactorPct
          ),
        });
      }
    } else if (key === 'insolvencyRiskUnhealthyLtvPct') {
      if (market.insolvencyRiskUnhealthyLtvPct !== newMarket.insolvencyRiskUnhealthyLtvPct) {
        updateLendingMarketIxnsArgs.push({
          mode: UpdateLendingMarketMode.UpdateInsolvencyRiskLtv.discriminator,
          value: updateMarketConfigEncodedValue(
            UpdateLendingMarketMode.UpdateInsolvencyRiskLtv.discriminator,
            newMarket.insolvencyRiskUnhealthyLtvPct
          ),
        });
      }
    } else if (key === 'minFullLiquidationValueThreshold') {
      if (!market.minFullLiquidationValueThreshold.eq(newMarket.minFullLiquidationValueThreshold)) {
        updateLendingMarketIxnsArgs.push({
          mode: UpdateLendingMarketMode.UpdateMinFullLiquidationThreshold.discriminator,
          value: updateMarketConfigEncodedValue(
            UpdateLendingMarketMode.UpdateMinFullLiquidationThreshold.discriminator,
            newMarket.minFullLiquidationValueThreshold.toNumber()
          ),
        });
      }
    } else if (key === 'maxLiquidatableDebtMarketValueAtOnce') {
      if (!market.maxLiquidatableDebtMarketValueAtOnce.eq(newMarket.maxLiquidatableDebtMarketValueAtOnce)) {
        updateLendingMarketIxnsArgs.push({
          mode: UpdateLendingMarketMode.UpdateLiquidationMaxValue.discriminator,
          value: updateMarketConfigEncodedValue(
            UpdateLendingMarketMode.UpdateLiquidationMaxValue.discriminator,
            newMarket.maxLiquidatableDebtMarketValueAtOnce.toNumber()
          ),
        });
      }
    } else if (key === 'globalUnhealthyBorrowValue') {
      if (!market.globalUnhealthyBorrowValue.eq(newMarket.globalUnhealthyBorrowValue)) {
        updateLendingMarketIxnsArgs.push({
          mode: UpdateLendingMarketMode.UpdateGlobalUnhealthyBorrow.discriminator,
          value: updateMarketConfigEncodedValue(
            UpdateLendingMarketMode.UpdateGlobalUnhealthyBorrow.discriminator,
            newMarket.globalUnhealthyBorrowValue.toNumber()
          ),
        });
      }
    } else if (key === 'globalAllowedBorrowValue') {
      if (!market.globalAllowedBorrowValue.eq(newMarket.globalAllowedBorrowValue)) {
        updateLendingMarketIxnsArgs.push({
          mode: UpdateLendingMarketMode.UpdateGlobalAllowedBorrow.discriminator,
          value: updateMarketConfigEncodedValue(
            UpdateLendingMarketMode.UpdateGlobalAllowedBorrow.discriminator,
            newMarket.globalAllowedBorrowValue.toNumber()
          ),
        });
      }
    } else if (key === 'riskCouncil') {
      if (!market.riskCouncil.equals(newMarket.riskCouncil)) {
        updateLendingMarketIxnsArgs.push({
          mode: UpdateLendingMarketMode.UpdateRiskCouncil.discriminator,
          value: updateMarketConfigEncodedValue(
            UpdateLendingMarketMode.UpdateRiskCouncil.discriminator,
            newMarket.riskCouncil
          ),
        });
      }
    } else if (key === 'minNetValueInObligationSf') {
      if (!market.minNetValueInObligationSf.eq(newMarket.minNetValueInObligationSf)) {
        updateLendingMarketIxnsArgs.push({
          mode: UpdateLendingMarketMode.UpdateMinNetValueObligationPostAction.discriminator,
          value: updateMarketConfigEncodedValue(
            UpdateLendingMarketMode.UpdateMinNetValueObligationPostAction.discriminator,
            newMarket.minNetValueInObligationSf.toString()
          ),
        });
      }
    } else if (key === 'minValueSkipLiquidationLtvBfChecks') {
      if (!market.minValueSkipLiquidationLtvBfChecks.eq(newMarket.minValueSkipLiquidationLtvBfChecks)) {
        updateLendingMarketIxnsArgs.push({
          mode: UpdateLendingMarketMode.UpdateMinValueSkipPriorityLiqCheck.discriminator,
          value: updateMarketConfigEncodedValue(
            UpdateLendingMarketMode.UpdateMinValueSkipPriorityLiqCheck.discriminator,
            newMarket.minValueSkipLiquidationLtvBfChecks.toNumber()
          ),
        });
      }
    } else if (key === 'elevationGroups') {
      let elevationGroupsDiffs = 0;
      for (let i = 0; i < market.elevationGroups.length; i++) {
        if (
          market.elevationGroups[i].id !== newMarket.elevationGroups[i].id ||
          market.elevationGroups[i].maxLiquidationBonusBps !== newMarket.elevationGroups[i].maxLiquidationBonusBps ||
          market.elevationGroups[i].ltvPct !== newMarket.elevationGroups[i].ltvPct ||
          market.elevationGroups[i].liquidationThresholdPct !== newMarket.elevationGroups[i].liquidationThresholdPct ||
          market.elevationGroups[i].allowNewLoans !== newMarket.elevationGroups[i].allowNewLoans ||
          market.elevationGroups[i].maxReservesAsCollateral !== newMarket.elevationGroups[i].maxReservesAsCollateral ||
          !market.elevationGroups[i].debtReserve.equals(newMarket.elevationGroups[i].debtReserve)
        ) {
          updateLendingMarketIxnsArgs.push({
            mode: UpdateLendingMarketMode.UpdateElevationGroup.discriminator,
            value: updateMarketConfigEncodedValue(
              UpdateLendingMarketMode.UpdateElevationGroup.discriminator,
              newMarket.elevationGroups[i]
            ),
          });
          elevationGroupsDiffs++;
        }
      }
      if (elevationGroupsDiffs > 1) {
        throw new Error('Can only update 1 elevation group at a time');
      }
    } else if (key === 'name') {
      if (!sameLengthArrayEquals(market.name, newMarket.name)) {
        updateLendingMarketIxnsArgs.push({
          mode: UpdateLendingMarketMode.UpdateName.discriminator,
          value: updateMarketConfigEncodedValue(UpdateLendingMarketMode.UpdateName.discriminator, newMarket.name),
        });
      }
    }
  } // for loop

  const ixns: TransactionInstruction[] = [];

  updateLendingMarketIxnsArgs.forEach((updateLendingMarketConfigArgs) => {
    ixns.push(
      updateMarketConfigIx(
        marketWithAddress,
        updateLendingMarketConfigArgs.mode,
        updateLendingMarketConfigArgs.value,
        programId
      )
    );
  });

  return ixns;
}

function updateMarketConfigEncodedValue(
  discriminator: number,
  value: number | number[] | PublicKey | ElevationGroup | string
): Buffer {
  let buffer: Buffer = Buffer.alloc(72);
  let pkBuffer: Buffer;
  let valueBigInt: bigint;
  let valueArray: number[];

  switch (discriminator) {
    case UpdateLendingMarketMode.UpdateEmergencyMode.discriminator:
    case UpdateLendingMarketMode.UpdateLiquidationCloseFactor.discriminator:
    case UpdateLendingMarketMode.UpdateInsolvencyRiskLtv.discriminator:
    case UpdateLendingMarketMode.UpdatePriceRefreshTriggerToMaxAgePct.discriminator:
    case UpdateLendingMarketMode.UpdateAutodeleverageEnabled.discriminator:
    case UpdateLendingMarketMode.UpdateBorrowingDisabled.discriminator:
      buffer.writeUIntLE(value as number, 0, 1);
      break;
    case UpdateLendingMarketMode.UpdateReferralFeeBps.discriminator:
      buffer.writeUInt16LE(value as number, 0);
      break;
    case UpdateLendingMarketMode.UpdateLiquidationMaxValue.discriminator:
    case UpdateLendingMarketMode.UpdateGlobalAllowedBorrow.discriminator:
    case UpdateLendingMarketMode.UpdateGlobalUnhealthyBorrow.discriminator:
    case UpdateLendingMarketMode.UpdateMinFullLiquidationThreshold.discriminator:
    case UpdateLendingMarketMode.UpdateMinValueSkipPriorityLiqCheck.discriminator:
      value = value as number;
      buffer.writeBigUint64LE(BigInt(value), 0);
      break;
    case UpdateLendingMarketMode.UpdateOwner.discriminator:
    case UpdateLendingMarketMode.UpdateRiskCouncil.discriminator:
      pkBuffer = (value as PublicKey).toBuffer();
      pkBuffer.copy(buffer, 0);
      break;
    case UpdateLendingMarketMode.UpdateElevationGroup.discriminator:
      buffer = serializeElevationGroup(value as ElevationGroup);
      break;
    case UpdateLendingMarketMode.UpdateMinNetValueObligationPostAction.discriminator:
      valueBigInt = BigInt(value as string);
      for (let i = 0; i < 16; i++) {
        buffer[15 - i] = Number((valueBigInt >> BigInt(i * 8)) & BigInt(0xff));
      }
      break;
    case UpdateLendingMarketMode.UpdateName.discriminator:
      valueArray = value as number[];
      for (let i = 0; i < valueArray.length; i++) {
        buffer.writeUIntLE(valueArray[i], i, 1);
      }
      break;
  }

  return buffer;
}

function updateMarketConfigIx(
  marketWithAddress: MarketWithAddress,
  modeDiscriminator: number,
  value: Buffer,
  programId: PublicKey
): TransactionInstruction {
  value;
  const accounts: UpdateLendingMarketAccounts = {
    lendingMarketOwner: marketWithAddress.state.lendingMarketOwner,
    lendingMarket: marketWithAddress.address,
  };

  const args: UpdateLendingMarketArgs = {
    mode: new anchor.BN(modeDiscriminator),
    value: [...value],
  };

  const ix = updateLendingMarket(args, accounts, programId);

  return ix;
}

function serializeElevationGroup(elevationGroup: ElevationGroup): Buffer {
  const buffer = Buffer.alloc(72);
  buffer.writeUInt16LE(elevationGroup.maxLiquidationBonusBps, 0);
  buffer.writeUIntLE(elevationGroup.id, 2, 1);
  buffer.writeUIntLE(elevationGroup.ltvPct, 3, 1);
  buffer.writeUIntLE(elevationGroup.liquidationThresholdPct, 4, 1);
  buffer.writeUIntLE(elevationGroup.allowNewLoans, 5, 1);
  buffer.writeUIntLE(elevationGroup.maxReservesAsCollateral, 6, 1);
  buffer.writeUIntLE(elevationGroup.padding0, 7, 1);
  const debtReserveBuffer = elevationGroup.debtReserve.toBuffer();
  debtReserveBuffer.copy(buffer, 8);
  return buffer;
}
