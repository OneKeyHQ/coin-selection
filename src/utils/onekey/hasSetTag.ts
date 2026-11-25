import * as CardanoWasm from '@emurgo/cardano-serialization-lib-asmjs';

export const hasSetTagWithBody = (txBodyHex: string) => {
  const tx = CardanoWasm.FixedTransaction.new_from_body_bytes(
    Buffer.from(txBodyHex, 'hex'),
  );

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

  return Promise.resolve(tagCborSets);
};
