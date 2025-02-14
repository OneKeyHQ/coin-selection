import * as CardanoWasm from '@emurgo/cardano-serialization-lib-asmjs';

export const hasSetTagWithBody = (txBodyHex: string) => {
  const txBody = CardanoWasm.TransactionBody.from_bytes(
    Uint8Array.from(Buffer.from(txBodyHex, 'hex')),
  );
  const witnesses = CardanoWasm.TransactionWitnessSet.new();
  const tx = CardanoWasm.Transaction.new(txBody, witnesses);

  let tagCborSets = false;
  try {
    const tagCBOR = CardanoWasm.has_transaction_set_tag(
      tx.to_bytes(),
    ).valueOf();
    tagCborSets =
      tagCBOR === CardanoWasm.TransactionSetsState.AllSetsHaveTag.valueOf() ||
      tagCBOR === CardanoWasm.TransactionSetsState.MixedSets.valueOf();
  } catch (error) {
    // ignore
  }

  return tagCborSets;
};
