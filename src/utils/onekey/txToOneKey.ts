// @ts-nocheck
import * as CardanoWasm from '@emurgo/cardano-serialization-lib-asmjs';
import type { IChangeAddress } from './types';

export enum CardanoAddressType {
  BASE = 0,
  BASE_SCRIPT_KEY = 1,
  BASE_KEY_SCRIPT = 2,
  BASE_SCRIPT_SCRIPT = 3,
  POINTER = 4,
  POINTER_SCRIPT = 5,
  ENTERPRISE = 6,
  ENTERPRISE_SCRIPT = 7,
  BYRON = 8,
  REWARD = 14,
  REWARD_SCRIPT = 15,
}

export enum CardanoTxSigningMode {
  ORDINARY_TRANSACTION = 0,
  POOL_REGISTRATION_AS_OWNER = 1,
  MULTISIG_TRANSACTION = 2,
  PLUTUS_TRANSACTION = 3,
}

export enum CardanoCertificateType {
  STAKE_REGISTRATION = 0,
  STAKE_DEREGISTRATION = 1,
  STAKE_DELEGATION = 2,
  STAKE_POOL_REGISTRATION = 3,
}

export enum CardanoPoolRelayType {
  SINGLE_HOST_IP = 0,
  SINGLE_HOST_NAME = 1,
  MULTIPLE_HOST_NAME = 2,
}

type Key = { hash: string | null; path: string | null };
type Keys = { payment: Key; stake: Key };

const generateKeys = (keys: Keys, xpub: string) => {
  const publicKey = CardanoWasm.Bip32PublicKey.from_bytes(
    Buffer.from(xpub, 'hex'),
  );

  const paymentKeyHashRaw = publicKey.derive(0).derive(0).to_raw_key().hash();
  const stakeKeyHashRaw = publicKey.derive(2).derive(0).to_raw_key().hash();

  const paymentKeyHash = Buffer.from(paymentKeyHashRaw.to_bytes()).toString(
    'hex',
  );

  const stakeKeyHash = Buffer.from(stakeKeyHashRaw.to_bytes()).toString('hex');

  return {
    payment: { ...keys.payment, hash: paymentKeyHash },
    stake: { ...keys.stake, hash: stakeKeyHash },
  };
};

const outputsToOneKey = (outputs: any, changeAddress: IChangeAddress) => {
  const onekeyOutputs = [];
  for (let i = 0; i < outputs.len(); i++) {
    const output = outputs.get(i);
    const multiAsset = output.amount().multiasset();
    let tokenBundle = null;
    if (multiAsset) {
      tokenBundle = [];
      for (let j = 0; j < multiAsset.keys().len(); j++) {
        const policy = multiAsset.keys().get(j);
        const assets = multiAsset.get(policy);
        const tokens = [];
        for (let k = 0; k < assets.keys().len(); k++) {
          const assetName = assets.keys().get(k);
          const amount = assets.get(assetName).to_str();
          tokens.push({
            assetNameBytes: Buffer.from(assetName.name()).toString('hex'),
            amount,
          });
        }
        // sort canonical
        tokens.sort((a, b) => {
          if (a.assetNameBytes.length == b.assetNameBytes.length) {
            return a.assetNameBytes > b.assetNameBytes ? 1 : -1;
          } else if (a.assetNameBytes.length > b.assetNameBytes.length)
            return 1;
          else return -1;
        });
        tokenBundle.push({
          policyId: Buffer.from(policy.to_bytes()).toString('hex'),
          tokenAmounts: tokens,
        });
      }
    }
    const outputAddressBech32 = output.address().to_bech32();

    const outputAddressHuman = (() => {
      try {
        return CardanoWasm.BaseAddress.from_address(output.address())
          .to_address()
          .to_bech32();
      } catch (e) {
        // ignore
      }
      try {
        return CardanoWasm.EnterpriseAddress.from_address(output.address())
          .to_address()
          .to_bech32();
      } catch (e) {
        // ignore
      }
      try {
        return CardanoWasm.PointerAddress.from_address(output.address())
          .to_address()
          .to_bech32();
      } catch (e) {
        // ignore
      }
      return CardanoWasm.ByronAddress.from_address(
        output.address(),
      ).to_base58();
    })();

    const destination =
      outputAddressBech32 === changeAddress.address
        ? {
            addressParameters: {
              addressType: CardanoAddressType.BASE,
              path: changeAddress.addressParameters.path,
              stakingPath: changeAddress.addressParameters.stakingPath,
            },
          }
        : {
            address: outputAddressHuman,
          };
    // https://github.com/dcSpark/cardano-multiplatform-lib/blob/c6a6d110065e98ed50640c7380d12748856608cf/chain/rust/src/transaction/mod.rs#L87
    // https://github.com/dcSpark/cardano-multiplatform-lib/blob/c6a6d110065e98ed50640c7380d12748856608cf/chain/rust/src/transaction/mod.rs#L117-L136
    // data_hash    : kind = 0
    // plutus_data  : kind = 1

    const datumHash = output.has_data_hash()
      ? output.data_hash().to_hex()
      : null;

    const inlineDatum = output.has_plutus_data()
      ? output.plutus_data().to_hex()
      : null;

    // const datumHash =
    //   output.datum() && output.datum().kind() === 0
    //     ? Buffer.from(output.datum().as_data_hash().to_bytes()).toString('hex')
    //     : null;
    // const inlineDatum =
    //   output.datum() && output.datum().kind() === 1
    //     ? Buffer.from(output.datum().as_data().get().to_bytes()).toString('hex')
    //     : null;
    const referenceScript = output.script_ref()
      ? Buffer.from(output.script_ref().get().to_bytes()).toString('hex')
      : null;
    const outputRes = {
      amount: output.amount().coin().to_str(),
      tokenBundle,
      datumHash,
      // https://github.com/input-output-hk/nami/commit/a5f5a9357da81307bff9bc77ef2476f1746c134a#diff-1c7110974e24c349d96acac1989fe76c94b0031ab0f5a114e10823e5d74549deR421-R423
      format: Buffer.from(output.to_bytes()).toString('hex').startsWith('a')
        ? 1
        : 0,
      inlineDatum,
      referenceScript,
      ...destination,
    };
    if (!tokenBundle) delete outputRes.tokenBundle;
    if (!datumHash) delete outputRes.datumHash;
    if (!inlineDatum) delete outputRes.inlineDatum;
    if (!referenceScript) delete outputRes.referenceScript;
    onekeyOutputs.push(outputRes);
  }
  return onekeyOutputs;
};

/**
 *
 * @param {Transaction} tx
 */
export const txToOneKey = async (
  rawTx: string,
  network: number,
  initKeys: Keys,
  xpub: string,
  changeAddress: IChangeAddress,
) => {
  const keys = generateKeys(initKeys, xpub);
  const tx = CardanoWasm.Transaction.from_bytes(Buffer.from(rawTx, 'hex'));

  let signingMode = CardanoTxSigningMode.ORDINARY_TRANSACTION;

  const outputs = tx.body().outputs();
  const onekeyOutputs = outputsToOneKey(outputs, changeAddress);

  let onekeyCertificates: [] | null = null;
  const certificates = tx.body().certs();
  if (certificates) {
    onekeyCertificates = [];
    for (let i = 0; i < certificates.len(); i++) {
      const cert = certificates.get(i);
      const certificate: any = {};
      if (cert.kind() === 0) {
        const credential = cert.as_stake_registration()?.stake_credential();
        certificate.type = CardanoCertificateType.STAKE_REGISTRATION;
        if (credential?.kind() === 0) {
          certificate.path = keys.stake.path;
        } else {
          const scriptHash = Buffer.from(
            credential.to_scripthash().to_bytes(),
          ).toString('hex');
          certificate.scriptHash = scriptHash;
        }
      } else if (cert.kind() === 1) {
        const credential = cert.as_stake_deregistration().stake_credential();
        certificate.type = CardanoCertificateType.STAKE_DEREGISTRATION;
        if (credential.kind() === 0) {
          certificate.path = keys.stake.path;
        } else {
          const scriptHash = Buffer.from(
            credential.to_scripthash().to_bytes(),
          ).toString('hex');
          certificate.scriptHash = scriptHash;
        }
      } else if (cert.kind() === 2) {
        const delegation = cert.as_stake_delegation();
        const credential = delegation.stake_credential();
        const poolKeyHashHex = Buffer.from(
          delegation.pool_keyhash().to_bytes(),
        ).toString('hex');
        certificate.type = CardanoCertificateType.STAKE_DELEGATION;
        if (credential.kind() === 0) {
          certificate.path = keys.stake.path;
        } else {
          const scriptHash = Buffer.from(
            credential.to_scripthash().to_bytes(),
          ).toString('hex');
          certificate.scriptHash = scriptHash;
        }
        certificate.pool = poolKeyHashHex;
      } else if (cert.kind() === 3) {
        const params = cert.as_pool_registration().pool_params();
        certificate.type = CardanoCertificateType.STAKE_POOL_REGISTRATION;
        const owners = params.pool_owners();
        const poolOwners = [];
        for (let i = 0; i < owners.len(); i++) {
          const keyHash = Buffer.from(owners.get(i).to_bytes()).toString('hex');
          if (keyHash == keys.stake.hash) {
            signingMode = CardanoTxSigningMode.POOL_REGISTRATION_AS_OWNER;
            poolOwners.push({
              stakingKeyPath: keys.stake.path,
            });
          } else {
            poolOwners.push({
              stakingKeyHash: keyHash,
            });
          }
        }
        const relays = params.relays();
        const onekeyRelays = [];
        for (let i = 0; i < relays.len(); i++) {
          const relay = relays.get(i);
          if (relay.kind() === 0) {
            const singleHostAddr = relay.as_single_host_addr();
            const type = CardanoPoolRelayType.SINGLE_HOST_IP;
            const port = singleHostAddr.port();
            const ipv4Address = singleHostAddr.ipv4()
              ? bytesToIp(singleHostAddr.ipv4().ip())
              : null;
            const ipv6Address = singleHostAddr.ipv6()
              ? bytesToIp(singleHostAddr.ipv6().ip())
              : null;
            onekeyRelays.push({ type, port, ipv4Address, ipv6Address });
          } else if (relay.kind() === 1) {
            const type = CardanoPoolRelayType.SINGLE_HOST_NAME;
            const singleHostName = relay.as_single_host_name();
            const port = singleHostName.port();
            const hostName = singleHostName.dns_name().record();
            onekeyRelays.push({
              type,
              port,
              hostName,
            });
          } else if (relay.kind() === 2) {
            const type = CardanoPoolRelayType.MULTIPLE_HOST_NAME;
            const multiHostName = relay.as_multi_host_name();
            const hostName = multiHostName.dns_name();
            onekeyRelays.push({
              type,
              hostName,
            });
          }
        }
        const cost = params.cost().to_str();
        const margin = params.margin();
        const pledge = params.pledge().to_str();
        const poolId = Buffer.from(params.operator().to_bytes()).toString(
          'hex',
        );
        const metadata = params.pool_metadata()
          ? {
              url: params.pool_metadata().url().url(),
              hash: Buffer.from(
                params.pool_metadata().pool_metadata_hash().to_bytes(),
              ).toString('hex'),
            }
          : null;
        const rewardAccount = params.reward_account().to_address().to_bech32();
        const vrfKeyHash = Buffer.from(
          params.vrf_keyhash().to_bytes(),
        ).toString('hex');

        certificate.poolParameters = {
          poolId,
          vrfKeyHash,
          pledge,
          cost,
          margin: {
            numerator: margin.numerator().to_str(),
            denominator: margin.denominator().to_str(),
          },
          rewardAccount,
          owners: poolOwners,
          relays: onekeyRelays,
          metadata,
        };
      }
      onekeyCertificates.push(certificate);
    }
  }
  const fee = tx.body().fee().to_str();
  const ttl = tx.body().ttl();
  const withdrawals = tx.body().withdrawals();
  let onekeyWithdrawals = null;
  if (withdrawals) {
    onekeyWithdrawals = [];
    for (let i = 0; i < withdrawals.keys().len(); i++) {
      const withdrawal = {};
      const rewardAddress = withdrawals.keys().get(i);
      if (rewardAddress.payment_cred().kind() === 0) {
        withdrawal.path = keys.stake.path;
      } else {
        withdrawal.scriptHash = Buffer.from(
          rewardAddress.payment_cred().to_scripthash().to_bytes(),
        ).toString('hex');
      }
      withdrawal.amount = withdrawals.get(rewardAddress).to_str();
      onekeyWithdrawals.push(withdrawal);
    }
  }
  const auxiliaryData = tx.body().auxiliary_data_hash()
    ? {
        hash: Buffer.from(tx.body().auxiliary_data_hash().to_bytes()).toString(
          'hex',
        ),
      }
    : null;
  const validityIntervalStart = tx.body().validity_start_interval()
    ? tx.body().validity_start_interval().to_str()
    : null;

  const mint = tx.body().mint();
  let additionalWitnessRequests = null;
  let mintBundle = null;
  if (mint) {
    mintBundle = [];
    for (let j = 0; j < mint.keys().len(); j++) {
      const policy = mint.keys().get(j);
      const assets = mint.get(policy);
      const tokens = [];
      for (let k = 0; k < assets.keys().len(); k++) {
        const assetName = assets.keys().get(k);
        const amount = assets.get(assetName);
        tokens.push({
          assetNameBytes: Buffer.from(assetName.name()).toString('hex'),
          mintAmount: amount.is_positive()
            ? amount.as_positive().to_str()
            : '-' + amount.as_negative().to_str(),
        });
      }
      // sort canonical
      tokens.sort((a, b) => {
        if (a.assetNameBytes.length == b.assetNameBytes.length) {
          return a.assetNameBytes > b.assetNameBytes ? 1 : -1;
        } else if (a.assetNameBytes.length > b.assetNameBytes.length) return 1;
        else return -1;
      });
      mintBundle.push({
        policyId: Buffer.from(policy.to_bytes()).toString('hex'),
        tokenAmounts: tokens,
      });
    }
    additionalWitnessRequests = [];
    if (keys.payment.path) additionalWitnessRequests.push(keys.payment.path);
    if (keys.stake.path) additionalWitnessRequests.push(keys.stake.path);
  }

  // Plutus
  const scriptDataHash = tx.body().script_data_hash()
    ? Buffer.from(tx.body().script_data_hash().to_bytes()).toString('hex')
    : null;

  let collateralInputs = null;
  if (tx.body().collateral()) {
    collateralInputs = [];
    const coll = tx.body().collateral();
    for (let i = 0; i < coll.len(); i++) {
      const input = coll.get(i);
      if (keys.payment.path) {
        collateralInputs.push({
          prev_hash: Buffer.from(input.transaction_id().to_bytes()).toString(
            'hex',
          ),
          prev_index: parseInt(input.index()),
          path: keys.payment.path, // needed to include payment key witness if available
        });
      } else {
        collateralInputs.push({
          prev_hash: Buffer.from(input.transaction_id().to_bytes()).toString(
            'hex',
          ),
          prev_index: parseInt(input.index()),
        });
      }
      signingMode = CardanoTxSigningMode.PLUTUS_TRANSACTION;
    }
  }

  let requiredSigners = null;
  if (tx.body().required_signers()) {
    requiredSigners = [];
    const r = tx.body().required_signers();
    for (let i = 0; i < r.len(); i++) {
      const signer = Buffer.from(r.get(i).to_bytes()).toString('hex');
      if (signer === keys.payment.hash) {
        requiredSigners.push({
          keyPath: keys.payment.path,
        });
      } else if (signer === keys.stake.hash) {
        // https://github.com/input-output-hk/nami/commit/a5f5a9357da81307bff9bc77ef2476f1746c134a#diff-1c7110974e24c349d96acac1989fe76c94b0031ab0f5a114e10823e5d74549deR421-R423
        requiredSigners.push({
          keyPath: keys.stake.path,
        });
      } else {
        requiredSigners.push({
          keyHash: signer,
        });
      }
    }
    signingMode = CardanoTxSigningMode.PLUTUS_TRANSACTION;
  }

  let referenceInputs = null;
  if (tx.body().reference_inputs()) {
    referenceInputs = [];
    const ri = tx.body().reference_inputs();
    for (let i = 0; i < ri.len(); i++) {
      referenceInputs.push({
        prev_hash: ri.get(i).transaction_id().to_hex(),
        prev_index: parseInt(ri.get(i).index().to_str()),
      });
    }
    signingMode = CardanoTxSigningMode.PLUTUS_TRANSACTION;
  }

  const totalCollateral = tx.body().total_collateral()
    ? tx.body().total_collateral().to_str()
    : null;

  const collateralReturn = (() => {
    if (tx.body().collateral_return()) {
      const outputs = CardanoWasm.TransactionOutputs.new();
      outputs.add(tx.body().collateral_return());
      const [out] = outputsToOneKey(outputs, changeAddress);
      return out;
    }
    return null;
  })();

  const includeNetworkId = !!tx.body().network_id();

  const onekeyTx = {
    signingMode,
    outputs: onekeyOutputs,
    fee,
    ttl: ttl ? `${ttl}` : null,
    validityIntervalStart,
    certificates: onekeyCertificates,
    withdrawals: onekeyWithdrawals,
    auxiliaryData,
    mint: mintBundle,
    scriptDataHash,
    collateralInputs,
    requiredSigners,
    protocolMagic: network === 1 ? 764824073 : 42,
    networkId: network,
    includeNetworkId,
    additionalWitnessRequests,
    collateralReturn,
    totalCollateral,
    referenceInputs,
  };
  Object.keys(onekeyTx).forEach(
    key => !onekeyTx[key] && onekeyTx[key] != 0 && delete onekeyTx[key],
  );
  console.log('format onekey cardano hardware Tx =====>>> : ', onekeyTx);
  return Promise.resolve(onekeyTx);
};

const bytesToIp = bytes => {
  if (!bytes) return null;
  if (bytes.length === 4) {
    return { ipv4: bytes.join('.') };
  } else if (bytes.length === 16) {
    let ipv6 = '';
    for (let i = 0; i < bytes.length; i += 2) {
      ipv6 += bytes[i].toString(16) + bytes[i + 1].toString(16) + ':';
    }
    ipv6 = ipv6.slice(0, -1);
    return { ipv6 };
  }
  return null;
};
