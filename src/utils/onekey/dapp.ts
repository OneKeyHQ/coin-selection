/* eslint-disable @typescript-eslint/no-non-null-assertion */
import * as CardanoWasm from '@emurgo/cardano-serialization-lib-asmjs';
import * as CardanoMessage from '@emurgo/cardano-message-signing-asmjs/cardano_message_signing';
import BigNumber from 'bignumber.js';
import { getUtxos as getRawUtxos, requestAccountKey } from './signTx';
import { DataSignError } from './error';
import { CoinSelectionError } from '../errors';
import { ERROR } from '../../constants';
import {
  IAdaAmount,
  IAdaUTXO,
  IEncodedTxADA,
  IEncodeInput,
  IEncodeOutput,
  IStakingInfo,
  ICardanoCertificate,
  CardanoCertificateType,
  IConvertCborTxParams,
} from './types';

const getBalance = async (balances: IAdaAmount[]) => {
  const value = await assetsToValue(balances);
  return Buffer.from(value.to_bytes() as any, 'hex').toString('hex');
};

export const assetsToValue = async (assets: IAdaAmount[]) => {
  const multiAsset = CardanoWasm.MultiAsset.new();
  const lovelace = assets.find(asset => asset.unit === 'lovelace');
  const policies = [
    ...new Set(
      assets
        .filter(asset => asset.unit !== 'lovelace')
        .map(asset => asset.unit.slice(0, 56)),
    ),
  ];
  policies.forEach(policy => {
    const policyAssets = assets.filter(
      asset => asset.unit.slice(0, 56) === policy,
    );
    const assetsValue = CardanoWasm.Assets.new();
    policyAssets.forEach(asset => {
      assetsValue.insert(
        CardanoWasm.AssetName.new(Buffer.from(asset.unit.slice(56), 'hex')),
        CardanoWasm.BigNum.from_str(asset.quantity),
      );
    });
    multiAsset.insert(
      CardanoWasm.ScriptHash.from_bytes(Buffer.from(policy as any, 'hex')),
      assetsValue,
    );
  });
  const value = CardanoWasm.Value.new(
    CardanoWasm.BigNum.from_str(lovelace ? lovelace.quantity : '0'),
  );
  if (assets.length > 1 || !lovelace) value.set_multiasset(multiAsset);
  return value;
};

const getAddresses = async (addresses: string[]) => {
  return addresses.map(address => {
    const addr = Buffer.from(
      CardanoWasm.Address.from_bech32(address).to_bytes() as any,
      'hex',
    ).toString('hex');
    return addr;
  });
};

const getUtxos = async (
  address: string,
  utxos: IAdaUTXO[],
  amount?: string,
) => {
  let converted: CardanoWasm.TransactionUnspentOutput[] | null | undefined =
    await getRawUtxos(address, utxos);
  // filter utxos
  if (amount) {
    let filterVaule;
    try {
      filterVaule = CardanoWasm.Value.from_bytes(Buffer.from(amount, 'hex'));
    } catch (e) {
      throw new Error('Invalid Request');
    }

    converted = converted?.filter(
      unspent =>
        !unspent.output().amount().compare(filterVaule) ||
        unspent.output().amount().compare(filterVaule) !== -1,
    );
  }

  if (amount && Array.isArray(converted) && converted.length <= 0) {
    return null;
  }

  return converted?.map(utxo =>
    Buffer.from(utxo.to_bytes() as any, 'hex').toString('hex'),
  );
};

const convertCborTxToEncodeTx = async ({
  txHex,
  utxos,
  addresses,
  changeAddress,
  isSignOnly,
}: IConvertCborTxParams): Promise<IEncodedTxADA> => {
  let body: CardanoWasm.TransactionBody;
  let rawTxHex: string;

  try {
    const tx = CardanoWasm.Transaction.from_bytes(Buffer.from(txHex, 'hex'));
    body = tx.body();
    rawTxHex = txHex;
  } catch {
    // Input is TransactionBody only (e.g., from staking providers like stakefish)
    // Build a complete Transaction with empty witness set
    body = CardanoWasm.TransactionBody.from_bytes(Buffer.from(txHex, 'hex'));
    const emptyWitnessSet = CardanoWasm.TransactionWitnessSet.new();
    const tx = CardanoWasm.Transaction.new(body, emptyWitnessSet);
    rawTxHex = Buffer.from(tx.to_bytes() as any, 'hex').toString('hex');
  }

  // Fee
  const fee = body.fee().to_str();
  const totalFeeInNative = new BigNumber(fee).shiftedBy(-1 * 6).toFixed();

  // Parse certificates first (needed to determine if this is a staking transaction)
  const certificates: ICardanoCertificate[] = [];
  let poolId: string | undefined;
  const certs = body.certs();
  if (certs) {
    const certsLen = certs.len();
    for (let i = 0; i < certsLen; i++) {
      const cert = certs.get(i);
      const certKind = cert.kind();

      // Stake Registration (kind = 0)
      if (certKind === CardanoWasm.CertificateKind.StakeRegistration) {
        const stakeReg = cert.as_stake_registration();
        if (stakeReg) {
          const stakeCredential = stakeReg.stake_credential();
          const keyHash = stakeCredential.to_keyhash();
          certificates.push({
            type: CardanoCertificateType.STAKE_REGISTRATION,
            stakeCredential: keyHash
              ? Buffer.from(keyHash.to_bytes() as any, 'hex').toString('hex')
              : undefined,
          });
        }
      }

      // Stake Deregistration (kind = 1)
      if (certKind === CardanoWasm.CertificateKind.StakeDeregistration) {
        const stakeDeReg = cert.as_stake_deregistration();
        if (stakeDeReg) {
          const stakeCredential = stakeDeReg.stake_credential();
          const keyHash = stakeCredential.to_keyhash();
          certificates.push({
            type: CardanoCertificateType.STAKE_DEREGISTRATION,
            stakeCredential: keyHash
              ? Buffer.from(keyHash.to_bytes() as any, 'hex').toString('hex')
              : undefined,
          });
        }
      }

      // Stake Delegation (kind = 2)
      if (certKind === CardanoWasm.CertificateKind.StakeDelegation) {
        const stakeDelegation = cert.as_stake_delegation();
        if (stakeDelegation) {
          const stakeCredential = stakeDelegation.stake_credential();
          const keyHash = stakeCredential.to_keyhash();
          const poolKeyHash = stakeDelegation.pool_keyhash();
          poolId = Buffer.from(poolKeyHash.to_bytes() as any, 'hex').toString(
            'hex',
          );
          certificates.push({
            type: CardanoCertificateType.STAKE_DELEGATION,
            stakeCredential: keyHash
              ? Buffer.from(keyHash.to_bytes() as any, 'hex').toString('hex')
              : undefined,
            poolKeyHash: poolId,
          });
        }
      }
    }
  }

  const isStakingTx = certificates.length > 0;
  const stakingInfo: IStakingInfo | undefined = isStakingTx
    ? { isStakingTx: true, certificates, poolId }
    : undefined;

  // inputs txs
  const encodeInputs: IEncodedTxADA['inputs'] = [];
  const inputs: { tx_hash: string; tx_index: number }[] = [];
  const inputsLen = body.inputs().len();
  for (let i = 0; i < inputsLen; i++) {
    const input = body.inputs().get(i);
    const txHash = Buffer.from(
      input.transaction_id().to_bytes() as any,
      'utf8',
    ).toString('hex');
    const index = input.index();
    inputs.push({ tx_hash: txHash, tx_index: index });
    const utxo = utxos.find(
      utxo => utxo.tx_hash === txHash && +utxo.tx_index === +index,
    );
    // Only push matched UTXOs, skip external inputs (e.g., from DeFi protocols)
    if (utxo) {
      encodeInputs.push(utxo as unknown as IEncodeInput);
    }
  }

  // outputs txs
  const outputs: IEncodeOutput[] = [];
  const outputsLen = body.outputs().len();

  // Staking transactions (delegation, registration, deregistration) can have empty outputs
  // Regular transactions must have at least one output
  if (outputsLen === 0 && !isStakingTx) {
    console.log('[convertCborTxToEncodeTx] Empty outputs detected, transaction data:', {
      fee,
      totalFeeInNative,
      inputsCount: inputsLen,
      inputs: inputs,
      matchedUtxos: encodeInputs.map(u => ({
        tx_hash: u.tx_hash,
        tx_index: u.tx_index,
        amount: u.amount,
      })),
    });
    throw new CoinSelectionError(ERROR.UTXO_BALANCE_INSUFFICIENT);
  }
  for (let i = 0; i < outputsLen; i++) {
    const output = body.outputs().get(i);
    const address = output.address().to_bech32();
    const amount = output.amount().coin().to_str();

    // get the asset from output
    const assetsArray: IAdaAmount[] = [];
    const multiasset = output.amount().multiasset();
    if (multiasset) {
      const keys = multiasset.keys(); // policy Ids of thee multiasset
      const N = keys.len();
      // (`${N} Multiassets in the UTXO`)

      for (let i = 0; i < N; i++) {
        const policyId = keys.get(i);
        const policyIdHex = Buffer.from(
          policyId.to_bytes() as any,
          'utf8',
        ).toString('hex');
        const assets = multiasset.get(policyId);
        if (assets) {
          const assetNames = assets.keys();
          const K = assetNames.len();

          for (let j = 0; j < K; j++) {
            const assetName = assetNames.get(j);
            const assetNameHex = Buffer.from(
              assetName.name() as any,
              'utf8',
            ).toString('hex');
            const multiassetAmt = multiasset.get_asset(policyId, assetName);
            assetsArray.push({
              unit: `${policyIdHex}${assetNameHex}`,
              quantity: multiassetAmt.to_str(),
            });
          }
        }
      }
    }
    // isChange: outputs length > 0 && address === changeAddress.address
    const isChange = i > 0 && address === changeAddress.address;
    outputs.push({
      amount: amount,
      address: address,
      assets: assetsArray,
      isChange,
    });
  }

  const totalSpent = outputs.length > 0
    ? BigNumber.sum(...outputs.map(o => o.amount)).toFixed()
    : '0';

  const token = outputs
    .filter(o => !addresses.includes(o.address))
    .find(o => o.assets.length > 0)?.assets?.[0].unit;

  // Determine 'from' address: prefer matched input, fallback to changeAddress
  const fromAddress =
    encodeInputs[0]?.address || changeAddress.address || '';

  // For staking transactions, 'to' can be the pool id or empty
  const toAddress = isStakingTx
    ? fromAddress || ''
    : outputs[0]?.address || '';

  const encodedTx: IEncodedTxADA = {
    inputs: encodeInputs.map(input => ({
      ...input,
      txHash: input.tx_hash,
      outputIndex: input.tx_index,
    })),
    outputs,
    fee,
    totalSpent,
    totalFeeInNative,
    transferInfo: {
      from: fromAddress,
      to: toAddress,
      amount: totalSpent,
      token,
    },
    tx: {
      body: body.to_hex(),
      hash: CardanoWasm.FixedTransaction.new_from_body_bytes(body.to_bytes())
        .transaction_hash()
        .to_hex(),
      size: 0,
      rawTxHex,
    },
    signOnly: isSignOnly,
    staking: stakingInfo,
  };

  console.log('Cardano DApp EncodedTx: ', encodedTx);

  return encodedTx;
};

const signData = async (
  address: string,
  payload: string,
  xprv: string,
  accountIndex: number,
) => {
  const keyHash = await extractKeyHash(address);
  if (!keyHash) {
    throw DataSignError.InvalidFormat;
  }
  const prefix = keyHash.startsWith('addr_vkh') ? 'addr_vkh' : 'stake_vkh';
  const { paymentKey, stakeKey } = await requestAccountKey(xprv, accountIndex);
  const accountKey = prefix === 'addr_vkh' ? paymentKey : stakeKey;
  const publicKey = accountKey.to_public();
  if (keyHash !== publicKey.hash().to_bech32(prefix))
    throw DataSignError.ProofGeneration;
  const protectedHeaders = CardanoMessage.HeaderMap.new();
  protectedHeaders.set_algorithm_id(
    CardanoMessage.Label.from_algorithm_id(CardanoMessage.AlgorithmId.EdDSA),
  );
  // protectedHeaders.set_key_id(publicKey.as_bytes()); // Removed to adhere to CIP-30
  protectedHeaders.set_header(
    CardanoMessage.Label.new_text('address'),
    CardanoMessage.CBORValue.new_bytes(Buffer.from(address, 'hex')),
  );
  const protectedSerialized =
    CardanoMessage.ProtectedHeaderMap.new(protectedHeaders);
  const unprotectedHeaders = CardanoMessage.HeaderMap.new();
  const headers = CardanoMessage.Headers.new(
    protectedSerialized,
    unprotectedHeaders,
  );
  const builder = CardanoMessage.COSESign1Builder.new(
    headers,
    Buffer.from(payload, 'hex'),
    false,
  );
  const toSign = builder.make_data_to_sign().to_bytes();

  const signedSigStruc = accountKey.sign(toSign).to_bytes();
  const coseSign1 = builder.build(signedSigStruc);

  stakeKey.free();
  paymentKey.free();

  const key = CardanoMessage.COSEKey.new(
    CardanoMessage.Label.from_key_type(CardanoMessage.KeyType.OKP),
  );
  key.set_algorithm_id(
    CardanoMessage.Label.from_algorithm_id(CardanoMessage.AlgorithmId.EdDSA),
  );
  key.set_header(
    CardanoMessage.Label.new_int(
      CardanoMessage.Int.new_negative(CardanoMessage.BigNum.from_str('1')),
    ),
    CardanoMessage.CBORValue.new_int(
      CardanoMessage.Int.new_i32(6), //CardanoMessage.CurveType.Ed25519
    ),
  ); // crv (-1) set to Ed25519 (6)
  key.set_header(
    CardanoMessage.Label.new_int(
      CardanoMessage.Int.new_negative(CardanoMessage.BigNum.from_str('2')),
    ),
    CardanoMessage.CBORValue.new_bytes(publicKey.as_bytes()),
  ); // x (-2) set to public key

  return {
    signature: Buffer.from(coseSign1.to_bytes()).toString('hex'),
    key: Buffer.from(key.to_bytes()).toString('hex'),
  };
};

export const extractKeyHash = async (address: string) => {
  try {
    const addr = CardanoWasm.BaseAddress.from_address(
      CardanoWasm.Address.from_bytes(Buffer.from(address, 'hex')),
    );
    return addr!.payment_cred()?.to_keyhash()!.to_bech32('addr_vkh');
  } catch (e) {
    // ignore
  }
  try {
    const addr = CardanoWasm.EnterpriseAddress.from_address(
      CardanoWasm.Address.from_bytes(Buffer.from(address, 'hex')),
    );
    return addr!.payment_cred().to_keyhash()!.to_bech32('addr_vkh');
  } catch (e) {
    // ignore
  }
  try {
    const addr = CardanoWasm.PointerAddress.from_address(
      CardanoWasm.Address.from_bytes(Buffer.from(address, 'hex')),
    );
    return addr!.payment_cred().to_keyhash()!.to_bech32('addr_vkh');
  } catch (e) {
    // ignore
  }
  try {
    const addr = CardanoWasm.RewardAddress.from_address(
      CardanoWasm.Address.from_bytes(Buffer.from(address, 'hex')),
    );
    return addr!.payment_cred().to_keyhash()!.to_bech32('stake_vkh');
  } catch (e) {
    // ignore
  }
  throw DataSignError.AddressNotPK;
};

export const dAppUtils = {
  getBalance,
  getAddresses,
  getUtxos,
  convertCborTxToEncodeTx,
  signData,
};
