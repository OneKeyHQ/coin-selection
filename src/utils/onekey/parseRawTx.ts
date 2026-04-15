import * as CardanoWasm from '@emurgo/cardano-serialization-lib-asmjs';

export type IParsedRawTxInput = {
  prev_hash: string;
  prev_index: number;
};

export type IParsedRawTxBodyStakeInfo = {
  hasCertificates: boolean;
  hasWithdrawals: boolean;
  requiredSignerHashes: string[];
};

export const parseRawTxInputs = (
  rawTxHex: string,
): Promise<IParsedRawTxInput[]> => {
  const tx = CardanoWasm.Transaction.from_hex(rawTxHex);
  const inputs = tx.body().inputs();
  const out: IParsedRawTxInput[] = [];
  for (let i = 0; i < inputs.len(); i += 1) {
    const input = inputs.get(i);
    out.push({
      prev_hash: input.transaction_id().to_hex(),
      prev_index: input.index(),
    });
  }
  return Promise.resolve(out);
};

export const parseRawTxBodyStakeInfo = (
  rawTxHex: string,
): Promise<IParsedRawTxBodyStakeInfo> => {
  const tx = CardanoWasm.Transaction.from_hex(rawTxHex);
  const body = tx.body();

  const certs = body.certs();
  const hasCertificates = !!certs && certs.len() > 0;

  const withdrawals = body.withdrawals();
  const hasWithdrawals = !!withdrawals && withdrawals.keys().len() > 0;

  const requiredSigners = body.required_signers();
  const requiredSignerHashes: string[] = [];
  if (requiredSigners) {
    for (let i = 0; i < requiredSigners.len(); i += 1) {
      requiredSignerHashes.push(requiredSigners.get(i).to_hex());
    }
  }

  return Promise.resolve({
    hasCertificates,
    hasWithdrawals,
    requiredSignerHashes,
  });
};

// Returns the hex stake key hash for key-credential base addresses (types 0
// and 1 in Cardano address layout); returns null for script-credential stakes
// or non-base addresses. Caller should treat null as "cannot safely filter
// stake witness".
export const extractStakeKeyHashFromBaseAddress = (
  addr: string,
): Promise<string | null> => {
  try {
    const address = CardanoWasm.Address.from_bech32(addr);
    const baseAddress = CardanoWasm.BaseAddress.from_address(address);
    if (!baseAddress) return Promise.resolve(null);
    const stakeCred = baseAddress.stake_cred();
    if (stakeCred.kind() !== CardanoWasm.CredKind.Key) {
      return Promise.resolve(null);
    }
    // spell-checker:disable-next-line
    const stakeKey = stakeCred.to_keyhash();
    if (!stakeKey) return Promise.resolve(null);
    return Promise.resolve(stakeKey.to_hex());
  } catch {
    return Promise.resolve(null);
  }
};
